import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-064 Slice C — usage accounting of POST /api/gemini/generate-image against the in-memory fake database (real Attempt
// lifecycle code, and a faithful model of provider_usage_events: UNIQUE idempotency_key + ON CONFLICT DO NOTHING, the
// quantity/unit/source shape check, one statement = all rows or none). The Google response, S3 and auth are fakes. Dummy
// keys, 0 real provider calls, 0 images, no migration.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  settings: { current: null as Record<string, unknown> | null },
  db: { current: null as unknown },
  upload: vi.fn(),
  presign: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.settings.current, error: null }) }) }) }),
  }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => mocks.db.current }))
vi.mock('@/lib/storage/s3', () => ({ uploadImageToS3: mocks.upload, createPresignedReadUrl: mocks.presign }))

import { POST } from '@/app/api/gemini/generate-image/route'
import { GEMINI_IMAGE_GENERATION_FLAG } from '@/lib/providers/gemini/image-feature'
import { costInputFromRow, deriveProviderUsageCost } from '@/lib/usage/pricing/derive'
import { createFakeDb, type FakeDb, type Injected, type Row } from './helpers/fake-image-db'

const USER = 'user-1'
const SESSION = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const REQ_2 = '33333333-3333-4333-8333-333333333333'
const GEMINI_KEY = 'AIza-user-gemini-dummy'
const state = { schemaVersion: 1, autoMode: false }

// What Google reports for one Nano Banana text->image execution (IMAGE-modality output tokens).
const USAGE_IMAGE = {
  promptTokenCount: 14, candidatesTokenCount: 1290, totalTokenCount: 1304, serviceTier: 'standard',
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 14 }],
  candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }],
}

let png: Buffer
beforeAll(async () => { png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3366cc' } }).png().toBuffer() })

let db: FakeDb
let fetchSpy: ReturnType<typeof vi.spyOn>
const NO_USAGE = Symbol('no usageMetadata')
const ok = (usageMetadata: unknown = USAGE_IMAGE, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }, finishReason: 'STOP' }],
  ...(usageMetadata === NO_USAGE ? {} : { usageMetadata }), responseId: 'resp-abc', modelVersion: 'nano-banana-2.1-001', ...extra,
}), { status: 200 })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const sessionRow = (overrides: Row = {}): Row => ({ id: SESSION, user_id: USER, project_id: null, production_id: null, working_prompt: 'user idea', working_state: state, current_image_id: null, revision: 1, ...overrides })
const body = (overrides: Record<string, unknown> = {}) => ({ prompt: 'a red fox', model: 'gemini-nb-2.1', sessionId: SESSION, clientRequestId: REQ, ...overrides })
const post = (payload: unknown) => POST(new Request('http://localhost/api/gemini/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))
const attempts = () => db.tables.image_generation_attempts
const images = () => db.tables.images
const ledger = () => db.tables.provider_usage_events
const keys = () => ledger().map((row) => String(row.idempotency_key).split(':').slice(2).join(':')).sort()
const metadataOf = (index = 0) => attempts()[index].result_metadata as any
const setDb = (next: FakeDb) => { db = next; mocks.db.current = next }
const withDb = (failOn: (table: string, op: string) => Injected = () => undefined, seed: Record<string, Row[]> = { image_generation_sessions: [sessionRow()] }) => setDb(createFakeDb(seed, failOn))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  mocks.settings.current = { gemini_api_key: GEMINI_KEY }
  mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/o.png', thumbnailUrl: 'https://cdn.test/t.webp', storageProvider: 's3', storagePath: 'users/u/images/x/original.png', thumbnailPath: 'users/u/images/x/thumb.webp', fileSize: png.length, mimeType: 'image/png' })
  mocks.presign.mockResolvedValue('https://signed.test/o.png')
  withDb()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('a successful execution is accounted once, linked to the canonical Attempt', () => {
  it('Nano Banana 2.1: input + IMAGE-output rows keyed by the Attempt, official model id, alias in metadata, funding BYOK', async () => {
    const response = await post(body())
    expect(response.status).toBe(200)
    const attemptId = attempts()[0].id as string
    expect(keys()).toEqual(['image_output_tokens', 'input_tokens'])
    expect(ledger().every((row) => String(row.idempotency_key).startsWith(`gemini_image:${attemptId}:`))).toBe(true)
    const byUnit = Object.fromEntries(ledger().map((row) => [String(row.idempotency_key).split(':')[2], row]))
    expect(byUnit.input_tokens).toMatchObject({ quantity: 14, unit: 'input_tokens', measurement_source: 'provider_reported' })
    expect(byUnit.image_output_tokens).toMatchObject({ quantity: 1290, unit: 'tokens', measurement_source: 'provider_reported' })
    expect((byUnit.image_output_tokens.provider_metadata as any).usage_category).toBe('image_output')
    for (const row of ledger()) {
      expect(row).toMatchObject({
        user_id: USER, provider: 'gemini', transport: 'rest', operation: 'image_generation', resource_type: 'image_generation_attempt',
        resource_id: attemptId, model: 'gemini-nano-banana-2.1', provider_task_id: 'resp-abc',
      })
      expect(row.provider_metadata).toMatchObject({
        funding: 'user_byok', credential_source: 'user', provider_response: 'received',
        image_generation: { attempt_id: attemptId, model_alias: 'gemini-nb-2.1', provider_model: 'gemini-nano-banana-2.1', model_version: 'nano-banana-2.1-001', image_size: '1K', aspect_ratio: '1:1' },
        usage: { serviceTier: 'standard', totalTokenCount: 1304 },
      })
    }
    expect(metadataOf().usage_accounting).toMatchObject({ ledger: 'recorded', rows: 2, usage: 'reported' })
    expect(metadataOf().provider_response).toMatchObject({ state: 'received', provider_model: 'gemini-nano-banana-2.1', model_alias: 'gemini-nb-2.1', response_id: 'resp-abc' })
    expect(attempts()[0].status).toBe('succeeded')
  })

  it('Nano Banana 2 Lite: attributed to the official Lite id', async () => {
    await post(body({ model: 'gemini-nb-lite' }))
    expect(new Set(ledger().map((row) => row.model))).toEqual(new Set(['gemini-3.1-flash-lite-image']))
    expect((ledger()[0].provider_metadata as any).image_generation).toMatchObject({ model_alias: 'gemini-nb-lite', provider_model: 'gemini-3.1-flash-lite-image' })
  })

  it('mixed modality report: TEXT output, IMAGE output and thinking are separate rows', async () => {
    fetchSpy.mockImplementation(async () => ok({ promptTokenCount: 20, candidatesTokenCount: 1330, thoughtsTokenCount: 215, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1290 }] }))
    await post(body())
    const rows = Object.fromEntries(ledger().map((row) => [String(row.idempotency_key).split(':')[2], row]))
    expect(Object.keys(rows).sort()).toEqual(['image_output_tokens', 'input_tokens', 'text_output_tokens', 'thoughts_tokens'])
    expect(rows.text_output_tokens).toMatchObject({ quantity: 40, unit: 'output_tokens' })
    expect(rows.image_output_tokens).toMatchObject({ quantity: 1290, unit: 'tokens' })
    expect(rows.thoughts_tokens).toMatchObject({ quantity: 215, unit: 'tokens' })
  })

  it('service tier absent: nothing is inferred', async () => {
    fetchSpy.mockImplementation(async () => ok({ promptTokenCount: 14, candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] }))
    await post(body())
    expect((ledger()[0].provider_metadata as any).usage.serviceTier).toBeUndefined()
    expect(JSON.stringify(ledger())).not.toMatch(/"standard"|"flex"|"priority"/)
  })

  it('usageMetadata missing: ONE unknown event (null quantity, source unknown), the image still succeeds — usage is not zero', async () => {
    fetchSpy.mockImplementation(async () => ok(NO_USAGE))
    const response = await post(body())
    expect(response.status).toBe(200)
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown', operation: 'image_generation' })
    expect(String(ledger()[0].idempotency_key)).toMatch(/:unknown$/)
    expect(metadataOf().usage_accounting).toMatchObject({ ledger: 'recorded', rows: 1, usage: 'unknown' })
  })

  it('partial usage metadata: only what was reported, no invented output, no zero', async () => {
    fetchSpy.mockImplementation(async () => ok({ promptTokenCount: 14 }))
    await post(body())
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ quantity: 14, unit: 'input_tokens' })
    expect(ledger().some((row) => row.quantity === 0)).toBe(false)
    expect(metadataOf().usage_accounting.usage).toBe('partial')
  })

  it('output without a modality breakdown is recorded as unattributed (not image, not plain output_tokens)', async () => {
    fetchSpy.mockImplementation(async () => ok({ promptTokenCount: 14, candidatesTokenCount: 1290 }))
    await post(body())
    expect(ledger().map((row) => [row.unit, (row.provider_metadata as any).usage_category ?? null]).sort()).toEqual([['input_tokens', null], ['tokens', 'output_unattributed']])
    expect(metadataOf().usage_accounting.output_attribution).toBe('unattributed')
  })

  it('cost stays UNKNOWN: no row is priced, none is zero, and the response carries no cost or usage field', async () => {
    const response = await post(body())
    for (const row of ledger()) {
      const cost = deriveProviderUsageCost(costInputFromRow({ ...row, occurred_at: new Date().toISOString() }), [])
      expect(cost.status).toBe('unavailable')
      expect(cost).not.toHaveProperty('amount')
    }
    expect(JSON.stringify(await response.json())).not.toMatch(/cost|usd|price|tokens|usage|"amount"/i)
    expect(ledger().every((row) => row.quantity === null || (row.quantity as number) > 0 || row.unit === 'input_tokens')).toBe(true)
  })
})

describe('idempotency: one canonical Attempt = one set of usage rows', () => {
  it('a replayed request id never reaches Google again and never adds rows', async () => {
    await post(body())
    const before = JSON.stringify(ledger())
    const replay = await post(body())
    expect((await replay.json()).replayed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(ledger())).toBe(before)
    expect(ledger()).toHaveLength(2)
  })

  it('two simultaneous identical requests: one provider call and one set of rows', async () => {
    await Promise.all([post(body()), post(body())])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
    expect(ledger()).toHaveLength(2)
    expect(new Set(ledger().map((row) => row.idempotency_key)).size).toBe(2)
  })

  it('a new request id is a new Attempt with its own rows (distinct keys, no collision)', async () => {
    await post(body())
    await post(body({ clientRequestId: REQ_2 }))
    expect(attempts()).toHaveLength(2)
    expect(ledger()).toHaveLength(4)
    expect(new Set(ledger().map((row) => row.resource_id)).size).toBe(2)
    expect(new Set(ledger().map((row) => row.idempotency_key)).size).toBe(4)
  })

  it('re-recording the same Attempt is a database-level no-op (ON CONFLICT DO NOTHING on the idempotency key)', async () => {
    await post(body())
    const { accountGeminiImageUsage } = await import('@/lib/usage/gemini-image-usage')
    const { extractGeminiUsage } = await import('@/lib/providers/gemini/usage')
    const accounting = await accountGeminiImageUsage({
      userId: USER, attemptId: attempts()[0].id as string, projectId: null, productionId: null, modelAlias: 'gemini-nb-2.1', providerModel: 'gemini-nano-banana-2.1',
      aspectRatio: '1:1', imageSize: '1K', funding: 'user_byok', credentialSource: 'user', providerResponse: 'received',
    }, extractGeminiUsage(USAGE_IMAGE))
    expect(accounting.ledger).toBe('recorded')
    expect(ledger()).toHaveLength(2)
  })
})

describe('failure accounting', () => {
  it('storage failure AFTER the provider response: the usage is already in the ledger, the Attempt is failed with outcome_unknown', async () => {
    mocks.upload.mockRejectedValue(new Error('S3 down'))
    const response = await post(body())
    expect(response.status).toBe(503)
    expect(ledger()).toHaveLength(2)
    expect(attempts()[0]).toMatchObject({ status: 'failed' })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(true)
    expect(metadataOf().usage_accounting.ledger).toBe('recorded')
    expect(images()).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('storage not configured and image-link failure are accounted the same way', async () => {
    mocks.upload.mockResolvedValue(null)
    await post(body())
    expect(ledger()).toHaveLength(2)
    setDb(createFakeDb({ image_generation_sessions: [sessionRow()] }, (table, op) => (table === 'images' && op === 'upsert' ? { message: 'write failed' } : undefined)))
    mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/o.png', thumbnailUrl: null, storageProvider: 's3', storagePath: 'p', thumbnailPath: null, fileSize: 1, mimeType: 'image/png' })
    await post(body({ clientRequestId: REQ_2 }))
    expect(ledger()).toHaveLength(2)
    expect(attempts()[0].status).toBe('failed')
  })

  it.each([
    ['HTTP 401', () => json({ error: { message: 'API key not valid' } }, 401)],
    ['HTTP 403', () => json({ error: { message: 'denied' } }, 403)],
    ['HTTP 429', () => json({ error: { message: 'quota' } }, 429)],
    ['HTTP 400', () => json({ error: { message: 'bad request' } }, 400)],
    ['HTTP 500', () => json({ error: { message: 'boom' } }, 500)],
    ['a non-JSON 200', () => new Response('<html>', { status: 200 })],
  ])('%s: no provider response with usage => no ledger row (nothing is invented), Attempt failed', async (_name, make) => {
    fetchSpy.mockImplementation(async () => make())
    await post(body())
    expect(ledger()).toHaveLength(0)
    expect(attempts()[0].status).toBe('failed')
    expect(attempts()[0].result_metadata).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('network failure and timeout: provider work is uncertain — no ledger row, the Attempt keeps outcome_unknown', async () => {
    fetchSpy.mockImplementation(async () => { throw new TypeError('fetch failed') })
    await post(body())
    expect(ledger()).toHaveLength(0)
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(true)
    fetchSpy.mockImplementation(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    await post(body({ clientRequestId: REQ_2 }))
    expect(ledger()).toHaveLength(0)
    expect((attempts()[1].failure_details as Row).outcome_unknown).toBe(true)
  })

  it('a blocked prompt that Google answered with usage is accounted as received_rejected; the Attempt is not outcome_unknown', async () => {
    fetchSpy.mockImplementation(async () => json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: { promptTokenCount: 9, totalTokenCount: 9 }, responseId: 'resp-blocked' }))
    const response = await post(body())
    expect(response.status).toBe(422)
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ quantity: 9, unit: 'input_tokens', provider_task_id: 'resp-blocked' })
    expect(ledger()[0].provider_metadata).toMatchObject({ provider_response: 'received_rejected', rejected_as: 'content_blocked' })
    expect(metadataOf().provider_response).toMatchObject({ state: 'received_rejected', rejected_as: 'content_blocked' })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(false)
  })

  it('a received response without usage (no image) records one unknown event, and an invalid image keeps its reported usage', async () => {
    fetchSpy.mockImplementation(async () => json({ candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'STOP' }] }))
    await post(body())
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ quantity: null, measurement_source: 'unknown' })
    expect(ledger()[0].provider_metadata).toMatchObject({ provider_response: 'received_rejected', rejected_as: 'no_image' })

    fetchSpy.mockImplementation(async () => json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '!!!!' } }] } }], usageMetadata: USAGE_IMAGE,
    }))
    await post(body({ clientRequestId: REQ_2 }))
    expect(ledger()).toHaveLength(3)
    expect(ledger().filter((row) => (row.provider_metadata as any).rejected_as === 'invalid_image').map((row) => row.quantity as number).sort((a, b) => a - b)).toEqual([14, 1290])
  })

  it('a 2xx response too large to read is a known execution with unknown usage', async () => {
    fetchSpy.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-length': String(80 * 1024 * 1024) } }))
    await post(body())
    expect(ledger()).toHaveLength(1)
    expect(ledger()[0]).toMatchObject({ quantity: null, measurement_source: 'unknown' })
  })

  it('NEVER records imaginary tokens: every ledger quantity equals a number Google sent', async () => {
    fetchSpy.mockImplementation(async () => ok({ promptTokenCount: 17, candidatesTokenCount: 1290, thoughtsTokenCount: 33, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] }))
    await post(body())
    const sent = new Set([17, 1290, 33])
    for (const row of ledger()) expect(sent.has(row.quantity as number)).toBe(true)
  })
})

describe('ledger failure is classified and documented, never silent success', () => {
  const failingLedger = () => withDb((table, op) => (table === 'provider_usage_events' && op === 'upsert' ? { message: 'ledger store detail' } : undefined))

  it('the delivered image is not undone: 200, Attempt succeeded, one retry of the LEDGER write only, provider not called again', async () => {
    failingLedger()
    const response = await post(body())
    expect(response.status).toBe(200)
    expect((await response.json()).replayed).toBe(false)
    expect(attempts()[0].status).toBe('succeeded')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(db.writes.filter((write) => write.table === 'provider_usage_events')).toHaveLength(2)
    expect(ledger()).toHaveLength(0)
  })

  it('the Attempt records ledger_failed with the numbers Google reported, so the gap is visible and reconcilable', async () => {
    failingLedger()
    await post(body())
    expect(metadataOf().usage_accounting).toMatchObject({ ledger: 'ledger_failed', rows: 2, usage: 'reported' })
    expect(metadataOf().usage_accounting.reported_usage).toMatchObject({ promptTokens: 14, candidatesTokens: 1290, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] })
  })

  it('logs the failure by class only: no provider text, prompt, key or store detail', async () => {
    failingLedger()
    const log = vi.mocked(console.error)
    await post(body())
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toMatch(/usage ledger write failed/)
    expect(logged).not.toMatch(/ledger store detail|a red fox|AIza|resp-abc/)
  })

  it('a replay after a ledger failure does not re-spend and does not pretend the gap was filled', async () => {
    failingLedger()
    await post(body())
    const replay = await post(body())
    expect((await replay.json()).replayed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(ledger()).toHaveLength(0)
    expect(metadataOf().usage_accounting.ledger).toBe('ledger_failed')
  })

  it('a failure to even mark the Attempt never breaks the request', async () => {
    setDb(createFakeDb({ image_generation_sessions: [sessionRow()] }, (table, op) => (table === 'provider_usage_events' && op === 'upsert' ? { message: 'x' } : undefined)))
    const original = db.from
    db.from = ((table: string) => {
      const builder = original(table) as any
      if (table !== 'image_generation_attempts') return builder
      const update = builder.update
      builder.update = (patch: Row) => (patch && 'result_metadata' in patch ? { eq: () => ({ eq: () => Promise.resolve({ error: { message: 'mark failed' } }) }) } : update(patch))
      return builder
    }) as typeof db.from
    const response = await post(body())
    expect(response.status).toBe(200)
    expect(attempts()[0].status).toBe('succeeded')
  })
})

describe('boundaries', () => {
  it('release switch OFF: no provider call, no ledger row, no Attempt', async () => {
    vi.unstubAllEnvs()
    const response = await post(body())
    expect(response.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ledger()).toHaveLength(0)
    expect(attempts()).toHaveLength(0)
    expect(db.writes).toEqual([])
  })

  it('validation errors, other users’ Sessions and missing credentials write no usage', async () => {
    await post(body({ model: 'gpt-image-2' }))
    withDb(undefined, { image_generation_sessions: [sessionRow({ user_id: 'user-2' })] })
    await post(body())
    withDb()
    mocks.settings.current = { gemini_api_key: null }
    await post(body())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ledger()).toHaveLength(0)
  })

  it('writes no image-generation usage for any other provider path: the ledger holds Gemini image rows only from this route', async () => {
    await post(body())
    expect(new Set(ledger().map((row) => [row.provider, row.operation, row.resource_type].join('/')))).toEqual(new Set(['gemini/image_generation/image_generation_attempt']))
  })
})
