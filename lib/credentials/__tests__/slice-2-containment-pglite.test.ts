import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_2 — proof of the PROPOSED containment migration in an isolated
// in-process PostgreSQL (PGlite 18 / production is 17.6). It runs the exact SQL files in
// docs/productization/sql/ against a table reconstructed from the production catalog (columns, defaults, constraints,
// RLS policies and the pre-migration ACL), switching roles with SET ROLE and emulating `auth.uid()` from a JWT claim.
//
// What this does NOT prove: Supabase's PostgREST, GoTrue JWT handling, the Supabase role bootstrap, event triggers or
// schema-cache behaviour. PostgREST statements are reproduced by shape (json_populate_recordset upsert, explicit column
// lists, `*` expansion), not executed by PostgREST. A Supabase-compatible staging run is still required (design doc).
// Dummy values only; nothing here touches a real database or credential.

// Each test boots its own in-process PostgreSQL (~2-5 s); the default 5 s per-test limit is too tight under load.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const sql = (name: string) => readFileSync(join(process.cwd(), 'docs/productization/sql', name), 'utf8')
const UP = sql('FUTURE_059_SLICE_2_containment.up.sql')
const DOWN = sql('FUTURE_059_SLICE_2_containment.down.sql')

const SECRET = ['openai_api_key', 'gemini_api_key', 'nanobanana_api_key', 'kling_api_key', 'replicate_api_key'] as const
const PREFS = ['theme', 'studio_intensity', 'auto_mode_default', 'save_prompt_history', 'notifications_email', 'notifications_browser', 'automation_enabled', 'default_image_model', 'image_evaluator_enabled', 'max_refinement_iterations'] as const
export const SELECT_ALLOWLIST = ['id', 'user_id', ...PREFS, 'nanobanana_base_url', 'nanobanana_model', 'created_at', 'updated_at'] as const
export const WRITE_ALLOWLIST = ['user_id', ...PREFS] as const

// Production relacl, sorted (aclitem order depends on grant history; the privileges are what matter).
const ORIGINAL_ACL = 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const KEY_A = 'sk-DUMMY-owner-a-0000'
const KEY_B = 'sk-DUMMY-owner-b-1111'

const SCHEMA = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE TABLE public.user_settings (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    theme text DEFAULT 'dark',
    auto_mode_default boolean DEFAULT true,
    save_prompt_history boolean DEFAULT true,
    notifications_email boolean DEFAULT true,
    notifications_browser boolean DEFAULT false,
    openai_api_key text,
    replicate_api_key text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    nanobanana_api_key text,
    nanobanana_base_url text DEFAULT 'https://api.nanobanana.ai',
    automation_enabled boolean DEFAULT false,
    nanobanana_model text DEFAULT 'v1',
    default_image_model varchar(20) DEFAULT 'openai',
    image_evaluator_enabled boolean DEFAULT false,
    max_refinement_iterations integer DEFAULT 2,
    studio_intensity text NOT NULL DEFAULT 'balanced',
    kling_api_key text,
    gemini_api_key text,
    CONSTRAINT user_settings_user_id_key UNIQUE (user_id),
    CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT user_settings_theme_check CHECK (theme = ANY (ARRAY['light','dark','system','studio'])),
    CONSTRAINT user_settings_studio_intensity_check CHECK (studio_intensity = ANY (ARRAY['soft','balanced','expressive']))
  );
  ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
  CREATE POLICY user_settings_select_own ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY user_settings_insert_own ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
  CREATE POLICY user_settings_update_own ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
  CREATE POLICY user_settings_delete_own ON public.user_settings FOR DELETE USING (auth.uid() = user_id);
  GRANT ALL ON TABLE public.user_settings TO anon, authenticated, service_role;
  INSERT INTO auth.users (id) VALUES ('${A}'), ('${B}');
  INSERT INTO public.user_settings (user_id, theme, openai_api_key, gemini_api_key, kling_api_key)
    VALUES ('${A}', 'dark', '${KEY_A}', 'gemini-DUMMY-a', 'kling-DUMMY-a'),
           ('${B}', 'light', '${KEY_B}', NULL, NULL);
`

let db: PGlite

type Outcome = { rows: Record<string, any>[]; error: string | null }
async function as(role: 'anon' | 'authenticated' | 'service_role', sub: string | null, statement: string, params: unknown[] = []): Promise<Outcome> {
  await db.exec(`SET ROLE ${role}`)
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ''])
    const result = await db.query<Record<string, any>>(statement, params)
    return { rows: result.rows, error: null }
  } catch (error) {
    return { rows: [], error: String((error as Error).message) }
  } finally {
    await db.exec('RESET ROLE')
  }
}
const superuser = async (statement: string, params: unknown[] = []) => (await db.query<Record<string, any>>(statement, params)).rows

/** The statement PostgREST generates for supabase-js `.upsert(row, { onConflict: 'user_id' })` (Prefer: return=minimal). */
function pgrstUpsert(columns: string[]) {
  const quoted = columns.map((c) => `"${c}"`).join(', ')
  return `INSERT INTO "public"."user_settings" (${quoted})
    SELECT ${columns.map((c) => `"pgrst_body"."${c}"`).join(', ')}
    FROM (SELECT $1::json AS json_data) pgrst_payload,
         LATERAL (SELECT ${quoted} FROM json_populate_recordset(null::"public"."user_settings", pgrst_payload.json_data)) pgrst_body
    ON CONFLICT ("user_id") DO UPDATE SET ${columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`
}

const settingsPayload = (userId: string, theme = 'studio') => ({
  user_id: userId, theme, studio_intensity: 'expressive', auto_mode_default: false, save_prompt_history: true,
  notifications_email: false, notifications_browser: true, automation_enabled: true, default_image_model: 'gpt-image-2',
  image_evaluator_enabled: false, max_refinement_iterations: 3,
})

async function applyUp() { await db.exec(UP) }
const aclText = async () => (await superuser(`SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) AS acl FROM pg_class WHERE oid = 'public.user_settings'::regclass`))[0].acl as string
const columnAclCount = async () => Number((await superuser(`SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attnum > 0 AND attacl IS NOT NULL`))[0].n)
const denied = (outcome: Outcome) => { expect(outcome.error).toMatch(/permission denied/i); expect(outcome.rows).toEqual([]) }

beforeEach(async () => {
  db = new PGlite()
  await db.exec(SCHEMA)
})
afterEach(async () => { await db.close() })

describe('baseline reproduces the verified production exposure (before the migration)', () => {
  it('has the production pre-migration ACL and no column ACLs', async () => {
    expect(await aclText()).toBe(ORIGINAL_ACL)
    expect(await columnAclCount()).toBe(0)
  })

  it('the owner JWT can SELECT its own provider-key columns; RLS hides other rows; anon holds the privilege but sees no row', async () => {
    const own = await as('authenticated', A, `SELECT ${SECRET.join(', ')} FROM public.user_settings`)
    expect(own.error).toBeNull()
    expect(own.rows).toHaveLength(1)
    expect(own.rows[0].openai_api_key).toBe(KEY_A)
    expect((await as('authenticated', A, `SELECT openai_api_key FROM public.user_settings WHERE user_id = $1`, [B])).rows).toEqual([])
    expect((await as('anon', null, `SELECT openai_api_key FROM public.user_settings`)).rows).toEqual([])
    expect(await superuser(`SELECT has_column_privilege('anon', 'public.user_settings', 'openai_api_key', 'SELECT') AS ok`)).toEqual([{ ok: true }])
  })

  it('REVOKE on a single secret column does NOT help while the table-wide grant exists', async () => {
    await db.exec(`REVOKE SELECT (openai_api_key) ON public.user_settings FROM authenticated`)
    const attempt = await as('authenticated', A, `SELECT openai_api_key FROM public.user_settings`)
    expect(attempt.error).toBeNull()
    expect(attempt.rows[0].openai_api_key).toBe(KEY_A)
  })
})

describe('after the forward migration', () => {
  beforeEach(applyUp)

  it('privilege matrix: no browser role holds any privilege on a provider-key column; service_role keeps all', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const column of SECRET) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
          const [{ ok }] = await superuser(`SELECT has_column_privilege($1, 'public.user_settings', $2, $3) AS ok`, [role, column, priv])
          expect(ok, `${role} ${priv} ${column}`).toBe(false)
        }
      }
    }
    for (const column of SECRET) for (const priv of ['SELECT', 'INSERT', 'UPDATE']) {
      const [{ ok }] = await superuser(`SELECT has_column_privilege('service_role', 'public.user_settings', $1, $2) AS ok`, [column, priv])
      expect(ok).toBe(true)
    }
    const acl = await aclText()
    expect(acl).toContain('service_role=arwdDxtm/postgres')
    expect(acl).toContain('postgres=arwdDxtm/postgres')
    expect(acl).not.toContain('anon=')
    expect(acl).toMatch(/authenticated=d\/postgres/) // table-level: DELETE only
  })

  it('the owner reads every non-secret column of its own row and only its own row', async () => {
    const own = await as('authenticated', A, `SELECT ${SELECT_ALLOWLIST.join(', ')} FROM public.user_settings`)
    expect(own.error).toBeNull()
    expect(own.rows).toHaveLength(1)
    expect(own.rows[0].user_id).toBe(A)
    expect((await as('authenticated', A, `SELECT theme FROM public.user_settings WHERE user_id = $1`, [B])).rows).toEqual([])
  })

  it('every way of reaching a key value is denied to the owner (select, star, whole row, predicate, order, returning, aggregate)', async () => {
    const attempts = [
      `SELECT openai_api_key FROM public.user_settings`,
      `SELECT gemini_api_key, kling_api_key FROM public.user_settings`,
      `SELECT * FROM public.user_settings`,
      `SELECT user_settings.* FROM public.user_settings`,
      `SELECT to_jsonb(user_settings) FROM public.user_settings`,
      `SELECT user_settings::text FROM public.user_settings`,
      `SELECT row_to_json(u) FROM public.user_settings u`,
      `SELECT user_id FROM public.user_settings WHERE openai_api_key LIKE 'sk-%'`,
      `SELECT user_id FROM public.user_settings ORDER BY nanobanana_api_key`,
      `SELECT count(*) FROM public.user_settings WHERE replicate_api_key IS NOT NULL`,
      `SELECT length(openai_api_key) FROM public.user_settings`,
      `UPDATE public.user_settings SET theme = 'dark' WHERE user_id = '${A}' RETURNING openai_api_key`,
      `UPDATE public.user_settings SET theme = 'dark' WHERE gemini_api_key IS NOT NULL`,
    ]
    for (const statement of attempts) {
      const outcome = await as('authenticated', A, statement)
      expect(outcome.error, statement).toMatch(/permission denied/i)
      expect(JSON.stringify(outcome.rows), statement).not.toContain('DUMMY')
    }
  })

  it('direct writes to a key column are denied for insert, update and upsert, including smuggled alongside preferences', async () => {
    const attempts = [
      `UPDATE public.user_settings SET openai_api_key = 'sk-DUMMY-attacker' WHERE user_id = '${A}'`,
      `UPDATE public.user_settings SET theme = 'dark', gemini_api_key = NULL WHERE user_id = '${A}'`,
      `INSERT INTO public.user_settings (user_id, openai_api_key) VALUES ('${A}', 'sk-DUMMY-attacker')`,
      `INSERT INTO public.user_settings (user_id, theme) VALUES ('${A}', 'dark') ON CONFLICT (user_id) DO UPDATE SET kling_api_key = 'sk-DUMMY-attacker'`,
    ]
    for (const statement of attempts) expect((await as('authenticated', A, statement)).error, statement).toMatch(/permission denied/i)
    const upsert = await as('authenticated', A, pgrstUpsert(['user_id', 'theme', 'openai_api_key']), [JSON.stringify([{ ...settingsPayload(A), openai_api_key: 'sk-DUMMY-attacker' }])])
    expect(upsert.error).toMatch(/permission denied/i)
    expect((await superuser(`SELECT openai_api_key FROM public.user_settings WHERE user_id = $1`, [A]))[0].openai_api_key).toBe(KEY_A)
  })

  it('server-managed columns are not browser-writable (base URL, timestamps, id)', async () => {
    for (const statement of [
      `UPDATE public.user_settings SET nanobanana_base_url = 'https://attacker.example' WHERE user_id = '${A}'`,
      `UPDATE public.user_settings SET nanobanana_model = 'x' WHERE user_id = '${A}'`,
      `UPDATE public.user_settings SET updated_at = now() WHERE user_id = '${A}'`,
      `UPDATE public.user_settings SET id = gen_random_uuid() WHERE user_id = '${A}'`,
    ]) expect((await as('authenticated', A, statement)).error, statement).toMatch(/permission denied/i)
  })

  it('anon is denied everything, including user_id and star', async () => {
    for (const statement of [
      `SELECT user_id FROM public.user_settings`,
      `SELECT * FROM public.user_settings`,
      `SELECT theme FROM public.user_settings`,
      `INSERT INTO public.user_settings (user_id, theme) VALUES ('${A}', 'dark')`,
      `UPDATE public.user_settings SET theme = 'dark'`,
      `DELETE FROM public.user_settings`,
    ]) expect((await as('anon', null, statement)).error, statement).toMatch(/permission denied/i)
  })

  it('the Settings page PostgREST upsert (insert path and conflict-update path) keeps working and leaves the keys untouched', async () => {
    const columns = Object.keys(settingsPayload(A))
    const update = await as('authenticated', A, pgrstUpsert(columns), [JSON.stringify([settingsPayload(A, 'studio')])])
    expect(update.error).toBeNull()
    const row = (await superuser(`SELECT theme, studio_intensity, max_refinement_iterations, openai_api_key, gemini_api_key, kling_api_key FROM public.user_settings WHERE user_id = $1`, [A]))[0]
    expect(row).toMatchObject({ theme: 'studio', studio_intensity: 'expressive', max_refinement_iterations: 3, openai_api_key: KEY_A, gemini_api_key: 'gemini-DUMMY-a', kling_api_key: 'kling-DUMMY-a' })

    await superuser(`DELETE FROM public.user_settings WHERE user_id = $1`, [B])
    const insert = await as('authenticated', B, pgrstUpsert(columns), [JSON.stringify([settingsPayload(B, 'light')])])
    expect(insert.error).toBeNull()
    expect((await superuser(`SELECT theme, openai_api_key FROM public.user_settings WHERE user_id = $1`, [B]))[0]).toEqual({ theme: 'light', openai_api_key: null })
  })

  it('RLS still binds the writes: no upsert or update for another user, user_id cannot be re-pointed', async () => {
    const columns = Object.keys(settingsPayload(A))
    expect((await as('authenticated', A, pgrstUpsert(columns), [JSON.stringify([settingsPayload(B, 'dark')])])).error).not.toBeNull()
    expect((await as('authenticated', A, `UPDATE public.user_settings SET user_id = '${B}' WHERE user_id = '${A}'`)).error).not.toBeNull()
    expect((await as('authenticated', A, `UPDATE public.user_settings SET theme = 'system' WHERE user_id = '${B}'`)).rows).toEqual([])
    expect((await superuser(`SELECT theme FROM public.user_settings WHERE user_id = $1`, [B]))[0].theme).toBe('light')
  })

  it('own-row DELETE is unchanged and cannot touch another user', async () => {
    expect((await as('authenticated', B, `DELETE FROM public.user_settings WHERE user_id = '${A}'`)).error).toBeNull()
    expect(await superuser(`SELECT 1 FROM public.user_settings WHERE user_id = $1`, [A])).toHaveLength(1)
    expect((await as('authenticated', B, `DELETE FROM public.user_settings WHERE user_id = '${B}'`)).error).toBeNull()
    expect(await superuser(`SELECT 1 FROM public.user_settings WHERE user_id = $1`, [B])).toHaveLength(0)
  })

  it('the Slice 1 server path still works through service_role: proof read, single-column read, status read, key write and removal, base URL', async () => {
    expect((await as('service_role', null, `SELECT user_id FROM public.user_settings WHERE user_id = $1`, [A])).rows).toEqual([{ user_id: A }])
    expect((await as('service_role', null, `SELECT openai_api_key FROM public.user_settings WHERE user_id = $1`, [A])).rows).toEqual([{ openai_api_key: KEY_A }])
    const statuses = await as('service_role', null, `SELECT ${SECRET.join(', ')} FROM public.user_settings WHERE user_id = $1`, [A])
    expect(statuses.error).toBeNull()
    const write = await as('service_role', null, pgrstUpsert(['user_id', 'gemini_api_key', 'nanobanana_base_url']), [JSON.stringify([{ user_id: A, gemini_api_key: 'gemini-DUMMY-new', nanobanana_base_url: 'https://nb.example.test' }])])
    expect(write.error).toBeNull()
    expect((await as('service_role', null, `UPDATE public.user_settings SET kling_api_key = NULL WHERE user_id = $1`, [A])).error).toBeNull()
    const after = (await superuser(`SELECT gemini_api_key, kling_api_key, nanobanana_base_url FROM public.user_settings WHERE user_id = $1`, [A]))[0]
    expect(after).toEqual({ gemini_api_key: 'gemini-DUMMY-new', kling_api_key: null, nanobanana_base_url: 'https://nb.example.test' })
    expect((await as('service_role', null, `SELECT * FROM public.user_settings`)).rows).toHaveLength(2) // bypasses RLS, as designed
  })

  it('a column added later is secure by default: invisible to the browser until explicitly granted', async () => {
    await db.exec(`ALTER TABLE public.user_settings ADD COLUMN future_secret text; UPDATE public.user_settings SET future_secret = 'DUMMY-future'`)
    denied(await as('authenticated', A, `SELECT future_secret FROM public.user_settings`))
    denied(await as('authenticated', A, `SELECT * FROM public.user_settings`))
    expect((await as('service_role', null, `SELECT future_secret FROM public.user_settings WHERE user_id = $1`, [A])).rows).toEqual([{ future_secret: 'DUMMY-future' }])
  })

  it('re-running the forward migration is rejected by its precondition and changes nothing', async () => {
    const before = await aclText()
    await expect(applyUp()).rejects.toThrow(/not the reviewed pre-migration state|already exist/)
    await db.exec('ROLLBACK')
    expect(await aclText()).toBe(before)
  })
})

describe('forward migration guards and atomicity', () => {
  it('aborts and changes nothing when the column set drifted', async () => {
    await db.exec(`ALTER TABLE public.user_settings ADD COLUMN surprise text`)
    await expect(applyUp()).rejects.toThrow(/columns changed/)
    await db.exec('ROLLBACK')
    expect(await aclText()).toBe(ORIGINAL_ACL)
  })

  it('aborts and changes nothing when the ACL differs from the reviewed state', async () => {
    await db.exec(`REVOKE TRUNCATE ON public.user_settings FROM anon`)
    await expect(applyUp()).rejects.toThrow(/not the reviewed pre-migration state/)
    await db.exec('ROLLBACK')
    expect(await columnAclCount()).toBe(0)
  })

  it('rolls everything back if the in-transaction verification fails', async () => {
    const poisoned = UP.replace('-- 4. Verify the result', `GRANT SELECT (openai_api_key) ON TABLE public.user_settings TO authenticated;\n-- 4. Verify the result`)
    expect(poisoned).not.toBe(UP)
    await expect(db.exec(poisoned)).rejects.toThrow(/still holds SELECT on openai_api_key/)
    await db.exec('ROLLBACK')
    expect(await aclText()).toBe(ORIGINAL_ACL)
    expect(await columnAclCount()).toBe(0)
  })
})

describe('rollback', () => {
  it('restores exactly the original ACL, and the documented tradeoff is real: the owner can read its keys again', async () => {
    await applyUp()
    denied(await as('authenticated', A, `SELECT openai_api_key FROM public.user_settings`))
    await db.exec(DOWN)
    expect(await aclText()).toBe(ORIGINAL_ACL)
    expect(await columnAclCount()).toBe(0)
    const again = await as('authenticated', A, `SELECT openai_api_key FROM public.user_settings`)
    expect(again.rows[0].openai_api_key).toBe(KEY_A)
  })

  it('up -> down -> up round-trips', async () => {
    await applyUp()
    await db.exec(DOWN)
    await applyUp()
    denied(await as('authenticated', A, `SELECT gemini_api_key FROM public.user_settings`))
  })

  it('the targeted alternative grants one non-secret column without re-exposing any key', async () => {
    await applyUp()
    await db.exec(`ALTER TABLE public.user_settings ADD COLUMN ui_density text DEFAULT 'normal'`)
    denied(await as('authenticated', A, `SELECT ui_density FROM public.user_settings`))
    await db.exec(`GRANT SELECT (ui_density) ON TABLE public.user_settings TO authenticated`)
    expect((await as('authenticated', A, `SELECT ui_density FROM public.user_settings`)).rows).toEqual([{ ui_density: 'normal' }])
    denied(await as('authenticated', A, `SELECT openai_api_key FROM public.user_settings`))
  })
})

describe('minimality of the write grant (documents what the privilege set actually has to include)', () => {
  it('the conflict-update upsert needs UPDATE on user_id too (PostgREST sets every supplied column, the key included)', async () => {
    await db.exec(UP.replace(/GRANT UPDATE \(\s*user_id,/, 'GRANT UPDATE ('))
    const columns = Object.keys(settingsPayload(A))
    const outcome = await as('authenticated', A, pgrstUpsert(columns), [JSON.stringify([settingsPayload(A)])])
    expect(outcome.error).toMatch(/permission denied/i)
  })
})

describe('allowlists match the real schema and the real application code', () => {
  const ROOT = process.cwd()
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.next', '.git', 'docs', 'public'].includes(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !full.includes('__tests__')) out.push(full)
    }
    return out
  }
  const rel = (file: string) => file.slice(ROOT.length + 1).split(String.fromCharCode(92)).join('/')
  const sources = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'components'))].map((file) => ({ path: rel(file), text: readFileSync(file, 'utf8') }))
  const consumers = sources.filter((file) => /from\(\s*['"]user_settings['"]\s*\)/.test(file.text))

  it('the allowlists plus the secret list cover exactly the 21 production columns, with no overlap', () => {
    const all = [...SELECT_ALLOWLIST, ...SECRET]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(21)
    for (const column of WRITE_ALLOWLIST) expect(SELECT_ALLOWLIST as readonly string[]).toContain(column)
    for (const column of SECRET) expect(WRITE_ALLOWLIST as readonly string[]).not.toContain(column)
  })

  it('the SQL file grants exactly these allowlists', () => {
    const list = (keyword: string) => {
      const match = new RegExp(`GRANT ${keyword} \\(([^)]*)\\)`).exec(UP)
      return match![1].split(',').map((c) => c.trim()).filter(Boolean).sort()
    }
    expect(list('SELECT')).toEqual([...SELECT_ALLOWLIST].sort())
    expect(list('INSERT')).toEqual([...WRITE_ALLOWLIST].sort())
    expect(list('UPDATE')).toEqual([...WRITE_ALLOWLIST].sort())
  })

  it('the only code that touches user_settings is the known set (a new consumer must be reviewed against this migration)', () => {
    expect(consumers.map((file) => file.path).sort()).toEqual([
      'app/(dashboard)/configuracoes/page.tsx',
      'app/(dashboard)/imagens/page.tsx',
      'app/api/settings/providers/route.ts',
      'components/theme-preference-bootstrap.tsx',
      'lib/credentials/api-credential-store.ts',
    ])
  })

  it('every session/browser-client read selects only granted columns and never a wildcard', () => {
    for (const file of consumers.filter((f) => f.path !== 'lib/credentials/api-credential-store.ts')) {
      const selects = [...file.text.matchAll(/from\(\s*['"]user_settings['"]\s*\)\s*\.(?:select|upsert)/g)]
      expect(selects.length, file.path).toBeGreaterThan(0)
      for (const match of file.text.matchAll(/from\(\s*['"]user_settings['"]\s*\)\s*\.select\(\s*['"]([^'"]*)['"]/g)) {
        expect(match[1], file.path).not.toContain('*')
        for (const column of match[1].split(',').map((c) => c.trim())) expect(SELECT_ALLOWLIST as readonly string[], `${file.path}: ${column}`).toContain(column)
      }
    }
  })

  it('every browser upsert writes only granted columns and no provider key', () => {
    const page = sources.find((file) => file.path === 'app/(dashboard)/configuracoes/page.tsx')!
    const block = /from\(\s*['"]user_settings['"]\s*\)\s*\.upsert\(\{([\s\S]*?)\}\s*,\s*\{/.exec(page.text)
    expect(block).not.toBeNull()
    const keys = [...block![1].matchAll(/^\s*([a-z_]+)\s*[:,]/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThanOrEqual(11)
    for (const key of keys) expect(WRITE_ALLOWLIST as readonly string[], key).toContain(key)
    expect([...WRITE_ALLOWLIST].sort()).toEqual([...new Set(keys)].sort())
  })

  it('the browser never writes user_settings anywhere else, and never relies on RETURNING', () => {
    for (const file of consumers) {
      if (file.path === 'lib/credentials/api-credential-store.ts') continue
      const upserts = file.text.match(/\.upsert\(/g) ?? []
      expect(upserts.length === 0 || file.path === 'app/(dashboard)/configuracoes/page.tsx', file.path).toBe(true)
      expect(file.text, file.path).not.toMatch(/from\(\s*['"]user_settings['"]\s*\)[\s\S]{0,400}\.(update|insert|delete)\(/)
    }
    const page = sources.find((file) => file.path === 'app/(dashboard)/configuracoes/page.tsx')!
    expect(/\.upsert\(\{[\s\S]*?\}\s*,\s*\{\s*onConflict:\s*'user_id'\s*\}\s*\)\s*\.select/.test(page.text)).toBe(false)
  })
})
