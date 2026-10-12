import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'
import { extractGeminiUsage } from '@/lib/providers/gemini/usage'
import { geminiImageUsageEvents, type GeminiImageUsageContext } from '@/lib/usage/gemini-image-usage'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { deriveProviderUsageCost, type ProviderUsageCostInput } from '../derive'
import { toPricingVersion, type PricingVersion } from '../registry'
import {
  PROPOSED_SOLE_TIER_ASSUMPTION,
  PROPOSED_UNATTRIBUTED_REASON,
  costInputFromRow,
  deriveProviderUsageCostProposed,
  executionCostVerdict,
  summarizeEstimatedCostProposed,
  toPricingVersionProposed,
} from './image-pricing-prototype'

// FUTURE-064 Slice D — LOCAL PROOF of the reviewed SQL (docs/productization/sql) against a Production-shaped schema in PGlite
// (isolated, in-process; no Supabase, no key, no provider) and of the proposed cost derivation (test-only prototype).
// NOTHING here is applied anywhere: the SQL stays a proposal.

const SQL_DIR = join(process.cwd(), 'docs', 'productization', 'sql')
const UP = readFileSync(join(SQL_DIR, 'FUTURE_064_SLICE_D_image_output_pricing.up.sql'), 'utf8')
const DOWN = readFileSync(join(SQL_DIR, 'FUTURE_064_SLICE_D_image_output_pricing.down.sql'), 'utf8')
const code = (sql: string) => sql.replace(/--.*$/gm, '')

const V1 = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image']
const NB21 = 'gemini-nano-banana-2.1'
const LITE = 'gemini-3.1-flash-lite-image'

/** Production-shaped state: the LIVE registry is exactly what 061 + 062 create (22 rows, SELECT-only grants, RLS, overlap trigger). */
async function prodLike() {
  const db = new PGlite()
  await db.exec(STUBS)
  await db.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY)')
  await db.exec(script('044_create_provider_usage_events.sql'))
  await db.exec(script('061_create_provider_pricing_versions.sql'))
  await db.exec(script('062_seed_openai_gpt_4o_mini_pricing.sql'))
  return db
}

const one = async <T = Record<string, unknown>>(db: PGlite, sql: string) => (await db.query<T>(sql)).rows[0]
const count = async (db: PGlite, where = 'true') => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM provider_pricing_versions WHERE ${where}`)).n
const digest = async (db: PGlite, where = 'true') => (await one<{ d: string }>(db, `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS d FROM provider_pricing_versions t WHERE ${where}`)).d
const constraintDef = async (db: PGlite) => (await one<{ d: string }>(db, "SELECT regexp_replace(pg_get_constraintdef(oid), '\\s+', '', 'g') AS d FROM pg_constraint WHERE conname = 'provider_pricing_versions_usage_category_check'")).d
const NOT_V1 = `NOT (provider = 'gemini' AND model IN ('${NB21}', '${LITE}'))`
const insertRow = (o: Record<string, string> = {}) => {
  const row: Record<string, string> = {
    provider: "'gemini'", model: "'m-x'", usage_category: "'input'", service_tier: "'standard'", currency: "'USD'", unit_name: "'tokens'",
    unit_quantity: '1000000', price_amount: '1', effective_from: "'2026-11-01T00:00:00Z'", effective_to: 'NULL', effective_from_basis: "'observed_at_source'",
    source_url: "'https://example.test/p'", source_label: "'t'", retrieved_at: "'2026-10-12T00:00:00Z'", ...o,
  }
  return `INSERT INTO provider_pricing_versions (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`
}
const wire = (r: Record<string, unknown>) => ({
  ...r,
  effective_from: (r.effective_from as Date).toISOString(),
  effective_to: r.effective_to ? (r.effective_to as Date).toISOString() : null,
  retrieved_at: (r.retrieved_at as Date).toISOString(),
})
const loadRows = async (db: PGlite) => (await db.query<Record<string, unknown>>('SELECT * FROM provider_pricing_versions')).rows.map(wire)

describe('the reviewed SQL — shape and safety (static)', () => {
  const up = code(UP)
  const down = code(DOWN)

  it('both files are one transaction with a lock timeout, a guard and a verification, and run as the table owner', () => {
    for (const sql of [up, down]) {
      expect(sql).toMatch(/^\s*BEGIN;/)
      expect(sql).toMatch(/COMMIT;\s*$/)
      expect(sql).toMatch(/SET LOCAL lock_timeout = '5s'/)
      expect(sql).toMatch(/\$guard\$/)
      expect(sql).toMatch(/\$verify\$/)
      expect(sql).toMatch(/NOTIFY pgrst, 'reload schema'/)
    }
  })

  it('forward: only the category CHECK is altered and only six rows are inserted — no other DDL, no UPDATE/DELETE/TRUNCATE/DROP TABLE', () => {
    // string literals (e.g. the privilege names inside has_table_privilege) are not statements
    const ddl = up.replace(/'[^']*'/g, "''")
    expect(ddl).not.toMatch(/\bUPDATE\s+public|\bDELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|DROP\s+POLICY|CREATE\s+(POLICY|TRIGGER|FUNCTION|INDEX|TABLE\s+public)|\bGRANT\b|\bREVOKE\b|DISABLE\s+ROW|DROP\s+TRIGGER|ALTER\s+TABLE\s+(?!public\.provider_pricing_versions)/i)
    expect(up).not.toMatch(/provider_usage_events|user_settings|api_key|service_role\s*=|auth\.users/i)
    expect([...up.matchAll(/ALTER TABLE\s+(\S+)/gi)].map((m) => m[1])).toEqual(['public.provider_pricing_versions'])
    expect(up).toMatch(/DROP CONSTRAINT provider_pricing_versions_usage_category_check,\s*ADD CONSTRAINT provider_pricing_versions_usage_category_check/)
    expect([...up.matchAll(/INSERT INTO\s+(\S+)/gi)].map((m) => m[1])).toEqual(['public.provider_pricing_versions'])
    expect(up).toMatch(/ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING/)
  })

  it('forward seeds exactly the six approved Standard versions: the two V1 models, three dimensions, no other model, tier, batch or cache price', () => {
    const rows = [...up.matchAll(/\('gemini', '([^']+)', '([^']+)',\s+'([^']+)', 'USD', 'tokens', 1000000,\s+([0-9.]+),/g)].map((m) => [m[1], m[2], m[3], Number(m[4])])
    expect(rows).toEqual([
      [NB21, 'input', 'standard', 1.5], [NB21, 'output', 'standard', 7.5], [NB21, 'image_output', 'standard', 30],
      [LITE, 'input', 'standard', 0.25], [LITE, 'output', 'standard', 1.5], [LITE, 'image_output', 'standard', 30],
    ])
    expect(up.match(/'2026-10-12T00:00:00Z', 'observed_at_source', 'https:\/\/ai\.google\.dev\/gemini-api\/docs\/pricing'/g)).toHaveLength(6)
    expect(up).not.toMatch(/gemini-3-pro-image|gemini-3\.1-flash-image'|gemini-2\.5/)
    expect(up).not.toMatch(/'cached_input', 'standard'|'flex', 'USD'|'priority', 'USD'/)
    // the 1K figure is documented as information; it is not a price row
    expect(up).toMatch(/1K image = 1,120 tokens = \$0\.0336/)
  })

  it('rollback: deletes only the six seeded rows by exact key and narrows the constraint back; never drops history blindly', () => {
    expect(down).toMatch(/DELETE FROM public\.provider_pricing_versions\s+WHERE provider = 'gemini' AND model IN/)
    expect([...down.matchAll(/DELETE FROM/gi)]).toHaveLength(1)
    expect(down).not.toMatch(/TRUNCATE|DROP\s+TABLE|\bUPDATE\s+public|provider_usage_events/i)
    expect(down).toMatch(/Refusing to delete price history/)
    expect(down).toMatch(/CHECK \(usage_category IN \('input', 'cached_input', 'output', 'unit'\)\)/)
  })
})

describe('forward migration against a Production-shaped registry', () => {
  let db: PGlite
  let before: { total: number; digestAll: string; digestOther: string }

  beforeAll(async () => {
    db = await prodLike()
    before = { total: await count(db), digestAll: await digest(db), digestOther: await digest(db, NOT_V1) }
  }, 60_000)
  afterAll(async () => { await db?.close() })

  it('starts from the live shape: 22 rows (19 from 061, 3 from 062), original 4-category constraint, no V1 rows', async () => {
    expect(before.total).toBe(22)
    expect(await count(db, `provider = 'gemini' AND model IN ('${NB21}', '${LITE}')`)).toBe(0)
    expect(await constraintDef(db)).toBe("CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'unit'::text])))")
  })

  it('before the migration image_output is rejected by the database', async () => {
    await expect(db.exec(insertRow({ usage_category: "'image_output'" }))).rejects.toThrow(/provider_pricing_versions_usage_category_check|check constraint/i)
  })

  it('applies cleanly in one transaction', async () => {
    await db.exec(UP)
    expect(await count(db)).toBe(28)
  })

  it('preserves every existing category and price row byte for byte', async () => {
    expect(await digest(db, NOT_V1)).toBe(before.digestOther)
    expect(await count(db, NOT_V1)).toBe(22)
    const categories = (await db.query<{ c: string }>(`SELECT DISTINCT usage_category AS c FROM provider_pricing_versions WHERE ${NOT_V1} ORDER BY 1`)).rows.map((r) => r.c)
    expect(categories).toEqual(['cached_input', 'input', 'output', 'unit'])
  })

  it('accepts image_output, still rejects any other category, and the existing categories remain valid', async () => {
    expect(await constraintDef(db)).toBe("CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'image_output'::text,'unit'::text])))")
    for (const bad of ['bogus', 'image', 'IMAGE_OUTPUT', 'image_output ', 'output_image', 'thoughts', 'output_unattributed', '']) {
      await expect(db.exec(insertRow({ usage_category: `'${bad}'` })), bad).rejects.toThrow(/provider_pricing_versions_usage_category_check|check constraint/i)
    }
    await db.exec('BEGIN')
    for (const [index, category] of ['input', 'cached_input', 'output', 'unit', 'image_output'].entries()) {
      await db.exec(insertRow({ model: `'m-cat-${index}'`, usage_category: `'${category}'` }))
    }
    await db.exec('ROLLBACK')
  })

  it('seeds exactly the approved prices: Nano Banana 2.1 and Nano Banana 2 Lite, Standard, USD per 1M tokens', async () => {
    const rows = (await db.query<{ model: string; usage_category: string; price: string; tier: string; unit: string; qty: string; basis: string; url: string }>(
      `SELECT model, usage_category, price_amount::text AS price, service_tier AS tier, unit_name AS unit, unit_quantity::text AS qty, effective_from_basis AS basis, source_url AS url
         FROM provider_pricing_versions WHERE provider = 'gemini' AND model IN ('${NB21}', '${LITE}') ORDER BY model, usage_category`)).rows
    const simplified = rows.map((r) => [r.model, r.usage_category, Number(r.price)])
    expect(simplified).toEqual([
      [LITE, 'image_output', 30], [LITE, 'input', 0.25], [LITE, 'output', 1.5],
      [NB21, 'image_output', 30], [NB21, 'input', 1.5], [NB21, 'output', 7.5],
    ])
    for (const row of rows) {
      expect(row).toMatchObject({ tier: 'standard', unit: 'tokens', basis: 'observed_at_source', url: 'https://ai.google.dev/gemini-api/docs/pricing' })
      expect(Number(row.qty)).toBe(1_000_000)
    }
    const meta = await one<{ from: Date; retrieved: Date; currency: string }>(db, `SELECT effective_from AS "from", retrieved_at AS retrieved, currency FROM provider_pricing_versions WHERE model = '${NB21}' AND usage_category = 'image_output'`)
    expect(meta.from.toISOString()).toBe('2026-10-12T00:00:00.000Z')
    expect(meta.retrieved.toISOString()).toBe('2026-10-12T04:05:00.000Z')
    expect(meta.currency).toBe('USD')
    // no price for any model that was not approved, no cache price, no non-Standard tier for the V1 models
    expect(await count(db, "usage_category = 'image_output'")).toBe(2)
    expect(await count(db, `model IN ('${NB21}', '${LITE}') AND (service_tier <> 'standard' OR usage_category IN ('cached_input', 'unit'))`)).toBe(0)
    expect(await count(db, "model IN ('gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image')")).toBe(0)
  })

  it('1K image = 1,120 image-output tokens = USD 0.0336 for both models (30 x 1120 / 1e6)', () => {
    expect((30 * 1120) / 1_000_000).toBeCloseTo(0.0336, 10)
  })

  it('access model is unchanged: RLS on, one SELECT policy, authenticated/service_role read-only, anon nothing', async () => {
    expect((await one<{ r: boolean }>(db, "SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.provider_pricing_versions'::regclass")).r).toBe(true)
    expect((await db.query('SELECT policyname FROM pg_policies WHERE tablename = \'provider_pricing_versions\'')).rows).toEqual([{ policyname: 'provider_pricing_versions_select_authenticated' }])
    await db.exec('SET ROLE authenticated')
    try {
      expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM provider_pricing_versions')).n).toBe(28)
      await expect(db.exec(insertRow({ usage_category: "'image_output'" }))).rejects.toThrow(/permission denied/i)
      await expect(db.exec('UPDATE provider_pricing_versions SET price_amount = 0')).rejects.toThrow(/permission denied/i)
      await expect(db.exec('DELETE FROM provider_pricing_versions')).rejects.toThrow(/permission denied/i)
    } finally { await db.exec('RESET ROLE') }
    await db.exec('SET ROLE service_role')
    try { await expect(db.exec(insertRow({ usage_category: "'image_output'" }))).rejects.toThrow(/permission denied/i) } finally { await db.exec('RESET ROLE') }
    await db.exec('SET ROLE anon')
    try { await expect(db.query('SELECT 1 FROM provider_pricing_versions')).rejects.toThrow(/permission denied/i) } finally { await db.exec('RESET ROLE') }
  })

  it('version history rules still hold for image_output: no overlap, back-to-back successor accepted, historical row never overwritten', async () => {
    await db.exec('BEGIN')
    // the successor needs the current row closed first (a reviewed price change = close + insert)
    await db.exec(`UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${NB21}' AND usage_category = 'image_output'`)
    await expect(db.exec(insertRow({ model: `'${NB21}'`, usage_category: "'image_output'", effective_from: "'2026-11-15T00:00:00Z'" }))).rejects.toThrow(/overlapping effective window/)
    await db.exec('ROLLBACK')
    await db.exec('BEGIN')
    await db.exec(`UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${NB21}' AND usage_category = 'image_output'`)
    await db.exec(insertRow({ model: `'${NB21}'`, usage_category: "'image_output'", effective_from: "'2026-12-01T00:00:00Z'", price_amount: '25' }))
    expect(await count(db, `model = '${NB21}' AND usage_category = 'image_output'`)).toBe(2)
    await db.exec('ROLLBACK')
    // an active duplicate with the same key is impossible
    await expect(db.exec(insertRow({ model: `'${NB21}'`, usage_category: "'image_output'", effective_from: "'2026-10-12T00:00:00Z'" }))).rejects.toThrow(/duplicate key|unique/i)
  })

  it('re-running the forward migration is a no-op (exact post-state recognized)', async () => {
    const snapshot = await digest(db)
    await db.exec(UP)
    expect(await digest(db)).toBe(snapshot)
    expect(await count(db)).toBe(28)
  })

  it('the rollback restores the previous state EXACTLY, and the category is rejected again', async () => {
    await db.exec(DOWN)
    expect(await count(db)).toBe(22)
    expect(await digest(db)).toBe(before.digestAll)
    expect(await constraintDef(db)).toBe("CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'unit'::text])))")
    await expect(db.exec(insertRow({ usage_category: "'image_output'" }))).rejects.toThrow(/check constraint/i)
  })

  it('re-running the rollback is a no-op, and forward -> rollback -> forward works', async () => {
    await db.exec(DOWN)
    expect(await digest(db)).toBe(before.digestAll)
    await db.exec(UP)
    expect(await count(db)).toBe(28)
    expect(await digest(db, NOT_V1)).toBe(before.digestOther)
    await db.exec(DOWN)
    expect(await digest(db)).toBe(before.digestAll)
  })
})

describe('guards: drift aborts BEFORE anything changes, and a late failure rolls the whole transaction back', () => {
  const cases: Array<[string, (db: PGlite) => Promise<void>, RegExp]> = [
    ['a drifted usage_category constraint', async (db) => {
      await db.exec("ALTER TABLE provider_pricing_versions DROP CONSTRAINT provider_pricing_versions_usage_category_check, ADD CONSTRAINT provider_pricing_versions_usage_category_check CHECK (usage_category IN ('input','cached_input','output','unit','bogus'))")
    }, /neither the pre- nor the post-migration definition/],
    ['RLS disabled', async (db) => { await db.exec('ALTER TABLE provider_pricing_versions DISABLE ROW LEVEL SECURITY') }, /RLS is not enabled/],
    ['an extra policy', async (db) => { await db.exec('CREATE POLICY extra ON provider_pricing_versions FOR SELECT TO anon USING (true)') }, /policy set/],
    ['a write grant for authenticated', async (db) => { await db.exec('GRANT INSERT ON provider_pricing_versions TO authenticated') }, /privileges/],
    ['a read grant for anon', async (db) => { await db.exec('GRANT SELECT ON provider_pricing_versions TO anon') }, /privileges/],
    ['the overlap trigger removed', async (db) => { await db.exec('DROP TRIGGER provider_pricing_versions_no_overlap ON provider_pricing_versions') }, /overlap trigger/],
    ['unexpected price history for a V1 model', async (db) => { await db.exec(insertRow({ model: `'${NB21}'`, effective_from: "'2026-09-01T00:00:00Z'" })) }, /unexpected price history/],
    ['a V1 cached_input price (never approved)', async (db) => { await db.exec(insertRow({ model: `'${LITE}'`, usage_category: "'cached_input'", effective_from: "'2026-10-12T00:00:00Z'" })) }, /unexpected price history/],
    ['an image_output row for an unapproved model', async (db) => {
      await db.exec("ALTER TABLE provider_pricing_versions DROP CONSTRAINT provider_pricing_versions_usage_category_check, ADD CONSTRAINT provider_pricing_versions_usage_category_check CHECK (usage_category IN ('input','cached_input','output','image_output','unit'))")
      await db.exec(insertRow({ model: "'gemini-3-pro-image'", usage_category: "'image_output'" }))
    }, /model that was not approved/],
  ]

  it.each(cases)('forward aborts on %s and changes nothing', async (_name, tamper, message) => {
    const db = await prodLike()
    try {
      await tamper(db)
      const [rowsBefore, digestBefore, defBefore] = [await count(db), await digest(db), await constraintDef(db)]
      await expect(db.exec(UP)).rejects.toThrow(message)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(await count(db)).toBe(rowsBefore)
      expect(await digest(db)).toBe(digestBefore)
      expect(await constraintDef(db)).toBe(defBefore)
    } finally { await db.close() }
  }, 60_000)

  it('a seeded value that drifted after the first run is detected on re-run (kept rows are verified, never trusted)', async () => {
    const db = await prodLike()
    try {
      await db.exec(UP)
      await db.exec(`UPDATE provider_pricing_versions SET price_amount = 9 WHERE model = '${NB21}' AND usage_category = 'image_output'`)
      await expect(db.exec(UP)).rejects.toThrow(/not exactly the six reviewed versions/)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(Number((await one<{ p: string }>(db, `SELECT price_amount::text AS p FROM provider_pricing_versions WHERE model = '${NB21}' AND usage_category = 'image_output'`)).p)).toBe(9)
    } finally { await db.close() }
  }, 60_000)

  it('a failure AFTER the constraint was widened rolls the constraint back too (atomic)', async () => {
    const db = await prodLike()
    try {
      // an allowed-looking pre-existing row with a WRONG price: the guard passes, the constraint is widened, the insert is
      // skipped by ON CONFLICT, and only the final verification can notice. Everything must be undone.
      await db.exec(insertRow({ model: `'${NB21}'`, usage_category: "'input'", effective_from: "'2026-10-12T00:00:00Z'", price_amount: '99' }))
      const defBefore = await constraintDef(db)
      const digestBefore = await digest(db)
      await expect(db.exec(UP)).rejects.toThrow(/not exactly the six reviewed versions/)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(await constraintDef(db)).toBe(defBefore)
      expect(await digest(db)).toBe(digestBefore)
      expect(await count(db, "usage_category = 'image_output'")).toBe(0)
    } finally { await db.close() }
  }, 60_000)

  it('the rollback refuses to delete price history that was edited, extended or closed after the seed', async () => {
    const edits: Array<[string, string]> = [
      ['a changed price', `UPDATE provider_pricing_versions SET price_amount = 31 WHERE model = '${LITE}' AND usage_category = 'image_output'`],
      ['a closed window', `UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${NB21}' AND usage_category = 'input'`],
      ['a newer version', insertRow({ model: `'${NB21}'`, usage_category: "'image_output'", effective_from: "'2026-12-01T00:00:00Z'", price_amount: '25' })],
    ]
    for (const [name, edit] of edits) {
      const db = await prodLike()
      try {
        await db.exec(UP)
        if (name === 'a newer version') await db.exec(`UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${NB21}' AND usage_category = 'image_output' AND effective_from = '2026-10-12T00:00:00Z'`)
        await db.exec(edit)
        const snapshot = await digest(db)
        await expect(db.exec(DOWN), name).rejects.toThrow(/Refusing to delete price history/)
        await db.exec('ROLLBACK').catch(() => undefined)
        expect(await digest(db), name).toBe(snapshot)
      } finally { await db.close() }
    }
  }, 120_000)

  it('the rollback refuses while an image_output row exists for another model', async () => {
    const db = await prodLike()
    try {
      await db.exec(UP)
      await db.exec(insertRow({ model: "'gemini-3-pro-image'", usage_category: "'image_output'" }))
      await expect(db.exec(DOWN)).rejects.toThrow(/image_output row exists for another model/)
    } finally { await db.close() }
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------------------------------
// Cost derivation (proposal) over the registry the reviewed SQL produces.
// ---------------------------------------------------------------------------------------------------------------------

describe('proposed cost derivation over the migrated registry', () => {
  let proposedVersions: PricingVersion[]
  let currentCodeVersions: PricingVersion[]

  beforeAll(async () => {
    const db = await prodLike()
    await db.exec(UP)
    const rows = await loadRows(db)
    await db.close()
    proposedVersions = rows.map(toPricingVersionProposed).filter((v): v is PricingVersion => v !== null)
    currentCodeVersions = rows.map(toPricingVersion).filter((v): v is PricingVersion => v !== null)
  }, 60_000)

  const ATTEMPT = '11111111-1111-4111-8111-111111111111'
  const context = (model: 'nb21' | 'lite' = 'nb21', overrides: Partial<GeminiImageUsageContext> = {}): GeminiImageUsageContext => ({
    userId: 'u1', attemptId: ATTEMPT, projectId: null, productionId: null,
    modelAlias: model === 'nb21' ? 'gemini-nb-2.1' : 'gemini-nb-lite', providerModel: model === 'nb21' ? NB21 : LITE,
    aspectRatio: '1:1', imageSize: '1K', funding: 'user_byok', credentialSource: 'user', providerResponse: 'received', ...overrides,
  })
  /** Real Slice C events -> real ledger row shape -> cost input (exactly what /api/settings/usage does). */
  const inputsFor = (usage: Record<string, unknown> | null, model: 'nb21' | 'lite' = 'nb21', occurredAt = '2026-10-20T12:00:00Z'): Array<{ key: string; input: ProviderUsageCostInput }> =>
    geminiImageUsageEvents(context(model), extractGeminiUsage(usage)).map((event) => ({
      key: event.idempotencyKey.split(':')[2],
      input: costInputFromRow({ ...toUsageEventRow(event), occurred_at: occurredAt }),
    }))
  const price = (usage: Record<string, unknown> | null, model: 'nb21' | 'lite' = 'nb21', versions = proposedVersions, occurredAt?: string) =>
    Object.fromEntries(inputsFor(usage, model, occurredAt).map(({ key, input }) => [key, deriveProviderUsageCostProposed(input, versions)]))
  const amount = (cost: unknown) => (cost as { amount?: string }).amount

  // A realistic 1K execution: 14 text prompt tokens in, 1,120 IMAGE tokens out (Google's documented 1K size), tier reported.
  const ONE_K = { promptTokenCount: 14, candidatesTokenCount: 1120, totalTokenCount: 1134, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }

  it('Nano Banana 2.1: 1,120 IMAGE tokens cost exactly USD 0.0336 at the image_output rate, input at 1.50/1M', () => {
    const costs = price(ONE_K)
    expect(costs.image_output_tokens).toMatchObject({ status: 'estimated', currency: 'USD', serviceTier: 'standard', components: [{ category: 'image_output', quantity: '1120', amount: '0.0336' }] })
    expect(costs.input_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'input', quantity: '14', amount: '0.000021' }] })
    expect(Object.keys(costs).sort()).toEqual(['image_output_tokens', 'input_tokens']) // totalTokenCount is not a row, so it is never priced
  })

  it('Nano Banana 2 Lite: the same 1,120 IMAGE tokens cost USD 0.0336; input at 0.25/1M', () => {
    const costs = price(ONE_K, 'lite')
    expect(costs.image_output_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'image_output', amount: '0.0336' }] })
    expect(costs.input_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'input', amount: '0.0000035' }] })
  })

  it('IMAGE output is NEVER priced at the text-output rate (text rate would give 0.0084 / 0.00168)', () => {
    for (const model of ['nb21', 'lite'] as const) {
      const image = price(ONE_K, model).image_output_tokens as { components: Array<{ amount: string; category: string }> }
      expect(image.components[0].category).toBe('image_output')
      expect(image.components[0].amount).toBe('0.0336')
      expect(image.components[0].amount).not.toBe(model === 'nb21' ? '0.0084' : '0.00168')
    }
    // and with no image_output version at all (SQL not applied) the image row is unavailable, not text-priced
    const withoutImageRows = proposedVersions.filter((v) => (v.usageCategory as string) !== 'image_output')
    expect(price(ONE_K, 'nb21', withoutImageRows).image_output_tokens).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
  })

  it('text output and thinking tokens are classified as text/thinking output (7.50 and 1.50 per 1M), separate from IMAGE output', () => {
    const mixed = { promptTokenCount: 20, thoughtsTokenCount: 215, candidatesTokenCount: 1160, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1120 }] }
    const nb = price(mixed)
    expect(nb.text_output_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'output', quantity: '40', amount: '0.0003' }] })
    expect(nb.thoughts_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'output', quantity: '215', amount: '0.0016125' }] })
    expect(nb.image_output_tokens).toMatchObject({ components: [{ category: 'image_output', amount: '0.0336' }] })
    const lite = price(mixed, 'lite')
    expect(lite.text_output_tokens).toMatchObject({ components: [{ amount: '0.00006' }] })
    expect(lite.thoughts_tokens).toMatchObject({ components: [{ amount: '0.0003225' }] })
  })

  it('output_unattributed stays UNPRICED with its own reason, never $0 and never treated as image or text', () => {
    const costs = price({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' })
    expect(costs.output_unattributed_tokens).toEqual({ status: 'unavailable', reason: PROPOSED_UNATTRIBUTED_REASON })
    expect(amount(costs.output_unattributed_tokens)).toBeUndefined()
    // the CURRENT code also leaves it unpriced (generic reason): the decision changes only the wording
    const current = Object.fromEntries(inputsFor({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' }).map(({ key, input }) => [key, deriveProviderUsageCost(input, currentCodeVersions)]))
    expect(current.output_unattributed_tokens).toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
  })

  it('missing modality / partial usage never yields a false total: priced + unpriced components are labelled partial, not complete', () => {
    const partial = Object.values(price({ promptTokenCount: 14, candidatesTokenCount: 1120, serviceTier: 'standard' }))
    expect(executionCostVerdict(partial)).toBe('partial')
    const summary = summarizeEstimatedCostProposed(partial)
    expect(summary.complete).toBe(false)
    expect(summary.pricedEvents).toBe(1)
    expect(summary.unpricedEvents).toBe(1)
    expect(summary.totals).toEqual([{ currency: 'USD', amount: '0.000021', pricedEvents: 1 }]) // a lower bound of the priced rows, flagged incomplete
    // a fully classified execution is complete
    const full = Object.values(price(ONE_K))
    expect(executionCostVerdict(full)).toBe('complete')
    expect(summarizeEstimatedCostProposed(full)).toMatchObject({ complete: true, unpricedEvents: 0, totals: [{ currency: 'USD', amount: '0.033621' }] })
    // an empty set is not "complete"
    expect(summarizeEstimatedCostProposed([]).complete).toBe(false)
    expect(executionCostVerdict([])).toBe('none')
  })

  it('unknown usage is unavailable and has no amount; only-input usage prices only the input', () => {
    const unknown = price(null)
    expect(unknown.unknown).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    expect(amount(unknown.unknown)).toBeUndefined()
    expect(executionCostVerdict(Object.values(unknown))).toBe('none')
    const onlyInput = price({ promptTokenCount: 14, serviceTier: 'standard' })
    expect(Object.keys(onlyInput)).toEqual(['input_tokens'])
  })

  it('a zero IMAGE or thinking count creates no row, so nothing is priced from an absent measurement', () => {
    expect(Object.keys(price({ promptTokenCount: 5, thoughtsTokenCount: 0, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 0 }] }))).toEqual(['input_tokens'])
  })

  describe('service tier', () => {
    it('a REPORTED non-Standard tier never receives Standard rates (no Flex/Priority price exists for these models)', () => {
      for (const tier of ['flex', 'priority']) {
        const costs = price({ ...ONE_K, serviceTier: tier })
        for (const cost of Object.values(costs)) expect(cost).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
      }
    })

    it('a REPORTED Standard tier is used as reported (no assumption added)', () => {
      const cost = price(ONE_K).image_output_tokens as { assumptions: string[] }
      expect(cost.assumptions).not.toContain(PROPOSED_SOLE_TIER_ASSUMPTION)
      expect(cost.assumptions).toEqual(expect.arrayContaining(['list_price_equivalent', 'paid_tier_list_price', 'byok_invoice_may_differ', 'price_observed_at_source']))
    })

    it('an unreported tier falls back to Standard ONLY because the registry prices exactly one tier for the model — and says so', () => {
      const { serviceTier: _omitted, ...withoutTier } = ONE_K
      void _omitted
      const costs = price(withoutTier)
      expect(costs.image_output_tokens).toMatchObject({ status: 'estimated', serviceTier: 'standard', components: [{ amount: '0.0336' }] })
      expect((costs.image_output_tokens as { assumptions: string[] }).assumptions).toContain(PROPOSED_SOLE_TIER_ASSUMPTION)
      expect((costs.input_tokens as { assumptions: string[] }).assumptions).toContain(PROPOSED_SOLE_TIER_ASSUMPTION)
    })

    it('the fallback switches itself OFF the moment the registry prices a second tier for the model', () => {
      const { serviceTier: _omitted, ...withoutTier } = ONE_K
      void _omitted
      const flex = toPricingVersionProposed({
        id: 'flex-1', provider: 'gemini', model: NB21, usage_category: 'image_output', service_tier: 'flex', currency: 'USD', unit_name: 'tokens', unit_quantity: '1000000', price_amount: '15',
        effective_from: '2026-10-12T00:00:00Z', effective_to: null, effective_from_basis: 'observed_at_source', source_url: 'https://example.test', source_label: 't', retrieved_at: '2026-10-12T00:00:00Z', notes: null,
      })!
      const costs = price(withoutTier, 'nb21', [...proposedVersions, flex])
      for (const cost of Object.values(costs)) expect(cost).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    })

    it('the fallback is limited to image-generation rows: the same model used for anything else keeps the strict rule', () => {
      const textRow: ProviderUsageCostInput = {
        provider: 'gemini', transport: 'api', operation: 'create', model: NB21, quantity: 100, unit: 'input_tokens', measurementSource: 'provider_reported',
        occurredAt: '2026-10-20T12:00:00Z', funding: 'user_byok',
      }
      expect(deriveProviderUsageCostProposed(textRow, proposedVersions)).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
    })

    it('an unrecognized reported tier is not replaced by Standard', () => {
      const costs = price({ ...ONE_K, serviceTier: 'turbo' })
      // the Slice C normalizer drops an unknown tier, so it becomes "not reported" -> sole-tier fallback applies; assert the drop explicitly
      expect(extractGeminiUsage({ ...ONE_K, serviceTier: 'turbo' })?.serviceTier).toBeNull()
      const direct = deriveProviderUsageCostProposed({ ...inputsFor(ONE_K)[0].input, serviceTier: 'turbo' }, proposedVersions)
      expect(direct).toEqual({ status: 'ambiguous', reason: 'service_tier_not_proven' })
      void costs
    })
  })

  describe('price versions and effective dates', () => {
    it('an execution before the first published price is unpriced (no back-dating), at/after it is priced', () => {
      expect(price(ONE_K, 'nb21', proposedVersions, '2026-10-11T23:59:59Z').image_output_tokens).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
      expect(price(ONE_K, 'nb21', proposedVersions, '2026-10-12T00:00:00Z').image_output_tokens).toMatchObject({ status: 'estimated', components: [{ amount: '0.0336' }] })
    })

    it('a later price change prices later executions only; earlier executions keep their rate', () => {
      const old = proposedVersions.find((v) => v.model === NB21 && (v.usageCategory as string) === 'image_output')!
      const closed = { ...old, effectiveTo: Date.parse('2026-12-01T00:00:00Z') }
      const next = { ...old, id: 'next', priceAmount: BigInt('25000000000000') /* 25.000000000000 at the registry's 12-digit scale */, effectiveFrom: Date.parse('2026-12-01T00:00:00Z'), effectiveTo: null }
      const versions = [...proposedVersions.filter((v) => v !== old), closed, next]
      expect(price(ONE_K, 'nb21', versions, '2026-11-30T23:59:59Z').image_output_tokens).toMatchObject({ components: [{ amount: '0.0336' }] })
      expect(price(ONE_K, 'nb21', versions, '2026-12-01T00:00:00Z').image_output_tokens).toMatchObject({ components: [{ amount: '0.028' }] })
    })

    it('overlapping versions are ambiguous, never guessed', () => {
      const old = proposedVersions.find((v) => v.model === NB21 && (v.usageCategory as string) === 'image_output')!
      expect(price(ONE_K, 'nb21', [...proposedVersions, { ...old, id: 'dup' }]).image_output_tokens).toEqual({ status: 'ambiguous', reason: 'overlapping_pricing_versions' })
    })

    it('a model with no registry rows (any non-V1 Google image model) is unavailable, never priced from a neighbour', () => {
      const input = { ...inputsFor(ONE_K)[1].input, model: 'gemini-3-pro-image' }
      expect(deriveProviderUsageCostProposed(input, proposedVersions)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_model' })
    })
  })

  describe('fail-safe dimensions', () => {
    it('cached or tool-use input tokens (not available for these models) are not guessed', () => {
      const cached = price({ ...ONE_K, cachedContentTokenCount: 5 })
      expect(cached.input_tokens).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
      const toolUse = price({ ...ONE_K, toolUsePromptTokenCount: 3 })
      expect(toolUse.input_tokens).toEqual({ status: 'ambiguous', reason: 'tool_use_tokens_not_priced' })
      // the IMAGE row is independent of the input row's problems
      expect(cached.image_output_tokens).toMatchObject({ status: 'estimated' })
    })

    it('totalTokenCount is never priced a second time: adding or removing it changes no amount', () => {
      const withTotal = price(ONE_K)
      const { totalTokenCount: _omitted, ...withoutTotal } = ONE_K
      void _omitted
      expect(price(withoutTotal)).toEqual(withTotal)
      expect(price({ ...ONE_K, totalTokenCount: 999_999 })).toEqual(withTotal)
    })

    it('a measured quantity that was not provider-reported is not priced', () => {
      const input = { ...inputsFor(ONE_K)[1].input, measurementSource: 'estimated' }
      expect(deriveProviderUsageCostProposed(input, proposedVersions)).toEqual({ status: 'unavailable', reason: 'measurement_not_provider_reported' })
    })
  })

  describe('regression: everything that is not a Gemini image row is byte-identical to the current deriver', () => {
    const rows: ProviderUsageCostInput[] = []
    const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-4o-mini', 'kling-v3', 'gemini-unknown-model']
    for (const model of models) {
      const provider = model.startsWith('gpt') ? 'openai' : model.startsWith('kling') ? 'kling' : 'gemini'
      for (const unit of ['input_tokens', 'output_tokens', 'tokens', 'units', 'credits', 'images'])
        for (const serviceTier of [null, 'standard', 'flex', 'priority', 'default', 'turbo'])
          for (const usageCategory of [null, 'thoughts'])
            for (const operation of ['create', 'improve', 'image_review', 'video_review', 'text_to_video'])
              rows.push({
                provider, transport: provider === 'kling' ? 'rest' : 'api', operation, model, quantity: 1234, unit, measurementSource: 'provider_reported',
                occurredAt: '2026-10-20T12:00:00Z', usageCategory, funding: 'user_byok', serviceTier, cachedInputTokens: 100, toolUsePromptTokens: operation === 'improve' ? 4 : null,
              })
    }
    rows.push(
      { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: null, unit: null, measurementSource: 'unknown', occurredAt: '2026-10-20T12:00:00Z' },
      { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: 5, unit: 'input_tokens', measurementSource: 'estimated', occurredAt: '2026-10-20T12:00:00Z', serviceTier: 'standard' },
      { provider: 'openai', transport: 'api', operation: 'create', model: 'gpt-4o-mini', quantity: 5, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: 'not-a-date', serviceTier: 'default' },
    )

    it(`prices ${rows.length} representative OpenAI / Gemini text / Kling / unknown rows identically`, () => {
      expect(rows.length).toBeGreaterThan(1000)
      let estimated = 0
      for (const row of rows) {
        const expected = deriveProviderUsageCost(row, currentCodeVersions)
        expect(deriveProviderUsageCostProposed(row, proposedVersions)).toEqual(expected)
        if (expected.status === 'estimated') estimated += 1
      }
      expect(estimated).toBeGreaterThan(50) // the matrix really exercises priced rows, not only "unavailable"
    })

    it('the current deriver, given the NEW registry rows, still prices input / text-output / thinking correctly and leaves IMAGE unpriced (SQL-before-code is safe)', () => {
      const current = Object.fromEntries(inputsFor({ promptTokenCount: 20, thoughtsTokenCount: 215, candidatesTokenCount: 1160, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1120 }] })
        .map(({ key, input }) => [key, deriveProviderUsageCost(input, currentCodeVersions)]))
      expect(current.input_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'input', amount: '0.00003' }] })
      expect(current.text_output_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'output', amount: '0.0003' }] })
      expect(current.thoughts_tokens).toMatchObject({ status: 'estimated', components: [{ category: 'output', amount: '0.0016125' }] })
      expect(current.image_output_tokens).toEqual({ status: 'unavailable', reason: 'unit_not_priceable' })
      // the unchanged loader silently drops the unknown category: the rows are ignored, never mis-loaded
      expect(currentCodeVersions.filter((v) => (v.usageCategory as string) === 'image_output')).toHaveLength(0)
      expect(proposedVersions.filter((v) => (v.usageCategory as string) === 'image_output')).toHaveLength(2)
      expect(currentCodeVersions).toHaveLength(26) // 22 old + 4 (input/output of the two V1 models)
    })
  })
})
