import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeDb } from './helpers/fake-db'
import { deriveImageProduction, isUuid, ownedProductionIdOrNull, resolveOwnedProductionContext } from '@/lib/library/production-scope'

// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1 — synthetic data only.

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROD_A1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const PROD_A2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'
const PROD_B1 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'
const PROD_FOREIGN = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'
const IMAGE = '99999999-9999-4999-8999-999999999999'

const productions = [
  { id: PROD_A1, user_id: USER, project_id: PROJECT_A },
  { id: PROD_A2, user_id: USER, project_id: PROJECT_A },
  { id: PROD_B1, user_id: USER, project_id: PROJECT_B },
  { id: PROD_FOREIGN, user_id: OTHER_USER, project_id: PROJECT_A },
]

describe('migration 048 (scripts/048_library_files_production_scope.sql)', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', '048_library_files_production_scope.sql'), 'utf8')

  it('adds a NULLABLE production_id with ON DELETE SET NULL to the real productions table', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS production_id UUID NULL REFERENCES productions\(id\) ON DELETE SET NULL/)
    expect(sql).not.toMatch(/production_id UUID NOT NULL/)
  })

  it('extends (does not weaken or duplicate) the 046 ownership trigger: owner AND Project of the file', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.library_files_enforce_ownership\(\)/)
    // the 046 checks are all still there
    for (const kept of ['p.id = NEW.project_id AND p.user_id = NEW.user_id', 'i.id = NEW.source_image_id AND i.user_id = NEW.user_id', 'r.id = NEW.source_render_execution_id AND r.user_id = NEW.user_id']) expect(sql).toContain(kept)
    expect(sql).toContain('pr.id = NEW.production_id AND pr.user_id = NEW.user_id AND pr.project_id = NEW.project_id')
    expect(sql.match(/CREATE TRIGGER library_files_enforce_ownership/g)).toHaveLength(1)
    expect(sql).toMatch(/UPDATE OF user_id, project_id, production_id, source_image_id, source_render_execution_id/)
  })

  it('a Project move that does not touch the Production clears it; an explicit cross-Project assignment is refused', () => {
    expect(sql).toMatch(/NEW\.production_id IS NOT DISTINCT FROM OLD\.production_id\s+AND NEW\.project_id IS DISTINCT FROM OLD\.project_id/)
    expect(sql).toMatch(/NEW\.production_id := NULL/)
    expect(sql).toMatch(/RAISE EXCEPTION 'library_files\.production_id must reference a Production of the file owner/)
  })

  it('opens ONLY production_id to UPDATE (immutable provenance stays closed) and never touches folder/path columns', () => {
    const grants = [...sql.matchAll(/GRANT UPDATE \(([^)]+)\)/g)].map((match) => match[1].trim())
    expect(grants).toEqual(['production_id'])
    expect(sql).not.toMatch(/REVOKE UPDATE/)
    expect(sql).not.toMatch(/storage_path\s*=|folder\s*=|parent_path|parent_id/)
  })

  it('has exactly the two justified browse indexes, scoped to active files', () => {
    const indexes = [...sql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)\s+ON library_files \(([^)]+)\)\s+WHERE ([^;]+);/g)]
    expect(indexes.map((match) => match[1])).toEqual(['idx_library_files_browse', 'idx_library_files_production_browse'])
    expect(indexes[0][2].replace(/\s+/g, ' ')).toBe('user_id, project_id, created_at DESC, id DESC')
    expect(indexes[1][2].replace(/\s+/g, ' ')).toBe('user_id, project_id, production_id, created_at DESC, id DESC')
    for (const index of indexes) expect(index[3]).toContain('deleted_at IS NULL')
  })

  describe('the backfill is deterministic and provenance-only', () => {
    const backfill = sql.slice(sql.indexOf('WITH candidates AS'))

    it('only ever fills NULLs and only when EXACTLY ONE distinct valid Production exists', () => {
      expect(backfill).toMatch(/HAVING count\(DISTINCT production_id\) = 1/)
      expect(backfill).toMatch(/WHERE lf\.id = uc\.file_id AND lf\.production_id IS NULL/)
    })

    it('requires the candidate Production to belong to the file’s own Project and owner', () => {
      expect(backfill).toMatch(/p\.project_id = lf\.project_id AND p\.user_id = lf\.user_id/)
    })

    it('uses only durable provenance: renders, image drafts, the video promotion pointer, ChannelPiece attachment', () => {
      for (const source of ['render_executions', 'video_drafts', 'channel_pieces', 'editorial_contents', 'image_drafts', 'video_generations', 'channel_piece_media']) expect(backfill).toContain(source)
    })

    it('never guesses: no folder/name/timestamp/min/max/first/newest inference', () => {
      expect(backfill).not.toMatch(/\bMIN\(|\bMAX\(|LIMIT 1|ORDER BY|ILIKE|LIKE\b|created_at|updated_at\s*=|folder|\.name\b/i)
    })

    it('does not bump updated_at and restores the trigger', () => {
      expect(sql).toMatch(/DISABLE TRIGGER update_library_files_updated_at;[\s\S]*ENABLE TRIGGER update_library_files_updated_at;/)
    })
  })

  it('is additive: no DROP TABLE/COLUMN, no DELETE, no historical migration touched, only library_files altered', () => {
    expect(sql).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i)
    expect(sql.match(/ALTER TABLE (\w+)/g)?.every((statement) => /ALTER TABLE library_files/.test(statement))).toBe(true)
    const numbers = readdirSync(join(process.cwd(), 'scripts')).filter((name) => /^04[0-9]_/.test(name))
    expect(numbers).toContain('048_library_files_production_scope.sql')
    expect(numbers.filter((name) => name.startsWith('048_'))).toHaveLength(1)
  })
})

describe('resolveOwnedProductionContext / ownedProductionIdOrNull', () => {
  const db = () => createFakeDb({ seed: { productions }, generatedId: [] }) as any

  it('accepts the owner’s own Production of THIS Project', async () => {
    expect(await resolveOwnedProductionContext(db(), { userId: USER, projectId: PROJECT_A, productionId: PROD_A1 })).toEqual({ ok: true, productionId: PROD_A1 })
  })

  it.each([
    ['a Production of another Project of the same user', PROJECT_A, PROD_B1, USER],
    ['another user’s Production', PROJECT_A, PROD_FOREIGN, USER],
    ['an unknown uuid', PROJECT_A, '12345678-1234-4234-8234-123456789012', USER],
    ['a non-uuid', PROJECT_A, 'not-a-uuid', USER],
    ['no Project', null, PROD_A1, USER],
  ])('refuses %s', async (_name, projectId, productionId, userId) => {
    expect(await resolveOwnedProductionContext(db(), { userId, projectId: projectId as string, productionId })).toEqual({ ok: false, code: 'PRODUCTION_NOT_FOUND' })
  })

  it('ownedProductionIdOrNull is lenient for server relationships: a valid id passes, anything unusable becomes NULL', async () => {
    expect(await ownedProductionIdOrNull(db(), { userId: USER, projectId: PROJECT_A, productionId: PROD_A1 })).toBe(PROD_A1)
    expect(await ownedProductionIdOrNull(db(), { userId: USER, projectId: PROJECT_A, productionId: PROD_B1 })).toBeNull()
    expect(await ownedProductionIdOrNull(db(), { userId: USER, projectId: PROJECT_A, productionId: null })).toBeNull()
  })

  it('isUuid', () => {
    expect(isUuid(PROD_A1)).toBe(true)
    expect(isUuid('x')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('deriveImageProduction — never fabricates a Production', () => {
  const draft = (overrides: Record<string, unknown>) => ({ id: crypto.randomUUID(), user_id: USER, production_id: null, current_image_id: null, generation_attempts: [], ...overrides })
  const derive = (drafts: Array<Record<string, unknown>>) => deriveImageProduction(createFakeDb({ seed: { image_drafts: drafts, productions }, generatedId: [] }) as any, { userId: USER, projectId: PROJECT_A, imageId: IMAGE })

  it('resolved: the draft that holds the image as its CURRENT image', async () => {
    expect(await derive([draft({ production_id: PROD_A1, current_image_id: IMAGE })])).toEqual({ kind: 'resolved', productionId: PROD_A1 })
  })

  it('resolved: a draft that recorded the image as an ATTEMPT', async () => {
    expect(await derive([draft({ production_id: PROD_A2, generation_attempts: [{ imageId: IMAGE }, { imageId: 'other' }] })])).toEqual({ kind: 'resolved', productionId: PROD_A2 })
  })

  it('resolved once when the current-image draft and an attempt draft agree', async () => {
    expect(await derive([draft({ production_id: PROD_A1, current_image_id: IMAGE }), draft({ production_id: PROD_A1, generation_attempts: [{ imageId: IMAGE }] })])).toEqual({ kind: 'resolved', productionId: PROD_A1 })
  })

  it('unscoped: no draft, or drafts without a Production', async () => {
    expect(await derive([])).toEqual({ kind: 'unscoped' })
    expect(await derive([draft({ production_id: null, current_image_id: IMAGE })])).toEqual({ kind: 'unscoped' })
    expect(await derive([draft({ production_id: PROD_A1, current_image_id: 'some-other-image' })])).toEqual({ kind: 'unscoped' })
  })

  it('ambiguous: conflicting Productions are reported, never resolved by "newest"/"first"', async () => {
    const result = await derive([draft({ production_id: PROD_A1, current_image_id: IMAGE }), draft({ production_id: PROD_A2, generation_attempts: [{ imageId: IMAGE }] })])
    expect(result.kind).toBe('ambiguous')
    expect((result as { productionIds: string[] }).productionIds).toEqual([PROD_A1, PROD_A2].sort())
  })

  it('a candidate from another Project or another user is ignored (and cannot create an ambiguity)', async () => {
    expect(await derive([draft({ production_id: PROD_B1, current_image_id: IMAGE })])).toEqual({ kind: 'unscoped' })
    expect(await derive([draft({ production_id: PROD_A1, current_image_id: IMAGE }), draft({ production_id: PROD_B1, generation_attempts: [{ imageId: IMAGE }] })])).toEqual({ kind: 'resolved', productionId: PROD_A1 })
    const foreignDraft = draft({ user_id: OTHER_USER, production_id: PROD_FOREIGN, current_image_id: IMAGE })
    expect(await derive([foreignDraft])).toEqual({ kind: 'unscoped' })
  })
})

describe('deriveImageProduction — query contract', () => {
  const imageDrafts = (handlers: { current?: unknown; attempts?: unknown }) => {
    const contains: unknown[] = []
    const chain = (result: unknown) => {
      const api: any = { select: () => api, eq: () => api, not: () => api, contains: (_column: string, value: unknown) => (contains.push(value), api), then: (resolve: (value: unknown) => void) => resolve(result) }
      return api
    }
    let call = 0
    return { contains, client: { from: (table: string) => (table === 'image_drafts' ? chain(call++ === 0 ? handlers.current : handlers.attempts) : createFakeDb({ seed: { productions }, generatedId: [] }).from(table)) } as any }
  }

  it('hands jsonb containment over as a JSON STRING (a JS array of objects would become a Postgres array literal)', async () => {
    const stub = imageDrafts({ current: { data: [], error: null }, attempts: { data: [], error: null } })
    await deriveImageProduction(stub.client, { userId: USER, projectId: PROJECT_A, imageId: IMAGE })
    expect(stub.contains).toEqual([JSON.stringify([{ imageId: IMAGE }])])
  })

  it('fails closed to "unscoped" when a relationship cannot be read (never a partial guess)', async () => {
    const failing = imageDrafts({ current: { data: [{ production_id: PROD_A1 }], error: null }, attempts: { data: null, error: { message: 'boom' } } })
    expect(await deriveImageProduction(failing.client, { userId: USER, projectId: PROJECT_A, imageId: IMAGE })).toEqual({ kind: 'unscoped' })
    const failingFirst = imageDrafts({ current: { data: null, error: { message: 'boom' } }, attempts: { data: [{ production_id: PROD_A1 }], error: null } })
    expect(await deriveImageProduction(failingFirst.client, { userId: USER, projectId: PROJECT_A, imageId: IMAGE })).toEqual({ kind: 'unscoped' })
  })
})
