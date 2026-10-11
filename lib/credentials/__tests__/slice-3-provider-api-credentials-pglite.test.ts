import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059 Slice 3A — proof of the PROPOSED (not applied) encrypted-credential table migration in an isolated in-process
// PostgreSQL. The fixture reproduces the production mechanism that makes this migration security-critical: Supabase's
// DEFAULT PRIVILEGES give arwdDxtm on every NEW public table to anon/authenticated/service_role at CREATE time, so the SQL
// must close that window inside its own transaction. Dummy rows only. (PGlite is PostgreSQL 18 / production is 17.6 and it
// is not PostgREST; the privilege semantics checked here are core PostgreSQL.)

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const sql = (name: string) => readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8')
const UP = sql('FUTURE_059_SLICE_3_provider_api_credentials.up.sql')
const DOWN = sql('FUTURE_059_SLICE_3_provider_api_credentials.down.sql')

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'v1.byok1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA'

const FIXTURE = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  INSERT INTO auth.users (id) VALUES ('${A}'), ('${B}');
`

let db: PGlite
type Outcome = { rows: Record<string, any>[]; error: string | null }
async function as(role: 'anon' | 'authenticated' | 'service_role', sub: string | null, statement: string): Promise<Outcome> {
  await db.exec(`SET ROLE ${role}`)
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ''])
    return { rows: (await db.query<Record<string, any>>(statement)).rows, error: null }
  } catch (error) {
    return { rows: [], error: String((error as Error).message) }
  } finally {
    await db.exec('RESET ROLE')
  }
}
const aclText = async () => (await db.query<{ acl: string }>(`SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) AS acl FROM pg_class WHERE oid = 'public.provider_api_credentials'::regclass`)).rows[0]?.acl
const tableExists = async () => (await db.query<{ r: string | null }>(`SELECT to_regclass('public.provider_api_credentials')::text AS r`)).rows[0].r !== null
const insertRow = (user: string, provider: string) => `INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES ('${user}', '${provider}', '${TOKEN}', 'byok1')`

beforeEach(async () => {
  db = new PGlite()
  await db.exec(FIXTURE)
})
afterEach(async () => { await db.close() })

describe('the artifact is reviewed code, not a deploy step', () => {
  it('lives under docs/, is one transaction, and is not in scripts/', () => {
    expect(UP.trimStart().startsWith('--')).toBe(true)
    expect(UP).toMatch(/^BEGIN;$/m)
    expect(UP.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(DOWN).toMatch(/^BEGIN;$/m)
    expect(DOWN.trimEnd()).toMatch(/COMMIT;(\n--[^\n]*)*$/)
    expect(UP.indexOf('CREATE TABLE')).toBeLessThan(UP.indexOf('REVOKE ALL ON TABLE public.provider_api_credentials FROM anon'))
    expect(UP.indexOf('REVOKE ALL ON TABLE public.provider_api_credentials FROM authenticated')).toBeLessThan(UP.lastIndexOf('COMMIT;'))
    expect(UP).toContain('PROPOSED, NOT APPLIED')
    expect(new RegExp("api_key" + String.fromCharCode(92) + "s+text").test(UP)).toBe(false)
  })
})

describe('forward migration', () => {
  it('without the lock-down the default privileges WOULD expose the table (why the migration must revoke in-transaction)', async () => {
    await db.exec(`CREATE TABLE public.provider_api_credentials_unprotected (id int)`)
    const { rows } = await db.query<{ acl: string }>(`SELECT relacl::text AS acl FROM pg_class WHERE relname = 'provider_api_credentials_unprotected'`)
    expect(rows[0].acl).toContain('anon=arwdDxtm')
    expect(rows[0].acl).toContain('authenticated=arwdDxtm')
  })

  it('creates the table with service_role-only privileges, RLS on and no policy', async () => {
    await db.exec(UP)
    expect(await aclText()).toBe('postgres=arwdDxtm/postgres,service_role=arwd/postgres')
    const { rows } = await db.query<Record<string, any>>(`SELECT relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS policies, (SELECT count(*)::int FROM pg_attribute WHERE attrelid = c.oid AND attnum > 0 AND attacl IS NOT NULL) AS column_acls FROM pg_class c WHERE oid = 'public.provider_api_credentials'::regclass`)
    expect(rows[0]).toEqual({ rls: true, policies: 0, column_acls: 0 })
  })

  it('has no plaintext key column and only ciphertext-envelope metadata', async () => {
    await db.exec(UP)
    const { rows } = await db.query<{ attname: string }>(`SELECT attname FROM pg_attribute WHERE attrelid = 'public.provider_api_credentials'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`)
    expect(rows.map((r) => r.attname)).toEqual(['id', 'user_id', 'provider', 'ciphertext', 'key_id', 'format_version', 'secret_version', 'source', 'created_at', 'updated_at'])
  })

  it('anon and authenticated can do nothing with the table, in any form', async () => {
    await db.exec(UP)
    await db.exec(insertRow(A, 'openai'))
    for (const role of ['anon', 'authenticated'] as const) {
      for (const statement of [
        `SELECT * FROM public.provider_api_credentials`,
        `SELECT ciphertext FROM public.provider_api_credentials`,
        `SELECT count(*) FROM public.provider_api_credentials`,
        `SELECT id FROM public.provider_api_credentials WHERE user_id = '${A}'`,
        insertRow(A, 'gemini'),
        `UPDATE public.provider_api_credentials SET key_id = 'x'`,
        `DELETE FROM public.provider_api_credentials`,
        `TRUNCATE public.provider_api_credentials`,
      ]) {
        const outcome = await as(role, A, statement)
        expect(outcome.error, `${role}: ${statement}`).toMatch(/permission denied/i)
      }
    }
  })

  it('defence in depth: even if a browser role were granted SELECT later, RLS with no policy shows no row', async () => {
    await db.exec(UP)
    await db.exec(insertRow(A, 'openai'))
    await db.exec(`GRANT SELECT ON public.provider_api_credentials TO authenticated`)
    expect((await as('authenticated', A, `SELECT ciphertext FROM public.provider_api_credentials`)).rows).toEqual([])
  })

  it('service_role can create, read, replace and delete rows (RLS bypass) but cannot truncate or alter', async () => {
    await db.exec(UP)
    expect((await as('service_role', null, insertRow(A, 'openai'))).error).toBeNull()
    expect((await as('service_role', null, `SELECT provider, key_id FROM public.provider_api_credentials`)).rows).toEqual([{ provider: 'openai', key_id: 'byok1' }])
    expect((await as('service_role', null, `UPDATE public.provider_api_credentials SET secret_version = 2, key_id = 'byok2'`)).error).toBeNull()
    expect((await as('service_role', null, `DELETE FROM public.provider_api_credentials WHERE user_id = '${A}'`)).error).toBeNull()
    expect((await as('service_role', null, `TRUNCATE public.provider_api_credentials`)).error).toMatch(/permission denied/i)
  })

  it('constraints: one row per owner and provider, only the four providers, version and source checks, cascade on user delete', async () => {
    await db.exec(UP)
    await db.exec(insertRow(A, 'openai'))
    await expect(db.exec(insertRow(A, 'openai'))).rejects.toThrow(/unique|duplicate/i)
    await expect(db.exec(insertRow(A, 'replicate'))).rejects.toThrow(/check/i)
    await expect(db.exec(insertRow(A, 'bogus'))).rejects.toThrow(/check/i)
    await expect(db.exec(`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id, secret_version) VALUES ('${B}', 'kling', '${TOKEN}', 'k', 0)`)).rejects.toThrow(/check/i)
    await expect(db.exec(`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id, source) VALUES ('${B}', 'kling', '${TOKEN}', 'k', 'plaintext')`)).rejects.toThrow(/check/i)
    await expect(db.exec(`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES ('${B}', 'kling', '', 'k')`)).rejects.toThrow(/check/i)
    await expect(db.exec(`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id) VALUES ('99999999-9999-4999-8999-999999999999', 'kling', '${TOKEN}', 'k')`)).rejects.toThrow(/foreign key/i)
    await db.exec(`DELETE FROM auth.users WHERE id = '${A}'`)
    expect((await db.query(`SELECT 1 FROM public.provider_api_credentials`)).rows).toHaveLength(0)
  })

  it('defaults a new row to version 1, format 1, source user_entry', async () => {
    await db.exec(UP)
    await db.exec(insertRow(A, 'openai'))
    expect((await db.query<Record<string, any>>(`SELECT format_version, secret_version, source FROM public.provider_api_credentials`)).rows[0]).toEqual({ format_version: 1, secret_version: 1, source: 'user_entry' })
  })
})

describe('transaction safety: no committed browser-readable intermediate state', () => {
  it('a failure after CREATE TABLE leaves no table at all', async () => {
    const broken = UP.replace('COMMENT ON TABLE public.provider_api_credentials IS', 'SELECT 1/0;\nCOMMENT ON TABLE public.provider_api_credentials IS')
    expect(broken).not.toBe(UP)
    await expect(db.exec(broken)).rejects.toThrow(/division by zero/)
    await db.exec('ROLLBACK')
    expect(await tableExists()).toBe(false)
  })

  it('a failing in-transaction verification (a leaked grant) rolls the whole migration back, table included', async () => {
    const leaky = UP.replace("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_api_credentials TO service_role;", "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_api_credentials TO service_role;\nGRANT SELECT ON TABLE public.provider_api_credentials TO authenticated;")
    expect(leaky).not.toBe(UP)
    await expect(db.exec(leaky)).rejects.toThrow(/authenticated still holds a privilege/)
    await db.exec('ROLLBACK')
    expect(await tableExists()).toBe(false)
  })

  it('a policy added by mistake is rejected by the verification', async () => {
    const withPolicy = UP.replace('ALTER TABLE public.provider_api_credentials ENABLE ROW LEVEL SECURITY;', "ALTER TABLE public.provider_api_credentials ENABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON public.provider_api_credentials FOR SELECT USING (true);")
    await expect(db.exec(withPolicy)).rejects.toThrow(/unexpected RLS policy/)
    await db.exec('ROLLBACK')
    expect(await tableExists()).toBe(false)
  })

  it('refuses to run twice', async () => {
    await db.exec(UP)
    await expect(db.exec(UP)).rejects.toThrow(/already exists/)
    await db.exec('ROLLBACK')
    expect(await aclText()).toBe('postgres=arwdDxtm/postgres,service_role=arwd/postgres')
  })

  it('requires auth.users', async () => {
    await db.exec('DROP TABLE auth.users')
    await expect(db.exec(UP)).rejects.toThrow(/auth.users not found/)
    await db.exec('ROLLBACK')
  })
})

describe('rollback', () => {
  it('drops an empty table', async () => {
    await db.exec(UP)
    await db.exec(DOWN)
    expect(await tableExists()).toBe(false)
  })

  it('refuses to drop a table that holds encrypted credentials (data-loss guard) and changes nothing', async () => {
    await db.exec(UP)
    await db.exec(insertRow(A, 'openai'))
    await expect(db.exec(DOWN)).rejects.toThrow(/refusing to drop a table that still holds 1 encrypted credential/)
    await db.exec('ROLLBACK')
    expect(await tableExists()).toBe(true)
    expect((await db.query(`SELECT 1 FROM public.provider_api_credentials`)).rows).toHaveLength(1)
  })

  it('up -> down -> up round-trips', async () => {
    await db.exec(UP)
    await db.exec(DOWN)
    await db.exec(UP)
    expect(await aclText()).toBe('postgres=arwdDxtm/postgres,service_role=arwd/postgres')
  })

  it('refuses when the table is absent', async () => {
    await expect(db.exec(DOWN)).rejects.toThrow(/does not exist/)
    await db.exec('ROLLBACK')
  })
})
