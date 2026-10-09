import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '@/lib/__tests__/helpers/fake-db'

// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — GET /api/settings/usage derives the estimate ON READ.
// Same fixtures as Production at the time of the mission (6 Gemini rows, 5 Kling rows). No provider is called.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import * as server from '@/lib/supabase/server'

const price = (id: string, model: string, category: string, tier: string, amount: string) => ({
  id, provider: 'gemini', model, usage_category: category, service_tier: tier, currency: 'USD', unit_name: 'tokens', unit_quantity: '1000000',
  price_amount: amount, effective_from: '2026-10-09T00:00:00+00:00', effective_to: null, effective_from_basis: 'observed_at_source',
  source_url: 'https://ai.google.dev/gemini-api/docs/pricing', source_label: `Gemini API pricing - ${model} - ${tier} - ${category}`, retrieved_at: '2026-10-09T00:00:00+00:00', notes: null,
})
const REGISTRY = [
  price('p-in', 'gemini-3.5-flash', 'input', 'standard', '1.500000000000'),
  price('p-cache', 'gemini-3.5-flash', 'cached_input', 'standard', '0.150000000000'),
  price('p-out', 'gemini-3.5-flash', 'output', 'standard', '9.000000000000'),
  { ...price('k-unit', 'kling-v3', 'unit', 'standard', '0.140000000000'), provider: 'kling', unit_name: 'units', unit_quantity: '1', effective_from: '2026-10-09T00:00:00+00:00', effective_from_basis: 'observed_at_source' },
]

const meta = (extra: Record<string, unknown> = {}) => ({ funding: 'user_byok', usage: { serviceTier: 'standard' }, ...extra })
const gemini = (id: string, unit: string, quantity: number | string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'user-a', occurred_at: '2026-10-12T17:38:46.650515+00:00', provider: 'gemini', transport: 'rest', operation: 'video_review', model: 'gemini-3.5-flash',
  quantity, unit, measurement_source: 'provider_reported', project_id: null, connection_id: null, provider_task_id: 'resp-SECRET', provider_metadata: meta(), idempotency_key: `k-${id}`, ...extra,
})
const kling = (id: string, extra: Record<string, unknown>) => ({
  id, user_id: 'user-a', provider: 'kling', transport: 'rest', operation: 'text_to_video', model: 'kling-v3', quantity: null, unit: null, measurement_source: 'unknown',
  project_id: null, connection_id: null, provider_task_id: 'task-SECRET', provider_metadata: {}, idempotency_key: `k-${id}`, ...extra,
})

const EVENTS = [
  gemini('g-in', 'input_tokens', '18432'),
  gemini('g-out', 'output_tokens', 612),
  gemini('g-think', 'tokens', 240, { provider_metadata: meta({ usage_category: 'thoughts' }) }),
  kling('k-rest-i2v', { transport: 'rest', operation: 'image_to_video', quantity: 3, unit: 'units', measurement_source: 'provider_reported', occurred_at: '2026-09-28T07:38:26.381+00:00', provider_metadata: { historical_import: true } }),
  kling('k-rest-t2v', { transport: 'rest', quantity: 3, unit: 'units', measurement_source: 'provider_reported', occurred_at: '2026-09-28T20:58:46.861+00:00', provider_metadata: { historical_import: true } }),
  kling('k-mcp-credits', { transport: 'mcp', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurement_source: 'balance_delta', occurred_at: '2026-09-29T20:01:46.620+00:00', provider_metadata: { historical_import: true } }),
  kling('k-mcp-unknown-1', { transport: 'mcp', model: 'kling-video-v3_0', occurred_at: '2026-09-30T07:55:08.924+00:00' }),
  kling('k-mcp-unknown-2', { transport: 'mcp', operation: 'image_to_video', model: 'kling-video-v3_0', occurred_at: '2026-10-01T02:22:12.489+00:00' }),
]

function signIn(db: any, options: { registryFails?: boolean } = {}) {
  const from = (table: string) => {
    if (options.registryFails && table === 'provider_pricing_versions') return { select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
    return db.from(table)
  }
  vi.mocked(server.createClient).mockResolvedValue({ from, auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } } as any)
}
const get = async () => (await import('@/app/api/settings/usage/route')).GET()
const dbWith = (events: Array<Record<string, unknown>>, registry: Array<Record<string, unknown>> = REGISTRY) =>
  createFakeDb({ seed: { provider_usage_events: events, provider_pricing_versions: registry, projects: [], provider_connections: [] } }) as any

describe('GET /api/settings/usage — estimated cost derived on read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prices the Gemini Review rows (input, output, thinking once each) and keeps the usage untouched', async () => {
    const db = dbWith(EVENTS)
    signIn(db)
    const body = await (await get()).json()
    const byId = Object.fromEntries(body.events.map((e: any) => [e.id, e]))
    expect(byId['g-in']).toMatchObject({ quantity: 18432, unit: 'input_tokens', measurement_source: 'provider_reported', funding: 'user_byok' })
    expect(byId['g-in'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.027648', currency: 'USD', basis: 'list_price_equivalent', serviceTier: 'standard' })
    expect(byId['g-out'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.005508' })
    expect(byId['g-think'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.00216' })
    expect(byId['g-think']).toMatchObject({ quantity: 240, unit: 'tokens', usage_category: 'thoughts' })
    expect(byId['g-in'].estimated_cost.pricing).toMatchObject({
      sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', retrievedAt: '2026-10-09T00:00:00+00:00', effectiveFrom: '2026-10-09T00:00:00.000Z', effectiveFromBasis: 'observed_at_source', versionIds: ['p-in'],
    })
    expect(byId['g-in'].estimated_cost.assumptions).toEqual(expect.arrayContaining(['list_price_equivalent', 'byok_invoice_may_differ']))
  })

  it('the six Gemini rows that exist in Production (2026-10-08) predate the observed rates: all stay unavailable, usage untouched', async () => {
    const at = ['2026-10-08T17:38:46.650515+00:00', '2026-10-08T17:39:03.609517+00:00']
    const production = at.flatMap((occurred_at, i) => [
      gemini(`h${i}-in`, 'input_tokens', 20000, { occurred_at }),
      gemini(`h${i}-out`, 'output_tokens', 600, { occurred_at }),
      gemini(`h${i}-think`, 'tokens', 200, { occurred_at, provider_metadata: meta({ usage_category: 'thoughts' }) }),
    ])
    const db = dbWith(production)
    signIn(db)
    const body = await (await get()).json()
    expect(body.events).toHaveLength(6)
    for (const event of body.events) {
      expect(event.estimated_cost).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
      expect(event).toMatchObject({ measurement_source: 'provider_reported', funding: 'user_byok' })
    }
    expect(JSON.stringify(body)).not.toMatch(/"amount"/)
    // and the usage rows themselves are exactly as stored
    expect(db.tables.provider_usage_events.map((r: any) => r.quantity)).toEqual(production.map((r) => r.quantity))
  })

  it('none of the five Kling rows is priced, each with a reason and without an amount (unknown is not free)', async () => {
    const db = dbWith(EVENTS)
    signIn(db)
    const body = await (await get()).json()
    const klingRows = body.events.filter((e: any) => e.provider === 'kling')
    expect(klingRows).toHaveLength(5)
    const reasons = Object.fromEntries(klingRows.map((e: any) => [e.id, e.estimated_cost]))
    expect(reasons['k-rest-i2v']).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(reasons['k-rest-t2v']).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(reasons['k-mcp-credits']).toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    expect(reasons['k-mcp-unknown-1']).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(reasons['k-mcp-unknown-2']).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    // usage is exactly what was recorded
    expect(klingRows.find((e: any) => e.id === 'k-mcp-credits')).toMatchObject({ quantity: 18, unit: 'credits', measurement_source: 'balance_delta' })
  })

  it('a registry that cannot be loaded degrades to "unavailable" for every row - the usage still renders, nothing is zero', async () => {
    const db = dbWith(EVENTS)
    signIn(db, { registryFails: true })
    const response = await get()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.events).toHaveLength(EVENTS.length)
    for (const event of body.events) expect(event.estimated_cost).toEqual({ status: 'unavailable', reason: 'pricing_registry_unavailable' })
  })

  it('an empty registry prices nothing (no embedded fallback prices)', async () => {
    const db = dbWith(EVENTS, [])
    signIn(db)
    const body = await (await get()).json()
    expect(body.events.every((e: any) => e.estimated_cost.status === 'unavailable')).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/"amount"/)
  })

  it('a row of the registry that fails validation is ignored, never repaired', async () => {
    const db = dbWith([EVENTS[0]], [{ ...REGISTRY[0], price_amount: 'free' }, ...REGISTRY.slice(1)])
    signIn(db)
    const body = await (await get()).json()
    expect(body.events[0].estimated_cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
  })

  it('a service tier that the provider reported selects that tier; a missing tier is ambiguous', async () => {
    const flex = REGISTRY.map((r) => ({ ...r, id: `${r.id}-flex`, service_tier: 'flex', price_amount: String(Number(r.price_amount) / 2) })).filter((r) => r.provider === 'gemini')
    const db = dbWith(
      [gemini('g-flex', 'input_tokens', 1_000_000, { provider_metadata: meta({ usage: { serviceTier: 'flex' } }) }), gemini('g-none', 'input_tokens', 1_000_000, { provider_metadata: { funding: 'user_byok' } })],
      [...REGISTRY, ...flex],
    )
    signIn(db)
    const byId = Object.fromEntries((await (await get()).json()).events.map((e: any) => [e.id, e]))
    expect(byId['g-flex'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.75', serviceTier: 'flex' })
    expect(byId['g-none'].estimated_cost).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
  })

  it('derives on read and writes nothing: no insert/update/upsert/delete of any table', async () => {
    const db = dbWith(EVENTS)
    signIn(db)
    const before = JSON.stringify(db.tables)
    await get()
    expect(db.log.filter((op: string) => /^(insert|update|upsert|delete)/.test(op))).toEqual([])
    expect(JSON.stringify(db.tables)).toBe(before)
  })

  it('the response carries display facts only: provenance of the price, but no task id, idempotency key or raw metadata', async () => {
    const db = dbWith(EVENTS)
    signIn(db)
    const raw = JSON.stringify(await (await get()).json())
    expect(raw).not.toMatch(/resp-SECRET|task-SECRET|idempotency|provider_metadata|promptTokensDetails/)
  })
})
