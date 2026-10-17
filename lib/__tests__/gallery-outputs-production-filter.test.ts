import { beforeEach, describe, expect, it } from 'vitest'
import { FILTER_ID_LIMIT, loadGalleryOutputs } from '@/lib/gallery/outputs-data'
import { decodeGalleryCursor, filterFingerprint, GALLERY_OUTPUT_TYPES, type GalleryOutputType, type GalleryOutputsResponse } from '@/lib/gallery/outputs'
import { createGalleryFakeDb, type FakeOptions, type Row } from './helpers/gallery-fake-db'

// S2A - the server-side Production filter, family by family.

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = u(1)
const OTHER = u(2)
const P1 = u(10)
const P2 = u(11)
const PR1 = u(20) // the Production under test (Project P1)
const PR2 = u(21) // another Production of P1
const PRX = u(22) // a Production of P2
const PR_THEIRS = u(23)
const t = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000000Z`

let tables: Record<string, Row[]>
let failing: Set<string>
let fakeOptions: FakeOptions
let log: ReturnType<typeof createGalleryFakeDb>['log']

const image = (n: number, over: Row = {}): Row => ({ id: u(100 + n), user_id: ME, project_id: P1, user_input: `Imagem ${n}`, generated_prompt: null, status: 'draft', model: 'm', mime_type: 'image/png', created_at: t(1, n), image_url: 'https://x', thumbnail_url: null, storage_path: null, thumbnail_path: null, ...over })
const attempt = (n: number, imageN: number, production: string | null, over: Row = {}): Row => ({ id: u(200 + n), user_id: ME, session_id: u(300 + n), project_id: P1, production_id: production, result_image_id: u(100 + imageN), status: 'succeeded', completed_at: t(1, imageN), ...over })
const draftOf = (n: number, imageN: number, production: string | null, over: Row = {}): Row => ({ id: u(700 + n), user_id: ME, project_id: P1, production_id: production, current_image_id: u(100 + imageN), ...over })
const videoGeneration = (n: number, over: Row = {}): Row => ({ id: u(400 + n), user_id: ME, project_id: P1, production_id: PR1, session_id: null, mode: 'text_to_video', prompt: `Vídeo ${n}`, provider: 'kling', model: 'k', status: 'succeeded', storage_path: 'private', library_file_id: null, created_at: t(2, n), ...over })
const execution = (n: number, over: Row = {}): Row => ({ id: u(500 + n), user_id: ME, project_id: P1, kind: 'video', status: 'completed', video_draft_id: u(600 + n), channel_piece_id: null, completed_at: t(3, n), output_mime_type: 'video/mp4', output_duration_ms: 1000, output_width: 1, output_height: 1, ...over })
const staticExecution = (n: number, piece: string, over: Row = {}): Row => execution(n, { kind: 'static_still', video_draft_id: null, channel_piece_id: piece, output_mime_type: 'image/png', ...over })

beforeEach(() => {
  failing = new Set()
  fakeOptions = {}
  tables = {
    projects: [{ id: P1, user_id: ME, name: 'Portal Norte' }, { id: P2, user_id: ME, name: 'Outro Project' }],
    productions: [
      { id: PR1, user_id: ME, project_id: P1, title: 'Campanha', intention: null },
      { id: PR2, user_id: ME, project_id: P1, title: 'Lançamento', intention: null },
      { id: PRX, user_id: ME, project_id: P2, title: 'Do P2', intention: null },
      { id: PR_THEIRS, user_id: OTHER, project_id: u(12), title: 'Alheia', intention: null },
    ],
    images: [], image_generation_attempts: [], image_drafts: [], library_files: [], video_generations: [], render_executions: [], video_drafts: [], channel_pieces: [], editorial_contents: [],
  }
})

async function run(query: Partial<Parameters<typeof loadGalleryOutputs>[1]> = {}): Promise<GalleryOutputsResponse> {
  const user = createGalleryFakeDb(tables, failing, new Set(), fakeOptions)
  const render = createGalleryFakeDb(tables, failing, new Set(), fakeOptions)
  const response = await loadGalleryOutputs(
    { userDb: user.db, renderDb: render.db, userId: ME },
    { types: GALLERY_OUTPUT_TYPES, projectId: P1, productionId: PR1, limit: 48, positions: {}, includeTotals: false, ...query },
  )
  log = [...user.log, ...render.log]
  return response
}

/** The same world with a Production in every family, plus every kind of non-member the rules must keep out. */
function seedWorld() {
  tables.images = [
    image(1), image(2), image(3), image(4), image(5), image(6, { project_id: P2 }), image(7), image(8), image(9, { image_url: null }),
  ]
  tables.image_generation_attempts = [
    attempt(1, 1, PR1), // member (Attempt)
    attempt(3, 3, PR1), attempt(33, 3, PR2), // conflict: two verified Productions
    attempt(4, 4, PR2), // other Production
    attempt(6, 6, PR1), // image lives in another Project: not a member
    attempt(7, 7, PR_THEIRS, { user_id: OTHER }), // someone else's claim does not exist for this owner
    attempt(8, 8, PR2), // the Attempt (PR2) wins over the draft (PR1)
    attempt(9, 9, PR1), // member by claim, but has no asset
  ]
  tables.image_drafts = [draftOf(2, 2, PR1), draftOf(8, 8, PR1)] // 2: member through the legacy draft only
  tables.video_generations = [
    videoGeneration(1), videoGeneration(2, { production_id: PR2 }), videoGeneration(3, { session_id: u(350) }),
    videoGeneration(4, { project_id: P2, production_id: PRX }), videoGeneration(5, { production_id: null }), videoGeneration(6, { status: 'failed' }),
  ]
  tables.video_drafts = [
    { id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'a' },
    { id: u(602), user_id: ME, project_id: P1, production_id: PR2, name: 'b' },
    { id: u(603), user_id: ME, project_id: P2, production_id: PR1, name: 'moved to another Project' },
  ]
  tables.editorial_contents = [
    { id: u(660), user_id: ME, project_id: P1, production_id: PR1, title: 'c1' },
    { id: u(661), user_id: ME, project_id: P1, production_id: PR2, title: 'c2' },
    { id: u(662), user_id: ME, project_id: P1, production_id: null, title: 'c3 unscoped' },
  ]
  tables.channel_pieces = [
    { id: u(650), user_id: ME, editorial_content_id: u(660) }, { id: u(651), user_id: ME, editorial_content_id: u(660) },
    { id: u(652), user_id: ME, editorial_content_id: u(661) }, { id: u(653), user_id: ME, editorial_content_id: u(662) },
  ]
  tables.render_executions = [
    execution(1), // member: draft of PR1
    execution(2), // draft of PR2
    execution(3, { video_draft_id: u(603) }), // draft sits in another Project
    execution(4, { project_id: P2 }), // render frozen in another Project
    staticExecution(11, u(650)), staticExecution(12, u(651)), // members: pieces of PR1's content
    staticExecution(13, u(652)), staticExecution(14, u(653)), // PR2 / no Production
    staticExecution(15, u(650), { project_id: P2 }),
    execution(5, { user_id: OTHER }), staticExecution(16, u(650), { user_id: OTHER }),
  ]
}

const keysOf = (response: GalleryOutputsResponse) => response.items.map((item) => item.key).sort()

describe('S2A - the Production filter selects exactly the verified members of every family', () => {
  it('returns the members of all four families and nothing else', async () => {
    seedWorld()
    const response = await run()
    expect(keysOf(response)).toEqual([
      `image:${u(101)}`, `image:${u(102)}`,
      `video_generation:${u(401)}`, `video_generation:${u(403)}`,
      `video_render:${u(501)}`,
      `static_render:${u(511)}`, `static_render:${u(512)}`,
    ].sort())
    for (const item of response.items) expect(item).toMatchObject({ productionId: PR1, productionState: 'resolved', projectId: P1 })
  })

  it('image membership follows the list rules: Attempts and legacy drafts count, conflicts / other Projects / other owners / no-asset do not', async () => {
    seedWorld()
    const keys = keysOf(await run({ types: ['image'] }))
    expect(keys).toEqual([`image:${u(101)}`, `image:${u(102)}`])
  })

  it('EQUIVALENCE: the filtered list is exactly the "resolved in this Production" subset of the unfiltered list', async () => {
    seedWorld()
    const all = await run({ projectId: null, productionId: null, limit: 100 })
    const expected = all.items.filter((item) => item.productionId === PR1 && item.productionState === 'resolved').map((item) => item.key).sort()
    expect(expected.length).toBe(7)
    expect(keysOf(await run())).toEqual(expected)
    // And the unfiltered list proves why the others are out: conflict / unscoped are separate states, never inside a Production.
    expect(all.items.find((item) => item.id === u(103))).toMatchObject({ productionState: 'conflict', productionId: null })
    expect(all.items.filter((item) => item.productionState === 'unscoped').length).toBeGreaterThan(0)
  })

  it('a Production with no output is genuinely empty: every source ok, no cursor, nothing partial', async () => {
    seedWorld()
    const response = await run({ productionId: PRX, projectId: P2 })
    // PRX has one AI video row, but in another family world the rest is empty.
    expect(response.items.map((item) => item.key)).toEqual([`video_generation:${u(404)}`])
    const none = await run({ productionId: PR2, projectId: P1, types: ['static_render'] })
    expect(none.items.map((item) => item.key)).toEqual([`static_render:${u(513)}`])
    tables.render_executions = []
    const empty = await run({ types: ['video_render', 'static_render'] })
    expect(empty).toMatchObject({ items: [], nextCursor: null, hasMore: false, partial: false })
  })

  it('filters BEFORE pagination: small pages never lose or repeat a member and never waste a page on non-members', async () => {
    seedWorld()
    const everything = (await run({ limit: 100 })).items.map((item) => item.key)
    for (const limit of [1, 2, 3]) {
      const seen: string[] = []
      let positions = {}
      let pages = 0
      for (; pages < 30; pages += 1) {
        const page = await run({ limit, positions })
        expect(page.items.length).toBeLessThanOrEqual(limit)
        if (page.nextCursor) expect(page.items.length).toBeGreaterThan(0) // a page that continues is never an empty page of rejects
        seen.push(...page.items.map((item) => item.key))
        if (!page.nextCursor) break
        const decoded = decodeGalleryCursor(page.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR1))
        if (!decoded.ok) throw new Error('cursor did not decode')
        positions = decoded.positions
      }
      expect(seen).toEqual(everything)
      expect(new Set(seen).size).toBe(seen.length)
    }
  })

  it('totals under the filter are exact and equal the members, per source and globally', async () => {
    seedWorld()
    const response = await run({ includeTotals: true, limit: 1 })
    expect(response.totals).toEqual({ bySource: { image: 2, video_generation: 2, video_render: 1, static_render: 2 }, global: 7, globalExact: true })
  })

  it('a Production whose count cannot be read never claims a global total', async () => {
    seedWorld()
    const user = createGalleryFakeDb(tables, new Set(), new Set(['video_generations']))
    const render = createGalleryFakeDb(tables)
    const response = await loadGalleryOutputs({ userDb: user.db, renderDb: render.db, userId: ME }, { types: GALLERY_OUTPUT_TYPES, projectId: P1, productionId: PR1, limit: 48, positions: {}, includeTotals: true })
    expect(response.totals).toMatchObject({ global: null, globalExact: false })
    expect(response.totals!.bySource.video_generation).toBeNull()
  })

  it('every family applies its filter inside the database query, before the page limit', async () => {
    seedWorld()
    await run({ includeTotals: true, limit: 5 })
    // The page lists only: the membership lookups of the same tables carry their own (id-set) ceiling.
    const lists = (table: string) => log.filter((entry) => entry.table === table && !entry.head && (table !== 'images' || entry.select.includes('user_input')))
    expect(lists('video_generations')[0].filters).toEqual(expect.arrayContaining(['eq:production_id', 'eq:project_id']))
    expect(lists('images')[0].filters).toEqual(expect.arrayContaining(['in:id', 'eq:project_id']))
    const renders = lists('render_executions')
    expect(renders.some((entry) => entry.filters.includes('in:video_draft_id'))).toBe(true)
    expect(renders.some((entry) => entry.filters.includes('in:channel_piece_id'))).toBe(true)
    for (const entry of [...lists('images'), ...lists('video_generations'), ...renders]) expect(entry.limit).toBe(6) // limit + 1: nothing fetched without bound
    for (const entry of log.filter((query) => query.head)) expect(entry.filters.some((f) => f === 'eq:production_id' || f.startsWith('in:'))).toBe(true) // counts use the same filter
  })

  it('the membership of a family is computed once per request, for the list and for its count', async () => {
    seedWorld()
    await run({ includeTotals: true })
    expect(log.filter((entry) => entry.table === 'video_drafts' && entry.filters.includes('eq:production_id')).length).toBe(1)
    expect(log.filter((entry) => entry.table === 'editorial_contents' && entry.filters.includes('eq:production_id')).length).toBe(1)
  })

  it('stays user-scoped everywhere, including the new lookups', async () => {
    seedWorld()
    await run({ includeTotals: true })
    for (const entry of log) expect(entry.filters, `${entry.table} must be owner-filtered`).toContain('eq:user_id')
  })

  it('without a Production nothing changes: no membership lookup is made', async () => {
    seedWorld()
    await run({ productionId: null, projectId: null })
    expect(log.some((entry) => entry.table === 'video_drafts' || entry.table === 'editorial_contents' || entry.table === 'channel_pieces')).toBe(true) // normal enrichment
    expect(log.filter((entry) => entry.table === 'video_drafts' && entry.filters.includes('eq:production_id')).length).toBe(0)
  })
})

describe('S2A - the filter fails honestly, per family', () => {
  it('a Production beyond the id ceiling fails the families that need an id set, and only them', async () => {
    seedWorld()
    tables.video_drafts = Array.from({ length: FILTER_ID_LIMIT + 1 }, (_, n) => ({ id: u(9000 + n), user_id: ME, project_id: P1, production_id: PR1, name: 'x' }))
    const response = await run()
    expect(response.sources.video_render).toEqual({ state: 'failed', code: 'PRODUCTION_FILTER_TOO_LARGE' })
    expect(response.sources.image).toMatchObject({ state: 'ok' })
    expect(response.sources.video_generation).toMatchObject({ state: 'ok' })
    expect(response.sources.static_render).toMatchObject({ state: 'ok' })
    expect(response.partial).toBe(true)
    expect(response.nextCursor).not.toBeNull() // the failed family still owes outputs
  })

  it('exactly the ceiling is complete', async () => {
    seedWorld()
    tables.video_drafts = Array.from({ length: FILTER_ID_LIMIT }, (_, n) => ({ id: u(601 + n), user_id: ME, project_id: P1, production_id: PR1, name: 'x' }))
    expect((await run({ types: ['video_render'] })).sources.video_render).toMatchObject({ state: 'ok' })
  })

  it('a cut-short membership lookup fails the family instead of filtering part of the Production', async () => {
    seedWorld()
    fakeOptions = { maxRows: { image_drafts: 1, image_generation_attempts: 1 } }
    expect((await run({ types: ['image'] })).sources.image).toEqual({ state: 'failed', code: 'PRODUCTION_FILTER_UNAVAILABLE' })
    fakeOptions = { maxRows: { channel_pieces: 1 } }
    expect((await run({ types: ['static_render'] })).sources.static_render).toEqual({ state: 'failed', code: 'PRODUCTION_FILTER_UNAVAILABLE' })
  })

  it('a failing lookup is a failed source, never an empty Production', async () => {
    seedWorld()
    failing = new Set(['editorial_contents'])
    const response = await run({ types: ['static_render', 'video_generation'] })
    expect(response.sources.static_render).toMatchObject({ state: 'failed' })
    expect(response.sources.video_generation).toMatchObject({ state: 'ok' })
    expect(response.items.map((item) => item.type)).toEqual(['video_generation', 'video_generation'])
    expect(response.partial).toBe(true)
  })

  it('a failed family keeps its place: it surfaces on a later page once it recovers, nothing skipped or duplicated', async () => {
    seedWorld()
    const healthy = (await run({ limit: 100 })).items.map((item) => item.key)
    const seen: string[] = []
    let positions = {}
    for (let page = 0; page < 20; page += 1) {
      failing = page === 0 ? new Set(['video_drafts']) : new Set()
      const response = await run({ limit: 2, positions })
      seen.push(...response.items.map((item) => item.key))
      if (!response.nextCursor) break
      const decoded = decodeGalleryCursor(response.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR1))
      if (!decoded.ok) throw new Error('cursor did not decode')
      positions = decoded.positions
    }
    expect([...seen].sort()).toEqual([...healthy].sort())
  })
})

describe('S2A - cursors are bound to the Production', () => {
  it('a position issued under one Production does not decode under another or without one', async () => {
    seedWorld()
    const page = await run({ limit: 1 })
    expect(decodeGalleryCursor(page.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR1))).toMatchObject({ ok: true })
    expect(decodeGalleryCursor(page.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR2))).toEqual({ ok: false, reason: 'FILTER_MISMATCH' })
    expect(decodeGalleryCursor(page.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, P1, null))).toEqual({ ok: false, reason: 'FILTER_MISMATCH' })
    expect(decodeGalleryCursor(page.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, null, null))).toEqual({ ok: false, reason: 'FILTER_MISMATCH' })
  })

  it('the fingerprint changes with every server-side filter', () => {
    const fingerprints = new Set([
      filterFingerprint(GALLERY_OUTPUT_TYPES, null, null), filterFingerprint(GALLERY_OUTPUT_TYPES, P1, null), filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR1),
      filterFingerprint(['image'] as GalleryOutputType[], P1, PR1), filterFingerprint(GALLERY_OUTPUT_TYPES, P1, PR2),
    ])
    expect(fingerprints.size).toBe(5)
  })
})
