import { beforeAll, describe, expect, it } from 'vitest'
import { extractGeminiUsage } from '@/lib/providers/gemini/usage'
import { geminiImageUsageEvents, type GeminiImageUsageContext } from '@/lib/usage/gemini-image-usage'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { costInputFromRow, deriveProviderUsageCost, type ProviderUsageCost, type ProviderUsageCostInput } from '../derive'
import { summarizeEstimatedCost } from '../aggregate'
import { toPricingVersion, type PricingVersion } from '../registry'
import { LITE, NB21, registries } from './image-pricing-fixtures'
import { GEMINI_IMAGE_CANARY_USAGE } from '@/lib/__tests__/helpers/gemini-image-canary'
import { PARTIAL_ESTIMATED_COST_LABEL } from '../presentation'

// FUTURE-064 Slice D — image-output cost derivation (PRODUCTION code: registry.ts, derive.ts, aggregate.ts) over the registry that the
// reviewed SQL produces (isolated PGlite; the SQL is NOT applied anywhere) AND over today's Production registry (old constraint,
// 22 rows). Usage rows are the real Slice C events, mapped to cost inputs exactly like /api/settings/usage does. 0 provider calls.

let oldVersions: PricingVersion[]
let newVersions: PricingVersion[]

beforeAll(async () => {
  const registry = await registries()
  oldVersions = registry.oldVersions
  newVersions = registry.newVersions
}, 60_000)

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const context = (model: 'nb21' | 'lite' = 'nb21', overrides: Partial<GeminiImageUsageContext> = {}): GeminiImageUsageContext => ({
  userId: 'u1', attemptId: ATTEMPT, projectId: null, productionId: null,
  modelAlias: model === 'nb21' ? 'gemini-nb-2.1' : 'gemini-nb-lite', providerModel: model === 'nb21' ? NB21 : LITE,
  aspectRatio: '1:1', imageSize: '1K', funding: 'user_byok', credentialSource: 'user', providerResponse: 'received', ...overrides,
})
const inputsFor = (usage: Record<string, unknown> | null, model: 'nb21' | 'lite' = 'nb21', occurredAt = '2026-10-20T12:00:00Z') =>
  geminiImageUsageEvents(context(model), extractGeminiUsage(usage)).map((event) => ({
    key: event.idempotencyKey.split(':')[2],
    input: costInputFromRow({ ...toUsageEventRow(event), occurred_at: occurredAt }),
  }))
const price = (usage: Record<string, unknown> | null, model: 'nb21' | 'lite' = 'nb21', versions: readonly PricingVersion[] = newVersions, occurredAt?: string) =>
  Object.fromEntries(inputsFor(usage, model, occurredAt).map(({ key, input }) => [key, deriveProviderUsageCost(input, versions)])) as Record<string, ProviderUsageCost>
const amount = (cost: ProviderUsageCost) => (cost.status === 'estimated' ? cost.amount : undefined)
const imageRow = (model = NB21): ProviderUsageCostInput => ({
  provider: 'gemini', transport: 'rest', operation: 'image_generation', model, quantity: 1120, unit: 'tokens', usageCategory: 'image_output',
  measurementSource: 'provider_reported', occurredAt: '2026-10-20T12:00:00Z', funding: 'user_byok', serviceTier: 'standard',
})

// 1K execution: 14 text prompt tokens in, 1,120 IMAGE tokens out (Google's documented 1K size), tier reported.
const ONE_K = { promptTokenCount: 14, candidatesTokenCount: 1120, totalTokenCount: 1134, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }

describe('image_output pricing with the six reviewed rows present', () => {
  it('exact canary: USD 0.0401535 is a partial subtotal; 315 unattributed tokens have no amount or rate', () => {
    const costs = price(GEMINI_IMAGE_CANARY_USAGE, 'nb21', newVersions, '2026-10-12T07:55:50.432Z')
    expect(costs.input_tokens).toMatchObject({ amount: '0.0000435' })
    expect(costs.image_output_tokens).toMatchObject({ amount: '0.0336' })
    expect(costs.thoughts_tokens).toMatchObject({ amount: '0.00651' })
    expect(costs.output_unattributed_tokens).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
    expect(summarizeEstimatedCost(Object.values(costs))).toMatchObject({
      complete: false, pricedEvents: 3, unpricedEvents: 1, totals: [{ currency: 'USD', amount: '0.0401535', pricedEvents: 3 }],
    })
    expect(PARTIAL_ESTIMATED_COST_LABEL).toBe('Custo estimado parcial')
  })

  it('the loader recognizes image_output: 28 versions load, two of them image_output (one per V1 model)', () => {
    expect(newVersions).toHaveLength(28)
    expect(newVersions.filter((v) => v.usageCategory === 'image_output').map((v) => v.model).sort()).toEqual([LITE, NB21])
  })

  it('Nano Banana 2.1 Standard: 1,120 IMAGE tokens cost exactly USD 0.0336 on the image_output dimension; input 1.50/1M', () => {
    const costs = price(ONE_K)
    expect(costs.image_output_tokens).toMatchObject({ status: 'estimated', currency: 'USD', serviceTier: 'standard', components: [{ category: 'image_output', quantity: '1120', amount: '0.0336' }] })
    expect(costs.input_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'input', quantity: '14', amount: '0.000021' }] })
    expect(Object.keys(costs).sort()).toEqual(['image_output_tokens', 'input_tokens'])
  })

  it('Nano Banana 2 Lite Standard: 1,120 IMAGE tokens cost USD 0.0336; input 0.25/1M', () => {
    const costs = price(ONE_K, 'lite')
    expect(costs.image_output_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'image_output', quantity: '1120', amount: '0.0336' }] })
    expect(costs.input_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'input', amount: '0.0000035' }] })
  })

  it('IMAGE output is NEVER priced at the text-output rate (a text rate would give 0.0084 / 0.00168)', () => {
    for (const model of ['nb21', 'lite'] as const) {
      const cost = price(ONE_K, model).image_output_tokens
      expect(cost.status === 'estimated' && cost.components.map((c) => c.category)).toEqual(['image_output'])
      expect(amount(cost)).toBe('0.0336')
      expect(amount(cost)).not.toBe(model === 'nb21' ? '0.0084' : '0.00168')
    }
  })

  it('input, text output and thinking are priced separately from IMAGE output (7.50 and 1.50 per 1M for text and thinking)', () => {
    const mixed = { promptTokenCount: 20, thoughtsTokenCount: 215, candidatesTokenCount: 1160, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1120 }] }
    const nb = price(mixed)
    expect(nb.input_tokens).toMatchObject({ components: [{ category: 'input', quantity: '20', amount: '0.00003' }] })
    expect(nb.text_output_tokens).toMatchObject({ components: [{ category: 'output', quantity: '40', amount: '0.0003' }] })
    expect(nb.thoughts_tokens).toMatchObject({ components: [{ category: 'output', quantity: '215', amount: '0.0016125' }] })
    expect(nb.image_output_tokens).toMatchObject({ components: [{ category: 'image_output', amount: '0.0336' }] })
    const lite = price(mixed, 'lite')
    expect(lite.text_output_tokens).toMatchObject({ components: [{ amount: '0.00006' }] })
    expect(lite.thoughts_tokens).toMatchObject({ components: [{ amount: '0.0003225' }] })
  })

  it('a fully classified execution sums to the exact total and the aggregate is COMPLETE', () => {
    const summary = summarizeEstimatedCost(Object.values(price(ONE_K)))
    expect(summary).toMatchObject({ complete: true, pricedEvents: 2, unpricedEvents: 0, totals: [{ currency: 'USD', amount: '0.033621', pricedEvents: 2 }] })
  })

  it('totalTokenCount is never priced a second time: adding, removing or changing it changes no amount', () => {
    const withTotal = price(ONE_K)
    const { totalTokenCount: _omitted, ...withoutTotal } = ONE_K
    void _omitted
    expect(price(withoutTotal)).toEqual(withTotal)
    expect(price({ ...ONE_K, totalTokenCount: 999_999 })).toEqual(withTotal)
  })

  it('uses the canonical Google model id: the alias, a neighbour or a non-approved Google model is never priced', () => {
    for (const model of ['gemini-nb-2.1', 'gemini-nb-lite', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']) {
      expect(deriveProviderUsageCost({ ...imageRow(), model }, newVersions)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    }
  })

  it('the currency and unit come from the version: USD per 1,000,000 tokens', () => {
    const cost = deriveProviderUsageCost(imageRow(), newVersions)
    expect(cost.status === 'estimated' && cost.currency).toBe('USD')
    expect(cost.status === 'estimated' && cost.basis).toBe('list_price_equivalent')
  })
})

describe('incomplete usage is never a final cost', () => {
  it('output_unattributed stays UNPRICED with its own reason — never image, never text, never $0', () => {
    const costs = price({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' })
    expect(costs.output_unattributed_tokens).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
    expect(amount(costs.output_unattributed_tokens)).toBeUndefined()
    // even with both a text and an image price present, it is not priced as either
    expect(deriveProviderUsageCost({ ...imageRow(), usageCategory: 'output_unattributed' }, newVersions)).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
  })

  it('missing modality + known input: the aggregate is PARTIAL (known sum only), not complete', () => {
    const partial = summarizeEstimatedCost(Object.values(price({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' })))
    expect(partial).toMatchObject({ complete: false, pricedEvents: 1, unpricedEvents: 1, totals: [{ currency: 'USD', amount: '0.000021' }] })
  })

  it('unknown usage has no amount and makes any aggregate that contains it partial', () => {
    const unknown = price(null)
    expect(unknown.unknown).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(amount(unknown.unknown)).toBeUndefined()
    expect(summarizeEstimatedCost(Object.values(unknown))).toMatchObject({ complete: false, totals: [], pricedEvents: 0, unpricedEvents: 1 })
    expect(summarizeEstimatedCost([...Object.values(price(ONE_K)), unknown.unknown]).complete).toBe(false)
  })

  it('a measured ZERO is a known amount (priced, complete); an absent quantity is not zero', () => {
    const zero = deriveProviderUsageCost({ ...imageRow(), quantity: 0 }, newVersions)
    expect(zero).toMatchObject({ status: 'estimated', amount: '0' })
    expect(summarizeEstimatedCost([zero])).toMatchObject({ complete: true, totals: [{ amount: '0', pricedEvents: 1 }] })
    expect(deriveProviderUsageCost({ ...imageRow(), quantity: null, unit: null }, newVersions)).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
  })

  it('a zero IMAGE or thinking count creates no row, so nothing is priced from an absent measurement', () => {
    expect(Object.keys(price({ promptTokenCount: 5, thoughtsTokenCount: 0, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 0 }] }))).toEqual(['input_tokens'])
  })

  it('aggregate completeness: empty is not complete, an ambiguous or older (missing) cost is unpriced, a priced set is complete', () => {
    expect(summarizeEstimatedCost([]).complete).toBe(false)
    expect(summarizeEstimatedCost([undefined]).complete).toBe(false)
    expect(summarizeEstimatedCost([null, deriveProviderUsageCost(imageRow(), newVersions)]).complete).toBe(false)
    expect(summarizeEstimatedCost([{ status: 'ambiguous', reason: 'service_tier_not_proven' }, deriveProviderUsageCost(imageRow(), newVersions)]).complete).toBe(false)
    expect(summarizeEstimatedCost([deriveProviderUsageCost(imageRow(), newVersions), deriveProviderUsageCost(imageRow(LITE), newVersions)])).toMatchObject({ complete: true, totals: [{ amount: '0.0672', pricedEvents: 2 }] })
  })
})

describe('service tier', () => {
  const { serviceTier: _drop, ...NO_TIER } = ONE_K
  void _drop

  it('a REPORTED Standard tier is used as reported, with no fallback assumption', () => {
    const cost = price(ONE_K).image_output_tokens
    expect(cost.status === 'estimated' && cost.assumptions).not.toContain('service_tier_sole_registry_tier')
    expect(cost.status === 'estimated' && cost.assumptions).toEqual(expect.arrayContaining(['list_price_equivalent', 'paid_tier_list_price', 'byok_invoice_may_differ', 'price_observed_at_source']))
  })

  it('a REPORTED Flex or Priority tier never receives Standard rates (no such price exists for these models)', () => {
    for (const tier of ['flex', 'priority']) {
      for (const cost of Object.values(price({ ...ONE_K, serviceTier: tier }))) expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
    }
  })

  it('an unrecognized REPORTED tier is not replaced by Standard (the usage normalizer drops it; a raw one stays ambiguous)', () => {
    expect(extractGeminiUsage({ ...ONE_K, serviceTier: 'turbo' })?.serviceTier).toBeNull()
    expect(deriveProviderUsageCost({ ...imageRow(), serviceTier: 'turbo' }, newVersions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('NO reported tier: Standard is assumed only because the registry prices exactly one tier for the model — and the assumption is recorded', () => {
    const costs = price(NO_TIER)
    for (const cost of Object.values(costs)) {
      expect(cost).toMatchObject({ status: 'estimated', serviceTier: 'standard' })
      expect(cost.status === 'estimated' && cost.assumptions).toContain('service_tier_sole_registry_tier')
    }
    expect(costs.image_output_tokens).toMatchObject({ components: [{ amount: '0.0336' }] })
    // identical amounts to the reported-Standard case
    expect(amount(costs.image_output_tokens)).toBe(amount(price(ONE_K).image_output_tokens))
  })

  it('the fallback is DISABLED when the registry prices a second tier for the model', () => {
    const flex = toPricingVersion({
      id: 'flex-1', provider: 'gemini', model: NB21, usage_category: 'image_output', service_tier: 'flex', currency: 'USD', unit_name: 'tokens', unit_quantity: '1000000', price_amount: '15',
      effective_from: '2026-10-12T00:00:00Z', effective_to: null, effective_from_basis: 'observed_at_source', source_url: 'https://example.test', source_label: 't', retrieved_at: '2026-10-12T00:00:00Z', notes: null,
    })!
    for (const cost of Object.values(price(NO_TIER, 'nb21', [...newVersions, flex]))) expect(cost).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    // the other model (still single-tier) keeps working
    expect(price(NO_TIER, 'lite', [...newVersions, flex]).image_output_tokens.status).toBe('estimated')
    // a reported tier still wins with two tiers present
    expect(price(ONE_K, 'nb21', [...newVersions, flex]).image_output_tokens).toMatchObject({ status: 'estimated', serviceTier: 'standard', components: [{ amount: '0.0336' }] })
    expect(price({ ...ONE_K, serviceTier: 'flex' }, 'nb21', [...newVersions, flex]).image_output_tokens).toMatchObject({ status: 'estimated', serviceTier: 'flex', components: [{ amount: '0.0168' }] })
  })

  it('the fallback is limited to image-generation rows: the same model in any other operation keeps the strict rule', () => {
    const textRow: ProviderUsageCostInput = { provider: 'gemini', transport: 'api', operation: 'create', model: NB21, quantity: 100, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: '2026-10-20T12:00:00Z' }
    expect(deriveProviderUsageCost(textRow, newVersions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    const { serviceTier: _s, ...noTier } = imageRow()
    void _s
    expect(deriveProviderUsageCost({ ...noTier, provider: 'openai' }, newVersions).status).not.toBe('estimated')
    expect(deriveProviderUsageCost({ ...noTier, operation: 'image_review' }, newVersions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('the fallback never invents a tier when the only registry tier is not Standard', () => {
    const onlyFlex = newVersions.filter((v) => v.model !== NB21).concat(newVersions.filter((v) => v.model === NB21).map((v) => ({ ...v, serviceTier: 'flex' })))
    const { serviceTier: _s, ...noTier } = imageRow()
    void _s
    expect(deriveProviderUsageCost(noTier, onlyFlex)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })
})

describe('price versions and effective dates', () => {
  it('an execution before the first published price is unpriced (no back-dating); at the instant it starts, it is priced', () => {
    expect(price(ONE_K, 'nb21', newVersions, '2026-10-11T23:59:59Z').image_output_tokens).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(price(ONE_K, 'nb21', newVersions, '2026-10-12T00:00:00Z').image_output_tokens).toMatchObject({ status: 'estimated', components: [{ amount: '0.0336' }] })
  })

  it('a later price change prices later executions only; earlier executions keep their version', () => {
    const old = newVersions.find((v) => v.model === NB21 && v.usageCategory === 'image_output')!
    const closed = { ...old, effectiveTo: Date.parse('2026-12-01T00:00:00Z') }
    const next = { ...old, id: 'next', priceAmount: BigInt('25000000000000') /* 25 at the registry's 12-digit scale */, effectiveFrom: Date.parse('2026-12-01T00:00:00Z'), effectiveTo: null }
    const versions = [...newVersions.filter((v) => v !== old), closed, next]
    expect(price(ONE_K, 'nb21', versions, '2026-11-30T23:59:59Z').image_output_tokens).toMatchObject({ components: [{ amount: '0.0336' }] })
    expect(price(ONE_K, 'nb21', versions, '2026-12-01T00:00:00Z').image_output_tokens).toMatchObject({ components: [{ amount: '0.028' }] })
  })

  it('overlapping versions are ambiguous, never guessed', () => {
    const old = newVersions.find((v) => v.model === NB21 && v.usageCategory === 'image_output')!
    expect(price(ONE_K, 'nb21', [...newVersions, { ...old, id: 'dup' }]).image_output_tokens).toEqual({ status: 'ambiguous', reason: 'overlapping_pricing_versions' })
  })
})

describe('compatibility with today\'s Production registry (old constraint, 22 rows, no image_output row)', () => {
  it('the registry has no image rows and the app code handles it: every Gemini image row is unavailable, never a failure, never zero', () => {
    expect(oldVersions).toHaveLength(22)
    expect(oldVersions.some((v) => v.model === NB21 || v.model === LITE)).toBe(false)
    const costs = price({ promptTokenCount: 20, thoughtsTokenCount: 215, candidatesTokenCount: 1160, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1120 }] }, 'nb21', oldVersions)
    for (const cost of Object.values(costs)) {
      expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
      expect(amount(cost)).toBeUndefined()
    }
    expect(price(ONE_K, 'lite', oldVersions).image_output_tokens).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    // the no-tier fallback cannot manufacture a price out of an empty registry
    const { serviceTier: _s, ...noTier } = ONE_K
    void _s
    for (const cost of Object.values(price(noTier, 'nb21', oldVersions))) expect(cost.status).toBe('unavailable')
  })

  it('an aggregate of only-unpriced image rows shows nothing as a total (and is not complete)', () => {
    const summary = summarizeEstimatedCost(Object.values(price(ONE_K, 'nb21', oldVersions)))
    expect(summary).toMatchObject({ totals: [], pricedEvents: 0, unpricedEvents: 2, complete: false })
  })

  it('the SQL-before-code and code-before-SQL orders are both safe: input/text/thinking rows price correctly once ONLY the input/output rows exist, IMAGE stays unpriced', () => {
    const withoutImageRows = newVersions.filter((v) => v.usageCategory !== 'image_output')
    const usage = { promptTokenCount: 20, thoughtsTokenCount: 215, candidatesTokenCount: 1160, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1120 }] }
    const costs = price(usage, 'nb21', withoutImageRows)
    expect(costs.input_tokens.status).toBe('estimated')
    expect(costs.text_output_tokens.status).toBe('estimated')
    expect(costs.thoughts_tokens.status).toBe('estimated')
    expect(costs.image_output_tokens).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' }) // never the text price
  })
})

describe('no provider execution is involved', () => {
  it('deriving costs reads only data: the release switch plays no role and no fetch is made', async () => {
    const calls: unknown[] = []
    const original = globalThis.fetch
    globalThis.fetch = ((...args: unknown[]) => { calls.push(args); throw new Error('network is not allowed') }) as typeof fetch
    try {
      price(ONE_K)
      summarizeEstimatedCost(Object.values(price(ONE_K)))
    } finally {
      globalThis.fetch = original
    }
    expect(calls).toEqual([])
  })
})
