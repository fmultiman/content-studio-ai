import { describe, expect, it } from 'vitest'
import { fixedToString, multiplyDivide, parseFixed, roundToUnits } from '../decimal'
import { findPricingVersion, toPricingVersion, type PricingVersion, type PricingVersionRow } from '../registry'
import { costInputFromRow, deriveProviderUsageCost, type ProviderUsageCost, type ProviderUsageCostInput } from '../derive'
import { summarizeEstimatedCost } from '../aggregate'
import { estimatedCostDetails, formatEstimatedAmount, unpricedReason } from '../presentation'

// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — lookup, derivation, aggregation, precision.

let seq = 0
function row(overrides: PricingVersionRow = {}): PricingVersionRow {
  seq += 1
  return {
    id: `v-${seq}`, provider: 'gemini', model: 'gemini-3.5-flash', usage_category: 'input', service_tier: 'standard', currency: 'USD',
    unit_name: 'tokens', unit_quantity: '1000000', price_amount: '1.5', effective_from: '2026-10-09T00:00:00Z', effective_to: null,
    effective_from_basis: 'observed_at_source', source_url: 'https://ai.google.dev/gemini-api/docs/pricing',
    source_label: 'Gemini API pricing', retrieved_at: '2026-10-09T00:00:00Z', notes: null, ...overrides,
  }
}
const version = (overrides: PricingVersionRow = {}): PricingVersion => toPricingVersion(row(overrides))!

/** gemini-3.5-flash, all three tiers x input/cached/output - the shape of the seeded registry. */
function geminiRegistry(): PricingVersion[] {
  const prices: Record<string, Record<string, string>> = {
    standard: { input: '1.5', cached_input: '0.15', output: '9' },
    flex: { input: '0.75', cached_input: '0.08', output: '4.5' },
    priority: { input: '2.7', cached_input: '0.27', output: '16.2' },
  }
  return Object.entries(prices).flatMap(([tier, byCategory]) =>
    Object.entries(byCategory).map(([category, price]) => version({ service_tier: tier, usage_category: category, price_amount: price })),
  )
}

// After the evidenced effective_from (2026-10-09, the day the rates were observed at the source).
const EXECUTED = '2026-10-12T17:38:46.650Z'
const geminiEvent = (overrides: Partial<ProviderUsageCostInput> = {}): ProviderUsageCostInput => ({
  provider: 'gemini', transport: 'rest', operation: 'video_review', model: 'gemini-3.5-flash', quantity: 18_432, unit: 'input_tokens',
  measurementSource: 'provider_reported', occurredAt: EXECUTED, funding: 'user_byok', serviceTier: 'standard', ...overrides,
})
const estimated = (cost: ProviderUsageCost) => {
  if (cost.status !== 'estimated') throw new Error(`expected estimated, got ${cost.status}/${(cost as any).reason}`)
  return cost
}

describe('decimal-safe money', () => {
  it('parses decimals exactly and rejects non-money', () => {
    expect(parseFixed('0.15')).toBe(parseFixed(0.15))
    expect(fixedToString(parseFixed('1.500000000000')!)).toBe('1.5')
    for (const bad of [-1, NaN, Infinity, 'abc', '', '1e3', null, undefined, {}]) expect(parseFixed(bad)).toBeNull()
  })

  it('does not accumulate floating point error (0.1 + 0.2 is exactly 0.3)', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(fixedToString(parseFixed('0.1')! + parseFixed('0.2')!)).toBe('0.3')
  })

  it('keeps 12 calculation digits, far finer than the 4 display digits', () => {
    // 1 token at $0.15 / 1M = $0.00000015: invisible at 4 digits but exact in the calculation.
    const cost = multiplyDivide(parseFixed(1)!, parseFixed('0.15')!, parseFixed(1_000_000)!)
    expect(fixedToString(cost)).toBe('0.00000015')
    expect(roundToUnits(cost, 4)).toBe(BigInt(0))
    expect(formatEstimatedAmount('0.00000015', 'USD')).toMatch(/^<\s?US\$\s?0,0001$/)
  })

  it('rounds half-up at the calculation scale and at display time', () => {
    expect(fixedToString(multiplyDivide(parseFixed(1)!, parseFixed(1)!, parseFixed(3)!))).toBe('0.333333333333')
    expect(fixedToString(multiplyDivide(parseFixed(2)!, parseFixed(1)!, parseFixed(3)!))).toBe('0.666666666667')
    expect(formatEstimatedAmount('0.00005', 'USD')).toMatch(/0,0001$/)
    expect(formatEstimatedAmount('0.02765', 'USD')).toMatch(/0,0277$/)
    expect(formatEstimatedAmount('1.5', 'USD')).toMatch(/1,50$/)
  })
})

describe('pricing lookup (effective dating)', () => {
  const key = { provider: 'gemini', model: 'gemini-3.5-flash', usageCategory: 'input' as const, serviceTier: 'standard' }
  const T = (iso: string) => Date.parse(iso)

  it('1. exact provider/model/category/tier match', () => {
    const result = findPricingVersion(geminiRegistry(), key, T(EXECUTED))
    expect(result.status).toBe('found')
    if (result.status === 'found') expect(result.version.priceAmount).toBe(parseFixed('1.5'))
  })

  it('2./3. selects the version effective at the execution, so an older execution keeps its historical rate', () => {
    const oldV = version({ price_amount: '1.5', effective_from: '2026-05-19T00:00:00Z', effective_to: '2026-11-01T00:00:00Z' })
    const newV = version({ price_amount: '2', effective_from: '2026-11-01T00:00:00Z' })
    const versions = [oldV, newV]
    const at = (iso: string) => {
      const r = findPricingVersion(versions, key, T(iso))
      return r.status === 'found' ? r.version.id : r.status
    }
    expect(at('2026-10-08T00:00:00Z')).toBe(oldV.id)
    expect(at('2026-10-31T23:59:59.999Z')).toBe(oldV.id)
    // half-open window: the boundary instant belongs to the NEW version
    expect(at('2026-11-01T00:00:00Z')).toBe(newV.id)
    expect(at('2027-01-01T00:00:00Z')).toBe(newV.id)
  })

  it('4. a future version is never used for an earlier execution', () => {
    const future = version({ effective_from: '2027-01-01T00:00:00Z' })
    expect(findPricingVersion([future], key, T(EXECUTED))).toMatchObject({ status: 'not_effective' })
  })

  it('5. no match for an unknown model/category', () => {
    expect(findPricingVersion(geminiRegistry(), { ...key, model: 'gemini-9' }, T(EXECUTED)).status).toBe('no_match')
    expect(findPricingVersion([], key, T(EXECUTED)).status).toBe('no_match')
  })

  it('6. overlapping versions are reported, never silently resolved', () => {
    const a = version({ effective_from: '2026-05-19T00:00:00Z' })
    const b = version({ effective_from: '2026-06-01T00:00:00Z', price_amount: '3' })
    expect(findPricingVersion([a, b], key, T(EXECUTED))).toMatchObject({ status: 'overlap' })
  })

  it('7./8. tier match is exact; a different tier never substitutes', () => {
    const flexOnly = [version({ service_tier: 'flex' })]
    expect(findPricingVersion(flexOnly, { ...key, serviceTier: 'flex' }, T(EXECUTED)).status).toBe('found')
    expect(findPricingVersion(flexOnly, { ...key, serviceTier: 'standard' }, T(EXECUTED)).status).toBe('no_match')
    expect(findPricingVersion(flexOnly, { ...key, serviceTier: 'turbo' }, T(EXECUTED)).status).toBe('no_match')
  })

  it('drops malformed registry rows instead of repairing them', () => {
    expect(toPricingVersion(row({ price_amount: 'free' }))).toBeNull()
    expect(toPricingVersion(row({ unit_quantity: '0' }))).toBeNull()
    expect(toPricingVersion(row({ usage_category: 'thoughts' }))).toBeNull()
    expect(toPricingVersion(row({ effective_to: '2026-01-01T00:00:00Z' }))).toBeNull()
    expect(toPricingVersion(row({ effective_from: 'not a date' }))).toBeNull()
  })
})

describe('deriveProviderUsageCost — Gemini', () => {
  const versions = geminiRegistry()

  it('9./10. normalises units: tokens x price per 1M, to exact decimals', () => {
    const cost = estimated(deriveProviderUsageCost(geminiEvent(), versions))
    expect(cost.amount).toBe('0.027648') // 18,432 x $1.50 / 1M
    expect(cost.currency).toBe('USD')
    expect(estimated(deriveProviderUsageCost(geminiEvent({ unit: 'output_tokens', quantity: 612 }), versions)).amount).toBe('0.005508')
  })

  it('11. thinking tokens are priced once, as output, and totalTokenCount is never priced', () => {
    const thoughts = estimated(deriveProviderUsageCost(geminiEvent({ unit: 'tokens', usageCategory: 'thoughts', quantity: 240 }), versions))
    expect(thoughts.amount).toBe('0.00216') // 240 x $9 / 1M (the output rate)
    expect(thoughts.components.map((c) => c.category)).toEqual(['output'])

    // The three ledger rows of one execution add up to input + output + thinking - there is no fourth "total" row to price.
    const rows = [
      geminiEvent(),
      geminiEvent({ unit: 'output_tokens', quantity: 612 }),
      geminiEvent({ unit: 'tokens', usageCategory: 'thoughts', quantity: 240 }),
    ]
    const summary = summarizeEstimatedCost(rows.map((r) => deriveProviderUsageCost(r, versions)))
    expect(summary.totals).toEqual([{ currency: 'USD', amount: '0.035316', pricedEvents: 3 }])
    // A plain `tokens` row without the thoughts category (e.g. a combined total) is NOT priced.
    expect(deriveProviderUsageCost(geminiEvent({ unit: 'tokens', quantity: 19_284 }), versions)).toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
  })

  it('cached prompt tokens are a SUBSET of the input: split out of the input line, not added on top', () => {
    const cost = estimated(deriveProviderUsageCost(geminiEvent({ cachedInputTokens: 1_024 }), versions))
    expect(cost.components.map((c) => [c.category, c.quantity])).toEqual([['input', '17408'], ['cached_input', '1024']])
    expect(cost.amount).toBe('0.0262656') // 17,408 x 1.50 + 1,024 x 0.15, per 1M
    expect(cost.assumptions).toContain('cached_tokens_priced_separately')
    expect(deriveProviderUsageCost(geminiEvent({ quantity: 100, cachedInputTokens: 101 }), versions)).toEqual({ status: 'unavailable', reason: 'inconsistent_usage' })
  })

  it('tool-use prompt tokens are billed as input but recorded in no row: refuse to under-count', () => {
    expect(deriveProviderUsageCost(geminiEvent({ toolUsePromptTokens: 50 }), versions)).toEqual({ status: 'ambiguous', reason: 'tool_use_tokens_not_priced' })
  })

  it('a proven service tier selects that tier (and only that tier)', () => {
    expect(estimated(deriveProviderUsageCost(geminiEvent({ serviceTier: 'flex', quantity: 1_000_000 }), versions)).amount).toBe('0.75')
    const priority = estimated(deriveProviderUsageCost(geminiEvent({ serviceTier: 'priority', quantity: 1_000_000 }), versions))
    expect(priority.amount).toBe('2.7')
    expect(priority.serviceTier).toBe('priority')
  })

  it('an unproven or unknown tier is AMBIGUOUS - the tier is never invented', () => {
    expect(deriveProviderUsageCost(geminiEvent({ serviceTier: null }), versions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    expect(deriveProviderUsageCost(geminiEvent({ serviceTier: 'batch' }), versions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('12. unknown is not zero: every non-priceable row has NO amount', () => {
    const cases: Array<[Partial<ProviderUsageCostInput>, string]> = [
      [{ quantity: null, unit: null, measurementSource: 'unknown' }, 'usage_unknown'],
      [{ measurementSource: 'balance_delta' }, 'measurement_not_provider_reported'],
      [{ measurementSource: 'estimated' }, 'measurement_not_provider_reported'],
      [{ model: null }, 'model_unknown'],
      [{ model: 'gemini-9-ultra' }, 'no_pricing_for_model'],
      [{ unit: 'images' }, 'unit_not_priceable'],
      [{ occurredAt: 'garbage' }, 'invalid_timestamp'],
      [{ quantity: 'abc' }, 'invalid_usage'],
      [{ occurredAt: '2026-05-01T00:00:00Z' }, 'pricing_not_effective_at_execution'],
    ]
    for (const [overrides, reason] of cases) {
      const cost = deriveProviderUsageCost(geminiEvent(overrides), versions)
      expect(cost).toEqual({ status: 'unavailable', reason })
      expect(cost).not.toHaveProperty('amount')
    }
    expect(deriveProviderUsageCost(geminiEvent(), [])).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
  })

  it('a MEASURED zero is a real zero (it is the only way to get $0)', () => {
    expect(estimated(deriveProviderUsageCost(geminiEvent({ quantity: 0 }), versions)).amount).toBe('0')
  })

  it('14. returns the pricing provenance: version ids, source, retrieval date, effective date and its basis', () => {
    const cost = estimated(deriveProviderUsageCost(geminiEvent(), versions))
    expect(cost.pricing).toMatchObject({
      sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', sourceLabel: 'Gemini API pricing', retrievedAt: '2026-10-09T00:00:00Z',
      effectiveFrom: '2026-10-09T00:00:00.000Z', effectiveFromBasis: 'observed_at_source',
    })
    expect(cost.pricing.versionIds).toEqual(cost.components.map((c) => c.pricingVersionId))
    expect(cost.assumptions).toContain('price_observed_at_source')
  })

  it('13./15. currency is preserved; BYOK stays an ESTIMATE (never zero, never "charged")', () => {
    const eur = versions.map((v) => ({ ...v, currency: 'EUR' }))
    expect(estimated(deriveProviderUsageCost(geminiEvent(), eur)).currency).toBe('EUR')
    const byok = estimated(deriveProviderUsageCost(geminiEvent({ funding: 'user_byok' }), versions))
    expect(byok.basis).toBe('list_price_equivalent')
    expect(byok.assumptions).toEqual(expect.arrayContaining(['list_price_equivalent', 'paid_tier_list_price', 'byok_invoice_may_differ']))
    expect(byok.amount).not.toBe('0')
    expect(estimated(deriveProviderUsageCost(geminiEvent({ funding: null }), versions)).assumptions).not.toContain('byok_invoice_may_differ')
  })

  it('mixed currencies for one row are refused', () => {
    const mixed = geminiRegistry().map((v) => (v.usageCategory === 'cached_input' ? { ...v, currency: 'EUR' } : v))
    expect(deriveProviderUsageCost(geminiEvent({ cachedInputTokens: 10 }), mixed)).toEqual({ status: 'unavailable', reason: 'mixed_currency' })
  })

  it('overlapping registry rows make the cost ambiguous', () => {
    const dup = [...geminiRegistry(), version({ price_amount: '9', effective_from: '2026-06-01T00:00:00Z' })]
    expect(deriveProviderUsageCost(geminiEvent(), dup)).toEqual({ status: 'ambiguous', reason: 'overlapping_pricing_versions' })
  })

  it('historical stability: a later price never reprices an earlier execution', () => {
    const closed = version({ price_amount: '1.5', effective_from: '2026-05-19T00:00:00Z', effective_to: '2026-11-01T00:00:00Z' })
    const next = version({ price_amount: '3', effective_from: '2026-11-01T00:00:00Z' })
    const before = estimated(deriveProviderUsageCost(geminiEvent({ quantity: 1_000_000 }), [closed]))
    const after = estimated(deriveProviderUsageCost(geminiEvent({ quantity: 1_000_000 }), [closed, next]))
    expect(after.amount).toBe(before.amount)
    expect(estimated(deriveProviderUsageCost(geminiEvent({ quantity: 1_000_000, occurredAt: '2026-11-02T00:00:00Z' }), [closed, next])).amount).toBe('3')
  })
})

describe('deriveProviderUsageCost — Kling and unsupported providers', () => {
  const kling = [version({ provider: 'kling', model: 'kling-v3', usage_category: 'unit', unit_name: 'units', unit_quantity: '1', price_amount: '0.14', effective_from: '2026-10-09T00:00:00Z', effective_from_basis: 'observed_at_source', source_url: 'https://kling.ai/document-api/pricing/base/video' })]
  const klingRest = (overrides: Partial<ProviderUsageCostInput> = {}): ProviderUsageCostInput => ({
    provider: 'kling', transport: 'rest', operation: 'text_to_video', model: 'kling-v3', quantity: 3, unit: 'units', measurementSource: 'provider_reported', occurredAt: '2026-10-10T00:00:00Z', ...overrides,
  })

  it('prices provider-reported API units at the published unit price - as a list-price estimate', () => {
    const cost = estimated(deriveProviderUsageCost(klingRest(), kling))
    expect(cost.amount).toBe('0.42')
    expect(cost.assumptions).toEqual(expect.arrayContaining(['price_observed_at_source', 'list_price_equivalent']))
    expect(cost.assumptions).not.toContain('paid_tier_list_price')
    expect(cost.assumptions).not.toContain('byok_invoice_may_differ')
  })

  it('does not price executions that predate the first price observed (no backfilled guess)', () => {
    expect(deriveProviderUsageCost(klingRest({ occurredAt: '2026-09-28T07:38:26Z' }), kling)).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
  })

  it('NEVER converts MCP credits (balance_delta) into money: no authoritative mapping exists', () => {
    expect(deriveProviderUsageCost(klingRest({ transport: 'mcp', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurementSource: 'balance_delta' }), kling))
      .toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    expect(deriveProviderUsageCost(klingRest({ transport: 'mcp', quantity: 18, unit: 'credits' }), kling)).toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
    expect(deriveProviderUsageCost(klingRest({ quantity: null, unit: null, measurementSource: 'unknown' }), kling)).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
  })

  it('a Kling model with no registry price stays unavailable', () => {
    expect(deriveProviderUsageCost(klingRest({ model: 'kling-v2-6' }), kling)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
  })

  // FUTURE-054: OpenAI now has billing semantics for Prompt Assistance (see prompt-assistance-pricing.test.ts).
  it('providers without ledger semantics (Nano Banana...) are unsupported even if a price existed', () => {
    const nano = [version({ provider: 'nano_banana', model: 'nano-banana-2' })]
    expect(deriveProviderUsageCost({ provider: 'nano_banana', transport: 'rest', operation: 'image_generation', model: 'nano-banana-2', quantity: 100, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: EXECUTED }, nano))
      .toEqual({ status: 'unavailable', reason: 'provider_not_supported' })
  })
})

describe('costInputFromRow reads only the closed set of facts it needs', () => {
  it('maps a ledger row and its provider_metadata (tier, cached, tool-use, thoughts, funding)', () => {
    const input = costInputFromRow({
      provider: 'gemini', transport: 'rest', operation: 'image_review', model: 'gemini-3.5-flash', quantity: '240', unit: 'tokens', measurement_source: 'provider_reported',
      occurred_at: EXECUTED, provider_metadata: { funding: 'user_byok', usage_category: 'thoughts', usage: { serviceTier: 'flex', cachedContentTokenCount: 5, toolUsePromptTokenCount: 7 } },
    })
    expect(input).toMatchObject({ quantity: '240', usageCategory: 'thoughts', funding: 'user_byok', serviceTier: 'flex', cachedInputTokens: 5, toolUsePromptTokens: 7 })
  })

  it('NUMERIC arrives as a string and is priced exactly; NULL stays unknown', () => {
    const versions = geminiRegistry()
    const base = { provider: 'gemini', transport: 'rest', operation: 'image_review', model: 'gemini-3.5-flash', unit: 'input_tokens', measurement_source: 'provider_reported', occurred_at: EXECUTED, provider_metadata: { usage: { serviceTier: 'standard' } } }
    expect(estimated(deriveProviderUsageCost(costInputFromRow({ ...base, quantity: '1000000' }), versions)).amount).toBe('1.5')
    expect(deriveProviderUsageCost(costInputFromRow({ ...base, quantity: null, unit: null, measurement_source: 'unknown' }), versions)).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(costInputFromRow({ ...base, quantity: 1, provider_metadata: null }).serviceTier).toBeNull()
  })
})

describe('aggregation', () => {
  const versions = geminiRegistry()
  const priced = (quantity: number) => deriveProviderUsageCost(geminiEvent({ quantity }), versions)

  it('16./17./18. sums priced rows, excludes unpriced rows from the number, and counts them', () => {
    const costs: ProviderUsageCost[] = [
      priced(1_000_000),
      priced(1_000_000),
      { status: 'unavailable', reason: 'usage_unknown' },
      { status: 'ambiguous', reason: 'service_tier_not_proven' },
      { status: 'unavailable', reason: 'unit_not_priceable' },
    ]
    expect(summarizeEstimatedCost(costs)).toEqual({
      totals: [{ currency: 'USD', amount: '3', pricedEvents: 2 }],
      pricedEvents: 2, unavailableEvents: 2, ambiguousEvents: 1, unpricedEvents: 3, totalEvents: 5,
      // FUTURE-064 Slice D: three rows are unpriced, so the known sum is a partial lower bound, not a complete total
      complete: false,
    })
  })

  it('nothing priced -> NO total (never "0")', () => {
    const summary = summarizeEstimatedCost([{ status: 'unavailable', reason: 'usage_unknown' }, undefined, null])
    expect(summary.totals).toEqual([])
    expect(summary.unpricedEvents).toBe(3)
  })

  it('totals never mix currencies (no FX)', () => {
    const eur = deriveProviderUsageCost(geminiEvent({ quantity: 1_000_000 }), versions.map((v) => ({ ...v, currency: 'EUR' })))
    const summary = summarizeEstimatedCost([priced(1_000_000), eur])
    expect(summary.totals.map((t) => [t.currency, t.amount])).toEqual([['EUR', '1.5'], ['USD', '1.5']])
  })

  it('19. keeps decimal precision across many small rows', () => {
    const tiny = priced(1) // $0.0000015
    expect(estimated(tiny).amount).toBe('0.0000015')
    const summary = summarizeEstimatedCost(Array.from({ length: 1000 }, () => tiny))
    expect(summary.totals[0].amount).toBe('0.0015')
    // the float equivalent drifts
    let float = 0
    for (let i = 0; i < 1000; i += 1) float += 0.0000015
    expect(float).not.toBe(0.0015)
  })
})

describe('presentation', () => {
  it('20./21./22./23. states estimate semantics, the unavailable state and provenance - and never claims a billed amount', () => {
    const cost = estimated(deriveProviderUsageCost(geminiEvent(), geminiRegistry()))
    const details = estimatedCostDetails(cost).join('\n')
    expect(details).toMatch(/não é o valor cobrado/)
    expect(details).toMatch(/Fonte: Gemini API pricing \(https:\/\/ai\.google\.dev/)
    expect(details).toMatch(/Preço em vigor desde 09\/10\/2026; consultado em 09\/10\/2026/)
    expect(details).toMatch(/BYOK/)
    expect(details).toMatch(/Valor cobrado não disponível/)
    expect(details).not.toMatch(/foi cobrado|cobrado pelo provedor|valor real cobrado:/i)
    expect(unpricedReason({ status: 'unavailable', reason: 'unit_not_priceable' })).toMatch(/conversão oficial/)
    expect(unpricedReason({ status: 'ambiguous', reason: 'service_tier_not_proven' })).toMatch(/nível de serviço/)
    expect(unpricedReason(estimated(deriveProviderUsageCost(geminiEvent(), geminiRegistry())))).toBeNull()
    expect(unpricedReason(undefined)).toMatch(/não pôde ser carregada/)
  })
})

describe('effective-date truthfulness (FUTURE-047 fix)', () => {
  // The Production Gemini Review rows are from 2026-10-08, one day BEFORE the rates were observed at the source.
  const OBSERVED = '2026-10-09T00:00:00Z'
  const observed = () => geminiRegistry() // every default version starts at OBSERVED with basis observed_at_source

  it('1. the observed price does not apply before its effective_from (not even by a second)', () => {
    for (const occurredAt of ['2026-10-08T17:38:46.650Z', '2026-10-08T23:59:59.999Z', '2026-05-19T00:00:00Z', '2026-07-21T00:00:00Z']) {
      expect(deriveProviderUsageCost(geminiEvent({ occurredAt }), observed())).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    }
  })

  it('2. the version applies on and after effective_from (inclusive start)', () => {
    expect(estimated(deriveProviderUsageCost(geminiEvent({ occurredAt: OBSERVED, quantity: 1_000_000 }), observed())).amount).toBe('1.5')
    expect(estimated(deriveProviderUsageCost(geminiEvent({ occurredAt: '2026-10-09T00:00:00.001Z', quantity: 1_000_000 }), observed())).amount).toBe('1.5')
    expect(estimated(deriveProviderUsageCost(geminiEvent({ occurredAt: '2027-03-01T00:00:00Z', quantity: 1_000_000 }), observed())).amount).toBe('1.5')
  })

  it('3. no GA-date backdating: the model release date is not a pricing start', () => {
    // gemini-3.5-flash GA = 2026-05-19, gemini-3.5-flash-lite GA = 2026-07-21 (official changelog): proves the model shipped, not its price.
    for (const [model, occurredAt] of [['gemini-3.5-flash', '2026-06-01T00:00:00Z'], ['gemini-3.5-flash-lite', '2026-08-01T00:00:00Z']] as const) {
      const lite = observed().map((v) => ({ ...v, model }))
      expect(deriveProviderUsageCost(geminiEvent({ model, occurredAt }), lite)).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    }
  })

  it('the cost explains why: the price is "observed at source", never "since the model GA"', () => {
    const cost = estimated(deriveProviderUsageCost(geminiEvent(), observed()))
    expect(cost.pricing.effectiveFromBasis).toBe('observed_at_source')
    expect(cost.assumptions).toContain('price_observed_at_source')
    expect(estimatedCostDetails(cost).join('\n')).toMatch(/observado na página oficial; execuções anteriores não são estimadas/)
    expect(estimatedCostDetails(cost).join('\n')).not.toMatch(/lançamento|desde o GA|desde o lançamento/i)
  })

  it('4. historical usage stays unavailable without an evidenced rate - and summaries do not turn it into zero', () => {
    const history = [
      geminiEvent({ occurredAt: '2026-10-08T17:38:46.650Z' }),
      geminiEvent({ occurredAt: '2026-10-08T17:38:46.650Z', unit: 'output_tokens', quantity: 612 }),
      geminiEvent({ occurredAt: '2026-10-08T17:39:03.609Z', unit: 'tokens', usageCategory: 'thoughts', quantity: 240 }),
    ].map((e) => deriveProviderUsageCost(e, observed()))
    expect(history.every((c) => c.status === 'unavailable' && c.reason === 'pricing_not_effective_at_execution')).toBe(true)
    const summary = summarizeEstimatedCost(history)
    expect(summary.totals).toEqual([])
    expect(summary.pricedEvents).toBe(0)
    expect(summary.unpricedEvents).toBe(3)
  })

  it('5. a later, authoritative historical version fills the gap without touching the usage event', () => {
    const event = geminiEvent({ occurredAt: '2026-10-08T17:38:46.650Z', quantity: 1_000_000 })
    const frozenEvent = JSON.stringify(event)
    const before = deriveProviderUsageCost(event, observed())
    expect(before.status).toBe('unavailable')

    // Registry change only: a NEW version covering [2026-05-19, 2026-10-09) from an official historical source.
    const historical = version({
      effective_from: '2026-05-19T00:00:00Z', effective_to: OBSERVED, price_amount: '1.25', effective_from_basis: 'official_effective_date',
      source_label: 'Official price history entry', retrieved_at: '2026-11-01T00:00:00Z',
    })
    const after = deriveProviderUsageCost(event, [...observed(), historical])
    expect(estimated(after).amount).toBe('1.25')
    expect(estimated(after).pricing.effectiveFromBasis).toBe('official_effective_date')
    expect(estimated(after).assumptions).not.toContain('price_observed_at_source')
    // The execution just after OBSERVED still uses the observed rate: no window overlaps, nothing is rewritten.
    expect(estimated(deriveProviderUsageCost(geminiEvent({ occurredAt: OBSERVED, quantity: 1_000_000 }), [...observed(), historical])).amount).toBe('1.5')
    // The usage event itself is never mutated.
    expect(JSON.stringify(event)).toBe(frozenEvent)
  })

  it('an explicitly evidenced earlier date is honoured (official_effective_date)', () => {
    const evidenced = geminiRegistry().map((v) => ({ ...v, effectiveFrom: Date.parse('2026-08-01T00:00:00Z'), effectiveFromBasis: 'official_effective_date' as const }))
    const cost = estimated(deriveProviderUsageCost(geminiEvent({ occurredAt: '2026-08-15T00:00:00Z' }), evidenced))
    expect(cost.pricing.effectiveFrom).toBe('2026-08-01T00:00:00.000Z')
    expect(cost.assumptions).not.toContain('price_observed_at_source')
  })
})
