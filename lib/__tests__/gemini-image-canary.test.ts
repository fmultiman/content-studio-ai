import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-064 release-gate canary — the restricted, self-expiring owner-only authorization. Mocked end to end: fake database running
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
import {
  GEMINI_IMAGE_CANARY_ENV,
  GEMINI_IMAGE_GENERATION_FLAG,
  describeGeminiImageAvailability,
  geminiImageCanaryAllows,
  parseGeminiImageCanary,
} from '@/lib/providers/gemini/image-feature'
import { createFakeDb, type FakeDb, type Row } from './helpers/fake-image-db'

const OWNER = '35428fd4-4784-4934-9af9-82a606aad77e'
const OTHER = '11111111-aaaa-4aaa-8aaa-111111111111'
const SESSION = '11111111-1111-4111-8111-111111111111'
const CANARY_REQ = '5c5a3f1e-2b7d-4c1a-9e3b-0a1b2c3d4e5f'
const OTHER_REQ = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-12T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const grant = (overrides: Partial<Record<'user' | 'req' | 'model' | 'expires' | 'version', string>> = {}) =>
  [overrides.version ?? 'v1', overrides.user ?? OWNER, overrides.req ?? CANARY_REQ, overrides.model ?? 'gemini-nb-2.1', overrides.expires ?? iso(NOW + 2 * 60 * 60 * 1000)].join('|')

describe('parseGeminiImageCanary — strict, inactive unless exactly right', () => {
  const parse = (value: string | undefined, now = NOW) => parseGeminiImageCanary({ [GEMINI_IMAGE_CANARY_ENV]: value }, now)

  it('accepts one well-formed, unexpired grant within 24 hours', () => {
    expect(parse(grant())).toEqual({ userId: OWNER, clientRequestId: CANARY_REQ, model: 'gemini-nb-2.1', expiresAtMs: NOW + 2 * 3600_000 })
    expect(parse(grant({ expires: iso(NOW + 24 * 3600_000) }))).not.toBeNull() // exactly 24 h is the ceiling
  })

  it.each([
    ['absent', undefined], ['empty', ''], ['whitespace', '   '], ['"true"', 'true'], ['"enabled"', 'enabled'], ['wrong version', grant({ version: 'v2' })],
    ['uppercase user uuid', grant({ user: OWNER.toUpperCase() })], ['non-uuid user', grant({ user: 'flavio' })], ['non-uuid request', grant({ req: 'abc' })],
    ['the lite alias', grant({ model: 'gemini-nb-lite' })], ['the official model id', grant({ model: 'gemini-nano-banana-2.1' })], ['a padded alias', grant({ model: 'gemini-nb-2.1 ' })],
    ['expiry with milliseconds', grant({ expires: '2026-10-12T14:00:00.000Z' })], ['expiry with an offset', grant({ expires: '2026-10-12T14:00:00+00:00' })],
    ['expiry without Z', grant({ expires: '2026-10-12T14:00:00' })], ['expiry that is not a date', grant({ expires: '2026-13-45T99:99:99Z' })],
    ['an expired grant', grant({ expires: iso(NOW - 1000) })], ['a grant expiring right now', grant({ expires: iso(NOW) })],
    ['a grant more than 24 h ahead', grant({ expires: iso(NOW + 24 * 3600_000 + 1000) })], ['a far-future grant', grant({ expires: '2099-01-01T00:00:00Z' })],
    ['four parts', `${OWNER}|${CANARY_REQ}|gemini-nb-2.1|${iso(NOW + 3600_000)}`], ['six parts', `${grant()}|extra`], ['a wildcard user', grant({ user: '*' })],
    ['an overlong value', `${grant()}${'x'.repeat(200)}`], ['newline injection', `${grant()}\n${grant({ user: OTHER })}`],
  ])('is INACTIVE for %s', (_name, value) => {
    expect(parse(value as string | undefined)).toBeNull()
  })

  it('geminiImageCanaryAllows requires every field to match and re-checks the expiry', () => {
    const canary = parse(grant())!
    const ok = { userId: OWNER, clientRequestId: CANARY_REQ, model: 'gemini-nb-2.1', aspectRatio: '1:1' }
    expect(geminiImageCanaryAllows(canary, ok, NOW)).toBe(true)
    expect(geminiImageCanaryAllows(canary, { ...ok, userId: OTHER }, NOW)).toBe(false)
    expect(geminiImageCanaryAllows(canary, { ...ok, clientRequestId: OTHER_REQ }, NOW)).toBe(false)
    expect(geminiImageCanaryAllows(canary, { ...ok, model: 'gemini-nb-lite' }, NOW)).toBe(false)
    expect(geminiImageCanaryAllows(canary, { ...ok, aspectRatio: '16:9' }, NOW)).toBe(false)
    expect(geminiImageCanaryAllows(canary, ok, canary.expiresAtMs)).toBe(false)
    expect(geminiImageCanaryAllows(canary, ok, canary.expiresAtMs + 1)).toBe(false)
  })

  it('never turns the global switch on and never changes the browser-visible availability (the UI stays disabled)', () => {
    const env = { [GEMINI_IMAGE_CANARY_ENV]: grant(), VERCEL_URL: 'app.vercel.app', VERCEL_ENV: 'production' }
    expect(describeGeminiImageAvailability(env)).toEqual({ available: false, reason: 'release_switch_off' })
  })
})

describe('POST /api/gemini/generate-image with the global switch OFF and a canary configured', () => {
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
  const body = (overrides: Record<string, unknown> = {}) => ({ prompt: 'A small young tree growing in a peaceful green garden', model: 'gemini-nb-2.1', aspectRatio: '1:1', sessionId: SESSION, clientRequestId: CANARY_REQ, ...overrides })
  const post = (payload: unknown) => POST(new Request('http://localhost/api/gemini/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))
  const setDb = (next: FakeDb) => { db = next; mocks.db.current = next }
  const configure = (value: string | undefined) => (value === undefined ? vi.unstubAllEnvs() : vi.stubEnv(GEMINI_IMAGE_CANARY_ENV, value))
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
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.unstubAllEnvs()
    asUser(OWNER)
    mocks.settings.current = { gemini_api_key: 'AIza-owner-dummy' }
    mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/o.png', thumbnailUrl: 'https://cdn.test/t.webp', storageProvider: 's3', storagePath: 'users/owner/images/x/original.png', thumbnailPath: 'p', fileSize: png.length, mimeType: 'image/png' })
    mocks.presign.mockResolvedValue('https://signed.test/o.png')
    setDb(createFakeDb({ image_generation_sessions: [sessionRow()] }))
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => googleOk())
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('with NO canary configured the route is exactly as disabled as before (403, nothing touched), even for the owner', async () => {
    const response = await post(body())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'GEMINI_IMAGE_GENERATION_DISABLED' })
    untouched()
  })

  it('the owner with the exact grant: ONE Google call for gemini-nano-banana-2.1 at 1K/1:1, one canonical Attempt, one image, usage recorded', async () => {
    configure(grant())
    const response = await post(body())
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ provider: 'gemini', model: 'gemini-nb-2.1', providerModel: 'gemini-nano-banana-2.1', replayed: false })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
    expect(JSON.parse(init.body as string).generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } })
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.image_generation_attempts[0]).toMatchObject({ status: 'succeeded', client_request_id: CANARY_REQ, user_id: OWNER, model: 'gemini-nb-2.1' })
    expect(db.tables.images).toHaveLength(1)
    expect(db.tables.provider_usage_events.map((row) => row.quantity).sort((a, b) => (a as number) - (b as number))).toEqual([30, 1120])
  })

  it('a replay of the fixed request id NEVER reaches Google again', async () => {
    configure(grant())
    await post(body())
    const replay = await post(body())
    expect((await replay.json()).replayed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    // two simultaneous replays also add nothing
    await Promise.all([post(body()), post(body())])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a failed first execution is also never retried by the same id (no second billable call)', async () => {
    configure(grant())
    fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: 500 }))
    expect((await post(body())).status).toBe(502)
    const again = await post(body())
    expect(await again.json()).toMatchObject({ replayed: true, status: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['another user (not authorized)', () => asUser(OTHER), body()],
    ['the owner with another request id', () => undefined, body({ clientRequestId: OTHER_REQ })],
    ['the owner with the Lite model', () => undefined, body({ model: 'gemini-nb-lite' })],
    ['the owner with a non-1:1 ratio', () => undefined, body({ aspectRatio: '16:9' })],
  ])('403 and NOTHING happens for %s', async (_name, arrange, payload) => {
    configure(grant())
    arrange()
    const response = await post(payload)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'GEMINI_IMAGE_GENERATION_DISABLED' })
    untouched()
  })

  it.each([
    ['an expired grant', grant({ expires: iso(NOW - 1000) })], ['a malformed grant', 'v1|nope'], ['a far-future grant', grant({ expires: '2099-01-01T00:00:00Z' })],
    ['a grant for another user', grant({ user: OTHER })], ['a grant for the Lite alias', grant({ model: 'gemini-nb-lite' })],
  ])('403 and nothing happens for %s', async (_name, value) => {
    configure(value)
    expect((await post(body())).status).toBe(403)
    untouched()
  })

  it('the grant expires on its own: valid now, refused after the expiry instant', async () => {
    configure(grant({ expires: iso(NOW + 60_000) }))
    vi.setSystemTime(NOW + 59_000)
    await post(body({ clientRequestId: CANARY_REQ }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    vi.setSystemTime(NOW + 61_000)
    setDb(createFakeDb({ image_generation_sessions: [sessionRow()] }))
    fetchSpy.mockClear()
    mocks.settingsReads.mockClear()
    mocks.upload.mockClear()
    const response = await post(body())
    expect(response.status).toBe(403)
    untouched()
  })

  it('an unknown model from the owner is a validation error (400), never a provider call or a fallback', async () => {
    configure(grant())
    const response = await post(body({ model: 'gpt-image-2' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_IMAGE_MODEL' })
    untouched()
  })

  it('an unauthenticated caller is refused before anything else', async () => {
    configure(grant())
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await post(body())).status).toBe(401)
    untouched()
  })

  it('the owner can probe that the canary is active WITHOUT spending: an invalid body is a 400 from validation, with no Attempt and no provider call', async () => {
    configure(grant())
    const response = await post(body({ prompt: '' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'PROMPT_REQUIRED' })
    untouched()
  })

  it('the FUTURE-050 execution policy still applies inside the canary (a Preview-like runtime is blocked)', async () => {
    configure(grant())
    const policy = await import('@/lib/providers/execution-policy')
    policy.__setMockedProvidersHarnessForTests(false)
    try {
      const response = await post(body())
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT' })
      untouched()
    } finally {
      policy.__setMockedProvidersHarnessForTests(true)
    }
  })

  it('with the GLOBAL switch ON the canary is ignored for the released 2.1 model, no grant needed', async () => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
    asUser(OTHER)
    setDb(createFakeDb({ image_generation_sessions: [sessionRow(OTHER)] }))
    mocks.settings.current = { gemini_api_key: 'AIza-other-dummy' }
    const response = await post(body({ clientRequestId: OTHER_REQ, model: 'gemini-nb-2.1', aspectRatio: '16:9' }))
    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('the canary stays out of everything else (static)', () => {
  const ROOT = process.cwd()
  const posix = (path: string) => path.split(String.fromCharCode(92)).join('/')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'docs', 'coverage'].includes(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
    }
    return out
  }
  const sources = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'components'))]
    .map((file) => ({ path: posix(file.slice(ROOT.length + 1)), text: readFileSync(file, 'utf8') }))
    .filter((file) => !/\.test\.tsx?$/.test(file.path) && !file.path.includes('/__tests__/'))

  it('only the feature module and the Gemini image route know the canary variable; no UI, settings or provider-status file does', () => {
    expect(sources.filter((file) => file.text.includes('CONTENT_STUDIO_GEMINI_IMAGE_CANARY')).map((file) => file.path)).toEqual(['lib/providers/gemini/image-feature.ts'])
    expect(sources.filter((file) => /parseGeminiImageCanary|geminiImageCanaryAllows/.test(file.text)).map((file) => file.path).sort()).toEqual(['app/api/gemini/generate-image/route.ts', 'lib/providers/gemini/image-feature.ts'])
    for (const file of sources.filter((f) => f.path.startsWith('components/') || /\/page\.tsx$/.test(f.path) || f.path.startsWith('app/api/settings/'))) {
      expect(file.text, file.path).not.toMatch(/CANARY|canary/)
    }
  })

  it('no checked-in deployment or environment file configures the canary', () => {
    for (const name of ['vercel.json', 'vercel.ts', 'next.config.mjs', 'next.config.js', '.env.example', '.env.production', '.env', '.env.local', 'package.json']) {
      let content = ''
      try { content = readFileSync(join(ROOT, name), 'utf8') } catch { /* absent */ }
      expect(content, name).not.toMatch(/CONTENT_STUDIO_GEMINI_IMAGE_CANARY/)
    }
  })

  it('the route consults the canary only after the global switch check and before any Attempt, credential or provider call', () => {
    const route = sources.find((file) => file.path === 'app/api/gemini/generate-image/route.ts')!.text.replace(/\r\n/g, '\n')
    const post = route.slice(route.indexOf('export async function POST'))
    const markers = ['isGeminiImageGenerationEnabled()', 'parseGeminiImageCanary()', 'providerExecutionBlockedResponse(', 'await parseRequest(request)', 'geminiImageCanaryAllows(', 'await runCanonicalGemini(']
    const indexes = markers.map((marker) => post.indexOf(marker))
    expect(indexes.every((index) => index > 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
  })
})
