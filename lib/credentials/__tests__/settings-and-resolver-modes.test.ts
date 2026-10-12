import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { LEAK, makeDb, type Access, type Tables } from './helpers/two-table-fake'

// FUTURE_059 Slice 3A — Settings → API routes and the provider execution resolver in each credential-store mode.
// The default (legacy) path must be indistinguishable from before; the encrypted modes must keep the same public contract:
// status-only responses, a typed 503-class failure instead of "not configured", and no secret anywhere.

const session = vi.hoisted(() => ({ client: null as unknown, userId: 'user-a' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))

const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const SECRET = 'sk-DUMMY-route-owner'
const LEGACY = 'sk-DUMMY-route-legacy'

type Store = typeof import('../api-credential-store')
let store: Store
let tables: Tables
let access: Access[]
let logs: string[]

const authUser = (id: string) => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }) } })

function setup(userId = 'user-a', failures: Parameters<typeof makeDb>[3] extends infer O ? (O extends { failures?: infer F } ? F : never) : never = []) {
  tables = {
    user_settings: [{ user_id: 'user-a', openai_api_key: LEGACY, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null, nanobanana_base_url: 'https://default.example' }],
    provider_api_credentials: [],
  }
  access = []
  const sessionDb = makeDb('caller', tables, access, { sessionUser: userId })
  session.client = Object.assign(Object.create(null), sessionDb, authUser(userId))
  store.__setPrivilegedCredentialClientForTests(makeDb('privileged', tables, access, { failures }))
}

const put = (provider: string, body: unknown) => new NextRequest(`http://localhost/api/settings/providers/${provider}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const del = (provider: string) => new NextRequest(`http://localhost/api/settings/providers/${provider}`, { method: 'DELETE' })
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) })

beforeEach(async () => {
  for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
  vi.resetModules()
  store = await import('../api-credential-store')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
})
afterEach(() => {
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('default (legacy) mode: Settings API is unchanged', () => {
  it('GET returns the same status map; the new diagnostic says legacy / key not required; no encrypted table access', async () => {
    setup()
    const { GET } = await import('@/app/api/settings/providers/route')
    const payload = await (await GET()).json()
    expect(Object.fromEntries(Object.entries(payload.providers).map(([k, v]) => [k, (v as { status: string }).status]))).toEqual({ openai: 'configured', nano_banana: 'missing', kling: 'missing', replicate: 'missing', gemini: 'missing' })
    expect(payload.credentialStorage).toEqual({ mode: 'legacy', invalidModeValue: false, encryptionKey: 'not_required' })
    // FUTURE-064 Slice B added the browser-safe `imageGeneration` availability class (no credential data) to this response.
    expect(Object.keys(payload).sort()).toEqual(['adminCredential', 'credentialStorage', 'executionPolicy', 'imageGeneration', 'nanobananaBaseUrl', 'providers', 'publicCredential'])
    expect(access.filter((a) => a.table === 'provider_api_credentials')).toEqual([])
    expect(JSON.stringify(payload)).not.toContain(LEGACY)
  })

  it('PUT and DELETE keep writing the legacy column only and answer { provider, status }', async () => {
    setup()
    const { PUT, DELETE } = await import('@/app/api/settings/providers/[provider]/route')
    const saved = await PUT(put('gemini', { apiKey: SECRET }), ctx('gemini'))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ provider: 'gemini', status: 'configured' })
    expect(tables.user_settings[0].gemini_api_key).toBe(SECRET)
    const removed = await DELETE(del('gemini'), ctx('gemini'))
    expect(await removed.json()).toEqual({ provider: 'gemini', status: 'missing' })
    expect(access.filter((a) => a.table === 'provider_api_credentials')).toEqual([])
  })

  it('an unrecognised mode value is flagged in the diagnostic and behaves as legacy', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'encrpyted')
    setup()
    const { GET } = await import('@/app/api/settings/providers/route')
    const payload = await (await GET()).json()
    expect(payload.credentialStorage).toMatchObject({ mode: 'legacy', invalidModeValue: true })
    expect(payload.providers.openai.status).toBe('configured')
  })
})

describe.each([['dual'], ['encrypted']])('%s mode: same public contract', (activeMode) => {
  beforeEach(() => { vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', activeMode); vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY) })

  it('PUT stores ciphertext, answers status only, GET reports configured, DELETE removes it', async () => {
    setup()
    const { PUT, DELETE } = await import('@/app/api/settings/providers/[provider]/route')
    const { GET } = await import('@/app/api/settings/providers/route')

    const saved = await PUT(put('gemini', { apiKey: SECRET }), ctx('gemini'))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ provider: 'gemini', status: 'configured' })
    expect(tables.provider_api_credentials).toHaveLength(1)
    expect(JSON.stringify(tables.provider_api_credentials)).not.toContain(SECRET)

    const listed = await (await GET()).json()
    expect(listed.providers.gemini.status).toBe('configured')
    expect(listed.credentialStorage).toEqual({ mode: activeMode, invalidModeValue: false, encryptionKey: 'configured' })
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(JSON.stringify(listed)).not.toMatch(/ciphertext|key_id|secret_version|byok1/)

    const removed = await DELETE(del('gemini'), ctx('gemini'))
    expect(await removed.json()).toEqual({ provider: 'gemini', status: 'missing' })
    expect(tables.provider_api_credentials).toEqual([])
  })

  it('the owner id comes from the session, never the body', async () => {
    setup()
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    await PUT(put('kling', { apiKey: SECRET, userId: 'user-evil', user_id: 'user-evil' }), ctx('kling'))
    expect(tables.provider_api_credentials.map((r) => r.user_id)).toEqual(['user-a'])
  })

  it('a database failure while saving is a static 500 with nothing leaked', async () => {
    setup('user-a', [{ table: 'provider_api_credentials', op: 'upsert' }])
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(put('kling', { apiKey: SECRET }), ctx('kling'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Nao foi possivel salvar a credencial' })
    expect(logs.join('\n')).not.toContain(SECRET)
    expect(logs.join('\n')).not.toContain(LEAK)
  })

  it('without the BYOK master key: save fails closed, status is unavailable (not missing), diagnostics name the cause', async () => {
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', '')
    setup()
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const { GET } = await import('@/app/api/settings/providers/route')
    expect((await PUT(put('openai', { apiKey: SECRET }), ctx('openai'))).status).toBe(500)
    const payload = await (await GET()).json()
    for (const entry of Object.values(payload.providers) as Array<{ status: string }>) expect(entry.status).toBe('unavailable')
    expect(payload.credentialStorage.encryptionKey).toBe('missing')
    expect(tables.user_settings[0].openai_api_key).toBe(LEGACY) // nothing was written anywhere
  })
})

describe('provider resolver compatibility (resolveProviderExecution)', () => {
  async function resolve(userId = 'user-a', provider: 'openai' | 'gemini' = 'openai') {
    const { resolveProviderExecution } = await import('../provider-execution')
    return resolveProviderExecution(session.client as never, { userId, provider })
  }

  it('legacy (default): ready from the legacy column, exactly as before', async () => {
    setup()
    await expect(resolve()).resolves.toMatchObject({ status: 'ready', provider: 'openai', executionMode: 'user_byok', credentialSource: 'user', secret: LEGACY })
    expect(access.filter((a) => a.table === 'provider_api_credentials')).toEqual([])
    await expect(resolve('user-a', 'gemini')).resolves.toMatchObject({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('dual: ready from the encrypted copy; a user without one still resolves through the bounded fallback', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    await expect(resolve()).resolves.toMatchObject({ status: 'ready', secret: LEGACY })
    await store.writeStoredApiCredential(session.client as never, { userId: 'user-a', provider: 'openai', secret: SECRET })
    await expect(resolve()).resolves.toMatchObject({ status: 'ready', secret: SECRET })
  })

  it('encrypted: missing encrypted row is provider_not_configured (the legacy value is not consulted)', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'encrypted')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    await expect(resolve()).resolves.toMatchObject({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('an unverifiable encrypted credential THROWS the typed unavailable error instead of returning provider_not_configured or a legacy key', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    await store.writeStoredApiCredential(session.client as never, { userId: 'user-a', provider: 'openai', secret: SECRET })
    const parts = tables.provider_api_credentials[0].ciphertext.split('.')
    parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
    tables.provider_api_credentials[0].ciphertext = parts.join('.')
    await expect(resolve()).rejects.toMatchObject({ name: 'ProviderCredentialUnavailableError', code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'decryption_failed' })
  })

  it('the platform credential is never substituted in any mode', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'platform-DUMMY')
    for (const value of ['legacy', 'dual', 'encrypted']) {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', value)
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
      setup()
      tables.user_settings[0].openai_api_key = null
      const result = await resolve().catch((e) => e)
      expect(JSON.stringify(result)).not.toContain('platform-DUMMY')
      expect(result).toMatchObject({ status: 'provider_not_configured' })
    }
  })
})
