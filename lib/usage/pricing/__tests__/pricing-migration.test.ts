import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'
import { deriveProviderUsageCost, type ProviderUsageCostInput } from '../derive'
import { toPricingVersion, type PricingVersion } from '../registry'

// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — the REAL migration 061 against PGlite (isolated, in-process).

const FILE = '061_create_provider_pricing_versions.sql'
const RAW = readFileSync(join(process.cwd(), 'scripts', FILE), 'utf8')
const SQL = RAW.replace(/--.*$/gm, '')

let db: PGlite
let seeded: Array<Record<string, unknown>>
let versions: PricingVersion[]

const insert = (overrides: Record<string, string | null> = {}) => {
  const row: Record<string, string | null> = {
    provider: "'gemini'", model: "'m-test'", usage_category: "'input'", service_tier: "'standard'", currency: "'USD'", unit_name: "'tokens'",
    unit_quantity: '1000000', price_amount: '1', effective_from: "'2026-01-01T00:00:00Z'", effective_to: 'NULL',
    effective_from_basis: "'official_effective_date'", source_url: "'https://example.test/pricing'", source_label: "'t'", retrieved_at: "'2026-10-09T00:00:00Z'", ...overrides,
  }
  const keys = Object.keys(row)
  return `INSERT INTO provider_pricing_versions (${keys.join(', ')}) VALUES (${keys.map((k) => row[k]).join(', ')})`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  // A pre-existing ledger table proves the migration neither touches nor depends on it.
  await db.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY)')
  await db.exec(script('044_create_provider_usage_events.sql'))
  await db.exec(RAW)
  const result = await db.query<Record<string, unknown>>('SELECT * FROM provider_pricing_versions')
  seeded = result.rows.map((r) => ({
    ...r,
    // PGlite returns Date objects / numeric strings; PostgREST returns ISO strings. Normalise to the wire shape.
    effective_from: (r.effective_from as Date).toISOString(),
    effective_to: r.effective_to ? (r.effective_to as Date).toISOString() : null,
    retrieved_at: (r.retrieved_at as Date).toISOString(),
  }))
  versions = seeded.map(toPricingVersion).filter((v): v is PricingVersion => v !== null)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('migration 061 — shape, access and safety', () => {
  it('is additive: DDL/DML only on its own table, no DROP TABLE, no UPDATE/DELETE/TRUNCATE statement, never touches provider_usage_events', () => {
    expect(SQL).not.toMatch(/provider_usage_events/i)
    expect(SQL).not.toMatch(/DROP\s+TABLE/i)
    // The only UPDATE in the file is the trigger event name (BEFORE INSERT OR UPDATE ON), never a statement.
    expect(SQL).not.toMatch(/^\s*(UPDATE|DELETE\s+FROM|TRUNCATE)\s/im)
    const targets = [...SQL.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE|INSERT INTO|ON TABLE|CREATE INDEX IF NOT EXISTS \S+\s+ON)\s+(\w+)/gi)].map((m) => m[1])
    expect(new Set(targets)).toEqual(new Set(['provider_pricing_versions']))
  })

  it('is the only 061, with the earlier ledger migrations in place', () => {
    const numbered = readdirSync(join(process.cwd(), 'scripts')).filter((name) => /^\d{3}_.*\.sql$/.test(name))
    expect(numbered.filter((name) => name.startsWith('061_'))).toEqual([FILE])
    expect(numbered).toContain('044_create_provider_usage_events.sql')
  })

  it('RLS: a single SELECT policy for authenticated; grants are SELECT-only (no runtime writer, not even service_role)', () => {
    expect(SQL).toMatch(/ALTER TABLE provider_pricing_versions ENABLE ROW LEVEL SECURITY/i)
    const policies = SQL.match(/CREATE POLICY[^;]*;/gi) ?? []
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/FOR SELECT TO authenticated/i)
    const grants = (SQL.match(/GRANT[^;]*;/gi) ?? []).map((s) => s.replace(/\s+/g, ' ').trim())
    expect(grants).toEqual([
      'GRANT SELECT ON TABLE provider_pricing_versions TO authenticated;',
      'GRANT SELECT ON TABLE provider_pricing_versions TO service_role;',
    ])
  })

  it('at runtime: authenticated can read but cannot insert, update or delete', async () => {
    await db.exec('SET ROLE authenticated')
    try {
      const read = await db.query('SELECT count(*)::int AS n FROM provider_pricing_versions')
      expect((read.rows[0] as { n: number }).n).toBeGreaterThan(0)
      await expect(db.exec(insert())).rejects.toThrow(/permission denied/i)
      await expect(db.exec("UPDATE provider_pricing_versions SET price_amount = 0")).rejects.toThrow(/permission denied/i)
      await expect(db.exec('DELETE FROM provider_pricing_versions')).rejects.toThrow(/permission denied/i)
    } finally {
      await db.exec('RESET ROLE')
    }
  })

  it('at runtime: service_role cannot write the registry either', async () => {
    await db.exec('SET ROLE service_role')
    try {
      await expect(db.exec(insert())).rejects.toThrow(/permission denied/i)
    } finally {
      await db.exec('RESET ROLE')
    }
  })

  it('re-running the migration is a no-op (idempotent seed)', async () => {
    const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM provider_pricing_versions')).rows[0].n
    await db.exec(RAW)
    const after = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM provider_pricing_versions')).rows[0].n
    expect(after).toBe(before)
  })
})

describe('migration 061 — effective-dating rules enforced by the database', () => {
  it('rejects an overlapping window for the same (provider, model, category, tier)', async () => {
    await db.exec(insert({ effective_from: "'2026-01-01T00:00:00Z'", effective_to: "'2026-06-01T00:00:00Z'" }))
    await expect(db.exec(insert({ effective_from: "'2026-03-01T00:00:00Z'" }))).rejects.toThrow(/overlapping effective window/)
    // ... even in another currency
    await expect(db.exec(insert({ effective_from: "'2026-03-01T00:00:00Z'", currency: "'EUR'" }))).rejects.toThrow(/overlapping effective window/)
  })

  it('accepts a back-to-back successor (half-open windows) and different tier/category/model', async () => {
    await db.exec(insert({ effective_from: "'2026-06-01T00:00:00Z'", price_amount: '2' }))
    await db.exec(insert({ service_tier: "'flex'", effective_from: "'2026-03-01T00:00:00Z'" }))
    await db.exec(insert({ usage_category: "'output'", effective_from: "'2026-03-01T00:00:00Z'" }))
    await db.exec(insert({ model: "'m-other'", effective_from: "'2026-03-01T00:00:00Z'" }))
  })

  it('rejects the same effective_from twice (unique), an inverted window, a bad currency, a non-https source and a negative price', async () => {
    await expect(db.exec(insert({ effective_from: "'2026-01-01T00:00:00Z'" }))).rejects.toThrow()
    await expect(db.exec(insert({ model: "'m-x1'", effective_from: "'2026-05-01T00:00:00Z'", effective_to: "'2026-04-01T00:00:00Z'" }))).rejects.toThrow(/provider_pricing_versions_window/)
    await expect(db.exec(insert({ model: "'m-x2'", currency: "'usd'" }))).rejects.toThrow()
    await expect(db.exec(insert({ model: "'m-x3'", source_url: "'http://insecure.test'" }))).rejects.toThrow()
    await expect(db.exec(insert({ model: "'m-x4'", price_amount: '-1' }))).rejects.toThrow()
    await expect(db.exec(insert({ model: "'m-x5'", effective_from_basis: "'guess'" }))).rejects.toThrow()
    await expect(db.exec(insert({ model: "'m-x6'", usage_category: "'thoughts'" }))).rejects.toThrow()
  })

  it('a historical version stays priceable after the rate changes (windows, not overwrites)', async () => {
    const rows = (await db.query<Record<string, unknown>>("SELECT * FROM provider_pricing_versions WHERE model = 'm-test' AND usage_category = 'input' AND service_tier = 'standard' ORDER BY effective_from")).rows
    expect(rows).toHaveLength(2)
    expect(String(rows[0].price_amount)).toBe('1.000000000000')
    expect(String(rows[1].price_amount)).toBe('2.000000000000')
  })
})

describe('migration 061 — the seeded official prices', () => {
  it('every seeded row passes validation and carries provenance (official https source, retrieval date, effective basis)', () => {
    const seededOfficial = seeded.filter((r) => r.provider === 'gemini' || r.provider === 'kling')
    expect(seededOfficial.length).toBe(19)
    for (const row of seededOfficial) {
      expect(toPricingVersion(row)).not.toBeNull()
      expect(String(row.source_url)).toMatch(/^https:\/\/(ai\.google\.dev\/gemini-api\/docs\/pricing|kling\.ai\/document-api\/pricing\/base\/video)$/)
      expect(String(row.source_label).length).toBeGreaterThan(10)
      expect(new Date(String(row.retrieved_at)).toISOString()).toBe('2026-10-09T00:00:00.000Z')
      expect(String(row.currency)).toBe('USD')
    }
  })

  it('prices exactly the integrations that write usage rows today: Gemini Review models and Kling API units - not OpenAI, not Nano Banana', () => {
    const keys = new Set(seeded.filter((r) => ['gemini', 'kling'].includes(String(r.provider))).map((r) => `${r.provider}/${r.model}`))
    expect([...keys].sort()).toEqual(['gemini/gemini-3.5-flash', 'gemini/gemini-3.5-flash-lite', 'kling/kling-v3'])
    expect(seeded.some((r) => r.provider === 'openai')).toBe(false)
  })

  it('matches the official pricing page (Paid Tier, USD per 1M tokens, retrieved 2026-10-09)', () => {
    const price = (model: string, tier: string, category: string) => {
      const row = seeded.find((r) => r.model === model && r.service_tier === tier && r.usage_category === category)!
      return Number(row.price_amount)
    }
    const expected: Record<string, Record<string, [number, number, number]>> = {
      'gemini-3.5-flash': { standard: [1.5, 0.15, 9], flex: [0.75, 0.08, 4.5], priority: [2.7, 0.27, 16.2] },
      'gemini-3.5-flash-lite': { standard: [0.3, 0.03, 2.5], flex: [0.15, 0.02, 1.25], priority: [0.54, 0.05, 4.5] },
    }
    for (const [model, tiers] of Object.entries(expected)) {
      for (const [tier, [input, cached, output]] of Object.entries(tiers)) {
        expect([price(model, tier, 'input'), price(model, tier, 'cached_input'), price(model, tier, 'output')]).toEqual([input, cached, output])
      }
    }
    expect(price('kling-v3', 'standard', 'unit')).toBe(0.14)
  })

  it('effective dates carry their basis: Gemini = model GA date per the official changelog; Kling = retrieval date', () => {
    const flash = seeded.find((r) => r.model === 'gemini-3.5-flash')!
    const lite = seeded.find((r) => r.model === 'gemini-3.5-flash-lite')!
    const kling = seeded.find((r) => r.model === 'kling-v3')!
    expect([flash.effective_from, flash.effective_from_basis]).toEqual(['2026-05-19T00:00:00.000Z', 'model_release_no_documented_change'])
    expect([lite.effective_from, lite.effective_from_basis]).toEqual(['2026-07-21T00:00:00.000Z', 'model_release_no_documented_change'])
    expect([kling.effective_from, kling.effective_from_basis]).toEqual(['2026-10-09T00:00:00.000Z', 'retrieval_date'])
  })
})

describe('registry (from the real migration) x the usage rows that exist in Production', () => {
  const gemini = (overrides: Partial<ProviderUsageCostInput>): ProviderUsageCostInput => ({
    provider: 'gemini', transport: 'rest', operation: 'video_review', model: 'gemini-3.5-flash', quantity: 1_000_000, unit: 'input_tokens',
    measurementSource: 'provider_reported', occurredAt: '2026-10-08T17:38:46.650Z', funding: 'user_byok', serviceTier: 'standard', ...overrides,
  })

  it('the six Gemini Review rows (standard tier, BYOK) are priced; input, output and thinking each once', () => {
    const input = deriveProviderUsageCost(gemini({}), versions)
    const output = deriveProviderUsageCost(gemini({ unit: 'output_tokens' }), versions)
    const thoughts = deriveProviderUsageCost(gemini({ unit: 'tokens', usageCategory: 'thoughts' }), versions)
    expect([input, output, thoughts].map((c) => (c.status === 'estimated' ? c.amount : c.status))).toEqual(['1.5', '9', '9'])
  })

  it('Flash-Lite and tiers resolve to their own rows', () => {
    const lite = deriveProviderUsageCost(gemini({ model: 'gemini-3.5-flash-lite', unit: 'output_tokens' }), versions)
    expect(lite.status === 'estimated' && lite.amount).toBe('2.5')
    const priority = deriveProviderUsageCost(gemini({ serviceTier: 'priority' }), versions)
    expect(priority.status === 'estimated' && priority.amount).toBe('2.7')
  })

  it('the five Kling rows: none is priced - REST units predate the first observed price, MCP credits have no mapping, unknown stays unknown', () => {
    const kling = (overrides: Partial<ProviderUsageCostInput>): ProviderUsageCostInput => ({
      provider: 'kling', transport: 'rest', operation: 'text_to_video', model: 'kling-v3', quantity: 3, unit: 'units', measurementSource: 'provider_reported', occurredAt: '2026-09-28T20:58:46.861Z', ...overrides,
    })
    expect(deriveProviderUsageCost(kling({}), versions)).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(deriveProviderUsageCost(kling({ occurredAt: '2026-09-28T07:38:26.381Z', operation: 'image_to_video' }), versions)).toEqual({ status: 'unavailable', reason: 'pricing_not_effective_at_execution' })
    expect(deriveProviderUsageCost(kling({ transport: 'mcp', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurementSource: 'balance_delta', occurredAt: '2026-09-29T20:01:46.620Z' }), versions).status).toBe('unavailable')
    expect(deriveProviderUsageCost(kling({ transport: 'mcp', model: 'kling-video-v3_0', quantity: null, unit: null, measurementSource: 'unknown', occurredAt: '2026-09-30T07:55:08.924Z' }), versions)).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
    // A FUTURE Kling REST execution with reported units is priced.
    const future = deriveProviderUsageCost(kling({ occurredAt: '2026-10-20T00:00:00Z' }), versions)
    expect(future.status === 'estimated' && future.amount).toBe('0.42')
  })
})
