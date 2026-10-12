import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-064 global authenticated BYOK release. Mocked end to end: fake database running
// the real Attempt/ledger code, fake Google (global fetch), fake S3, fake auth. 0 real provider calls, 0 images, 0 storage writes.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  settings: { current: null as Record<string, unknown> | null },
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
            return { data: mocks.settings.current, error: null }
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

const OWNER = '35428fd4-4784-4934-9af9-82a606aad77e'
const OTHER = '11111111-aaaa-4aaa-8aaa-111111111111'
const SESSION = '11111111-1111-4111-8111-111111111111'
const REQ = '5c5a3f1e-2b7d-4c1a-9e3b-0a1b2c3d4e5f'
const MODELS = ['gemini-nb-2.1', 'gemini-nb-lite'] as const

describe('global release: all authenticated users, own Sessions, Gemini BYOK', () => {
  let png: Buffer
  let db: FakeDb
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeAll(async () => { png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3a7d44' } }).png().toBuffer() })

  const googleOk = () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 1120, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] },
    responseId: 'resp-canary',
  }), { status: 200 })
  const sessionRow = (user = OWNER): Row => ({ id: SESSION, user_id: user, project_id: null, production_id: null, working_prompt: 'canary', working_state: { schemaVersion: 1, autoMode: false }, current_image_id: null, revision: 1 })
  const body = (overrides: Record<string, unknown> = {}) => ({ prompt: 'A small young tree growing in a peaceful green garden', model: 'gemini-nb-2.1', aspectRatio: '1:1', sessionId: SESSION, clientRequestId: REQ, ...overrides })
  const post = (payload: unknown) => POST(new Request('http://localhost/api/gemini/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))
  const setDb = (next: FakeDb) => { db = next; mocks.db.current = next }
  const asUser = (id: string) => mocks.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
  const untouched = () => {
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
    expect(db.tables.image_generation_attempts).toHaveLength(0)
    expect(db.tables.provider_usage_events).toHaveLength(0)
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
    asUser(OWNER)
    mocks.settings.current = { gemini_api_key: 'AIza-owner-dummy' }
    mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/o.png', thumbnailUrl: 'https://cdn.test/t.webp', storageProvider: 's3', storagePath: 'users/owner/images/x/original.png', thumbnailPath: 'p', fileSize: png.length, mimeType: 'image/png' })
    mocks.presign.mockResolvedValue('https://signed.test/o.png')
    setDb(createFakeDb({ image_generation_sessions: [sessionRow()] }))
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => googleOk())
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })


  it.each(MODELS)('allows a non-owner authenticated user to generate %s and replay without another charge', async (model) => {
    asUser(OTHER)
    setDb(createFakeDb({ image_generation_sessions: [sessionRow(OTHER)] }))
    const payload = body({ model, aspectRatio: '16:9' })
    expect((await post(payload)).status).toBe(200)
    expect(await (await post(payload)).json()).toMatchObject({ replayed: true, status: 'succeeded' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.images).toHaveLength(1)
    expect(db.tables.provider_usage_events.map((row) => row.quantity).sort((a, b) => Number(a) - Number(b))).toEqual([30, 1120])
  })

  it.each(MODELS)('refuses %s without BYOK before any provider call or ledger row', async (model) => {
    mocks.settings.current = { gemini_api_key: null }
    const response = await post(body({ model }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(db.tables.provider_usage_events).toHaveLength(0)
  })

  it.each(MODELS)('rejects an authenticated caller using another user Session for %s', async (model) => {
    asUser(OTHER)
    expect((await post(body({ model }))).status).toBe(404)
    untouched()
  })

  it.each([undefined, '', 'true', '1', 'ENABLED'])('keeps the default OFF for %j even when an obsolete canary grant is present', async (value) => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, value)
    vi.stubEnv('CONTENT_STUDIO_GEMINI_IMAGE_CANARY', `v1|${OWNER}|${REQ}|gemini-nb-2.1|${new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z')}`)
    for (const model of MODELS) {
      const response = await post(body({ model }))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'GEMINI_IMAGE_GENERATION_DISABLED' })
    }
    untouched()
  })

  it('refuses unauthenticated callers before credential, claim or Google', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await post(body())).status).toBe(401)
    untouched()
  })

  it.each(MODELS)('keeps Preview blocked even with the release ON for %s', async (model) => {
    const policy = await import('@/lib/providers/execution-policy')
    policy.__setMockedProvidersHarnessForTests(false)
    try {
      const response = await post(body({ model }))
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT' })
      untouched()
    } finally { policy.__setMockedProvidersHarnessForTests(true) }
  })

  it('rollback blocks even an existing successful Attempt replay before further access', async () => {
    await post(body())
    fetchSpy.mockClear()
    mocks.settingsReads.mockClear()
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, '')
    expect((await post(body())).status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mocks.settingsReads).not.toHaveBeenCalled()
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.images).toHaveLength(1)
  })
})
