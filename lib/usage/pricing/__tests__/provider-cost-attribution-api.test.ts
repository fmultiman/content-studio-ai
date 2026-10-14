import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from '@/lib/__tests__/helpers/fake-db'
import { summarizeEstimatedCost } from '../aggregate'
import { GPT_IMAGE_2, VEO_FAST, registriesBeforeAndAfter } from './provider-cost-fixtures'

// PROVIDER_COST_ATTRIBUTION_V1 — GET /api/settings/usage derives GPT Image 2 and Veo costs ON READ from the reviewed registry, for the
// signed-in user only. The ledger rows are the ones Production holds (verbatim facts); nothing is written and no provider is called.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import * as server from '@/lib/supabase/server'

let registryBefore: Array<Record<string, unknown>>
let registryAfter: Array<Record<string, unknown>>
beforeAll(async () => {
  const registries = await registriesBeforeAndAfter()
  registryBefore = registries.beforeRows
  registryAfter = registries.afterRows
}, 120_000)

const OPENAI_USAGE = { inputTokens: 1054, totalTokens: 2810, outputTokens: 1756, inputTextTokens: 30, inputImageTokens: 1024, outputTextTokens: 0, outputImageTokens: 1756 }
const row = (id: string, userId: string, extra: Record<string, unknown>) => ({
  id, user_id: userId, project_id: null, connection_id: null, provider_task_id: 'task-SECRET', idempotency_key: `k-${id}`, transport: 'rest', ...extra,
})
const openai = (id: string, userId: string, unit: 'input_tokens' | 'output_tokens', quantity: string) =>
  row(id, userId, {
    provider: 'openai', operation: 'image_generation', model: GPT_IMAGE_2, quantity, unit, measurement_source: 'provider_reported', occurred_at: '2026-10-13T17:20:39.575778+00:00',
    provider_metadata: { api: 'openai_images_edits', usage: OPENAI_USAGE, funding: 'user_byok', credential_source: 'user' },
  })
const veo = (id: string, userId: string, operation: string, seconds: number, occurred_at: string) =>
  row(id, userId, {
    provider: 'gemini', operation, model: VEO_FAST, quantity: String(seconds), unit: 'seconds', measurement_source: 'derived', occurred_at,
    provider_metadata: { request: { audio: null, duration: seconds, multi_shot: null, resolution: '720p', aspect_ratio: '16:9', output_count: 1 } },
  })
const klingAB = (id: string, userId: string) =>
  row(id, userId, {
    provider: 'kling', operation: 'image_to_video', model: 'kling-v3', quantity: null, unit: null, measurement_source: 'unknown', occurred_at: '2026-10-14T10:21:38.788+00:00',
    provider_metadata: { request: { audio: 'off', duration: 5, resolution: '720p' } },
  })

const EVENTS = [
  openai('a-oai-in', 'user-a', 'input_tokens', '1054'),
  openai('a-oai-out', 'user-a', 'output_tokens', '1756'),
  veo('a-t2v', 'user-a', 'text_to_video', 4, '2026-10-14T00:22:26.001+00:00'),
  veo('a-i2v', 'user-a', 'image_to_video', 4, '2026-10-14T00:50:08.305+00:00'),
  veo('a-ab', 'user-a', 'image_to_video', 8, '2026-10-14T00:58:48.644+00:00'),
  klingAB('a-kling-ab', 'user-a'),
  // another account: must never be visible, counted or priced for user-a
  veo('b-veo', 'user-b', 'text_to_video', 8, '2026-10-14T01:00:00.000+00:00'),
  openai('b-oai-out', 'user-b', 'output_tokens', '999'),
]

function signIn(userId: string | null, registry: Array<Record<string, unknown>>) {
  const db = createFakeDb({ seed: { provider_usage_events: EVENTS, provider_pricing_versions: registry, projects: [], provider_connections: [] } }) as any
  vi.mocked(server.createClient).mockResolvedValue({
    from: (table: string) => db.from(table),
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: userId ? null : { message: 'no session' } }) },
  } as any)
  return db
}
const get = async () => (await import('@/app/api/settings/usage/route')).GET()

describe('GET /api/settings/usage — GPT Image 2 and Veo costs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prices the real canaries for the signed-in user: Veo US$ 1.60 estimated, the OpenAI canary as a labelled simulation', async () => {
    signIn('user-a', registryAfter)
    const body = await (await get()).json()
    const byId = Object.fromEntries(body.events.map((e: any) => [e.id, e]))
    expect(Object.keys(byId).sort()).toEqual(['a-ab', 'a-i2v', 'a-kling-ab', 'a-oai-in', 'a-oai-out', 'a-t2v'])

    expect(byId['a-t2v'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.4', currency: 'USD', basis: 'list_price_equivalent' })
    expect(byId['a-i2v'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.4' })
    expect(byId['a-ab'].estimated_cost).toMatchObject({ status: 'estimated', amount: '0.8' })
    expect(byId['a-t2v'].estimated_cost.assumptions).toContain('usage_derived_from_request')

    expect(byId['a-oai-in'].estimated_cost).toMatchObject({ status: 'simulated', amount: '0.008342', basis: 'current_list_price_simulation' })
    expect(byId['a-oai-out'].estimated_cost).toMatchObject({ status: 'simulated', amount: '0.05268' })

    // the Kling A+B has no usage: unknown, no amount at all
    expect(byId['a-kling-ab'].estimated_cost).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(byId['a-kling-ab']).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown' })

    // the usage columns are exactly what the ledger holds; the derived seconds stay labelled as derived
    expect(byId['a-ab']).toMatchObject({ quantity: 8, unit: 'seconds', measurement_source: 'derived' })
    expect(byId['a-oai-out']).toMatchObject({ quantity: 1756, unit: 'output_tokens', measurement_source: 'provider_reported', funding: 'user_byok' })

    const summary = summarizeEstimatedCost(body.events.map((e: any) => e.estimated_cost))
    expect(summary.totals).toEqual([{ currency: 'USD', amount: '1.6', pricedEvents: 3 }])
    expect(summary.simulatedTotals).toEqual([{ currency: 'USD', amount: '0.061022', pricedEvents: 2 }])
    expect(summary.complete).toBe(false)
  })

  it('is isolated between users: another account\'s rows are neither returned nor priced, and the payload leaks no ids or task ids', async () => {
    signIn('user-a', registryAfter)
    const a = await (await get()).json()
    expect(a.events.map((e: any) => e.id)).not.toEqual(expect.arrayContaining(['b-veo']))
    expect(JSON.stringify(a)).not.toMatch(/b-veo|b-oai-out|task-SECRET|user-b|idempotency|k-a-/)

    signIn('user-b', registryAfter)
    const b = await (await get()).json()
    expect(b.events.map((e: any) => e.id).sort()).toEqual(['b-oai-out', 'b-veo'])
    expect(b.events.find((e: any) => e.id === 'b-veo').estimated_cost).toMatchObject({ status: 'estimated', amount: '0.8' })
    expect(JSON.stringify(b)).not.toMatch(/a-t2v|a-oai|a-kling|user-a/)
  })

  it('rejects an unauthenticated request without reading the ledger', async () => {
    signIn(null, registryAfter)
    const response = await get()
    expect(response.status).toBe(401)
  })

  it('before the pricing SQL is applied the same rows keep their usage and are "unavailable" (never zero, never a fallback price)', async () => {
    signIn('user-a', registryBefore)
    const body = await (await get()).json()
    for (const id of ['a-oai-in', 'a-oai-out', 'a-t2v', 'a-i2v', 'a-ab']) {
      expect(body.events.find((e: any) => e.id === id).estimated_cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    }
    expect(JSON.stringify(body)).not.toMatch(/"amount"/)
    expect(body.events.find((e: any) => e.id === 'a-ab')).toMatchObject({ quantity: 8, unit: 'seconds' })
  })

  it('reading never writes: the ledger and the registry are exactly as seeded after the request', async () => {
    const db = signIn('user-a', registryAfter)
    const snapshot = JSON.stringify([db.tables.provider_usage_events, db.tables.provider_pricing_versions])
    await get()
    await get()
    expect(JSON.stringify([db.tables.provider_usage_events, db.tables.provider_pricing_versions])).toBe(snapshot)
    expect(db.tables.provider_usage_events).toHaveLength(EVENTS.length)
  })
})
