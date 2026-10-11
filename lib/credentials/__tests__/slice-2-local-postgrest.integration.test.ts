import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_2 — LOCAL STACK CONTRACT TEST (real PostgreSQL + real PostgREST + real JWTs).
//
// SKIPPED unless SLICE2_LOCAL_STACK=1. It talks to a THROWAWAY local PostgreSQL 17 cluster and a local PostgREST process
// started by hand (see docs/productization/FUTURE_059_BYOK_CREDENTIAL_SLICE_2_LOCAL_STACK_PROOF_V1.md). It refuses to run
// against anything that is not a loopback address, and it DROPs/recreates public.user_settings there, so it must never be
// pointed at a real database. Dummy users and dummy keys only; no response body is ever printed.
//
// Environment:
//   SLICE2_LOCAL_STACK=1
//   SLICE2_PG_PORT        (default 54329)   PostgreSQL superuser `postgres`, trust auth, loopback
//   SLICE2_PGREST_URL     (default http://127.0.0.1:54330)
//   SLICE2_JWT_SECRET     the secret PostgREST was started with (PGRST_JWT_SECRET)
//
// What this proves that PGlite could not: the SQL PostgREST actually generates, PostgREST's role switching from
// `authenticator` on a signed JWT, `request.jwt.claims` handling through auth.uid(), error mapping, schema-cache reload on
// NOTIFY, and supabase-js (the same client library the application uses) against it.
// What it still does NOT prove: Supabase's gateway (Kong/apikey), GoTrue, event triggers, hosted PostgREST settings.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const ENABLED = process.env.SLICE2_LOCAL_STACK === '1'
const PG_PORT = Number(process.env.SLICE2_PG_PORT ?? 54329)
const REST_URL = (process.env.SLICE2_PGREST_URL ?? 'http://127.0.0.1:54330').replace(/\/$/, '')
const JWT_SECRET = process.env.SLICE2_JWT_SECRET ?? ''

const sqlFile = (name: string) => readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8')
const FIXTURE = ENABLED ? sqlFile('FUTURE_059_SLICE_2_local_stack_fixture.sql') : ''
const UP = ENABLED ? sqlFile('FUTURE_059_SLICE_2_containment.up.sql') : ''
const DOWN = ENABLED ? sqlFile('FUTURE_059_SLICE_2_containment.down.sql') : ''
const TABLE_SECTION = FIXTURE.slice(FIXTURE.indexOf('CREATE TABLE public.user_settings'))

const SECRET = ['openai_api_key', 'gemini_api_key', 'nanobanana_api_key', 'kling_api_key', 'replicate_api_key'] as const
const PREFS = ['theme', 'studio_intensity', 'auto_mode_default', 'save_prompt_history', 'notifications_email', 'notifications_browser', 'automation_enabled', 'default_image_model', 'image_evaluator_enabled', 'max_refinement_iterations'] as const
const SELECT_ALLOWLIST = ['id', 'user_id', ...PREFS, 'nanobanana_base_url', 'nanobanana_model', 'created_at', 'updated_at']
const ORIGINAL_ACL = 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const KEY_A = 'sk-DUMMY-local-owner-a'
const KEY_B = 'sk-DUMMY-local-owner-b'
const DUMMY = /DUMMY/

// ---- helpers ---------------------------------------------------------------------------------------------------------

const b64 = (value: object | Buffer) => Buffer.from(Buffer.isBuffer(value) ? value : JSON.stringify(value)).toString('base64url')
function jwt(role: string, sub?: string, extra: Record<string, unknown> = {}, secret = JWT_SECRET) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ role, aud: 'authenticated', iat: now, exp: now + 3600, ...(sub ? { sub } : {}), ...extra })
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`
}

type Rest = { status: number; json: any; text: string }
const seen: string[] = [] // every response body the "browser" received, for the no-secret scan (never printed)

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

/** supabase-js (the application's client library) pointed at the local PostgREST instead of `<url>/rest/v1`. */
function supabaseFor(token: string | null, record: string[] = seen): SupabaseClient {
  const localFetch: typeof fetch = async (input, init) => {
    const url = String(input).replace(`${REST_URL}/rest/v1/`, `${REST_URL}/`)
    const response = await fetch(url, init)
    record.push(await response.clone().text())
    return response
  }
  return createClient(REST_URL, 'local-test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: localFetch, headers: token ? { Authorization: `Bearer ${token}` } : {} },
  })
}

let admin: ReturnType<typeof postgres>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const aclText = async () => (await admin`SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) AS acl FROM pg_class WHERE oid = 'public.user_settings'::regclass`)[0].acl as string
const columnAclCount = async () => Number((await admin`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attnum > 0 AND attacl IS NOT NULL`)[0].n)

/** Run a script on its own connection so a failed transaction can never leak into the next step. */
async function runScript(script: string) {
  const sql = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 1, onnotice: () => {} })
  try { await sql.unsafe(script); return null } catch (error) { return String((error as Error).message) } finally { await sql.end({ timeout: 2 }) }
}

async function waitForSchemaCache() {
  for (let i = 0; i < 40; i++) {
    const probe = await rest('GET', '/user_settings?select=user_id&limit=1', { jwt: jwt('service_role') })
    if (probe.status === 200) return
    await sleep(150)
  }
  throw new Error('PostgREST did not reload the schema cache')
}

async function resetTable() {
  await admin.unsafe('DROP TABLE IF EXISTS public.user_settings CASCADE')
  await admin.unsafe(TABLE_SECTION)
  await admin`INSERT INTO auth.users (id) VALUES (${A}), (${B}), (${C}) ON CONFLICT DO NOTHING`
  await admin`INSERT INTO public.user_settings (user_id, theme, openai_api_key, gemini_api_key, kling_api_key) VALUES (${A}, 'dark', ${KEY_A}, 'gemini-DUMMY-a', 'kling-DUMMY-a'), (${B}, 'light', ${KEY_B}, NULL, NULL)`
  await admin.unsafe("NOTIFY pgrst, 'reload schema'")
  await sleep(300)
  await waitForSchemaCache()
}

async function applyUp() {
  expect(await runScript(UP)).toBeNull()
  await sleep(300)
  await waitForSchemaCache()
}

const settingsPayload = (userId: string, theme: string) => ({
  user_id: userId, theme, studio_intensity: 'expressive', auto_mode_default: false, save_prompt_history: false,
  notifications_email: false, notifications_browser: true, automation_enabled: true, default_image_model: 'gpt-image-2',
  image_evaluator_enabled: true, max_refinement_iterations: 4,
})
const denied = (r: Rest) => { expect([401, 403], `status ${r.status}`).toContain(r.status); expect(r.json?.code).toBe('42501'); expect(r.text).not.toMatch(DUMMY) }

// ---- suite -----------------------------------------------------------------------------------------------------------

describe.skipIf(!ENABLED).sequential('Slice 2 containment against a real local PostgreSQL + PostgREST', () => {
  const owner = () => jwt('authenticated', A)
  const other = () => jwt('authenticated', B)
  const service = () => jwt('service_role')

  beforeAll(async () => {
    expect(JWT_SECRET.length).toBeGreaterThan(32)
    expect(new URL(REST_URL).hostname).toBe('127.0.0.1') // loopback only — this suite DROPs a table
    expect([5432, 6543]).not.toContain(PG_PORT)
    admin = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 2, onnotice: () => {} })
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'authenticator'`
    if (n === 0) await admin.unsafe(FIXTURE)
    const [{ version }] = await admin`SELECT version() AS version`
    expect(version).toMatch(/PostgreSQL 17\./)
  })
  afterAll(async () => { await admin?.end({ timeout: 2 }) })
  beforeEach(async () => { seen.length = 0; await resetTable() })

  describe('1. pre-migration (reproduces the production exposure through real PostgREST)', () => {
    it('fixture ACL equals the production ACL, built by default privileges', async () => {
      expect(await aclText()).toBe(ORIGINAL_ACL)
      expect(await columnAclCount()).toBe(0)
    })

    it('the owner JWT can read its own key through PostgREST; another user cannot; anon sees no row', async () => {
      const own = await rest('GET', '/user_settings?select=openai_api_key,gemini_api_key', { jwt: owner() })
      expect(own.status).toBe(200)
      expect(own.json).toHaveLength(1)
      expect(own.json[0].openai_api_key).toBe(KEY_A)
      expect((await rest('GET', `/user_settings?select=openai_api_key&user_id=eq.${B}`, { jwt: owner() })).json).toEqual([])
      const anon = await rest('GET', '/user_settings?select=openai_api_key')
      expect(anon.status).toBe(200)
      expect(anon.json).toEqual([])
    })

    it('the owner JWT can also overwrite its own key', async () => {
      const patch = await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body: { openai_api_key: 'sk-DUMMY-overwritten' }, headers: { prefer: 'return=minimal' } })
      expect(patch.status).toBe(204)
      expect((await admin`SELECT openai_api_key FROM public.user_settings WHERE user_id = ${A}`)[0].openai_api_key).toBe('sk-DUMMY-overwritten')
    })
  })

  describe('2-5, 11. after the forward migration — protected columns', () => {
    beforeEach(applyUp)

    it('the migration produced exactly the intended ACL and the NOTIFY reloaded PostgREST', async () => {
      expect(await aclText()).toMatch(/authenticated=d\/postgres/) // table level: DELETE only
      expect(await aclText()).not.toContain('anon=')
      const openapi = await rest('GET', '/', { jwt: owner() })
      expect(openapi.status).toBe(200)
      // FINDING (differs from the privilege model): PostgREST lists the tables a role can touch but NOT the individual columns it
      // may read, so the OpenAPI document still names the key columns (names only — no value, and no access). Anonymous callers do
      // not get the table at all (asserted in the anonymous test).
      const columns = Object.keys(openapi.json?.definitions?.user_settings?.properties ?? {})
      for (const column of SELECT_ALLOWLIST) expect(columns).toContain(column)
      expect(openapi.text).not.toMatch(DUMMY)
    })

    it('the owner cannot read any key column by any PostgREST query form', async () => {
      const forms = [
        '/user_settings?select=openai_api_key',
        '/user_settings?select=user_id,gemini_api_key',
        '/user_settings?select=*',
        '/user_settings',
        '/user_settings?openai_api_key=not.is.null&select=user_id',
        '/user_settings?select=user_id&order=nanobanana_api_key',
        '/user_settings?select=user_id&kling_api_key=like.*DUMMY*',
        '/user_settings?select=user_id&or=(replicate_api_key.is.null,user_id.eq.x)',
      ]
      for (const form of forms) {
        const result = await rest('GET', form, { jwt: owner() })
        expect(result.status, form).toBeGreaterThanOrEqual(400)
        expect(result.text, form).not.toMatch(DUMMY)
        if (result.status !== 400) expect(result.json?.code, form).toBe('42501')
      }
      const accept = await rest('GET', '/user_settings?select=openai_api_key', { jwt: owner(), headers: { accept: 'application/vnd.pgrst.object+json' } })
      expect(accept.status).toBeGreaterThanOrEqual(400)
      expect(accept.text).not.toMatch(DUMMY)
    })

    it('an alias of a granted column is just that column: it returns theme values, never the key', async () => {
      const result = await rest('GET', '/user_settings?select=openai_api_key:theme', { jwt: owner() })
      expect(result.status).toBe(200)
      expect(result.json).toEqual([{ openai_api_key: 'dark' }])
      expect(result.text).not.toMatch(DUMMY)
    })

    it('the owner cannot overwrite or create a key (PATCH, POST, upsert, return=representation)', async () => {
      denied(await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body: { openai_api_key: 'sk-DUMMY-attacker' } }))
      denied(await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body: { theme: 'dark', gemini_api_key: null } }))
      denied(await rest('POST', '/user_settings', { jwt: owner(), body: { user_id: A, kling_api_key: 'sk-DUMMY-attacker' } }))
      denied(await rest('POST', '/user_settings?on_conflict=user_id', { jwt: owner(), body: { ...settingsPayload(A, 'dark'), nanobanana_api_key: 'sk-DUMMY-attacker' }, headers: { prefer: 'resolution=merge-duplicates' } }))
      expect((await admin`SELECT openai_api_key, gemini_api_key FROM public.user_settings WHERE user_id = ${A}`)[0]).toEqual({ openai_api_key: KEY_A, gemini_api_key: 'gemini-DUMMY-a' })
    })

    it('RETURNING cannot reveal protected fields: a bare return=representation is rejected, a column-limited one works', async () => {
      const bare = await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body: { theme: 'system' }, headers: { prefer: 'return=representation' } })
      denied(bare) // PostgREST returns every column, including the keys -> permission denied (no partial leak)
      const limited = await rest('PATCH', `/user_settings?user_id=eq.${A}&select=theme,max_refinement_iterations`, { jwt: owner(), body: { theme: 'system' }, headers: { prefer: 'return=representation' } })
      expect(limited.status).toBe(200)
      expect(limited.json).toEqual([{ theme: 'system', max_refinement_iterations: 2 }])
    })

    it('server-managed non-secret columns are not browser-writable', async () => {
      for (const body of [{ nanobanana_base_url: 'https://attacker.example' }, { nanobanana_model: 'x' }, { updated_at: '2030-01-01' }]) {
        denied(await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body }))
      }
    })

    it('anonymous requests cannot read, write or delete anything (table-level denial, not just empty rows)', async () => {
      for (const [method, path, body] of [
        ['GET', '/user_settings?select=openai_api_key', undefined],
        ['GET', '/user_settings?select=theme', undefined],
        ['GET', '/user_settings?select=user_id', undefined],
        ['POST', '/user_settings', { user_id: A, theme: 'dark' }],
        ['PATCH', `/user_settings?user_id=eq.${A}`, { theme: 'dark' }],
        ['DELETE', `/user_settings?user_id=eq.${A}`, undefined],
      ] as const) {
        const result = await rest(method, path, { jwt: null, body })
        expect([401, 403], `${method} ${path} -> ${result.status}`).toContain(result.status)
        expect(result.json?.code).toBe('42501')
      }
      const anonOpenApi = await rest('GET', '/')
      expect(Object.keys(anonOpenApi.json?.definitions ?? {})).not.toContain('user_settings')
    })

    it('JWT edge cases: bad signature, expired, unknown role and a role-less token never widen access', async () => {
      expect((await rest('GET', '/user_settings?select=theme', { jwt: jwt('authenticated', A, {}, 'x'.repeat(48)) })).status).toBe(401)
      expect((await rest('GET', '/user_settings?select=theme', { jwt: jwt('authenticated', A, { exp: 1 }) })).status).toBe(401)
      expect((await rest('GET', '/user_settings?select=theme', { jwt: jwt('postgres', A) })).status).toBeGreaterThanOrEqual(400) // not a role PostgREST may switch to
      expect((await rest('GET', '/user_settings?select=theme', { jwt: jwt('authenticated') })).json).toEqual([]) // no sub -> auth.uid() is null -> RLS shows nothing
    })

    it('no key value or key column appears in anything a browser role received during these tests', () => {
      expect(seen.join('\n')).not.toMatch(DUMMY)
    })
  })

  describe('6-8, 10. after the forward migration — Settings keeps working', () => {
    beforeEach(applyUp)

    it('reads every non-secret column of the owner row, only that row', async () => {
      const result = await rest('GET', `/user_settings?select=${SELECT_ALLOWLIST.join(',')}`, { jwt: owner() })
      expect(result.status).toBe(200)
      expect(result.json).toHaveLength(1)
      expect(result.json[0].user_id).toBe(A)
    })

    it('the Settings page flow with supabase-js: load, upsert, RELOAD shows the saved values (not defaults), keys untouched', async () => {
      const browser = supabaseFor(owner())
      const load = await browser.from('user_settings').select(PREFS.join(', ')).eq('user_id', A).single()
      expect(load.error).toBeNull()
      expect((load.data as any).theme).toBe('dark')

      const save = await browser.from('user_settings').upsert(settingsPayload(A, 'studio'), { onConflict: 'user_id' })
      expect(save.error).toBeNull()

      const reload = await supabaseFor(owner()).from('user_settings').select(PREFS.join(', ')).eq('user_id', A).single()
      expect(reload.error).toBeNull()
      expect(reload.data).toEqual({
        theme: 'studio', studio_intensity: 'expressive', auto_mode_default: false, save_prompt_history: false,
        notifications_email: false, notifications_browser: true, automation_enabled: true, default_image_model: 'gpt-image-2',
        image_evaluator_enabled: true, max_refinement_iterations: 4,
      })
      // none of those equals the column default, so a silent fallback to defaults would have failed above
      expect((await admin`SELECT openai_api_key, gemini_api_key, kling_api_key FROM public.user_settings WHERE user_id = ${A}`)[0]).toEqual({ openai_api_key: KEY_A, gemini_api_key: 'gemini-DUMMY-a', kling_api_key: 'kling-DUMMY-a' })
    })

    it('the first save of a brand-new user (insert path) works', async () => {
      const newUser = supabaseFor(jwt('authenticated', C))
      expect((await newUser.from('user_settings').upsert(settingsPayload(C, 'light'), { onConflict: 'user_id' })).error).toBeNull()
      const back = await supabaseFor(jwt('authenticated', C)).from('user_settings').select('theme, studio_intensity').eq('user_id', C).single()
      expect(back.data).toEqual({ theme: 'light', studio_intensity: 'expressive' })
    })

    it('RLS still isolates users: no read, update, upsert or delete of another user row', async () => {
      const browser = supabaseFor(owner())
      expect((await browser.from('user_settings').select('theme').eq('user_id', B)).data).toEqual([])
      expect((await browser.from('user_settings').upsert(settingsPayload(B, 'dark'), { onConflict: 'user_id' })).error).not.toBeNull()
      const patch = await rest('PATCH', `/user_settings?user_id=eq.${B}`, { jwt: owner(), body: { theme: 'system' }, headers: { prefer: 'return=minimal' } })
      expect([200, 204]).toContain(patch.status)
      const del = await rest('DELETE', `/user_settings?user_id=eq.${B}`, { jwt: owner() })
      expect([200, 204]).toContain(del.status)
      expect((await admin`SELECT theme FROM public.user_settings WHERE user_id = ${B}`)[0].theme).toBe('light')
      const repoint = await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: owner(), body: { user_id: B } })
      expect(repoint.status).toBeGreaterThanOrEqual(400)
    })

    it('own-row DELETE still works (reported separately, see the proof document)', async () => {
      expect([200, 204]).toContain((await rest('DELETE', `/user_settings?user_id=eq.${A}`, { jwt: owner() })).status)
      expect(await admin`SELECT 1 FROM public.user_settings WHERE user_id = ${A}`).toHaveLength(0)
    })
  })

  describe('9. service_role and the Slice 1 credential store against real PostgREST', () => {
    beforeEach(applyUp)

    it('service_role reads and writes the key columns directly', async () => {
      const read = await rest('GET', `/user_settings?select=openai_api_key&user_id=eq.${A}`, { jwt: service() })
      expect(read.status).toBe(200)
      expect(read.json[0].openai_api_key).toBe(KEY_A)
      expect((await rest('PATCH', `/user_settings?user_id=eq.${A}`, { jwt: service(), body: { gemini_api_key: null }, headers: { prefer: 'return=minimal' } })).status).toBe(204)
      expect((await admin`SELECT gemini_api_key FROM public.user_settings WHERE user_id = ${A}`)[0].gemini_api_key).toBeNull()
      expect((await rest('GET', '/user_settings?select=*', { jwt: service() })).json).toHaveLength(2) // bypasses RLS, by design
    })

    describe('the real api-credential-store (application code) with real supabase-js clients', () => {
      let store: typeof import('../api-credential-store')
      let privilegedCalls: string[]

      beforeEach(async () => {
        vi.resetModules()
        store = await import('../api-credential-store')
        store.__setCredentialStoreCallerClientHarnessForTests(false)
        privilegedCalls = []
        store.__setPrivilegedCredentialClientForTests(supabaseFor(service(), privilegedCalls))
      })
      afterAll(() => { store?.__setPrivilegedCredentialClientForTests(null); store?.__setCredentialStoreCallerClientHarnessForTests(true) })

      it('resolves the owner credential: the session client only proves ownership, the privileged client reads the key', async () => {
        const sessionSeen: string[] = []
        const caller = supabaseFor(owner(), sessionSeen)
        await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: KEY_A })
        expect(sessionSeen.join('')).not.toMatch(DUMMY)
        expect(privilegedCalls.join('')).toMatch(DUMMY)
      })

      it('a session for A asking for B gets "missing" and the privileged client is never used', async () => {
        const caller = supabaseFor(owner())
        await expect(store.readStoredApiCredential(caller, { userId: B, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
        expect(privilegedCalls).toEqual([])
      })

      it('statuses, replace and remove work end to end and the browser-visible payloads stay secret-free', async () => {
        const sessionSeen: string[] = []
        const caller = supabaseFor(owner(), sessionSeen)
        await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toEqual({ openai: 'configured', gemini: 'configured', nano_banana: 'missing', kling: 'configured', replicate: 'missing' })
        await store.writeStoredApiCredential(caller, { userId: A, provider: 'nano_banana', secret: 'nb-DUMMY-local', nanobananaBaseUrl: 'https://nb.example.test' })
        await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'nano_banana' })).resolves.toEqual({ status: 'configured', secret: 'nb-DUMMY-local' })
        await store.removeStoredApiCredential(caller, { userId: A, provider: 'openai' })
        await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
        expect((await admin`SELECT nanobanana_base_url FROM public.user_settings WHERE user_id = ${A}`)[0].nanobanana_base_url).toBe('https://nb.example.test')
        expect(sessionSeen.join('')).not.toMatch(DUMMY) // the session client never saw a key, even though keys were read/written
        const browserBase = await supabaseFor(owner()).from('user_settings').select('nanobanana_base_url').eq('user_id', A).single()
        expect(browserBase.data).toEqual({ nanobanana_base_url: 'https://nb.example.test' }) // the provider status route's own read
      })

      it('a failing privileged client is "unavailable", never "missing", and never falls back to the session client', async () => {
        store.__setPrivilegedCredentialClientForTests(supabaseFor(jwt('service_role', undefined, {}, 'y'.repeat(48)))) // wrong signature -> 401 from PostgREST
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        await expect(store.readStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai' })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'store_failure' })
        await expect(store.readStoredApiCredentialStatuses(supabaseFor(owner()), A)).resolves.toEqual({ openai: 'unavailable', gemini: 'unavailable', nano_banana: 'unavailable', kling: 'unavailable', replicate: 'unavailable' })
      })

      it('the browser Settings route read (service-role-free) and the proof read are the only session reads and both are granted', async () => {
        const browser = supabaseFor(owner())
        expect((await browser.from('user_settings').select('user_id').eq('user_id', A).maybeSingle()).error).toBeNull()
        expect((await browser.from('user_settings').select('nanobanana_base_url').eq('user_id', A).maybeSingle()).error).toBeNull()
      })
    })
  })

  describe('12-14. rollback, post-rollback behaviour and guards (real PostgreSQL 17.6)', () => {
    it('rollback restores exactly the original ACL; the key is readable through PostgREST again (the documented tradeoff)', async () => {
      await applyUp()
      denied(await rest('GET', '/user_settings?select=openai_api_key', { jwt: owner() }))
      expect(await runScript(DOWN)).toBeNull()
      await sleep(300)
      await waitForSchemaCache()
      expect(await aclText()).toBe(ORIGINAL_ACL)
      expect(await columnAclCount()).toBe(0)
      const again = await rest('GET', '/user_settings?select=openai_api_key', { jwt: owner() })
      expect(again.status).toBe(200)
      expect(again.json[0].openai_api_key).toBe(KEY_A)
      const settings = await supabaseFor(owner()).from('user_settings').upsert(settingsPayload(A, 'studio'), { onConflict: 'user_id' })
      expect(settings.error).toBeNull() // Settings keeps working after rollback too
    })

    it('up -> down -> up round-trips and the second up is protected again', async () => {
      await applyUp()
      expect(await runScript(DOWN)).toBeNull()
      await applyUp()
      denied(await rest('GET', '/user_settings?select=gemini_api_key', { jwt: owner() }))
    })

    it('a second run of the forward migration is rejected and changes nothing', async () => {
      await applyUp()
      const before = await aclText()
      expect(await runScript(UP)).toMatch(/not the reviewed pre-migration state|already exist/)
      expect(await aclText()).toBe(before)
    })

    it('column drift aborts with no change', async () => {
      await admin.unsafe('ALTER TABLE public.user_settings ADD COLUMN surprise text')
      expect(await runScript(UP)).toMatch(/columns changed/)
      expect(await aclText()).toBe(ORIGINAL_ACL)
      expect(await columnAclCount()).toBe(0)
    })

    it('ACL drift aborts with no change', async () => {
      await admin.unsafe('REVOKE TRUNCATE ON public.user_settings FROM anon')
      expect(await runScript(UP)).toMatch(/not the reviewed pre-migration state/)
      expect(await columnAclCount()).toBe(0)
    })

    it('a failing in-transaction verification rolls the whole migration back', async () => {
      const poisoned = UP.replace('-- 4. Verify the result', 'GRANT SELECT (openai_api_key) ON TABLE public.user_settings TO authenticated;\n-- 4. Verify the result')
      expect(poisoned).not.toBe(UP)
      expect(await runScript(poisoned)).toMatch(/still holds SELECT on openai_api_key/)
      expect(await aclText()).toBe(ORIGINAL_ACL)
      expect(await columnAclCount()).toBe(0)
      expect((await rest('GET', '/user_settings?select=openai_api_key', { jwt: owner() })).json[0].openai_api_key).toBe(KEY_A) // nothing changed
    })

    it('the migration is atomic under concurrent Settings upserts: no 5xx, every request is a clean success', async () => {
      const results: number[] = []
      let stop = false
      const writer = (async () => {
        const browser = supabaseFor(owner(), [])
        while (!stop) {
          const { error, status } = await browser.from('user_settings').upsert(settingsPayload(A, 'studio'), { onConflict: 'user_id' })
          results.push(error ? status : 201)
          await sleep(15)
        }
      })()
      await sleep(200)
      expect(await runScript(UP)).toBeNull()
      await sleep(400)
      stop = true
      await writer
      expect(results.length).toBeGreaterThan(5)
      expect(results.filter((status) => status >= 500)).toEqual([])
      expect(results.filter((status) => status >= 400)).toEqual([]) // upsert columns are granted both before and after
    })
  })

  describe('report only: is own-row DELETE strictly necessary?', () => {
    it('the application never deletes user_settings from the browser or the server; revoking DELETE only blocks the owner from deleting its own row', async () => {
      await applyUp()
      await admin.unsafe('REVOKE DELETE ON TABLE public.user_settings FROM authenticated')
      await sleep(300)
      const attempt = await rest('DELETE', `/user_settings?user_id=eq.${A}`, { jwt: owner() })
      expect([401, 403]).toContain(attempt.status)
      expect((await supabaseFor(owner()).from('user_settings').upsert(settingsPayload(A, 'studio'), { onConflict: 'user_id' })).error).toBeNull() // Settings unaffected
      expect(await admin`SELECT 1 FROM public.user_settings WHERE user_id = ${A}`).toHaveLength(1)
    })

    it('account deletion still cascades without DELETE for the API roles: the referential action runs as the table owner', async () => {
      await applyUp()
      await admin.unsafe('REVOKE DELETE ON TABLE public.user_settings FROM authenticated')
      await admin.unsafe("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slice2_auth_admin') THEN CREATE ROLE slice2_auth_admin NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA auth TO slice2_auth_admin; GRANT SELECT, DELETE ON auth.users TO slice2_auth_admin")
      await admin.unsafe('SET ROLE slice2_auth_admin')
      try { await admin.unsafe(`DELETE FROM auth.users WHERE id = '${A}'`) } finally { await admin.unsafe('RESET ROLE') }
      expect(await admin`SELECT 1 FROM public.user_settings WHERE user_id = ${A}`).toHaveLength(0)
    })
  })
})

describe.skipIf(ENABLED)('Slice 2 local stack contract test (skipped)', () => {
  it('runs only with SLICE2_LOCAL_STACK=1 against a throwaway local PostgreSQL + PostgREST', () => {
    expect(ENABLED).toBe(false)
  })
})
