import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DOWN, LITE, NB21, NEW_CATEGORY_CHECK, NOT_V1, OLD_CATEGORY_CHECK, UP, code, constraintDef, count, digest, insertRow, one, prodLike,
} from './image-pricing-fixtures'

// FUTURE-064 Slice D — LOCAL PROOF of the reviewed image_output SQL (docs/productization/sql) against a Production-shaped schema in
// PGlite (isolated, in-process; no Supabase, no key, no provider). The SQL stays a PROPOSAL: nothing here applies it anywhere.

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
    expect(await constraintDef(db)).toBe(OLD_CATEGORY_CHECK)
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
    expect(await constraintDef(db)).toBe(NEW_CATEGORY_CHECK)
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
    expect(await constraintDef(db)).toBe(OLD_CATEGORY_CHECK)
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

