import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059 Slice 3B — the PROPOSED (not applied) atomic backfill function, in an isolated in-process PostgreSQL. This checks
// the function's decisions, privileges and migration guards. It CANNOT check row-lock behaviour between concurrent
// transactions (PGlite has one connection); that is proven against a real PostgreSQL by the opt-in local-stack suite
// (slice-3b-local-postgrest.integration.test.ts). Dummy data only.

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const sql = (name: string) => readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8')
const TABLE_UP = sql('FUTURE_059_SLICE_3_provider_api_credentials.up.sql')
const UP = sql('FUTURE_059_SLICE_3B_backfill_function.up.sql')
const DOWN = sql('FUTURE_059_SLICE_3B_backfill_function.down.sql')

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'v1.byok1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA'
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const FN = 'public.backfill_provider_api_credential'

const FIXTURE = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.user_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    theme text DEFAULT 'dark',
    openai_api_key text, gemini_api_key text, nanobanana_api_key text, kling_api_key text, replicate_api_key text
  );
  INSERT INTO auth.users (id) VALUES ('${A}'), ('${B}');
`

let db: PGlite
type Outcome = { rows: Record<string, any>[]; error: string | null }
async function as(role: 'anon' | 'authenticated' | 'service_role', statement: string, params: unknown[] = []): Promise<Outcome> {
  await db.exec(`SET ROLE ${role}`)
  try {
    return { rows: (await db.query<Record<string, any>>(statement, params)).rows, error: null }
  } catch (error) {
    return { rows: [], error: String((error as Error).message) }
  } finally {
    await db.exec('RESET ROLE')
  }
}
const call = (role: 'anon' | 'authenticated' | 'service_role', user: string, provider: string, legacy: string, ciphertext = TOKEN) =>
  as(role, `SELECT ${FN}($1::uuid, $2, $3, $4, 'byok1', 1::smallint) AS outcome`, [user, provider, sha(legacy), ciphertext])
const outcomeOf = async (user: string, provider: string, legacy: string, ciphertext?: string) => (await call('service_role', user, provider, legacy, ciphertext)).rows[0]?.outcome as string | undefined
const rows = async () => (await db.query<Record<string, any>>(`SELECT user_id, provider, ciphertext, key_id, format_version, secret_version, source FROM public.provider_api_credentials ORDER BY provider`)).rows
const fnExists = async () => (await db.query<{ r: string | null }>(`SELECT to_regprocedure('${FN}(uuid,text,text,text,text,smallint)')::text AS r`)).rows[0].r !== null

beforeEach(async () => {
  db = new PGlite()
  await db.exec(FIXTURE)
  await db.exec(TABLE_UP)
  await db.exec(`INSERT INTO public.user_settings (user_id, openai_api_key, gemini_api_key, nanobanana_api_key, kling_api_key, replicate_api_key) VALUES ('${A}', 'sk-DUMMY-openai-ç-ü', 'gemini-DUMMY', 'nb-DUMMY', 'kling-DUMMY', 'rep-DUMMY'), ('${B}', NULL, NULL, NULL, NULL, NULL)`)
})
afterEach(async () => { await db.close() })

describe('the artifact', () => {
  it('is one transaction, kept under docs/, and says it is not applied', () => {
    expect(UP).toMatch(/^BEGIN;$/m)
    expect(UP.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(UP).toContain('PROPOSED, NOT APPLIED')
    expect(DOWN).toContain('PROPOSED, NOT APPLIED')
    expect(UP.indexOf('CREATE FUNCTION')).toBeLessThan(UP.indexOf('FROM anon'))
    expect(UP.indexOf('FROM authenticated')).toBeLessThan(UP.lastIndexOf('COMMIT;'))
  })
})

describe('privileges: only service_role can run it, and the lock-down is part of the same transaction', () => {
  it('without the REVOKE the project default privileges WOULD let a browser role call it (why the migration revokes in-transaction)', async () => {
    await db.exec(`CREATE FUNCTION public.unprotected_demo() RETURNS int LANGUAGE sql AS 'SELECT 1'`)
    expect((await as('anon', 'SELECT public.unprotected_demo() AS n')).rows).toEqual([{ n: 1 }])
  })

  it('after the migration anon and authenticated get "permission denied for function"; service_role runs it; it is SECURITY INVOKER', async () => {
    await db.exec(UP)
    for (const role of ['anon', 'authenticated'] as const) {
      const result = await call(role, A, 'openai', 'sk-DUMMY-openai-ç-ü')
      expect(result.error, role).toMatch(/permission denied for function/i)
    }
    expect(await rows()).toEqual([])
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('inserted')
    const { rows: meta } = await db.query<Record<string, any>>(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = '${FN}(uuid,text,text,text,text,smallint)'::regprocedure`)
    expect(meta[0].prosecdef).toBe(false)
    expect(meta[0].acl).toBe('{postgres=X/postgres,service_role=X/postgres}')
  })
})

describe('decisions', () => {
  beforeEach(async () => { await db.exec(UP) })

  it('inserts once, as a legacy_backfill row at version 1, and the SHA-256 matches Node for multi-byte values', async () => {
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('inserted')
    expect(await rows()).toEqual([{ user_id: A, provider: 'openai', ciphertext: TOKEN, key_id: 'byok1', format_version: 1, secret_version: 1, source: 'legacy_backfill' }])
  })

  it('never overwrites an existing encrypted row (user write or earlier migration), valid or not', async () => {
    await db.exec(`INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id, source) VALUES ('${A}', 'openai', 'v1.byok1.USER.ROW.CIPHERTEXT', 'byok1', 'user_entry')`)
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü', 'v1.byok1.MIGRATION.ROW.CIPHERTEXT')).toBe('exists')
    expect(await rows()).toEqual([expect.objectContaining({ ciphertext: 'v1.byok1.USER.ROW.CIPHERTEXT', source: 'user_entry' })])
  })

  it('is idempotent', async () => {
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('inserted')
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('exists')
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('exists')
    expect(await rows()).toHaveLength(1)
  })

  it('refuses a stale snapshot: changed, whitespace-padded, removed (NULL) or empty legacy values', async () => {
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-something-else')).toBe('legacy_changed')
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü ')).toBe('legacy_changed')
    await db.exec(`UPDATE public.user_settings SET openai_api_key = NULL WHERE user_id = '${A}'`) // the removal committed first
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('legacy_changed')
    await db.exec(`UPDATE public.user_settings SET openai_api_key = 'sk-DUMMY-replaced' WHERE user_id = '${A}'`) // the replacement committed first
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('legacy_changed')
    expect(await rows()).toEqual([])
  })

  it('reports a missing settings row and writes nothing', async () => {
    await db.exec(`DELETE FROM public.user_settings WHERE user_id = '${B}'`)
    expect(await outcomeOf(B, 'openai', 'whatever')).toBe('no_settings_row')
    expect(await rows()).toEqual([])
  })

  it('maps each provider to its own column (a hash from another provider never matches)', async () => {
    expect(await outcomeOf(A, 'gemini', 'sk-DUMMY-openai-ç-ü')).toBe('legacy_changed')
    expect(await outcomeOf(A, 'openai', 'gemini-DUMMY')).toBe('legacy_changed')
    for (const [provider, value] of [['openai', 'sk-DUMMY-openai-ç-ü'], ['gemini', 'gemini-DUMMY'], ['nano_banana', 'nb-DUMMY'], ['kling', 'kling-DUMMY']] as const) {
      expect(await outcomeOf(A, provider, value), provider).toBe('inserted')
    }
    expect((await rows()).map((r) => r.provider)).toEqual(['gemini', 'kling', 'nano_banana', 'openai'])
  })

  it('rejects Replicate, unknown providers and malformed hashes, and the failed call writes nothing', async () => {
    for (const [provider, hash] of [['replicate', sha('rep-DUMMY')], ['bogus', sha('x')], ['openai', 'not-a-hash'], ['openai', sha('x').toUpperCase()]] as const) {
      const result = await as('service_role', `SELECT ${FN}($1::uuid, $2, $3, $4, 'byok1', 1::smallint)`, [A, provider, hash, TOKEN])
      expect(result.error, `${provider}/${hash}`).toMatch(/unsupported provider|invalid expected hash/)
    }
    expect(await rows()).toEqual([])
  })

  it('a rolled-back transaction leaves nothing behind', async () => {
    await db.exec('BEGIN')
    await db.query(`SELECT ${FN}($1::uuid, 'openai', $2, $3, 'byok1', 1::smallint)`, [A, sha('sk-DUMMY-openai-ç-ü'), TOKEN])
    await db.exec('ROLLBACK')
    expect(await rows()).toEqual([])
  })
})

describe('migration guards', () => {
  it('requires the table migration first', async () => {
    const empty = new PGlite()
    await empty.exec(FIXTURE)
    await expect(empty.exec(UP)).rejects.toThrow(/apply FUTURE_059_SLICE_3_provider_api_credentials/)
    await empty.close()
  })

  it('refuses to run twice', async () => {
    await db.exec(UP)
    await expect(db.exec(UP)).rejects.toThrow(/already exists/)
    await db.exec('ROLLBACK')
    expect(await fnExists()).toBe(true)
  })

  it('a leaked EXECUTE grant fails the in-transaction verification and rolls the function back', async () => {
    const leaky = UP.replace('GRANT EXECUTE ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) TO service_role, authenticated;')
    expect(leaky).not.toBe(UP)
    await expect(db.exec(leaky)).rejects.toThrow(/a browser role can execute the backfill function/)
    await db.exec('ROLLBACK')
    expect(await fnExists()).toBe(false)
  })

  it('a function that is SECURITY DEFINER is rejected by the verification', async () => {
    const definer = UP.replace('SECURITY INVOKER', 'SECURITY DEFINER')
    await expect(db.exec(definer)).rejects.toThrow(/must be SECURITY INVOKER/)
    await db.exec('ROLLBACK')
    expect(await fnExists()).toBe(false)
  })

  it('rollback drops only the function: the table and its rows stay', async () => {
    await db.exec(UP)
    expect(await outcomeOf(A, 'openai', 'sk-DUMMY-openai-ç-ü')).toBe('inserted')
    await db.exec(DOWN)
    expect(await fnExists()).toBe(false)
    expect(await rows()).toHaveLength(1)
    await expect(db.exec(DOWN)).rejects.toThrow(/does not exist/)
    await db.exec('ROLLBACK')
  })

  it('up -> down -> up round-trips', async () => {
    await db.exec(UP)
    await db.exec(DOWN)
    await db.exec(UP)
    expect(await outcomeOf(A, 'kling', 'kling-DUMMY')).toBe('inserted')
  })
})
