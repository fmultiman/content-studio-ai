import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — LOCAL STACK CONTRACT TEST for lazy migrate-on-read, the operator sweep and, above
// all, the row-lock behaviour of the atomic backfill function under REAL CONCURRENT TRANSACTIONS (separate PostgreSQL connections).
//
// SKIPPED unless SLICE3B_LOCAL_STACK=1. Talks only to a THROWAWAY loopback PostgreSQL 17 + PostgREST; DROPs and recreates
// `public.user_settings` and `public.provider_api_credentials` there. Never point it at a real database. Dummy data only.
//
// Environment: SLICE3B_LOCAL_STACK=1, SLICE3B_PG_PORT (54329), SLICE3B_PGREST_URL (http://127.0.0.1:54330), SLICE3B_JWT_SECRET.
// Prerequisite: the Slice 2 local-stack fixture (docs/productization/sql/FUTURE_059_SLICE_2_local_stack_fixture.sql).

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 })

const ENABLED = process.env.SLICE3B_LOCAL_STACK === '1'
const PG_PORT = Number(process.env.SLICE3B_PG_PORT ?? 54329)
const REST_URL = (process.env.SLICE3B_PGREST_URL ?? 'http://127.0.0.1:54330').replace(/\/$/, '')
const JWT_SECRET = process.env.SLICE3B_JWT_SECRET ?? ''

const read = (name: string) => (ENABLED ? readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8') : '')
const FIXTURE = read('FUTURE_059_SLICE_2_local_stack_fixture.sql')
const SLICE2_UP = read('FUTURE_059_SLICE_2_containment.up.sql')
const SLICE3_UP = read('FUTURE_059_SLICE_3_provider_api_credentials.up.sql')
const SLICE3B_UP = read('FUTURE_059_SLICE_3B_backfill_function.up.sql')
const SLICE3B_DOWN = read('FUTURE_059_SLICE_3B_backfill_function.down.sql')
const USER_SETTINGS_SECTION = FIXTURE.slice(FIXTURE.indexOf('CREATE TABLE public.user_settings'))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [A, B, C, D] = [1, 2, 3, 4].map(id)
const LEGACY = 'sk-DUMMY-local3b-legacy-a'
const NEWER = 'sk-DUMMY-local3b-newer-a'
const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const DUMMY = /DUMMY/
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const TOKEN = 'v1.byok1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA'

const b64 = (value: object | Buffer) => Buffer.from(Buffer.isBuffer(value) ? value : JSON.stringify(value)).toString('base64url')
function jwt(role: string, sub?: string) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ role, aud: 'authenticated', iat: now, exp: now + 3600, ...(sub ? { sub } : {}) })
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`
}

type Rest = { status: number; json: any; text: string }
async function rest(method: string, path: string, options: { jwt?: string | null; body?: unknown } = {}): Promise<Rest> {
  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(options.jwt ? { authorization: `Bearer ${options.jwt}` } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  return { status: response.status, json, text }
}

type Seen = { method: string; path: string; status: number; requestBody: string }
function supabaseFor(token: string, requests: Seen[] = [], responses: string[] = []): SupabaseClient {
  const localFetch: typeof fetch = async (input, init) => {
    const url = String(input).replace(`${REST_URL}/rest/v1/`, `${REST_URL}/`)
    const response = await fetch(url, init)
    requests.push({ method: init?.method ?? 'GET', path: new URL(url).pathname, status: response.status, requestBody: typeof init?.body === 'string' ? init.body : '' })
    responses.push(await response.clone().text())
    return response
  }
  return createClient(REST_URL, 'local-test-anon-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localFetch, headers: { Authorization: `Bearer ${token}` } } })
}

let admin: ReturnType<typeof postgres>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const clients: Array<ReturnType<typeof postgres>> = []

/** A dedicated single-connection client: lets a test hold a transaction open while another connection acts. */
function connection() {
  const sql = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 1, onnotice: () => {} })
  clients.push(sql)
  return sql
}
async function runScript(script: string) {
  const sql = connection()
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
  await admin.unsafe('DROP FUNCTION IF EXISTS public.backfill_provider_api_credential(uuid,text,text,text,text,smallint)')
  await admin.unsafe('DROP TABLE IF EXISTS public.provider_api_credentials CASCADE')
  await admin.unsafe('DROP TABLE IF EXISTS public.user_settings CASCADE')
  await admin.unsafe(USER_SETTINGS_SECTION)
  expect(await runScript(SLICE2_UP)).toBeNull()
  await admin`INSERT INTO auth.users (id) VALUES (${A}), (${B}), (${C}), (${D}) ON CONFLICT DO NOTHING`
  await admin`INSERT INTO public.user_settings (user_id, theme, openai_api_key, kling_api_key) VALUES (${A}, 'dark', ${LEGACY}, NULL), (${B}, 'light', NULL, NULL), (${C}, 'dark', NULL, 'kling-DUMMY-c'), (${D}, 'dark', 'sk-DUMMY-d', NULL)`
  expect(await runScript(SLICE3_UP)).toBeNull()
  expect(await runScript(SLICE3B_UP)).toBeNull()
  // Each migration script NOTIFYs, so PostgREST reloads its schema cache several times (and answers 503 meanwhile; hosted
  // Supabase has the same short window — the store reports it as a retryable 'unavailable'). Wait until the new function is in
  // the cache AND the reloads have settled, so no test races a reload.
  for (let i = 0; i < 60; i++) {
    const spec = await rest('GET', '/', { jwt: jwt('service_role') })
    if (spec.status === 200 && Object.keys(spec.json?.paths ?? {}).includes('/rpc/backfill_provider_api_credential')) break
    await sleep(200)
  }
  await sleep(1200)
  await waitFor('/user_settings')
  await waitFor('/provider_api_credentials')
  await sleep(500)
  await waitFor('/provider_api_credentials')
}

const rows = async () => admin`SELECT user_id, provider, ciphertext, source, secret_version FROM public.provider_api_credentials ORDER BY user_id, provider`
const legacyOf = async (user: string) => (await admin`SELECT openai_api_key FROM public.user_settings WHERE user_id = ${user}`)[0].openai_api_key as string | null

/** Calls the function on `sql` as service_role (inside the caller's transaction when one is open). */
const callFunction = (sql: ReturnType<typeof postgres>, user: string, legacy: string, ciphertext = TOKEN) =>
  sql.unsafe(`SELECT public.backfill_provider_api_credential('${user}'::uuid, 'openai', '${sha(legacy)}', '${ciphertext}', 'byok1', 1::smallint) AS outcome`).then((r) => (r[0] as unknown as { outcome: string }).outcome)

/** Resolves 'blocked' if `promise` has not settled within `ms` (i.e. it is waiting on a lock), otherwise its value. */
async function blockedOrDone<T>(promise: Promise<T>, ms = 900): Promise<'blocked' | { value: T }> {
  return Promise.race([promise.then((value) => ({ value })), sleep(ms).then(() => 'blocked' as const)])
}

describe.skipIf(!ENABLED).sequential('Slice 3B against a real local PostgreSQL + PostgREST', () => {
  const owner = () => jwt('authenticated', A)
  const service = () => jwt('service_role')
  let store: typeof import('../api-credential-store')
  let sweepModule: typeof import('../credential-backfill-sweep')
  let crypto: typeof import('../byok-crypto')
  let privilegedRequests: Seen[]
  let sessionResponses: string[]

  beforeAll(async () => {
    expect(JWT_SECRET.length).toBeGreaterThan(32)
    expect(new URL(REST_URL).hostname).toBe('127.0.0.1')
    expect([5432, 6543]).not.toContain(PG_PORT)
    admin = postgres({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: 'postgres', max: 2, onnotice: () => {} })
    const [{ n }] = await admin`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'authenticator'`
    if (n === 0) await admin.unsafe(FIXTURE)
    expect((await admin`SELECT version() AS v`)[0].v).toMatch(/PostgreSQL 17\./)
  })
  afterAll(async () => {
    store?.__setPrivilegedCredentialClientForTests(null)
    store?.__setCredentialStoreCallerClientHarnessForTests(true)
    for (const sql of clients) await sql.end({ timeout: 1 }).catch(() => undefined)
    await admin?.end({ timeout: 2 })
  })

  beforeEach(async () => {
    for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
    await reset()
    vi.resetModules()
    store = await import('../api-credential-store')
    sweepModule = await import('../credential-backfill-sweep')
    crypto = await import('../byok-crypto')
    store.__setCredentialStoreCallerClientHarnessForTests(false)
    privilegedRequests = []
    sessionResponses = []
    store.__setPrivilegedCredentialClientForTests(supabaseFor(service(), privilegedRequests, []))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  describe('the function through real PostgREST', () => {
    it('browser roles cannot call it (401/403, SQLSTATE 42501) and it is not advertised to them; service_role can', async () => {
      const args = { p_user_id: A, p_provider: 'openai', p_expected_legacy_sha256: sha(LEGACY), p_ciphertext: TOKEN, p_key_id: 'byok1', p_format_version: 1 }
      for (const token of [jwt('authenticated', A), null]) {
        const result = await rest('POST', '/rpc/backfill_provider_api_credential', { jwt: token, body: args })
        expect([401, 403], `${token ? 'owner' : 'anon'} -> ${result.status}`).toContain(result.status)
        expect(result.json?.code).toBe('42501')
      }
      expect(await rows()).toHaveLength(0)
      expect(Object.keys((await rest('GET', '/', { jwt: owner() })).json?.paths ?? {})).not.toContain('/rpc/backfill_provider_api_credential')
      const ok = await rest('POST', '/rpc/backfill_provider_api_credential', { jwt: service(), body: args })
      expect(ok.status).toBe(200)
      expect(ok.json).toBe('inserted')
    })
  })

  describe('lazy migrate-on-read through real PostgREST (dual)', () => {
    beforeEach(() => { vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual'); vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY) })

    it('migrates a legacy-only credential; the session never sees a key; the plaintext is never sent to the database', async () => {
      const sessionRequests: Seen[] = []
      const caller = supabaseFor(owner(), sessionRequests, sessionResponses)
      await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY })
      const [row] = await rows()
      expect(row).toMatchObject({ user_id: A, provider: 'openai', source: 'legacy_backfill', secret_version: 1 })
      expect(crypto.decryptCredential({ userId: A, provider: 'openai', token: row.ciphertext })).toBe(LEGACY)
      expect(sessionResponses.join('\n')).not.toMatch(DUMMY)
      expect(sessionRequests.filter((r) => r.path.includes('provider_api_credentials') || r.path.includes('/rpc/'))).toEqual([])
      const rpc = privilegedRequests.filter((r) => r.path === '/rpc/backfill_provider_api_credential')
      expect(rpc).toHaveLength(1)
      expect(rpc[0].requestBody).not.toContain(LEGACY)
      expect(rpc[0].requestBody).toContain(sha(LEGACY))
      expect(rpc[0].status).toBe(200)
    })

    it('simultaneous reads produce exactly one encrypted row', async () => {
      await Promise.all([1, 2, 3].map(() => store.readStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai' })))
      expect(await rows()).toHaveLength(1)
    })

    it('an existing encrypted credential is never migrated over; a corrupted one stays an explicit error', async () => {
      const wrote = crypto.encryptCredential({ userId: A, provider: 'openai', secret: NEWER })
      await admin`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES (${A}, 'openai', ${wrote.token}, ${wrote.keyId})`
      await expect(store.readStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: NEWER })
      const parts = wrote.token.split('.')
      parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
      await admin`UPDATE public.provider_api_credentials SET ciphertext = ${parts.join('.')} WHERE user_id = ${A}`
      privilegedRequests.length = 0
      await expect(store.readStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'decryption_failed' })
      expect(privilegedRequests.filter((r) => r.path.startsWith('/rpc/'))).toEqual([])
      expect((await rows())[0].ciphertext).toBe(parts.join('.'))
    })

    it('a missing database function (Slice 3B SQL not applied) never breaks the read', async () => {
      expect(await runScript(SLICE3B_DOWN)).toBeNull()
      await sleep(600)
      await expect(store.readStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY })
      expect(await rows()).toHaveLength(0)
    })
  })

  describe('ROW-LOCK SAFETY under real concurrent transactions', () => {
    it('a removal that committed FIRST wins: the blocked backfill sees NULL and refuses, nothing is resurrected', async () => {
      const remover = connection()
      const migrator = connection()
      await remover.unsafe('BEGIN')
      await remover.unsafe(`UPDATE public.user_settings SET openai_api_key = NULL WHERE user_id = '${A}'`) // step 1 of a removal, not yet committed
      await migrator.unsafe('BEGIN')
      const pending = callFunction(migrator, A, LEGACY) // the app read LEGACY before the removal
      expect(await blockedOrDone(pending)).toBe('blocked') // the function waits on the removal's row lock
      await remover.unsafe('COMMIT')
      expect(await pending).toBe('legacy_changed')
      await migrator.unsafe('COMMIT')
      expect(await rows()).toHaveLength(0)
      expect(await legacyOf(A)).toBeNull()
    })

    it('a backfill that holds the lock FIRST makes the removal wait; after both, the credential is gone from BOTH stores', async () => {
      const migrator = connection()
      const remover = connection()
      await migrator.unsafe('BEGIN')
      expect(await callFunction(migrator, A, LEGACY)).toBe('inserted') // lock held until COMMIT
      const removal = remover.unsafe(`UPDATE public.user_settings SET openai_api_key = NULL WHERE user_id = '${A}'`)
      expect(await blockedOrDone(removal)).toBe('blocked')
      await migrator.unsafe('COMMIT')
      await removal
      await admin`DELETE FROM public.provider_api_credentials WHERE user_id = ${A} AND provider = 'openai'` // step 2 of the removal order: legacy first, encrypted second
      expect(await rows()).toHaveLength(0)
      expect(await legacyOf(A)).toBeNull()
    })

    it('a replacement that committed FIRST wins: the backfill (old hash) refuses and the newer legacy value is untouched', async () => {
      const replacer = connection()
      const migrator = connection()
      await replacer.unsafe('BEGIN')
      await replacer.unsafe(`UPDATE public.user_settings SET openai_api_key = '${NEWER}' WHERE user_id = '${A}'`)
      await migrator.unsafe('BEGIN')
      const pending = callFunction(migrator, A, LEGACY)
      expect(await blockedOrDone(pending)).toBe('blocked')
      await replacer.unsafe('COMMIT')
      expect(await pending).toBe('legacy_changed')
      await migrator.unsafe('COMMIT')
      expect(await rows()).toHaveLength(0)
      expect(await legacyOf(A)).toBe(NEWER)
    })

    it('two simultaneous backfills of the same credential: exactly one inserts, the other reports "exists"', async () => {
      const x = connection()
      const y = connection()
      await x.unsafe('BEGIN')
      await y.unsafe('BEGIN')
      const first = await callFunction(x, A, LEGACY, 'v1.byok1.FIRST.INSERT.CIPHERTEXT')
      const second = callFunction(y, A, LEGACY, 'v1.byok1.SECOND.INSERT.CIPHERTEXT') // waits on the first's unique-index entry
      expect(await blockedOrDone(second)).toBe('blocked')
      await x.unsafe('COMMIT')
      expect([first, await second].sort()).toEqual(['exists', 'inserted'])
      await y.unsafe('COMMIT')
      const stored = await rows()
      expect(stored).toHaveLength(1)
      expect(stored[0].ciphertext).toBe('v1.byok1.FIRST.INSERT.CIPHERTEXT')
    })

    it('a user write (encrypted first) racing a backfill: the user value wins and is never overwritten by the migration', async () => {
      const user = crypto // keep module loaded
      void user
      vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
      vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
      const migrator = connection()
      await migrator.unsafe('BEGIN')
      expect(await callFunction(migrator, A, LEGACY, 'v1.byok1.MIGRATION.ROW.CIPHERTEXT')).toBe('inserted')
      const write = store.writeStoredApiCredential(supabaseFor(owner()), { userId: A, provider: 'openai', secret: NEWER })
      expect(await blockedOrDone(write)).toBe('blocked') // the user's encrypted upsert waits for the migration's row
      await migrator.unsafe('COMMIT')
      await write
      const [row] = await rows()
      expect(row.source).toBe('user_entry')
      expect(crypto.decryptCredential({ userId: A, provider: 'openai', token: row.ciphertext })).toBe(NEWER)
      expect(await legacyOf(A)).toBe(NEWER)
    })
  })

  describe('the operator sweep through real PostgREST', () => {
    beforeEach(() => { vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual'); vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY) })

    it('dry run reports and writes nothing; execution covers inactive owners; a second pass is idempotent; a clean dry run is cut-over ready', async () => {
      const client = store.createOperatorPrivilegedClient()
      const dry = await sweepModule.runCredentialSweep(client)
      expect(dry).toMatchObject({ dryRun: true, done: true, usersScanned: 4, stopped: null })
      expect(dry.totals).toMatchObject({ legacyConfigured: 3, legacyOnly: 3, migrated: 0 })
      expect(dry.cutoverReady).toBe(false)
      expect(await rows()).toHaveLength(0)

      const executed = await sweepModule.runCredentialSweep(client, { dryRun: false, batchSize: 2, maxBatches: 10 })
      expect(executed).toMatchObject({ done: true, stopped: null })
      expect(executed.totals).toMatchObject({ migrated: 3, failed: 0 })
      expect((await rows()).map((r) => `${r.user_id.slice(-1)}:${r.provider}`)).toEqual(['1:openai', '3:kling', '4:openai'])
      for (const row of await rows()) expect(row.source).toBe('legacy_backfill')

      const again = await sweepModule.runCredentialSweep(client, { dryRun: false })
      expect(again.totals).toMatchObject({ migrated: 0, verified: 3 })
      const verify = await sweepModule.runCredentialSweep(client)
      expect(verify).toMatchObject({ cutoverReady: true, totals: { legacyOnly: 0, verified: 3, divergent: 0, integrityErrors: 0 } })
      expect(JSON.stringify([dry, executed, again, verify])).not.toMatch(DUMMY)
    })

    it('a divergent or corrupted encrypted row is reported and blocks readiness; the sweep never touches it', async () => {
      const client = store.createOperatorPrivilegedClient()
      const different = crypto.encryptCredential({ userId: A, provider: 'openai', secret: NEWER })
      await admin`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES (${A}, 'openai', ${different.token}, ${different.keyId})`
      const parts = crypto.encryptCredential({ userId: D, provider: 'openai', secret: 'sk-DUMMY-d' }).token.split('.')
      parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
      await admin`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES (${D}, 'openai', ${parts.join('.')}, 'byok1')`
      const before = JSON.stringify(await rows())
      const report = await sweepModule.runCredentialSweep(client, { dryRun: false, batchSize: 10 })
      expect(report.totals).toMatchObject({ divergent: 1, integrityErrors: 1, migrated: 1 }) // only C's Kling credential moved
      expect(report.cutoverReady).toBeNull()
      const after = await rows()
      expect(JSON.stringify(after.filter((r) => r.user_id !== C))).toBe(JSON.stringify(JSON.parse(before)))
    })
  })
})

describe.skipIf(ENABLED)('Slice 3B local stack contract test (skipped)', () => {
  it('runs only with SLICE3B_LOCAL_STACK=1 against a throwaway local PostgreSQL + PostgREST', () => {
    expect(ENABLED).toBe(false)
  })
})
