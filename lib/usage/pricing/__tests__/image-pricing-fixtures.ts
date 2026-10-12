// FUTURE-064 Slice D — shared fixtures for the image-output pricing tests: the reviewed SQL, a Production-shaped PGlite registry and
// small query helpers. Test-only (nothing in app/ or production lib/ imports this).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'
import { toPricingVersion, type PricingVersion } from '../registry'

const SQL_DIR = join(process.cwd(), 'docs', 'productization', 'sql')
export const UP = readFileSync(join(SQL_DIR, 'FUTURE_064_SLICE_D_image_output_pricing.up.sql'), 'utf8')
export const DOWN = readFileSync(join(SQL_DIR, 'FUTURE_064_SLICE_D_image_output_pricing.down.sql'), 'utf8')
export const code = (sql: string) => sql.replace(/--.*$/gm, '')

export const NB21 = 'gemini-nano-banana-2.1'
export const LITE = 'gemini-3.1-flash-lite-image'
export const NOT_V1 = `NOT (provider = 'gemini' AND model IN ('${NB21}', '${LITE}'))`

/** The OLD category list (what Production has today) and the NEW one (what the reviewed SQL produces). */
export const OLD_CATEGORY_CHECK = "CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'unit'::text])))"
export const NEW_CATEGORY_CHECK = "CHECK((usage_category=ANY(ARRAY['input'::text,'cached_input'::text,'output'::text,'image_output'::text,'unit'::text])))"

/** Production-shaped state: the LIVE registry is exactly what 061 + 062 create (22 rows, SELECT-only grants, RLS, overlap trigger). */
export async function prodLike() {
  const db = new PGlite()
  await db.exec(STUBS)
  await db.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY)')
  await db.exec(script('044_create_provider_usage_events.sql'))
  await db.exec(script('061_create_provider_pricing_versions.sql'))
  await db.exec(script('062_seed_openai_gpt_4o_mini_pricing.sql'))
  return db
}

export const one = async <T = Record<string, unknown>>(db: PGlite, sql: string) => (await db.query<T>(sql)).rows[0]
export const count = async (db: PGlite, where = 'true') => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM provider_pricing_versions WHERE ${where}`)).n
export const digest = async (db: PGlite, where = 'true') =>
  (await one<{ d: string }>(db, `SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS d FROM provider_pricing_versions t WHERE ${where}`)).d
export const constraintDef = async (db: PGlite) =>
  (await one<{ d: string }>(db, "SELECT regexp_replace(pg_get_constraintdef(oid), '\\s+', '', 'g') AS d FROM pg_constraint WHERE conname = 'provider_pricing_versions_usage_category_check'")).d

export const insertRow = (o: Record<string, string> = {}) => {
  const row: Record<string, string> = {
    provider: "'gemini'", model: "'m-x'", usage_category: "'input'", service_tier: "'standard'", currency: "'USD'", unit_name: "'tokens'",
    unit_quantity: '1000000', price_amount: '1', effective_from: "'2026-11-01T00:00:00Z'", effective_to: 'NULL', effective_from_basis: "'observed_at_source'",
    source_url: "'https://example.test/p'", source_label: "'t'", retrieved_at: "'2026-10-12T00:00:00Z'", ...o,
  }
  return `INSERT INTO provider_pricing_versions (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')})`
}

/** Rows in the PostgREST wire shape (ISO strings), as the app's loader receives them. */
export async function loadWireRows(db: PGlite): Promise<Array<Record<string, unknown>>> {
  return (await db.query<Record<string, unknown>>('SELECT * FROM provider_pricing_versions')).rows.map((r) => ({
    ...r,
    effective_from: (r.effective_from as Date).toISOString(),
    effective_to: r.effective_to ? (r.effective_to as Date).toISOString() : null,
    retrieved_at: (r.retrieved_at as Date).toISOString(),
  }))
}

export const toVersions = (rows: Array<Record<string, unknown>>): PricingVersion[] =>
  rows.map(toPricingVersion).filter((v): v is PricingVersion => v !== null)

/** The registry as Production has it TODAY (old constraint, 22 rows) and as the reviewed SQL would leave it (28 rows). */
export async function registries() {
  const oldDb = await prodLike()
  const oldRows = await loadWireRows(oldDb)
  await oldDb.close()
  const newDb = await prodLike()
  await newDb.exec(UP)
  const newRows = await loadWireRows(newDb)
  await newDb.close()
  return { oldRows, newRows, oldVersions: toVersions(oldRows), newVersions: toVersions(newRows) }
}
