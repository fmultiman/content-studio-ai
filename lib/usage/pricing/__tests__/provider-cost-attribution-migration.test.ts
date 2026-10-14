import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { code, constraintDef, count, digest, insertRow, one } from './image-pricing-fixtures'
import {
  GPT_IMAGE_2, PCA_CHECK, PCA_DOWN, PCA_SCOPE, PCA_UP, SLICE_D_CHECK, VEO_FAST, VEO_LITE, VEO_STANDARD, productionToday,
} from './provider-cost-fixtures'

// PROVIDER_COST_ATTRIBUTION_V1 — LOCAL PROOF of the reviewed OpenAI GPT Image 2 / Google Veo pricing SQL against a Production-shaped
// schema in PGlite (isolated, in-process; no Supabase, no key, no provider). The SQL stays a PROPOSAL: nothing here applies it anywhere.

const NOT_SCOPE = `NOT ${PCA_SCOPE}`
const up = code(PCA_UP)
const down = code(PCA_DOWN)

describe('the reviewed SQL — shape and safety (static)', () => {
  it('both files are one transaction with a lock timeout, a guard and a verification, and refresh the PostgREST schema', () => {
    for (const sql of [up, down]) {
      expect(sql).toMatch(/^\s*BEGIN;/)
      expect(sql).toMatch(/COMMIT;\s*$/)
      expect(sql).toMatch(/SET LOCAL lock_timeout = '5s'/)
      expect(sql).toMatch(/\$guard\$/)
      expect(sql).toMatch(/\$verify\$/)
      expect(sql).toMatch(/NOTIFY pgrst, 'reload schema'/)
    }
  })

  it('forward: only the category CHECK is altered and only price rows are inserted — no other DDL, no UPDATE/DELETE/TRUNCATE/DROP TABLE, no usage ledger', () => {
    const ddl = up.replace(/'[^']*'/g, "''")
    expect(ddl).not.toMatch(/\bUPDATE\s+public|\bDELETE\s+FROM|\bTRUNCATE\b|DROP\s+TABLE|DROP\s+POLICY|CREATE\s+(POLICY|TRIGGER|FUNCTION|INDEX|TABLE\s+public)|\bGRANT\b|\bREVOKE\b|DISABLE\s+ROW|DROP\s+TRIGGER|ALTER\s+TABLE\s+(?!public\.provider_pricing_versions)/i)
    expect(up).not.toMatch(/provider_usage_events|user_settings|api_key|service_role\s*=|auth\.users/i)
    expect([...up.matchAll(/ALTER TABLE\s+(\S+)/gi)].map((m) => m[1])).toEqual(['public.provider_pricing_versions'])
    expect(up).toMatch(/DROP CONSTRAINT provider_pricing_versions_usage_category_check,\s*ADD CONSTRAINT provider_pricing_versions_usage_category_check/)
    expect([...up.matchAll(/INSERT INTO\s+(\S+)/gi)].map((m) => m[1])).toEqual(['public.provider_pricing_versions'])
    expect(up).toMatch(/ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING/)
  })

  it('forward seeds exactly the eleven approved Standard versions (the official figures), and nothing else', () => {
    const rows = [...up.matchAll(/\('(openai|gemini)', '([^']+)', '([^']+)', 'standard', 'USD', '(tokens|seconds)', (\d+), ([0-9.]+), '2026-10-14T00:00:00Z', 'observed_at_source'/g)].map((m) => [m[1], m[2], m[3], m[4], Number(m[5]), Number(m[6])])
    expect(rows).toEqual([
      ['openai', GPT_IMAGE_2, 'input', 'tokens', 1_000_000, 5],
      ['openai', GPT_IMAGE_2, 'image_input', 'tokens', 1_000_000, 8],
      ['openai', GPT_IMAGE_2, 'image_output', 'tokens', 1_000_000, 30],
      ['gemini', VEO_STANDARD, 'video_second_720p', 'seconds', 1, 0.4],
      ['gemini', VEO_STANDARD, 'video_second_1080p', 'seconds', 1, 0.4],
      ['gemini', VEO_STANDARD, 'video_second_4k', 'seconds', 1, 0.6],
      ['gemini', VEO_FAST, 'video_second_720p', 'seconds', 1, 0.1],
      ['gemini', VEO_FAST, 'video_second_1080p', 'seconds', 1, 0.12],
      ['gemini', VEO_FAST, 'video_second_4k', 'seconds', 1, 0.3],
      ['gemini', VEO_LITE, 'video_second_720p', 'seconds', 1, 0.05],
      ['gemini', VEO_LITE, 'video_second_1080p', 'seconds', 1, 0.08],
    ])
    expect(up.match(/'https:\/\/developers\.openai\.com\/api\/docs\/pricing', 'OpenAI API pricing/g)).toHaveLength(3)
    expect(up.match(/'https:\/\/ai\.google\.dev\/gemini-api\/docs\/pricing', 'Gemini API pricing/g)).toHaveLength(8)
    // never seeded: Batch prices, cache prices, text output for GPT Image 2, 4k for Lite, any other model or tier
    expect(up).not.toMatch(/'cached_input', 'standard'/)
    expect(up).not.toMatch(/'(openai|gemini)', 'gpt-image-2', 'output'/)
    expect(up).not.toMatch(/veo-3\.1-lite-generate-preview', 'video_second_4k'/)
    expect(up).not.toMatch(/'batch'|'flex'|'priority'/)
    expect(up).not.toMatch(/gpt-image-1|gpt-image-2\.5|veo-2|veo-3-/)
  })

  it('rollback: deletes only the seeded rows by exact scope and narrows the constraint back; never drops history blindly', () => {
    expect([...down.matchAll(/DELETE FROM/gi)]).toHaveLength(1)
    expect(down).not.toMatch(/TRUNCATE|DROP\s+TABLE|\bUPDATE\s+public|provider_usage_events/i)
    expect(down).toMatch(/Refusing to delete price history/)
    expect(down).toMatch(/CHECK \(usage_category IN \('input', 'cached_input', 'output', 'image_output', 'unit'\)\)/)
  })
})

describe('forward migration against Production as it is today', () => {
  let db: PGlite
  let before: { total: number; digestAll: string; digestOther: string }

  beforeAll(async () => {
    db = await productionToday()
    before = { total: await count(db), digestAll: await digest(db), digestOther: await digest(db, NOT_SCOPE) }
  }, 60_000)
  afterAll(async () => { await db?.close() })

  it('starts from the live shape: 28 rows and the Slice D constraint; new categories are rejected by the database', async () => {
    expect(before.total).toBe(28)
    expect(await constraintDef(db)).toBe(SLICE_D_CHECK)
    await expect(db.exec(insertRow({ usage_category: "'image_input'" }))).rejects.toThrow(/check constraint/i)
    await expect(db.exec(insertRow({ usage_category: "'video_second_720p'", unit_name: "'seconds'", unit_quantity: '1' }))).rejects.toThrow(/check constraint/i)
  })

  it('applies cleanly in one transaction: 28 -> 39 rows', async () => {
    await db.exec(PCA_UP)
    expect(await count(db)).toBe(39)
    expect(await constraintDef(db)).toBe(PCA_CHECK)
  })

  it('preserves every existing price row byte for byte (Gemini text/image, Kling units, OpenAI chat)', async () => {
    expect(await digest(db, NOT_SCOPE)).toBe(before.digestOther)
    expect(await count(db, NOT_SCOPE)).toBe(28)
  })

  it('stores the approved prices with USD, the right unit, the observation date and the official source', async () => {
    const rows = (await db.query<{ model: string; usage_category: string; price: string; unit: string; qty: string; basis: string; url: string; tier: string }>(
      `SELECT model, usage_category, price_amount::text AS price, unit_name AS unit, unit_quantity::text AS qty, effective_from_basis AS basis, source_url AS url, service_tier AS tier
         FROM provider_pricing_versions WHERE ${PCA_SCOPE} ORDER BY model, usage_category`,
    )).rows
    expect(rows).toHaveLength(11)
    const by = Object.fromEntries(rows.map((r) => [`${r.model}|${r.usage_category}`, Number(r.price)]))
    expect(by).toEqual({
      [`${GPT_IMAGE_2}|input`]: 5, [`${GPT_IMAGE_2}|image_input`]: 8, [`${GPT_IMAGE_2}|image_output`]: 30,
      [`${VEO_STANDARD}|video_second_720p`]: 0.4, [`${VEO_STANDARD}|video_second_1080p`]: 0.4, [`${VEO_STANDARD}|video_second_4k`]: 0.6,
      [`${VEO_FAST}|video_second_720p`]: 0.1, [`${VEO_FAST}|video_second_1080p`]: 0.12, [`${VEO_FAST}|video_second_4k`]: 0.3,
      [`${VEO_LITE}|video_second_720p`]: 0.05, [`${VEO_LITE}|video_second_1080p`]: 0.08,
    })
    for (const row of rows) {
      expect(row.tier).toBe('standard')
      expect(row.basis).toBe('observed_at_source')
      expect(row.url).toBe(row.model === GPT_IMAGE_2 ? 'https://developers.openai.com/api/docs/pricing' : 'https://ai.google.dev/gemini-api/docs/pricing')
      expect(row.unit).toBe(row.model === GPT_IMAGE_2 ? 'tokens' : 'seconds')
      expect(Number(row.qty)).toBe(row.model === GPT_IMAGE_2 ? 1_000_000 : 1)
    }
    const meta = await one<{ from: Date; retrieved: Date; currency: string }>(db, `SELECT effective_from AS "from", retrieved_at AS retrieved, currency FROM provider_pricing_versions WHERE model = '${GPT_IMAGE_2}' AND usage_category = 'image_output'`)
    expect(meta.from.toISOString()).toBe('2026-10-14T00:00:00.000Z')
    expect(meta.retrieved.toISOString()).toBe('2026-10-14T12:20:00.000Z')
    expect(meta.currency).toBe('USD')
    // no Batch, cache or non-Standard price, and no 4k price for Lite
    expect(await count(db, `${PCA_SCOPE} AND (service_tier <> 'standard' OR usage_category = 'cached_input')`)).toBe(0)
    expect(await count(db, `model = '${VEO_LITE}' AND usage_category = 'video_second_4k'`)).toBe(0)
    expect(await count(db, `model = '${GPT_IMAGE_2}' AND usage_category = 'output'`)).toBe(0)
  })

  it('still rejects any other category; existing categories remain valid', async () => {
    for (const bad of ['bogus', 'video_second_8k', 'video_second', 'Image_Input', 'image_input ', 'video_second_720P', '']) {
      await expect(db.exec(insertRow({ usage_category: `'${bad}'` })), bad).rejects.toThrow(/check constraint/i)
    }
    await db.exec('BEGIN')
    for (const [index, category] of ['input', 'cached_input', 'output', 'unit', 'image_output', 'image_input', 'video_second_720p'].entries()) {
      await db.exec(insertRow({ model: `'m-cat-${index}'`, usage_category: `'${category}'` }))
    }
    await db.exec('ROLLBACK')
  })

  it('access model is unchanged: RLS on, one SELECT policy, authenticated/service_role read-only, anon nothing', async () => {
    expect((await one<{ r: boolean }>(db, "SELECT relrowsecurity AS r FROM pg_class WHERE oid = 'public.provider_pricing_versions'::regclass")).r).toBe(true)
    expect((await db.query("SELECT policyname FROM pg_policies WHERE tablename = 'provider_pricing_versions'")).rows).toEqual([{ policyname: 'provider_pricing_versions_select_authenticated' }])
    await db.exec('SET ROLE authenticated')
    try {
      expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM provider_pricing_versions')).n).toBe(39)
      await expect(db.exec(insertRow({ usage_category: "'image_input'" }))).rejects.toThrow(/permission denied/i)
      await expect(db.exec('UPDATE provider_pricing_versions SET price_amount = 0')).rejects.toThrow(/permission denied/i)
      await expect(db.exec('DELETE FROM provider_pricing_versions')).rejects.toThrow(/permission denied/i)
    } finally { await db.exec('RESET ROLE') }
    await db.exec('SET ROLE anon')
    try { await expect(db.query('SELECT 1 FROM provider_pricing_versions')).rejects.toThrow(/permission denied/i) } finally { await db.exec('RESET ROLE') }
  })

  it('version history rules hold for the new categories: an overlapping window and a duplicate key are rejected', async () => {
    await expect(db.exec(insertRow({ model: `'${VEO_FAST}'`, usage_category: "'video_second_720p'", unit_name: "'seconds'", unit_quantity: '1', effective_from: "'2026-11-15T00:00:00Z'" }))).rejects.toThrow(/overlapping effective window/)
    await expect(db.exec(insertRow({ model: `'${VEO_FAST}'`, usage_category: "'video_second_720p'", unit_name: "'seconds'", unit_quantity: '1', effective_from: "'2026-10-14T00:00:00Z'" }))).rejects.toThrow(/duplicate key|unique/i)
  })

  it('re-running the forward migration is a no-op (exact post-state recognized)', async () => {
    const snapshot = await digest(db)
    await db.exec(PCA_UP)
    expect(await digest(db)).toBe(snapshot)
    expect(await count(db)).toBe(39)
  })

  it('the rollback restores Production-today EXACTLY, and the new categories are rejected again', async () => {
    await db.exec(PCA_DOWN)
    expect(await count(db)).toBe(28)
    expect(await digest(db)).toBe(before.digestAll)
    expect(await constraintDef(db)).toBe(SLICE_D_CHECK)
    await expect(db.exec(insertRow({ usage_category: "'image_input'" }))).rejects.toThrow(/check constraint/i)
  })

  it('re-running the rollback is a no-op, and forward -> rollback -> forward works', async () => {
    await db.exec(PCA_DOWN)
    expect(await digest(db)).toBe(before.digestAll)
    await db.exec(PCA_UP)
    expect(await count(db)).toBe(39)
    expect(await digest(db, NOT_SCOPE)).toBe(before.digestOther)
    await db.exec(PCA_DOWN)
    expect(await digest(db)).toBe(before.digestAll)
  })

  it('never touches the usage ledger (provider_usage_events stays exactly as it was)', async () => {
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM provider_usage_events')).n).toBe(0)
  })
})

describe('guards: drift aborts BEFORE anything changes, and a late failure rolls the whole transaction back', () => {
  const cases: Array<[string, (db: PGlite) => Promise<void>, RegExp]> = [
    ['Production WITHOUT Slice D (old 4-category constraint)', async (db) => {
      await db.exec("DELETE FROM provider_pricing_versions WHERE usage_category = 'image_output'")
      await db.exec("ALTER TABLE provider_pricing_versions DROP CONSTRAINT provider_pricing_versions_usage_category_check, ADD CONSTRAINT provider_pricing_versions_usage_category_check CHECK (usage_category IN ('input','cached_input','output','unit'))")
    }, /neither the Slice D nor the post-migration definition/],
    ['a drifted usage_category constraint', async (db) => {
      await db.exec("ALTER TABLE provider_pricing_versions DROP CONSTRAINT provider_pricing_versions_usage_category_check, ADD CONSTRAINT provider_pricing_versions_usage_category_check CHECK (usage_category IN ('input','cached_input','output','image_output','unit','bogus'))")
    }, /neither the Slice D nor the post-migration definition/],
    ['RLS disabled', async (db) => { await db.exec('ALTER TABLE provider_pricing_versions DISABLE ROW LEVEL SECURITY') }, /RLS is not enabled/],
    ['an extra policy', async (db) => { await db.exec('CREATE POLICY extra ON provider_pricing_versions FOR SELECT TO anon USING (true)') }, /policy set/],
    ['a write grant for authenticated', async (db) => { await db.exec('GRANT INSERT ON provider_pricing_versions TO authenticated') }, /privileges/],
    ['the overlap trigger removed', async (db) => { await db.exec('DROP TRIGGER provider_pricing_versions_no_overlap ON provider_pricing_versions') }, /overlap trigger/],
    ['unexpected price history for GPT Image 2 (an older version)', async (db) => { await db.exec(insertRow({ provider: "'openai'", model: `'${GPT_IMAGE_2}'`, effective_from: "'2026-09-01T00:00:00Z'" })) }, /unexpected price history/],
    ['a GPT Image 2 cached_input price (never approved)', async (db) => { await db.exec(insertRow({ provider: "'openai'", model: `'${GPT_IMAGE_2}'`, usage_category: "'cached_input'", effective_from: "'2026-10-14T00:00:00Z'" })) }, /unexpected price history/],
    ['a Veo flex-tier price (never approved)', async (db) => { await db.exec(insertRow({ model: `'${VEO_FAST}'`, service_tier: "'flex'", effective_from: "'2026-10-14T00:00:00Z'" })) }, /unexpected price history/],
    ['a new-category row for an unapproved model', async (db) => {
      await db.exec("ALTER TABLE provider_pricing_versions DROP CONSTRAINT provider_pricing_versions_usage_category_check, ADD CONSTRAINT provider_pricing_versions_usage_category_check CHECK (usage_category IN ('input','cached_input','output','image_output','image_input','unit','video_second_720p','video_second_1080p','video_second_4k'))")
      await db.exec(insertRow({ provider: "'openai'", model: "'gpt-image-1'", usage_category: "'image_input'" }))
    }, /model that was not approved/],
  ]

  it.each(cases)('forward aborts on %s and changes nothing', async (_name, tamper, message) => {
    const db = await productionToday()
    try {
      await tamper(db)
      const [rowsBefore, digestBefore, defBefore] = [await count(db), await digest(db), await constraintDef(db)]
      await expect(db.exec(PCA_UP)).rejects.toThrow(message)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(await count(db)).toBe(rowsBefore)
      expect(await digest(db)).toBe(digestBefore)
      expect(await constraintDef(db)).toBe(defBefore)
    } finally { await db.close() }
  }, 60_000)

  it('a seeded value that drifted after the first run is detected on re-run (kept rows are verified, never trusted)', async () => {
    const db = await productionToday()
    try {
      await db.exec(PCA_UP)
      await db.exec(`UPDATE provider_pricing_versions SET price_amount = 9 WHERE model = '${VEO_FAST}' AND usage_category = 'video_second_720p'`)
      await expect(db.exec(PCA_UP)).rejects.toThrow(/not exactly the 11 reviewed versions/)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(Number((await one<{ p: string }>(db, `SELECT price_amount::text AS p FROM provider_pricing_versions WHERE model = '${VEO_FAST}' AND usage_category = 'video_second_720p'`)).p)).toBe(9)
    } finally { await db.close() }
  }, 60_000)

  it('a failure AFTER the constraint was widened rolls the constraint back too (atomic)', async () => {
    const db = await productionToday()
    try {
      // an allowed-looking pre-existing row with a WRONG price: the guard passes, the constraint is widened, the insert is skipped
      // by ON CONFLICT, and only the final verification can notice. Everything must be undone.
      await db.exec(insertRow({ provider: "'openai'", model: `'${GPT_IMAGE_2}'`, usage_category: "'input'", effective_from: "'2026-10-14T00:00:00Z'", price_amount: '99' }))
      const defBefore = await constraintDef(db)
      const digestBefore = await digest(db)
      await expect(db.exec(PCA_UP)).rejects.toThrow(/not exactly the 11 reviewed versions/)
      await db.exec('ROLLBACK').catch(() => undefined)
      expect(await constraintDef(db)).toBe(defBefore)
      expect(await digest(db)).toBe(digestBefore)
      expect(await count(db, "usage_category = 'image_input'")).toBe(0)
    } finally { await db.close() }
  }, 60_000)

  it('the rollback refuses to delete price history that was edited, extended or closed after the seed', async () => {
    const edits: Array<[string, string]> = [
      ['a changed price', `UPDATE provider_pricing_versions SET price_amount = 31 WHERE model = '${GPT_IMAGE_2}' AND usage_category = 'image_output'`],
      ['a closed window', `UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${VEO_LITE}' AND usage_category = 'video_second_1080p'`],
      ['a newer version', insertRow({ provider: "'openai'", model: `'${GPT_IMAGE_2}'`, usage_category: "'image_output'", effective_from: "'2026-12-01T00:00:00Z'", price_amount: '25' })],
    ]
    for (const [name, edit] of edits) {
      const db = await productionToday()
      try {
        await db.exec(PCA_UP)
        if (name === 'a newer version') await db.exec(`UPDATE provider_pricing_versions SET effective_to = '2026-12-01T00:00:00Z' WHERE model = '${GPT_IMAGE_2}' AND usage_category = 'image_output' AND effective_from = '2026-10-14T00:00:00Z'`)
        await db.exec(edit)
        const snapshot = await digest(db)
        await expect(db.exec(PCA_DOWN), name).rejects.toThrow(/Refusing to delete price history/)
        await db.exec('ROLLBACK').catch(() => undefined)
        expect(await digest(db), name).toBe(snapshot)
      } finally { await db.close() }
    }
  }, 120_000)

  it('the rollback refuses while a new-category row exists for another model', async () => {
    const db = await productionToday()
    try {
      await db.exec(PCA_UP)
      await db.exec(insertRow({ provider: "'openai'", model: "'gpt-image-1'", usage_category: "'image_input'" }))
      await expect(db.exec(PCA_DOWN)).rejects.toThrow(/new-category row exists for another model/)
    } finally { await db.close() }
  }, 60_000)
})
