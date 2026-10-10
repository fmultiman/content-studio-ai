import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'
import { promptAssistanceUsageEvents, type PromptAssistanceUsageContext } from '@/lib/prompt-assistance/usage'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { costInputFromRow, deriveProviderUsageCost, type ProviderUsageCost } from '../derive'
import { toPricingVersion, type PricingVersion } from '../registry'

// FUTURE-054 — migration 062 (OpenAI gpt-4o-mini list price) applied on top of the REAL 061 in PGlite, and the cost the
// existing derivation produces for Prompt Assistance ledger rows. Nothing here calls a provider.

const FILE = '062_seed_openai_gpt_4o_mini_pricing.sql'
const RAW = readFileSync(join(process.cwd(), 'scripts', FILE), 'utf8')
const SQL = RAW.replace(/--.*$/gm, '')

let db: PGlite
let versions: PricingVersion[]

const wire = (r: Record<string, any>): Record<string, any> => ({
  ...r,
  effective_from: (r.effective_from as Date).toISOString(),
  effective_to: r.effective_to ? (r.effective_to as Date).toISOString() : null,
  retrieved_at: (r.retrieved_at as Date).toISOString(),
})

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY)')
  await db.exec(script('044_create_provider_usage_events.sql'))
  await db.exec(script('061_create_provider_pricing_versions.sql'))
  await db.exec(RAW)
  const rows = (await db.query<Record<string, any>>('SELECT * FROM provider_pricing_versions')).rows
  versions = rows.map(wire).map(toPricingVersion).filter((v): v is PricingVersion => v !== null)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const USER = '11111111-1111-4111-8111-111111111111'
const AFTER = '2026-10-10T13:00:00Z'

function costOf(
  usage: NonNullable<PromptAssistanceUsageContext['usage']>,
  options: { provider?: string; model?: string; at?: string; only?: 'input_tokens' | 'output_tokens' | 'tokens' } = {},
): ProviderUsageCost[] {
  const provider = options.provider ?? 'openai'
  const model = options.model ?? 'gpt-4o-mini'
  return promptAssistanceUsageEvents({ userId: USER, projectId: null, productionId: null, provider, model, operation: 'create', funding: 'user_byok', usage })
    .filter((event) => !options.only || event.measurement?.unit === options.only)
    .map((event) => ({ ...toUsageEventRow(event), occurred_at: options.at ?? AFTER }))
    .map((row) => deriveProviderUsageCost(costInputFromRow(row), versions))
}

describe('migration 062 — data only, governed, idempotent', () => {
  it('only inserts into provider_pricing_versions: no DDL, no policy, no ledger access, no UPDATE/DELETE statement', () => {
    expect(SQL).not.toMatch(/provider_usage_events/i)
    expect(SQL).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/i)
    expect(SQL).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM)\s/im)
    expect([...SQL.matchAll(/INSERT INTO\s+(\w+)/gi)].map((m) => m[1])).toEqual(['provider_pricing_versions'])
  })

  it('seeds exactly the verified Standard list price of gpt-4o-mini, with provenance, observed — not back-dated', async () => {
    const rows = (await db.query<Record<string, any>>("SELECT * FROM provider_pricing_versions WHERE provider = 'openai' ORDER BY usage_category")).rows.map(wire)
    expect(rows.map((r) => [r.model, r.usage_category, r.service_tier, r.currency, r.unit_name, Number(r.unit_quantity), Number(r.price_amount)])).toEqual([
      ['gpt-4o-mini', 'cached_input', 'standard', 'USD', 'tokens', 1_000_000, 0.075],
      ['gpt-4o-mini', 'input', 'standard', 'USD', 'tokens', 1_000_000, 0.15],
      ['gpt-4o-mini', 'output', 'standard', 'USD', 'tokens', 1_000_000, 0.6],
    ])
    for (const row of rows) {
      expect(row.source_url).toBe('https://developers.openai.com/api/docs/pricing')
      expect(row.effective_from_basis).toBe('observed_at_source')
      expect(row.effective_from).toBe('2026-10-10T00:00:00.000Z')
      expect(row.effective_to).toBeNull()
    }
    // No other OpenAI model, tier or Batch price is invented.
    expect(rows).toHaveLength(3)
  })

  it('is re-runnable without duplicating or changing rows', async () => {
    const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM provider_pricing_versions')).rows[0].n
    await db.exec(RAW)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM provider_pricing_versions')).rows[0].n).toBe(before)
  })

  it('leaves the 061 seed untouched and the ledger empty', async () => {
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM provider_pricing_versions WHERE provider IN ('gemini','kling')")).rows[0].n).toBe(19)
    expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM provider_usage_events')).rows[0].n).toBe(0)
  })
})

describe('OpenAI Prompt Assistance cost — only what is proven', () => {
  const usage = { inputTokens: 265, outputTokens: 74, totalTokens: 339, providerRequestId: 'c1', serviceTier: 'default' }

  it('prices input and output at the Standard list price when the response itself reported the default tier', () => {
    const [input, output] = costOf(usage)
    expect(input).toMatchObject({ status: 'estimated', currency: 'USD', serviceTier: 'standard', basis: 'list_price_equivalent', amount: '0.00003975' })
    expect(output).toMatchObject({ status: 'estimated', amount: '0.0000444' })
    expect(input.status === 'estimated' && input.assumptions).toEqual(expect.arrayContaining(['list_price_equivalent', 'byok_invoice_may_differ', 'price_observed_at_source']))
    expect(input.status === 'estimated' && input.assumptions).not.toContain('paid_tier_list_price')
    expect(input.status === 'estimated' && input.pricing.sourceUrl).toBe('https://developers.openai.com/api/docs/pricing')
  })

  it('splits the cached SUBSET out of the prompt tokens (priced once, never on top)', () => {
    const [input] = costOf({ ...usage, inputTokens: 1200, cachedInputTokens: 1024 }, { only: 'input_tokens' })
    // 176 x 0.15/1M + 1024 x 0.075/1M
    expect(input).toMatchObject({ status: 'estimated', amount: '0.0001032' })
    expect(input.status === 'estimated' && input.components.map((c) => [c.category, c.quantity])).toEqual([['input', '176'], ['cached_input', '1024']])
  })

  it('a missing tier is ambiguous — never assumed Standard from the key, the account or the model', () => {
    const { serviceTier: _omit, ...withoutTier } = usage
    for (const cost of costOf(withoutTier)) expect(cost).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('a reported non-Standard tier is never priced with the Standard price', () => {
    for (const tier of ['flex', 'priority', 'scale']) {
      for (const cost of costOf({ ...usage, serviceTier: tier })) expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
    }
  })

  it('unsupported OpenAI models stay unpriced (gpt-3.5-turbo has no verified price here)', () => {
    for (const cost of costOf(usage, { model: 'gpt-3.5-turbo' })) expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
  })

  it('executions before the observed effective date, unknown usage and inconsistent cached counts get no amount', () => {
    for (const cost of costOf(usage, { at: '2026-10-09T23:59:59Z' })) expect(cost).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(costOf({ inputTokens: null, outputTokens: null, totalTokens: null } as any)[0]).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(costOf({ ...usage, inputTokens: 10, cachedInputTokens: 11 }, { only: 'input_tokens' })[0]).toEqual({ status: 'unavailable', reason: 'inconsistent_usage' })
  })

  it('an OpenAI row can never be a thinking row, and a measured zero is a zero cost, not unknown', () => {
    const row = { ...toUsageEventRow(promptAssistanceUsageEvents({ userId: USER, projectId: null, productionId: null, provider: 'openai', model: 'gpt-4o-mini', operation: 'create', funding: 'user_byok', usage })[0]), occurred_at: AFTER, unit: 'tokens', provider_metadata: { usage_category: 'thoughts', usage: { serviceTier: 'default' } } }
    expect(deriveProviderUsageCost(costInputFromRow(row), versions)).toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
    expect(costOf({ ...usage, outputTokens: 0 }, { only: 'output_tokens' })[0]).toMatchObject({ status: 'estimated', amount: '0' })
  })

  it('the already-recorded smoke rows (no tier, no funding in metadata) stay honestly unpriced and are never repriced', () => {
    for (const unit of ['input_tokens', 'output_tokens']) {
      const row = { provider: 'openai', transport: 'api', operation: 'create', model: 'gpt-4o-mini', quantity: '265', unit, measurement_source: 'provider_reported', occurred_at: '2026-10-10 02:23:47.826017+00', provider_metadata: { operation: 'create', media_type: 'image' } }
      expect(deriveProviderUsageCost(costInputFromRow(row), versions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    }
  })
})

describe('Gemini Prompt Assistance cost — tier only when the provider reported it', () => {
  const lite = 'gemini-3.5-flash-lite'
  const usage = { inputTokens: 273, outputTokens: 79, totalTokens: 432, thoughtsTokens: 80, providerRequestId: 'g1', serviceTier: 'standard' }

  it('prices input, output and thinking (as output, once) at the reported Standard tier and never prices the total', () => {
    const [input, output, thoughts] = costOf(usage, { provider: 'gemini', model: lite })
    expect(input).toMatchObject({ status: 'estimated', serviceTier: 'standard', amount: '0.0000819' }) // 273 x 0.30 / 1M
    expect(output).toMatchObject({ status: 'estimated', amount: '0.0001975' }) // 79 x 2.50 / 1M
    expect(thoughts).toMatchObject({ status: 'estimated', amount: '0.0002' }) // 80 x 2.50 / 1M
    expect(input.status === 'estimated' && input.assumptions).toEqual(expect.arrayContaining(['paid_tier_list_price', 'byok_invoice_may_differ']))
  })

  it('uses the tier the provider reported when it is not Standard', () => {
    const [input] = costOf({ ...usage, serviceTier: 'flex' }, { provider: 'gemini', model: lite })
    expect(input).toMatchObject({ status: 'estimated', serviceTier: 'flex', amount: '0.00004095' }) // 273 x 0.15 / 1M
  })

  it('an unreported tier stays ambiguous for every row, thinking included', () => {
    for (const cost of costOf({ ...usage, serviceTier: null }, { provider: 'gemini', model: lite })) expect(cost).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('tool-use prompt tokens (billed as input, in no row) make the input row ambiguous instead of under-priced', () => {
    const [input] = costOf({ ...usage, toolUsePromptTokens: 12 }, { provider: 'gemini', model: lite })
    expect(input).toEqual({ status: 'ambiguous', reason: 'tool_use_tokens_not_priced' })
  })
})
