import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '@/lib/__tests__/helpers/fake-db'
import { extractGeminiUsage } from '@/lib/providers/gemini/usage'
import { geminiImageUsageEvents } from '@/lib/usage/gemini-image-usage'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { summarizeEstimatedCost } from '../aggregate'
import { LITE, NB21, registries } from './image-pricing-fixtures'

// FUTURE-064 Slice D — GET /api/settings/usage end to end for Gemini image-generation ledger rows (real Slice C events), over the
// Production registry as it is TODAY and over the registry the reviewed SQL would produce. Derived on read; nothing is written; no provider.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
import * as server from '@/lib/supabase/server'

let oldRows: Array<Record<string, unknown>>
let newRows: Array<Record<string, unknown>>
beforeAll(async () => {
  const registry = await registries()
  oldRows = registry.oldRows
  newRows = registry.newRows
}, 60_000)

const events = (usage: Record<string, unknown> | null, providerModel = NB21, attemptId = '11111111-1111-4111-8111-111111111111') =>
  geminiImageUsageEvents({
    userId: 'user-a', attemptId, projectId: null, productionId: null, modelAlias: 'gemini-nb-2.1', providerModel, aspectRatio: '1:1', imageSize: '1K',
    funding: 'user_byok', credentialSource: 'user', providerResponse: 'received', responseId: 'resp-SECRET',
  }, extractGeminiUsage(usage)).map((event, index) => ({
    ...toUsageEventRow(event), id: `${attemptId}-${index}`, user_id: 'user-a', occurred_at: '2026-10-20T12:00:00+00:00',
  }))

const run = async (rows: Array<Record<string, unknown>>, registry: Array<Record<string, unknown>>) => {
  const db = createFakeDb({ seed: { provider_usage_events: rows, provider_pricing_versions: registry, projects: [], provider_connections: [] } }) as any
  vi.mocked(server.createClient).mockResolvedValue({ from: (t: string) => db.from(t), auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } } as any)
  const response = await (await import('@/app/api/settings/usage/route')).GET()
  return { response, body: await response.json(), db }
}

const ONE_K = { promptTokenCount: 14, candidatesTokenCount: 1120, totalTokenCount: 1134, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }

describe('GET /api/settings/usage — Gemini image generation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('with the new registry rows: input and IMAGE output are priced (USD 0.000021 + 0.0336) and the aggregate is complete', async () => {
    const { response, body } = await run(events(ONE_K), newRows)
    expect(response.status).toBe(200)
    const byUnit = Object.fromEntries(body.events.map((e: any) => [e.usage_category ?? e.unit, e]))
    expect(byUnit.image_output).toMatchObject({ operation: 'image_generation', quantity: 1120, unit: 'tokens', usage_category: 'image_output', model: NB21 })
    expect(byUnit.image_output.estimated_cost).toMatchObject({ status: 'estimated', amount: '0.0336', serviceTier: 'standard', components: [{ category: 'image_output' }] })
    expect(byUnit.input_tokens.estimated_cost).toMatchObject({ status: 'estimated', amount: '0.000021' })
    expect(summarizeEstimatedCost(body.events.map((e: any) => e.estimated_cost))).toMatchObject({ complete: true, totals: [{ amount: '0.033621' }] })
  })

  it('Nano Banana 2 Lite is priced from its own versions', async () => {
    const { body } = await run(events(ONE_K, LITE), newRows)
    const image = body.events.find((e: any) => e.usage_category === 'image_output')
    expect(image.estimated_cost).toMatchObject({ status: 'estimated', amount: '0.0336' })
    expect(body.events.find((e: any) => e.unit === 'input_tokens').estimated_cost).toMatchObject({ amount: '0.0000035' })
  })

  it("with TODAY's Production registry (old constraint, 22 rows): 200, every image row is unavailable, none is zero, no failure", async () => {
    const { response, body } = await run(events(ONE_K), oldRows)
    expect(response.status).toBe(200)
    expect(body.events).toHaveLength(2)
    for (const event of body.events) {
      expect(event.estimated_cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
      expect(event.estimated_cost).not.toHaveProperty('amount')
    }
    expect(summarizeEstimatedCost(body.events.map((e: any) => e.estimated_cost))).toMatchObject({ totals: [], complete: false, unpricedEvents: 2 })
  })

  it('partial usage (output without a modality breakdown) is partial: input priced, output unavailable with its own reason', async () => {
    const { body } = await run(events({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' }), newRows)
    const costs = Object.fromEntries(body.events.map((e: any) => [e.usage_category ?? e.unit, e.estimated_cost]))
    expect(costs.input_tokens).toMatchObject({ status: 'estimated', amount: '0.000021' })
    expect(costs.output_unattributed).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
    expect(summarizeEstimatedCost(body.events.map((e: any) => e.estimated_cost))).toMatchObject({ complete: false, pricedEvents: 1, unpricedEvents: 1, totals: [{ amount: '0.000021' }] })
  })

  it('unknown usage is unavailable with no amount; no tier reported falls back to Standard only with its assumption', async () => {
    const unknown = await run(events(null), newRows)
    expect(unknown.body.events[0].estimated_cost).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    const { serviceTier: _s, ...noTier } = ONE_K
    void _s
    const { body } = await run(events(noTier), newRows)
    const image = body.events.find((e: any) => e.usage_category === 'image_output')
    expect(image.estimated_cost).toMatchObject({ status: 'estimated', amount: '0.0336', serviceTier: 'standard' })
    expect(image.estimated_cost.assumptions).toContain('service_tier_sole_registry_tier')
  })

  it('derives on read and writes nothing; the response exposes no response id, idempotency key or raw metadata', async () => {
    const { db, body } = await run(events(ONE_K), newRows)
    expect(db.log.filter((op: string) => /^(insert|update|upsert|delete)/.test(op))).toEqual([])
    expect(JSON.stringify(body)).not.toMatch(/resp-SECRET|idempotency|gemini_image:|provider_metadata|promptTokensDetails/)
  })
})
