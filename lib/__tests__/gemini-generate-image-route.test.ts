import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-064 Slice A — POST /api/gemini/generate-image against an in-memory fake database (real Attempt lifecycle code
// from lib/image-generation/execution.ts), the real credential resolver over a fake caller client, a fake S3 and a
// fake `fetch`. Dummy keys, 0 real provider calls, 0 real storage writes, no database.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  settings: { current: null as Record<string, unknown> | null, error: null as { message: string } | null },
  db: { current: null as unknown },
  upload: vi.fn(),
  presign: vi.fn(),
  settingsReads: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'user_settings') mocks.settingsReads()
            return { data: mocks.settings.current, error: mocks.settings.error }
          },
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => mocks.db.current }))
vi.mock('@/lib/storage/s3', () => ({ uploadImageToS3: mocks.upload, createPresignedReadUrl: mocks.presign }))

import { POST } from '@/app/api/gemini/generate-image/route'
import { GEMINI_IMAGE_GENERATION_FLAG } from '@/lib/providers/gemini/image-feature'
import { createFakeDb, type FakeDb, type Row } from './helpers/fake-image-db'

const USER = 'user-1'
const OTHER = 'user-2'
const SESSION = '11111111-1111-4111-8111-111111111111'
const REQ = '22222222-2222-4222-8222-222222222222'
const REQ_2 = '33333333-3333-4333-8333-333333333333'
const GEMINI_KEY = 'AIza-user-gemini-dummy'
const OPENAI_KEY = 'sk-openai-must-not-be-used'
const NANO_KEY = 'nb-third-party-must-not-be-used'
const state = { schemaVersion: 1, autoMode: false }

let png: Buffer
beforeAll(async () => { png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3366cc' } }).png().toBuffer() })

let db: FakeDb
let fetchSpy: ReturnType<typeof vi.spyOn>
const geminiOk = (bytes = png) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] },
}), { status: 200 })

const session = (overrides: Row = {}): Row => ({ id: SESSION, user_id: USER, project_id: null, production_id: null, working_prompt: 'user idea', working_state: state, current_image_id: null, revision: 1, ...overrides })
const body = (overrides: Record<string, unknown> = {}) => ({ prompt: 'a red fox', model: 'gemini-nb-2.1', sessionId: SESSION, clientRequestId: REQ, ...overrides })
const post = (payload: unknown, raw = false) =>
  POST(new Request('http://localhost/api/gemini/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (payload as string) : JSON.stringify(payload) }))
const attempts = () => db.tables.image_generation_attempts
const images = () => db.tables.images

function useDb(next: FakeDb) { db = next; mocks.db.current = next }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  mocks.settings.current = { gemini_api_key: GEMINI_KEY, openai_api_key: OPENAI_KEY, nanobanana_api_key: NANO_KEY }
  mocks.settings.error = null
  mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/original.png', thumbnailUrl: 'https://cdn.test/thumb.webp', storageProvider: 's3', storagePath: 'users/user-1/images/x/original.png', thumbnailPath: 'users/user-1/images/x/thumb.webp', fileSize: png.length, mimeType: 'image/png' })
  mocks.presign.mockResolvedValue('https://signed.test/original.png')
  useDb(createFakeDb({ image_generation_sessions: [session()] }))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => geminiOk())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const nothingHappened = () => {
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(attempts()).toHaveLength(0)
  expect(images()).toHaveLength(0)
}

describe('release safety', () => {
  it('is disabled by default: no Attempt, no credential read, no provider call', async () => {
    vi.unstubAllEnvs()
    const response = await post(body())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'GEMINI_IMAGE_GENERATION_DISABLED' })
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
    nothingHappened()
  })

  it.each(['1', 'true', 'ENABLED', 'on'])('stays disabled for the boolean-ish value %j', async (value) => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, value)
    expect((await post(body())).status).toBe(403)
    nothingHappened()
  })

  it('answers 401 to an unauthenticated caller before anything else', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await post(body())
    expect(response.status).toBe(401)
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
    nothingHappened()
  })

  it('is blocked by the FUTURE-050 execution policy in a Preview runtime even when the switch is on', async () => {
    const policy = await import('@/lib/providers/execution-policy')
    policy.__setMockedProvidersHarnessForTests(false)
    try {
      const response = await post(body())
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', provider: 'gemini' })
      nothingHappened()
    } finally {
      policy.__setMockedProvidersHarnessForTests(true)
    }
  })
})

describe('request validation (closed schema, closed model registry)', () => {
  it.each([
    ['gpt-image-2'], ['nanobanana-v1'], ['v2'], ['gemini-nano-banana-2.1'], ['gemini-3.1-flash-lite-image'], ['gemini-3-pro-image'],
    ['gemini-2.5-flash-image'], ['GEMINI-NB-2.1'], [''], ['__proto__'], [null], [42], [undefined],
  ])('rejects model %j with an explicit error, no Attempt, no provider call, no fallback', async (model) => {
    const response = await post(body({ model }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_IMAGE_MODEL' })
    nothingHappened()
  })

  it('has no default model: omitting it is a validation error, not gpt-image-2 or NanoBanana', async () => {
    const { model: _omitted, ...withoutModel } = body()
    void _omitted
    const response = await post(withoutModel)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_IMAGE_MODEL' })
    nothingHappened()
  })

  it.each([
    [{ image: 'data:image/png;base64,AAAA' }], [{ images: ['x'] }], [{ imageUrl: 'https://x.test/a.png' }], [{ image_url: 'x' }],
    [{ sourceImage: 'x' }], [{ sourceImages: [] }], [{ sourceReferences: [{ type: 'image', id: 'x' }] }], [{ referenceImages: ['x'] }],
    [{ references: [] }], [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }], [{ fileData: {} }], [{ mask: 'x' }],
    [{ files: [] }], [{ attachments: [] }], [{ inputImage: 'x' }], [{ video: 'x' }],
  ])('explicitly rejects image-to-image input %j', async (extra) => {
    const response = await post(body(extra))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'SOURCE_NOT_SUPPORTED' })
    nothingHappened()
  })

  it.each([[{ size: '2K' }], [{ imageSize: '4K' }], [{ quality: 'high' }], [{ n: 4 }], [{ provider: 'openai' }], [{ apiKey: 'x' }], [{ temperature: 1 }]])(
    'rejects the unsupported field %j (size is fixed at 1K server-side, provider is fixed)', async (extra) => {
      const response = await post(body(extra))
      expect(response.status).toBe(400)
      expect(['UNSUPPORTED_FIELD', 'SOURCE_NOT_SUPPORTED']).toContain((await response.json()).code)
      nothingHappened()
    })

  it.each([
    ['prompt missing', { prompt: undefined }, 'PROMPT_REQUIRED'], ['prompt blank', { prompt: '   ' }, 'PROMPT_REQUIRED'], ['prompt not a string', { prompt: 7 }, 'PROMPT_REQUIRED'],
    ['prompt too long', { prompt: 'x'.repeat(20_001) }, 'PROMPT_TOO_LONG'], ['bad aspect ratio', { aspectRatio: '7:3' }, 'INVALID_ASPECT_RATIO'],
    ['aspect ratio not a string', { aspectRatio: 1 }, 'INVALID_ASPECT_RATIO'], ['no session', { sessionId: undefined }, 'SESSION_REQUEST_ID_REQUIRED'],
    ['no clientRequestId', { clientRequestId: undefined }, 'SESSION_REQUEST_ID_REQUIRED'],
  ])('%s -> %s', async (_name, extra, code) => {
    const response = await post(body(extra))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code })
    nothingHappened()
  })

  it('rejects non-UUID ids and malformed bodies without touching the database or the provider', async () => {
    expect(await (await post(body({ sessionId: 'not-a-uuid' }))).json()).toMatchObject({ code: 'SESSION_REQUEST_ID_REQUIRED' })
    expect(await (await post(body({ clientRequestId: 'nope' }))).json()).toMatchObject({ code: 'SESSION_REQUEST_ID_REQUIRED' })
    expect((await post('{not json', true)).status).toBe(400)
    expect((await post('[]', true)).status).toBe(400)
    expect((await post('null', true)).status).toBe(400)
    expect((await post(JSON.stringify({ prompt: 'x'.repeat(70_000) }), true)).status).toBe(413)
    nothingHappened()
  })
})

describe('ownership', () => {
  it('rejects a Session that belongs to another user: no credential read, no Attempt, no provider call', async () => {
    useDb(createFakeDb({ image_generation_sessions: [session({ user_id: OTHER })] }))
    const response = await post(body())
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'SESSION_NOT_FOUND' })
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    nothingHappened()
  })

  it('rejects a Session whose Project is not owned by the caller', async () => {
    useDb(createFakeDb({ image_generation_sessions: [session({ project_id: 'p-1' })], projects: [{ id: 'p-1', user_id: OTHER }] }))
    const response = await post(body())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    nothingHappened()
  })

  it('rejects a Session whose Production is not owned by the caller', async () => {
    useDb(createFakeDb({ image_generation_sessions: [session({ project_id: 'p-1', production_id: 'pr-1' })], projects: [{ id: 'p-1', user_id: USER }], productions: [{ id: 'pr-1', project_id: 'p-1', user_id: OTHER }] }))
    const response = await post(body())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PRODUCTION_NOT_FOUND' })
    nothingHappened()
  })

  it('rejects a Session that already carries image references (no image-to-image through session state)', async () => {
    useDb(createFakeDb({ image_generation_sessions: [session({ working_state: { ...state, sourceReferences: [{ type: 'image', id: '44444444-4444-4444-8444-444444444444' }] } })] }))
    const response = await post(body())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'SOURCE_NOT_SUPPORTED' })
    nothingHappened()
  })
})

describe('credential resolution (existing Gemini BYOK resolver)', () => {
  it('uses the caller Gemini key and never the OpenAI or third-party NanoBanana key', async () => {
    const response = await post(body())
    expect(response.status).toBe(200)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(GEMINI_KEY)
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(OPENAI_KEY)
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(NANO_KEY)
    expect(JSON.stringify(await response.clone().json())).not.toMatch(/AIza|sk-openai|nb-third/)
  })

  it('reports a missing Gemini key as PROVIDER_NOT_CONFIGURED (400), closes the Attempt, makes no provider call', async () => {
    mocks.settings.current = { gemini_api_key: null, openai_api_key: OPENAI_KEY, nanobanana_api_key: NANO_KEY }
    const response = await post(body())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]).toMatchObject({ status: 'failed', provider: 'gemini' })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(false)
    expect(images()).toHaveLength(0)
  })

  it('does not substitute another provider key when the Gemini key is empty', async () => {
    mocks.settings.current = { gemini_api_key: '', openai_api_key: OPENAI_KEY, nanobanana_api_key: NANO_KEY }
    expect((await post(body())).status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports an unreadable credential store as a retryable 503, distinct from "not configured"', async () => {
    mocks.settings.current = null
    mocks.settings.error = { message: 'connection reset' }
    const response = await post(body())
    const payload = await response.json()
    expect(response.status).toBe(503)
    expect(JSON.stringify(payload)).toMatch(/PROVIDER_CREDENTIAL_UNAVAILABLE/)
    expect(JSON.stringify(payload)).not.toMatch(/NOT_CONFIGURED|não configurad/i)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(attempts()[0]).toMatchObject({ status: 'failed' })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(false)
  })
})

describe('successful generation', () => {
  it.each([['gemini-nb-2.1', 'gemini-nano-banana-2.1'], ['gemini-nb-lite', 'gemini-3.1-flash-lite-image']])('persists one image and Attempt for %s using the official endpoint', async (model, providerModel) => {
    const response = await post(body({ model, aspectRatio: '16:9' }))
    const payload = await response.json()
    expect(response.status).toBe(200)

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${providerModel}:generateContent`)
    expect(JSON.parse(init.body as string).generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '1K' } })

    expect(mocks.upload).toHaveBeenCalledTimes(1)
    const upload = mocks.upload.mock.calls[0][0]
    expect(upload).toMatchObject({ userId: USER, folder: 'images', mimeType: 'image/png' })
    expect((upload.buffer as Buffer).equals(png)).toBe(true)

    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]).toMatchObject({
      status: 'succeeded', provider: 'gemini', model, session_id: SESSION, user_id: USER, client_request_id: REQ,
      submitted_config: { aspectRatio: '16:9', imageSize: '1K', providerModel },
    })
    expect(images()).toHaveLength(1)
    expect(images()[0]).toMatchObject({ id: attempts()[0].id, user_id: USER, model, storage_path: 'users/user-1/images/x/original.png', mime_type: 'image/png' })
    expect(attempts()[0].result_image_id).toBe(images()[0].id)
    expect(db.tables.image_generation_sessions[0].current_image_id).toBe(images()[0].id)

    expect(payload).toMatchObject({
      provider: 'gemini', model, providerModel, attemptId: attempts()[0].id,
      sessionId: SESSION, replayed: false, imageUrl: 'https://signed.test/original.png', mimeType: 'image/png',
    })
  })

  it('records reported Lite usage before storing its one image', async () => {
    const response = await post(body({ model: 'gemini-nb-lite' }))
    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
    expect(db.tables.provider_usage_events.map((row) => row.quantity)).toEqual([5, 1290])
  })

  it('defaults the aspect ratio to 1:1 and never invents cost or usage fields', async () => {
    const payload = await (await post(body())).json()
    expect(JSON.parse(((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body) as string).generationConfig.imageConfig.aspectRatio).toBe('1:1')
    expect(JSON.stringify(payload)).not.toMatch(/cost|usd|price|tokens|usage/i)
  })

  it('falls back to the stored URL when presigning fails and never breaks the success', async () => {
    mocks.presign.mockRejectedValue(new Error('sign failed'))
    const payload = await (await post(body())).json()
    expect(payload.imageUrl).toBe('https://cdn.test/original.png')
  })
})

describe('idempotency and one canonical Attempt per request', () => {
  it('replays a completed request without a second provider call, upload or Attempt', async () => {
    const first = await (await post(body())).json()
    const second = await (await post(body())).json()
    expect(first.replayed).toBe(false)
    expect(second).toMatchObject({ replayed: true, status: 'succeeded', attemptId: first.attemptId })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
    expect(images()).toHaveLength(1)
  })

  it('collapses two simultaneous identical submissions into one provider call and one Attempt', async () => {
    const [a, b] = await Promise.all([post(body()), post(body())])
    const results = [await a.json(), await b.json()]
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
    expect(results.filter((r) => r.replayed === false)).toHaveLength(1)
    expect(results.filter((r) => r.replayed === true)).toHaveLength(1)
    expect(results.every((r) => r.attemptId === attempts()[0].id)).toBe(true)
  })

  it('answers 409 IDEMPOTENCY_CONFLICT when a request id is reused with different parameters', async () => {
    await post(body())
    for (const changed of [{ prompt: 'a blue fox' }, { aspectRatio: '9:16' }]) {
      const response = await post(body(changed))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
  })

  it('a Lite request reusing a succeeded 2.1 request id is blocked without replaying or executing another model', async () => {
    await post(body())
    const response = await post(body({ model: 'gemini-nb-lite' }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
    expect(images()).toHaveLength(1)
  })

  it('creates a new Attempt with a new clientRequestId and increments the sequence', async () => {
    await post(body())
    await post(body({ clientRequestId: REQ_2 }))
    expect(attempts().map((a) => a.sequence)).toEqual([1, 2])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not call the provider again when the same request id is replayed after a failure', async () => {
    fetchSpy.mockImplementation(async () => new Response('{}', { status: 500 }))
    expect((await post(body())).status).toBe(502)
    const replay = await post(body())
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true, status: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(attempts()).toHaveLength(1)
  })
})

describe('provider failures (before persistence): one call, Attempt closed, nothing stored', () => {
  it.each([
    [400, 502, 'PROVIDER_ERROR', false], [401, 400, 'PROVIDER_CREDENTIAL_REJECTED', false], [403, 400, 'PROVIDER_CREDENTIAL_REJECTED', false],
    [404, 502, 'PROVIDER_MODEL_UNAVAILABLE', false], [429, 429, 'PROVIDER_RATE_LIMITED', false], [500, 502, 'PROVIDER_UNAVAILABLE', true], [503, 502, 'PROVIDER_UNAVAILABLE', true],
  ])('Gemini HTTP %i -> %i %s (outcome_unknown=%s)', async (upstream, status, code, unknown) => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'raw provider detail AIza-leak' } }), { status: upstream }))
    const response = await post(body())
    const payload = await response.json()
    expect(response.status).toBe(status)
    expect(payload.code).toBe(code)
    expect(JSON.stringify(payload)).not.toMatch(/raw provider detail|AIza/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(images()).toHaveLength(0)
    expect(attempts()).toHaveLength(1)
    expect(attempts()[0]).toMatchObject({ status: 'failed', result_image_id: null })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(unknown)
    expect(JSON.stringify(attempts()[0].failure_details)).not.toMatch(/raw provider detail|AIza|a red fox/)
  })

  it('maps a network failure to 502 with outcome unknown and never retries', async () => {
    fetchSpy.mockImplementation(async () => { throw new TypeError('fetch failed') })
    const response = await post(body())
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('PROVIDER_UNAVAILABLE')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(true)
  })

  it('maps a timeout to 504', async () => {
    fetchSpy.mockImplementation(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    const response = await post(body())
    expect(response.status).toBe(504)
    expect((await response.json()).code).toBe('PROVIDER_TIMEOUT')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('maps a safety block to 422', async () => {
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), { status: 200 }))
    const response = await post(body())
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('PROVIDER_CONTENT_BLOCKED')
    expect(attempts()[0]).toMatchObject({ status: 'failed' })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(false)
  })

  it.each([
    ['unreadable JSON', () => new Response('<html>', { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
    ['a non-object body', () => new Response('[]', { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
    ['no candidates', () => new Response('{}', { status: 200 }), 'EMPTY_PROVIDER_RESULT'],
    ['text only', () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }), { status: 200 }), 'EMPTY_PROVIDER_RESULT'],
    ['invalid base64', () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '!!!!' } }] } }] }), { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
    ['a type/bytes mismatch', () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: png.toString('base64') } }] } }] }), { status: 200 }), 'INVALID_PROVIDER_RESPONSE'],
    ['an oversized declared body', () => new Response('{}', { status: 200, headers: { 'content-length': String(80 * 1024 * 1024) } }), 'INVALID_PROVIDER_RESPONSE'],
  ])('rejects %s without storing anything and closes the Attempt', async (_name, make, code) => {
    fetchSpy.mockImplementation(async () => make())
    const response = await post(body())
    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe(code)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(images()).toHaveLength(0)
    expect(attempts()[0]).toMatchObject({ status: 'failed', result_image_id: null })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('failures after the provider answered (a paid image we could not keep)', () => {
  it('closes the Attempt as outcome_unknown when storage throws', async () => {
    mocks.upload.mockRejectedValue(new Error('S3 down'))
    const response = await post(body())
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('STORAGE_UNAVAILABLE')
    expect(attempts()[0]).toMatchObject({ status: 'failed', result_image_id: null })
    expect((attempts()[0].failure_details as Row).outcome_unknown).toBe(true)
    expect(images()).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not fall back to a data URL when storage is not configured', async () => {
    mocks.upload.mockResolvedValue(null)
    const response = await post(body())
    expect(response.status).toBe(503)
    expect(images()).toHaveLength(0)
    expect(attempts()[0]).toMatchObject({ status: 'failed' })
    expect(JSON.stringify(images())).not.toContain('data:image')
  })

  it('closes the Attempt when the image row cannot be saved', async () => {
    useDb(createFakeDb({ image_generation_sessions: [session()] }, (table, op) => (table === 'images' && op === 'upsert' ? { message: 'write failed' } : undefined)))
    const response = await post(body())
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('OUTPUT_SAVE_FAILED')
    expect(attempts()[0]).toMatchObject({ status: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('never retries the paid call to recover from a storage failure, and a replay does not re-spend', async () => {
    mocks.upload.mockRejectedValue(new Error('S3 down'))
    await post(body())
    mocks.upload.mockResolvedValue(null)
    const replay = await post(body())
    expect(await replay.json()).toMatchObject({ replayed: true, status: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('zero real provider calls', () => {
  it('only ever reaches the faked Gemini endpoint, never OpenAI or the third-party NanoBanana host', async () => {
    await post(body())
    await post(body({ clientRequestId: REQ_2, model: 'gemini-nb-lite' }))
    const hosts = fetchSpy.mock.calls.map(([input]: unknown[]) => new URL(String(input)).hostname)
    expect(new Set(hosts)).toEqual(new Set(['generativelanguage.googleapis.com']))
  })

  it('the shared harness refuses a real provider host when no fake is installed', async () => {
    vi.restoreAllMocks()
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).rejects.toThrow(/real provider call/)
  })
})
