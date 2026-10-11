import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3A — LOCAL STACK CONTRACT TEST for the encrypted credential table and the
// mode-aware store (real PostgreSQL + real PostgREST + real JWTs + real supabase-js).
//
// SKIPPED unless SLICE3_LOCAL_STACK=1. It talks to a THROWAWAY local PostgreSQL 17 cluster and a local PostgREST started by
// hand, refuses anything that is not loopback, and DROPs/recreates `public.provider_api_credentials` and empties
// `public.user_settings` there. Never point it at a real database. Dummy users and dummy keys only; no response is printed.
//
// Environment: SLICE3_LOCAL_STACK=1, SLICE3_PG_PORT (54329), SLICE3_PGREST_URL (http://127.0.0.1:54330), SLICE3_JWT_SECRET.
// Prerequisite: the Slice 2 local stack fixture (docs/productization/sql/FUTURE_059_SLICE_2_local_stack_fixture.sql); the
// Slice 2 containment is applied here if it is not already.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const ENABLED = process.env.SLICE3_LOCAL_STACK === '1'
const PG_PORT = Number(process.env.SLICE3_PG_PORT ?? 54329)
const REST_URL = (process.env.SLICE3_PGREST_URL ?? 'http://127.0.0.1:54330').replace(/\/$/, '')
const JWT_SECRET = process.env.SLICE3_JWT_SECRET ?? ''

const sqlFile = (name: string) => readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8')
const read = (name: string) => (ENABLED ? sqlFile(name) : '')
const FIXTURE = read('FUTURE_059_SLICE_2_local_stack_fixture.sql')
const SLICE2_UP = read('FUTURE_059_SLICE_2_containment.up.sql')
const SLICE3_UP = read('FUTURE_059_SLICE_3_provider_api_credentials.up.sql')
const SLICE3_DOWN = read('FUTURE_059_SLICE_3_provider_api_credentials.down.sql')
const USER_SETTINGS_SECTION = FIXTURE.slice(FIXTURE.indexOf('CREATE TABLE public.user_settings'))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const SECRET = 'sk-DUMMY-local3-owner-a'
const SECRET_2 = 'sk-DUMMY-local3-owner-a-v2'
const LEGACY = 'sk-DUMMY-local3-legacy-a'
const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const DUMMY = /DUMMY/

const b64 = (value: object | Buffer) => Buffer.from(Buffer.isBuffer(value) ? value : JSON.stringify(value)).toString('base64url')
function jwt(role: string, sub?: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ role, aud: 'authenticated', iat: now, exp: now + 3600, ...(sub ? { sub } : {}), ...extra })
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`
}

type Rest = { status: number; json: any; text: string }
const seen: string[] = []

async function rest(method: string, path: string, options: { jwt?: string | null; body?: unknown; headers?: Record<string, string> } = {}): Promise<Rest> {
  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(options.jwt ? { authorization: `Bearer ${options.jwt}` } : {}), ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  seen.push(text)
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { status: response.status, json, text }
}

type Recorded = { method: string; path: string; status: number }
/** supabase-js pointed at the local PostgREST root; records method/path/status of every request (never bodies' secrets). */
function supabaseFor(token: string | null, requests: Recorded[] = [], bodies: string[] = seen): SupabaseClient {
  const localFetch: typeof fetch = async (input, init) => {
    const url = String(input).replace(`${REST_URL}/rest/v1/`, `${REST_URL}/`)
    const response = await fetch(url, init)
    requests.push({ method: init?.method ?? 'GET', path: new URL(url).pathname, status: response.status })
    bodies.push(await response.clone().text())
    return response
  }
  return createClient(REST_URL, 'local-test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: localFetch, headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
}

let admin: ReturnType<typeof postgres>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function runScript(script: string) {
  const sql = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 1, onnotice: () => {} })
  try { await sql.unsafe(script); return null } catch (error) { return String((error as Error).message) } finally { await sql.end({ timeout: 2 }) }
}

async function waitFor(path: string) {
  for (let i = 0; i < 40; i++) {
    if ((await rest('GET', `${path}?select=*&limit=1`, { jwt: jwt('service_role') })).status === 200) return
    await sleep(150)
  }
  throw new Error(`PostgREST did not expose ${path}`)
}

async function reset() {
  await admin.unsafe('DROP TABLE IF EXISTS public.provider_api_credentials CASCADE')
  await admin.unsafe('DROP TABLE IF EXISTS public.user_settings CASCADE')
  await admin.unsafe(USER_SETTINGS_SECTION)
  expect(await runScript(SLICE2_UP)).toBeNull() // production's Slice 2 state: column-level grants only
  await admin`INSERT INTO auth.users (id) VALUES (${A}), (${B}), (${C}) ON CONFLICT DO NOTHING`
  await admin`INSERT INTO public.user_settings (user_id, theme, openai_api_key) VALUES (${A}, 'dark', ${LEGACY}), (${B}, 'light', NULL)`
  expect(await runScript(SLICE3_UP)).toBeNull()
  await sleep(300)
  await waitFor('/user_settings')
  await waitFor('/provider_api_credentials')
  // The migration NOTIFY and the one above each trigger a schema-cache reload; PostgREST answers 503 while one is in progress.
  // Let both finish so a test never races a reload (hosted Supabase has the same short window; the store reports it as a
  // retryable 'unavailable').
  await sleep(700)
  await waitFor('/provider_api_credentials')
}

describe.skipIf(!ENABLED).sequential('Slice 3A encrypted credential store against a real local PostgreSQL + PostgREST', () => {
  const owner = () => jwt('authenticated', A)
  const service = () => jwt('service_role')
  let store: typeof import('../api-credential-store')
  let privilegedCalls: Recorded[]
  let sessionCalls: Recorded[]
  let sessionBodies: string[]

  beforeAll(async () => {
    expect(JWT_SECRET.length).toBeGreaterThan(32)
    expect(new URL(REST_URL).hostname).toBe('127.0.0.1')
    expect([5432, 6543]).not.toContain(PG_PORT)
    admin = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 2, onnotice: () => {} })
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'authenticator'`
    if (n === 0) await admin.unsafe(FIXTURE)
    const [{ version }] = await admin`SELECT version() AS version`
    expect(version).toMatch(/PostgreSQL 17\./)
  })
  afterAll(async () => {
    store?.__setPrivilegedCredentialClientForTests(null)
    store?.__setCredentialStoreCallerClientHarnessForTests(true)
    await admin?.end({ timeout: 2 })
  })

  beforeEach(async () => {
    seen.length = 0
    for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
    await reset()
    vi.resetModules()
    store = await import('../api-credential-store')
    store.__setCredentialStoreCallerClientHarnessForTests(false)
    privilegedCalls = []
    sessionCalls = []
    sessionBodies = []
    store.__setPrivilegedCredentialClientForTests(supabaseFor(service(), privilegedCalls, []))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  const rows = async () => admin`SELECT user_id, provider, ciphertext, key_id, format_version, secret_version, source FROM public.provider_api_credentials ORDER BY provider`
  const owner$ = () => supabaseFor(owner(), sessionCalls, sessionBodies)

  describe('the migration through real PostgREST: browser roles have no access at all', () => {
    it('the production default privileges are overridden: ACL is service_role-only, RLS on, no policy', async () => {
      const [row] = await admin`SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) AS acl, relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS policies FROM pg_class c WHERE oid = 'public.provider_api_credentials'::regclass`
      expect(row).toEqual({ acl: 'postgres=arwdDxtm/postgres,service_role=arwd/postgres', rls: true, policies: 0 })
    })

    it('owner JWT and anon: every verb and query form is denied (401/403, SQLSTATE 42501)', async () => {
      await admin`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES (${A}, 'openai', 'v1.byok1.a.b.c', 'byok1')`
      for (const token of [owner(), null]) {
        for (const [method, path, body] of [
          ['GET', '/provider_api_credentials?select=*', undefined],
          ['GET', '/provider_api_credentials?select=ciphertext', undefined],
          ['GET', '/provider_api_credentials?select=id&key_id=eq.byok1', undefined],
          ['POST', '/provider_api_credentials', { user_id: A, provider: 'gemini', ciphertext: 'x', key_id: 'k' }],
          ['POST', '/provider_api_credentials?on_conflict=user_id,provider', { user_id: A, provider: 'openai', ciphertext: 'x', key_id: 'k' }],
          ['PATCH', `/provider_api_credentials?user_id=eq.${A}`, { key_id: 'x' }],
          ['DELETE', `/provider_api_credentials?user_id=eq.${A}`, undefined],
        ] as const) {
          const result = await rest(method, path, { jwt: token, body, headers: method === 'POST' && path.includes('on_conflict') ? { prefer: 'resolution=merge-duplicates' } : {} })
          expect([401, 403], `${token ? 'owner' : 'anon'} ${method} ${path} -> ${result.status}`).toContain(result.status)
          expect(result.json?.code).toBe('42501')
        }
      }
      expect(await rows()).toHaveLength(1)
      expect(seen.join('\n')).not.toMatch(/v1\.byok1/)
    })

    it('the table is not advertised to browser roles, and service_role can use it', async () => {
      expect(Object.keys((await rest('GET', '/', { jwt: owner() })).json?.definitions ?? {})).not.toContain('provider_api_credentials')
      expect(Object.keys((await rest('GET', '/')).json?.definitions ?? {})).not.toContain('provider_api_credentials')
      expect((await rest('GET', '/provider_api_credentials?select=provider', { jwt: service() })).status).toBe(200)
    })
  })

  describe('legacy (default): unchanged through real PostgREST, and the encrypted table is never requested', () => {
    it('read, status, write and remove use the plaintext column only', async () => {
      const caller = owner$()
      await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY })
      await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'configured', gemini: 'missing' })
      await store.writeStoredApiCredential(caller, { userId: A, provider: 'gemini', secret: 'gemini-DUMMY-legacy' })
      await store.removeStoredApiCredential(caller, { userId: A, provider: 'openai' })
      expect((await admin`SELECT gemini_api_key, openai_api_key FROM public.user_settings WHERE user_id = ${A}`)[0]).toEqual({ gemini_api_key: 'gemini-DUMMY-legacy', openai_api_key: null })
      expect([...privilegedCalls, ...sessionCalls].filter((call) => call.path.includes('provider_api_credentials'))).toEqual([])
      expect(await rows()).toHaveLength(0)
    })

    it('an invalid mode value and a stray key variable change nothing', async () => {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'encrpyted')
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', 'garbage')
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY })
      expect(privilegedCalls.filter((call) => call.path.includes('provider_api_credentials'))).toEqual([])
    })
  })

  describe.each([['dual'], ['encrypted']])('%s mode through real PostgREST', (mode) => {
    beforeEach(() => { vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', mode); vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY) })

    it('write -> read -> replace -> remove, with ciphertext at rest and a composite upsert', async () => {
      const caller = owner$()
      await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET })
      let [row] = await rows()
      expect(row).toMatchObject({ user_id: A, provider: 'openai', key_id: 'byok1', format_version: 1, secret_version: 1, source: 'user_entry' })
      expect(JSON.stringify(row)).not.toContain(SECRET)
      expect((await admin`SELECT openai_api_key FROM public.user_settings WHERE user_id = ${A}`)[0].openai_api_key).toBe(mode === 'dual' ? SECRET : null)
      await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET })

      await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_2 })
      ;[row] = await rows()
      expect(row.secret_version).toBe(2)
      expect(await rows()).toHaveLength(1)
      await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_2 })
      await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'configured', gemini: 'missing' })

      await store.removeStoredApiCredential(caller, { userId: A, provider: 'openai' })
      expect(await rows()).toHaveLength(0)
      expect((await admin`SELECT openai_api_key FROM public.user_settings WHERE user_id = ${A}`)[0].openai_api_key).toBeNull()
      await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    })

    it('the session client never sees a key or ciphertext, and never queries the encrypted table', async () => {
      const caller = owner$()
      await store.writeStoredApiCredential(caller, { userId: A, provider: 'gemini', secret: SECRET })
      await store.readStoredApiCredential(caller, { userId: A, provider: 'gemini' })
      await store.readStoredApiCredentialStatuses(caller, A)
      expect(sessionBodies.join('\n')).not.toMatch(DUMMY)
      expect(sessionBodies.join('\n')).not.toMatch(/v1\.byok1/)
      expect(sessionCalls.filter((call) => call.path.includes('provider_api_credentials'))).toEqual([])
      expect(privilegedCalls.some((call) => call.path.includes('provider_api_credentials'))).toBe(true)
      expect([...privilegedCalls, ...sessionCalls].filter((call) => call.status >= 400)).toEqual([])
    })

    it('a first-time owner (no settings row) can store and resolve a credential; the NanoBanana base URL is saved', async () => {
      const caller = supabaseFor(jwt('authenticated', C), sessionCalls, sessionBodies)
      await store.writeStoredApiCredential(caller, { userId: C, provider: 'nano_banana', secret: 'nb-DUMMY-c', nanobananaBaseUrl: 'https://nb.example.test' })
      expect((await admin`SELECT nanobanana_base_url, nanobanana_api_key FROM public.user_settings WHERE user_id = ${C}`)[0]).toEqual({ nanobanana_base_url: 'https://nb.example.test', nanobanana_api_key: mode === 'dual' ? 'nb-DUMMY-c' : null })
      await expect(store.readStoredApiCredential(caller, { userId: C, provider: 'nano_banana' })).resolves.toEqual({ status: 'configured', secret: 'nb-DUMMY-c' })
    })

    it('isolation: a session for A asking for B gets "missing" and the privileged client is not used', async () => {
      await store.writeStoredApiCredential(owner$(), { userId: A, provider: 'openai', secret: SECRET })
      privilegedCalls.length = 0
      await expect(store.readStoredApiCredential(owner$(), { userId: B, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
      expect(privilegedCalls).toEqual([])
    })

    it('tampered or relocated ciphertext is "unavailable", never a fallback to the legacy value', async () => {
      await store.writeStoredApiCredential(owner$(), { userId: A, provider: 'openai', secret: SECRET })
      await admin`UPDATE public.user_settings SET openai_api_key = ${LEGACY} WHERE user_id = ${A}`
      const [{ ciphertext }] = await rows()
      const parts = ciphertext.split('.')
      parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
      await admin`UPDATE public.provider_api_credentials SET ciphertext = ${parts.join('.')} WHERE user_id = ${A}`
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'decryption_failed' })

      await admin`UPDATE public.provider_api_credentials SET ciphertext = ${ciphertext}, user_id = ${B}, provider = 'gemini' WHERE user_id = ${A}`
      await admin`UPDATE public.user_settings SET gemini_api_key = 'x' WHERE user_id = ${B}`
      await expect(store.readStoredApiCredential(supabaseFor(jwt('authenticated', B)), { userId: B, provider: 'gemini' })).rejects.toMatchObject({ reason: 'decryption_failed' })
    })

    it('two concurrent saves leave exactly one row for the owner and provider', async () => {
      await Promise.all([
        store.writeStoredApiCredential(owner$(), { userId: A, provider: 'kling', secret: 'kling-DUMMY-1' }),
        store.writeStoredApiCredential(owner$(), { userId: A, provider: 'kling', secret: 'kling-DUMMY-2' }),
      ])
      expect(await rows()).toHaveLength(1)
      const read = await store.readStoredApiCredential(owner$(), { userId: A, provider: 'kling' })
      expect(['kling-DUMMY-1', 'kling-DUMMY-2']).toContain((read as { secret: string }).secret)
    })

    it('Settings preference upserts from the browser keep working in this mode', async () => {
      const save = await owner$().from('user_settings').upsert({ user_id: A, theme: 'studio', studio_intensity: 'expressive', auto_mode_default: false, save_prompt_history: false, notifications_email: false, notifications_browser: true, automation_enabled: true, default_image_model: 'gpt-image-2', image_evaluator_enabled: true, max_refinement_iterations: 4 }, { onConflict: 'user_id' })
      expect(save.error).toBeNull()
    })
  })

  describe('dual mode only: bounded legacy fallback and consistent removal', () => {
    beforeEach(() => { vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual'); vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY) })

    it('a user with only a legacy value still resolves (and the fallback is logged by code only)', async () => {
      const info = vi.spyOn(console, 'info')
      info.mockClear()
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY })
      // Slice 3B adds a lazy migration after the fallback when its SQL function exists; every line is a code-only log
      const logged = info.mock.calls.map((call) => String(call[0]))
      expect(logged[0]).toBe('[credential-store] read outcome=legacy_fallback provider=openai')
      for (const line of logged) expect(line).toMatch(/^\[credential-(store|backfill)\] [a-z ]+ outcome=[a-z_]+( provider=[a-z_]+)?$/)
    })
  })

  describe('encrypted mode only: the legacy column is not consulted', () => {
    it('a legacy-only user is "missing"', async () => {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'encrypted')
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    })
  })

  describe('configuration and database failures are distinct from "missing"', () => {
    it('active mode without the BYOK master key: encryption_not_configured', async () => {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
      await expect(store.writeStoredApiCredential(owner$(), { userId: A, provider: 'openai', secret: SECRET })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
      expect(await rows()).toHaveLength(0)
    })

    it('the migration not applied yet (table missing) is store_failure, not missing', async () => {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
      expect(await runScript(SLICE3_DOWN)).toBeNull()
      await sleep(500)
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'store_failure' })
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'legacy')
      await expect(store.readStoredApiCredential(owner$(), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY }) // rollback = flip the mode
    })

    it('rollback SQL refuses to drop a table holding credentials, then works once empty', async () => {
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'encrypted')
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
      await store.writeStoredApiCredential(owner$(), { userId: A, provider: 'openai', secret: SECRET })
      expect(await runScript(SLICE3_DOWN)).toMatch(/refusing to drop a table that still holds 1 encrypted credential/)
      expect(await rows()).toHaveLength(1)
      await store.removeStoredApiCredential(owner$(), { userId: A, provider: 'openai' })
      expect(await runScript(SLICE3_DOWN)).toBeNull()
    })
  })
})

describe.skipIf(ENABLED)('Slice 3A local stack contract test (skipped)', () => {
  it('runs only with SLICE3_LOCAL_STACK=1 against a throwaway local PostgreSQL + PostgREST', () => {
    expect(ENABLED).toBe(false)
  })
})
