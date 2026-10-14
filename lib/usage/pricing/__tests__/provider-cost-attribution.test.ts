import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenAIImageUsageEvents } from '@/lib/usage/openai-image-usage'
import { summarizeUsage, type UsageEventView } from '@/lib/usage/provider-usage'
import { summarizeEstimatedCost } from '../aggregate'
import { costInputFromRow, deriveProviderUsageCost, type ProviderUsageCost, type ProviderUsageCostInput } from '../derive'
import { costState, describeCostCoverage, estimatedCostDetails, formatEstimatedAmount, unpricedReason } from '../presentation'
import type { PricingVersion } from '../registry'
import { GPT_IMAGE_2, VEO_FAST, VEO_LITE, VEO_STANDARD, registriesBeforeAndAfter } from './provider-cost-fixtures'

// PROVIDER_COST_ATTRIBUTION_V1 — OpenAI GPT Image 2 (per modality) and Google Veo (per second and resolution), derived on read from the
// reviewed registry (the SQL applied to a Production-shaped PGlite). Nothing here calls a provider or writes anything.

let before: PricingVersion[]
let after: PricingVersion[]
beforeAll(async () => {
  const registries = await registriesBeforeAndAfter()
  before = registries.before
  after = registries.after
}, 120_000)

const derive = (input: ProviderUsageCostInput, versions: readonly PricingVersion[] = after) => deriveProviderUsageCost(input, versions)

// ---- the REAL ledger rows (verbatim from Production, 2026-10-13/14), as the Settings route reads them -----------------------------
const OPENAI_USAGE = { inputTokens: 1054, totalTokens: 2810, outputTokens: 1756, inputTextTokens: 30, inputImageTokens: 1024, outputTextTokens: 0, outputImageTokens: 1756 }
const openaiRow = (unit: 'input_tokens' | 'output_tokens', quantity: string, extra: Record<string, unknown> = {}) => ({
  provider: 'openai', transport: 'rest', operation: 'image_generation', model: GPT_IMAGE_2, quantity, unit, measurement_source: 'provider_reported',
  occurred_at: '2026-10-13T17:20:39.575778+00:00',
  provider_metadata: { api: 'openai_images_edits', usage: OPENAI_USAGE, funding: 'user_byok', credential_source: 'user', provider_response: 'received' },
  ...extra,
})
const veoRow = (operation: string, seconds: number, occurred_at: string, extra: Record<string, unknown> = {}) => ({
  provider: 'gemini', transport: 'rest', operation, model: VEO_FAST, quantity: String(seconds), unit: 'seconds', measurement_source: 'derived', occurred_at,
  provider_metadata: { request: { audio: null, duration: seconds, multi_shot: null, resolution: '720p', aspect_ratio: '16:9', output_count: 1 } },
  ...extra,
})
const REAL = {
  openaiIn: openaiRow('input_tokens', '1054'),
  openaiOut: openaiRow('output_tokens', '1756'),
  t2v: veoRow('text_to_video', 4, '2026-10-14T00:22:26.001+00:00'),
  i2v: veoRow('image_to_video', 4, '2026-10-14T00:50:08.305+00:00'),
  ab: veoRow('image_to_video', 8, '2026-10-14T00:58:48.644+00:00'),
  klingAB: {
    provider: 'kling', transport: 'rest', operation: 'image_to_video', model: 'kling-v3', quantity: null, unit: null, measurement_source: 'unknown',
    occurred_at: '2026-10-14T10:21:38.788+00:00', provider_metadata: { request: { audio: 'off', duration: 5, multi_shot: false, resolution: '720p', aspect_ratio: null, output_count: 1 } },
  },
}
const fromRow = (row: Record<string, unknown>, versions: readonly PricingVersion[] = after) => derive(costInputFromRow(row), versions)
// Intl separates "US$" from the number with a no-break space; compare on a plain space.
const plain = (text: string) => text.replace(/ /g, ' ')
const amountOf = (cost: ProviderUsageCost) => {
  if (cost.status !== 'estimated' && cost.status !== 'simulated') throw new Error(`no amount on a ${cost.status} cost`)
  return Number(cost.amount)
}

describe('the registry the reviewed SQL produces', () => {
  it('prices GPT Image 2 per modality and Veo per second and resolution — and only those', () => {
    const added = after.filter((v) => !before.some((b) => b.id === v.id) && (v.model === GPT_IMAGE_2 || v.model.startsWith('veo-')))
    expect(added).toHaveLength(11)
    const key = (v: PricingVersion) => `${v.model}|${v.usageCategory}`
    const price = Object.fromEntries(added.map((v) => [key(v), `${Number(v.priceAmount) / Number(v.unitQuantity)}`]))
    // USD per token (1M tokens) and per second, exactly the official figures
    expect(Number(price[`${GPT_IMAGE_2}|input`]) * 1e6).toBeCloseTo(5, 6)
    expect(Number(price[`${GPT_IMAGE_2}|image_input`]) * 1e6).toBeCloseTo(8, 6)
    expect(Number(price[`${GPT_IMAGE_2}|image_output`]) * 1e6).toBeCloseTo(30, 6)
    expect(Object.fromEntries(Object.entries(price).filter(([k]) => k.startsWith('veo-')).map(([k, v]) => [k, Number(v)]))).toEqual({
      [`${VEO_STANDARD}|video_second_720p`]: 0.4, [`${VEO_STANDARD}|video_second_1080p`]: 0.4, [`${VEO_STANDARD}|video_second_4k`]: 0.6,
      [`${VEO_FAST}|video_second_720p`]: 0.1, [`${VEO_FAST}|video_second_1080p`]: 0.12, [`${VEO_FAST}|video_second_4k`]: 0.3,
      [`${VEO_LITE}|video_second_720p`]: 0.05, [`${VEO_LITE}|video_second_1080p`]: 0.08,
    })
    for (const version of added) {
      expect(version.currency).toBe('USD')
      expect(version.serviceTier).toBe('standard')
      expect(version.effectiveFromBasis).toBe('observed_at_source')
      expect(version.effectiveFrom).toBe(Date.parse('2026-10-14T00:00:00Z'))
      expect(version.effectiveTo).toBeNull()
    }
    // no Batch ($4 / $2.5 / $15), no cached-input price, no GPT Image text-output price
    expect(added.some((v) => v.usageCategory === 'cached_input')).toBe(false)
    expect(added.some((v) => v.model === GPT_IMAGE_2 && v.usageCategory === 'output')).toBe(false)
    expect(added.filter((v) => v.model === GPT_IMAGE_2).map((v) => Number(v.priceAmount))).toEqual(expect.not.arrayContaining([4, 2.5, 15]))
  })

  it('the existing registry rows are unchanged by the addition', () => {
    // ids are generated per database, so compare the price facts themselves
    const fact = (v: PricingVersion) => [v.provider, v.model, v.usageCategory, v.serviceTier, v.currency, `${v.priceAmount}`, v.effectiveFrom, v.effectiveTo].join('|')
    const kept = new Set(after.map(fact))
    expect(before).toHaveLength(28)
    expect(before.every((v) => kept.has(fact(v)))).toBe(true)
    expect(after).toHaveLength(39)
  })
})

describe('OpenAI GPT Image 2 — the real I2I canary (30 text + 1024 image input, 1756 image output tokens)', () => {
  it('splits the input aggregate by modality and prices the output as image tokens: USD 0.061022 in total (no double counting)', () => {
    const input = fromRow(REAL.openaiIn)
    const output = fromRow(REAL.openaiOut)
    expect(input.status).toBe('simulated')
    expect(output.status).toBe('simulated')
    if (input.status !== 'simulated' || output.status !== 'simulated') return
    expect(input.components).toEqual([
      expect.objectContaining({ category: 'input', quantity: '30', amount: '0.00015' }),
      expect.objectContaining({ category: 'image_input', quantity: '1024', amount: '0.008192' }),
    ])
    expect(output.components).toEqual([expect.objectContaining({ category: 'image_output', quantity: '1756', amount: '0.05268' })])
    expect(input.amount).toBe('0.008342')
    expect(output.amount).toBe('0.05268')
    expect(amountOf(input) + amountOf(output)).toBeCloseTo(0.061022, 12)
    // every ledger token counted exactly once: 30 + 1024 = 1054 input, 1756 output
    expect(input.components.reduce((sum, c) => sum + Number(c.quantity), 0)).toBe(1054)
    expect(output.components.reduce((sum, c) => sum + Number(c.quantity), 0)).toBe(1756)
    expect(input.currency).toBe('USD')
    expect(input.serviceTier).toBe('standard')
  })

  it('the 2026-10-13 canary predates the first known price (observed 2026-10-14): it is a labelled SIMULATION, not a period estimate', () => {
    const cost = fromRow(REAL.openaiOut)
    expect(cost).toMatchObject({ status: 'simulated', basis: 'current_list_price_simulation' })
    if (cost.status !== 'simulated') return
    expect(cost.assumptions).toEqual(expect.arrayContaining(['current_price_simulation', 'service_tier_sole_registry_tier', 'price_observed_at_source', 'byok_invoice_may_differ']))
    expect(cost.pricing).toMatchObject({ sourceUrl: 'https://developers.openai.com/api/docs/pricing', effectiveFromBasis: 'observed_at_source', effectiveFrom: '2026-10-14T00:00:00.000Z' })
    expect(estimatedCostDetails(cost).join(' ')).toMatch(/simulação, não uma estimativa do período/)
    expect(costState(cost)).toEqual({ key: 'simulated', label: 'Simulação a preço atual' })
  })

  it('an execution on/after the observation date is a normal ESTIMATE with the same arithmetic (priced at the effective version)', () => {
    const input = fromRow(openaiRow('input_tokens', '1054', { occurred_at: '2026-10-15T09:00:00+00:00' }))
    const output = fromRow(openaiRow('output_tokens', '1756', { occurred_at: '2026-10-15T09:00:00+00:00' }))
    expect(input).toMatchObject({ status: 'estimated', amount: '0.008342', basis: 'list_price_equivalent' })
    expect(output).toMatchObject({ status: 'estimated', amount: '0.05268' })
    if (input.status === 'estimated') expect(input.assumptions).not.toContain('current_price_simulation')
    expect(costState(input)).toEqual({ key: 'estimated', label: 'Custo estimado' })
  })

  it('never uses the cached-input or Batch rates, and never a text rate on image tokens', () => {
    const input = fromRow(openaiRow('input_tokens', '1054', { occurred_at: '2026-10-15T09:00:00+00:00' }))
    if (input.status !== 'estimated') throw new Error('expected an estimate')
    expect(input.components.map((c) => c.category)).toEqual(['input', 'image_input'])
    // 1054 image tokens at the TEXT rate would be 0.00527; at the cached image rate 0.000...; the real split costs more than either shortcut
    expect(amountOf(input)).not.toBeCloseTo((1054 * 5) / 1e6, 9)
    expect(amountOf(input)).not.toBeCloseTo((1054 * 8) / 1e6, 9)
  })

  it('a text-only input and an image-only input each use only their own price', () => {
    const textOnly = fromRow(openaiRow('input_tokens', '200', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { funding: 'user_byok', usage: { inputTokens: 200, inputTextTokens: 200, inputImageTokens: 0 } } }))
    expect(textOnly).toMatchObject({ status: 'estimated', amount: '0.001' })
    const imageOnly = fromRow(openaiRow('input_tokens', '500', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { funding: 'user_byok', usage: { inputTokens: 500, inputTextTokens: 0, inputImageTokens: 500 } } }))
    expect(imageOnly).toMatchObject({ status: 'estimated', amount: '0.004' })
  })

  it('a modality detail that is absent is only taken as zero when the other part equals the whole aggregate', () => {
    const wholeIsImage = fromRow(openaiRow('input_tokens', '500', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { usage: { inputImageTokens: 500 } } }))
    expect(wholeIsImage).toMatchObject({ status: 'estimated', amount: '0.004' })
    const partial = fromRow(openaiRow('input_tokens', '500', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { usage: { inputImageTokens: 100 } } }))
    expect(partial).toEqual({ status: 'unavailable', reason: 'input_modality_unattributed' })
  })

  it('no detail at all, or details that do not add up to the aggregate, are unavailable — never guessed', () => {
    const none = (unit: 'input_tokens' | 'output_tokens') => openaiRow(unit, '1000', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { funding: 'user_byok', usage: {} } })
    expect(fromRow(none('input_tokens'))).toEqual({ status: 'unavailable', reason: 'input_modality_unattributed' })
    expect(fromRow(none('output_tokens'))).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
    const mismatch = openaiRow('input_tokens', '1054', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { usage: { inputTextTokens: 30, inputImageTokens: 1000 } } })
    expect(fromRow(mismatch)).toEqual({ status: 'unavailable', reason: 'inconsistent_usage' })
    const mismatchOut = openaiRow('output_tokens', '1756', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { usage: { outputImageTokens: 1000, outputTextTokens: 10 } } })
    expect(fromRow(mismatchOut)).toEqual({ status: 'unavailable', reason: 'inconsistent_usage' })
  })

  it('text OUTPUT tokens have no published GPT Image 2 price: the row is unavailable instead of borrowing another rate', () => {
    const row = openaiRow('output_tokens', '1800', { occurred_at: '2026-10-15T00:00:00+00:00', provider_metadata: { usage: { outputImageTokens: 1756, outputTextTokens: 44 } } })
    expect(fromRow(row)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
  })

  it('without the new registry rows the same events stay unavailable (the code deploys safely before the SQL)', () => {
    expect(fromRow(REAL.openaiIn, before)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    expect(fromRow(REAL.openaiOut, before)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
  })

  it('an OpenAI Chat row (Prompt Assistance, gpt-4o-mini) is priced exactly as before', () => {
    const chat = derive({
      provider: 'openai', transport: 'rest', operation: 'improve', model: 'gpt-4o-mini', quantity: 1000, unit: 'input_tokens', measurementSource: 'provider_reported',
      occurredAt: '2026-10-20T00:00:00Z', serviceTier: 'default', cachedInputTokens: 0,
    })
    expect(chat).toMatchObject({ status: 'estimated', amount: '0.00015' })
  })
})

describe('Google Veo 3.1 — per generated second and resolution, from the DERIVED duration', () => {
  it('prices the three real canaries: T2V 4 s = 0.40, I2V 4 s = 0.40, A+B 8 s = 0.80 (Fast, 720p) — USD 1.60 in total', () => {
    const [t2v, i2v, ab] = [REAL.t2v, REAL.i2v, REAL.ab].map((row) => fromRow(row))
    expect([t2v.status, i2v.status, ab.status]).toEqual(['estimated', 'estimated', 'estimated'])
    expect([amountOf(t2v), amountOf(i2v), amountOf(ab)]).toEqual([0.4, 0.4, 0.8])
    expect(amountOf(t2v) + amountOf(i2v) + amountOf(ab)).toBeCloseTo(1.6, 12)
    if (t2v.status !== 'estimated') return
    expect(t2v.components).toEqual([expect.objectContaining({ category: 'video_second_720p', quantity: '4', amount: '0.4' })])
    expect(t2v.serviceTier).toBe('standard')
    expect(t2v.pricing).toMatchObject({ sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', effectiveFrom: '2026-10-14T00:00:00.000Z' })
  })

  it('labels the quantity as DERIVED by Content Studio, never as measured by the provider', () => {
    const cost = fromRow(REAL.t2v)
    if (cost.status !== 'estimated') throw new Error('expected an estimate')
    expect(cost.assumptions).toEqual(expect.arrayContaining(['usage_derived_from_request', 'paid_tier_list_price', 'price_observed_at_source', 'list_price_equivalent']))
    expect(estimatedCostDetails(cost).join(' ')).toMatch(/duração é a do pedido entregue, calculada pelo Content Studio \(não medida pelo provedor\)/)
    expect(estimatedCostDetails(cost).join(' ')).toMatch(/Valor cobrado não disponível/)
  })

  it('every official (model, resolution) price applies to its own resolution and duration', () => {
    const matrix: Array<[string, string, number]> = [
      [VEO_LITE, '720p', 0.05], [VEO_LITE, '1080p', 0.08],
      [VEO_FAST, '720p', 0.1], [VEO_FAST, '1080p', 0.12], [VEO_FAST, '4k', 0.3],
      [VEO_STANDARD, '720p', 0.4], [VEO_STANDARD, '1080p', 0.4], [VEO_STANDARD, '4k', 0.6],
    ]
    for (const [model, resolution, perSecond] of matrix) {
      for (const seconds of [4, 6, 8]) {
        const cost = fromRow(veoRow('text_to_video', seconds, '2026-10-20T00:00:00+00:00', {
          model, provider_metadata: { request: { duration: seconds, resolution } },
        }))
        expect(cost.status, `${model} ${resolution} ${seconds}s`).toBe('estimated')
        expect(amountOf(cost)).toBeCloseTo(perSecond * seconds, 12)
      }
    }
  })

  it('Lite does not support 4k: there is no price, so the row is unavailable (never the Fast/Standard rate)', () => {
    const cost = fromRow(veoRow('text_to_video', 8, '2026-10-20T00:00:00+00:00', { model: VEO_LITE, provider_metadata: { request: { duration: 8, resolution: '4k' } } }))
    expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
  })

  it('a video row without a known resolution is unavailable; the resolution is matched case-insensitively', () => {
    const none = fromRow(veoRow('text_to_video', 4, '2026-10-20T00:00:00+00:00', { provider_metadata: { request: { duration: 4, resolution: null } } }))
    expect(none).toEqual({ status: 'unavailable', reason: 'resolution_unknown' })
    const weird = fromRow(veoRow('text_to_video', 4, '2026-10-20T00:00:00+00:00', { provider_metadata: { request: { duration: 4, resolution: '8k' } } }))
    expect(weird).toEqual({ status: 'unavailable', reason: 'resolution_unknown' })
    const upper = fromRow(veoRow('text_to_video', 4, '2026-10-20T00:00:00+00:00', { provider_metadata: { request: { duration: 4, resolution: '720P' } } }))
    expect(upper.status).toBe('estimated')
  })

  it('a ledger quantity that disagrees with the recorded request duration is inconsistent, not priced', () => {
    const cost = fromRow(veoRow('text_to_video', 4, '2026-10-20T00:00:00+00:00', { quantity: '8' }))
    expect(cost).toEqual({ status: 'unavailable', reason: 'inconsistent_usage' })
  })

  it('an unknown Veo model (not in the registry) is unavailable, never priced by another model', () => {
    const cost = fromRow(veoRow('text_to_video', 4, '2026-10-20T00:00:00+00:00', { model: 'veo-4.0-generate-preview' }))
    expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    expect(fromRow(REAL.t2v, before)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
  })

  it('a Veo execution BEFORE the first known price is a labelled simulation; one after a closed window stays unavailable', () => {
    const early = fromRow(veoRow('text_to_video', 4, '2026-10-13T12:00:00+00:00'))
    expect(early).toMatchObject({ status: 'simulated', amount: '0.4' })
    const closed = after.map((v) => (v.model === VEO_FAST ? { ...v, effectiveTo: Date.parse('2026-10-15T00:00:00Z') } : v))
    expect(fromRow(veoRow('text_to_video', 4, '2026-10-16T12:00:00+00:00'), closed)).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
  })

  it('only Veo seconds may be priced from a DERIVED quantity: every other derived / estimated / balance-delta quantity stays unpriced', () => {
    const base: ProviderUsageCostInput = { provider: 'gemini', transport: 'rest', operation: 'video_review', model: 'gemini-3.5-flash', quantity: 100, unit: 'input_tokens', measurementSource: 'derived', occurredAt: '2026-10-20T00:00:00Z', serviceTier: 'standard' }
    for (const measurementSource of ['derived', 'estimated', 'balance_delta', 'manual_import', 'unknown']) {
      expect(derive({ ...base, measurementSource }), measurementSource).toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    }
    // a derived Kling quantity is not Veo seconds
    expect(derive({ provider: 'kling', transport: 'rest', operation: 'image_to_video', model: 'kling-v3', quantity: 5, unit: 'seconds', measurementSource: 'derived', occurredAt: '2026-10-20T00:00:00Z' }))
      .toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    // estimated Veo seconds are not priced either
    expect(derive({ ...costInputFromRow(REAL.t2v), measurementSource: 'estimated' })).toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
  })
})

describe('Kling: units and credits are never one currency; unknown consumption is never invented', () => {
  it('the real Kling REST A+B (task 939292108199575614) has NO usage: it stays unavailable / unknown — 3 units are not assumed', () => {
    const cost = fromRow(REAL.klingAB)
    expect(cost).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(costState(cost)).toEqual({ key: 'unknown', label: 'Consumo desconhecido' })
    expect(JSON.stringify(cost)).not.toMatch(/amount/)
    expect(unpricedReason(cost)).toMatch(/O provedor não informou o consumo/)
  })

  it('provider-reported UNITS keep their own list-price estimate and say the package price may differ; MCP CREDITS have no USD price', () => {
    const units = derive({ provider: 'kling', transport: 'rest', operation: 'image_to_video', model: 'kling-v3', quantity: 3, unit: 'units', measurementSource: 'provider_reported', occurredAt: '2026-10-14T10:00:00Z' })
    expect(units).toMatchObject({ status: 'estimated', amount: '0.42' })
    if (units.status === 'estimated') {
      expect(units.assumptions).toContain('kling_package_price_unknown')
      expect(estimatedCostDetails(units).join(' ')).toMatch(/preço real da unidade depende do pacote de recursos/)
    }
    const credits = derive({ provider: 'kling', transport: 'mcp', operation: 'text_to_video', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurementSource: 'balance_delta', occurredAt: '2026-09-29T20:01:46Z' })
    expect(credits).toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    // even a (hypothetical) provider-reported credit quantity has no USD mapping
    expect(derive({ provider: 'kling', transport: 'mcp', operation: 'text_to_video', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurementSource: 'provider_reported', occurredAt: '2026-10-20T00:00:00Z' }))
      .toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
  })

  it('usage totals never add units and credits (or anything measured differently) together', () => {
    const view = (id: string, unit: UsageEventView['unit'], quantity: number | null, measurement_source: UsageEventView['measurement_source'], transport: string): UsageEventView => ({
      id, occurred_at: '2026-10-14T10:00:00Z', provider: 'kling', transport, operation: 'image_to_video', model: 'kling-v3', quantity, unit, measurement_source, project_id: null, connection_id: null,
    })
    const summary = summarizeUsage([
      view('u1', 'units', 3, 'provider_reported', 'rest'),
      view('u2', 'units', 3, 'provider_reported', 'rest'),
      view('c1', 'credits', 18, 'balance_delta', 'mcp'),
      view('unknown', null, null, 'unknown', 'rest'),
    ])
    expect(summary.groups.map((g) => [g.unit, g.measurementSource, g.quantity, g.events])).toEqual(expect.arrayContaining([['units', 'provider_reported', 6, 2], ['credits', 'balance_delta', 18, 1]]))
    expect(summary.groups).toHaveLength(2)
    expect(summary.unknownEvents).toBe(1)
  })
})

describe('totals: coverage is always stated and unknown is never zero', () => {
  const all = () => [REAL.t2v, REAL.i2v, REAL.ab, REAL.openaiIn, REAL.openaiOut, REAL.klingAB].map((row) => fromRow(row))

  it('"US$ 1.60 estimated" + the OpenAI canary as a separate simulation + one unpriced Kling row; never a complete total', () => {
    const summary = summarizeEstimatedCost(all())
    expect(summary.totals).toEqual([{ currency: 'USD', amount: '1.6', pricedEvents: 3 }])
    expect(summary.simulatedTotals).toEqual([{ currency: 'USD', amount: '0.061022', pricedEvents: 2 }])
    expect(summary).toMatchObject({ pricedEvents: 3, simulatedEvents: 2, unavailableEvents: 1, ambiguousEvents: 0, unpricedEvents: 1, totalEvents: 6, complete: false })
    const line = describeCostCoverage(summary)
    expect(plain(line)).toBe('US$ 1,60 estimados + US$ 0,061 simulados a preço atual (2 registros anteriores à tabela) + 1 registro sem precificação')
  })

  it('the simulation never leaks into the estimated total and a simulation alone is not an estimate', () => {
    const onlySimulated = summarizeEstimatedCost([fromRow(REAL.openaiIn), fromRow(REAL.openaiOut)])
    expect(onlySimulated.totals).toEqual([])
    expect(onlySimulated.complete).toBe(false)
    expect(plain(describeCostCoverage(onlySimulated))).toMatch(/^Nenhum valor estimado \+ US\$ 0,061 simulados/)
  })

  it('a total over fully estimated rows is complete; one unknown row (never zero) makes it partial', () => {
    const priced = [REAL.t2v, REAL.i2v, REAL.ab].map((row) => fromRow(row))
    expect(summarizeEstimatedCost(priced)).toMatchObject({ complete: true, unpricedEvents: 0, simulatedEvents: 0 })
    const withUnknown = summarizeEstimatedCost([...priced, fromRow(REAL.klingAB)])
    expect(withUnknown.complete).toBe(false)
    expect(withUnknown.totals).toEqual([{ currency: 'USD', amount: '1.6', pricedEvents: 3 }])
    expect(summarizeEstimatedCost([])).toMatchObject({ complete: false, totals: [], totalEvents: 0 })
  })

  it('a missing cost counts as unavailable, a measured zero stays a priced zero', () => {
    const summary = summarizeEstimatedCost([undefined, null, fromRow(veoRow('text_to_video', 0, '2026-10-20T00:00:00+00:00', { quantity: '0', provider_metadata: { request: { duration: null, resolution: '720p' } } }))])
    expect(summary).toMatchObject({ unavailableEvents: 2, pricedEvents: 1 })
    expect(summary.totals).toEqual([{ currency: 'USD', amount: '0', pricedEvents: 1 }])
  })

  it('formats USD in product language and never shows a non-zero amount as zero', () => {
    expect(plain(formatEstimatedAmount('1.6', 'USD'))).toBe('US$ 1,60')
    expect(plain(formatEstimatedAmount('0.8', 'USD'))).toBe('US$ 0,80')
    expect(plain(formatEstimatedAmount('0.061022', 'USD'))).toBe('US$ 0,061')
    expect(plain(formatEstimatedAmount('0.008342', 'USD'))).toBe('US$ 0,0083')
    expect(formatEstimatedAmount('0.00000001', 'USD')).toMatch(/^< /)
  })
})

describe('integrity', () => {
  it('derivation is pure: it never mutates the row, the registry or the ledger, and repeating it gives the same answer', () => {
    const row = JSON.parse(JSON.stringify(REAL.openaiIn))
    const versions = after.map((v) => Object.freeze({ ...v }))
    const first = deriveProviderUsageCost(costInputFromRow(row), versions)
    const second = deriveProviderUsageCost(costInputFromRow(row), versions)
    expect(second).toEqual(first)
    expect(row).toEqual(REAL.openaiIn)
  })

  it('the OpenAI image ledger rows keep one idempotency key per aggregate, so re-recording never duplicates usage', () => {
    const context = {
      userId: 'u', attemptId: 'attempt-1', projectId: null, productionId: null, model: GPT_IMAGE_2, size: '1024x1024', quality: 'medium', funding: 'user_byok',
      credentialSource: 'user', inputReferences: [], providerResponse: 'received' as const,
    }
    const raw = { input_tokens: 1054, output_tokens: 1756, total_tokens: 2810, input_tokens_details: { text_tokens: 30, image_tokens: 1024 }, output_tokens_details: { text_tokens: 0, image_tokens: 1756 } }
    const first = buildOpenAIImageUsageEvents(context, raw)
    const second = buildOpenAIImageUsageEvents(context, raw)
    expect(first.map((e) => e.idempotencyKey)).toEqual(['openai_image_edit:attempt-1:input_tokens', 'openai_image_edit:attempt-1:output_tokens'])
    expect(second.map((e) => e.idempotencyKey)).toEqual(first.map((e) => e.idempotencyKey))
    // the usage detail the cost derivation needs is what the recorder stores next to each aggregate
    const stored = first[0].providerMetadata as { usage: Record<string, number> }
    expect(stored.usage).toMatchObject({ inputTextTokens: 30, inputImageTokens: 1024, outputImageTokens: 1756, outputTextTokens: 0 })
  })

  it('the cost modules are read-only derivations: no provider call, no credential or service-role access, no write', () => {
    const dir = join(process.cwd(), 'lib', 'usage', 'pricing')
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(4)
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8')
      expect(source, name).not.toMatch(/\bfetch\(|@\/lib\/providers|service-role|createServiceRole|\.insert\(|\.update\(|\.upsert\(|\.delete\(|api[_-]?key/i)
    }
  })
})
