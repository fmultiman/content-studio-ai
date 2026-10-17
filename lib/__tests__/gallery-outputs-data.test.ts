import { beforeEach, describe, expect, it } from 'vitest'
import { loadGalleryOutputs } from '@/lib/gallery/outputs-data'
import { decodeGalleryCursor, filterFingerprint, GALLERY_OUTPUT_TYPES, type GalleryOutput, type GalleryOutputType, type GalleryOutputsResponse } from '@/lib/gallery/outputs'
import { createGalleryFakeDb, type Row } from './helpers/gallery-fake-db'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = u(1)
const OTHER = u(2)
const P1 = u(10)
const P2 = u(11)
const PR1 = u(20) // Production of P1
const PR2 = u(21) // another Production of P1
const PRX = u(22) // Production of P2
const PR_THEIRS = u(23) // someone else's
const t = (day: number, hour = 10, micro = 0) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.${String(micro).padStart(6, '0')}Z`

let tables: Record<string, Row[]>
let failing: Set<string>
let failingHead: Set<string>
let log: ReturnType<typeof createGalleryFakeDb>['log']
let renderEnabled: boolean

const image = (n: number, over: Row = {}): Row => ({ id: u(100 + n), user_id: ME, project_id: P1, user_input: `Imagem ${n}`, generated_prompt: null, status: 'draft', model: 'gpt-image-2', mime_type: 'image/png', created_at: t(1, n), image_url: 'https://cdn/x', thumbnail_url: null, storage_path: `users/${ME}/images/${u(900 + n)}/original.png`, thumbnail_path: null, ...over })
const attempt = (n: number, imageN: number, over: Row = {}): Row => ({ id: u(200 + n), user_id: ME, session_id: u(300 + n), project_id: P1, production_id: PR1, result_image_id: u(100 + imageN), status: 'succeeded', completed_at: t(1, imageN), ...over })
const videoGeneration = (n: number, over: Row = {}): Row => ({ id: u(400 + n), user_id: ME, project_id: P1, production_id: PR1, session_id: null, mode: 'text_to_video', prompt: `Vídeo ${n}`, provider: 'kling', model: 'kling-v2', status: 'succeeded', storage_path: `${ME}/videos/ai/${P1}/${u(400 + n)}.mp4`, public_url: 'https://private/signed', library_file_id: null, created_at: t(2, n), result_metadata: { completed_at: t(2, n + 1) }, ...over })
const execution = (n: number, over: Row = {}): Row => ({ id: u(500 + n), user_id: ME, project_id: P1, kind: 'video', status: 'completed', video_draft_id: u(600 + n), channel_piece_id: null, completed_at: t(3, n), output_bucket: 'private-bucket', output_storage_path: `users/${ME}/renders/scratch/${u(500 + n)}/output.mp4`, output_mime_type: 'video/mp4', output_duration_ms: 5000, output_width: 1080, output_height: 1920, input_snapshot: { slide: { id: 'slide-2', index: 2, total: 5 }, secret: 'frozen' }, claimed_by: 'worker-1', lease_expires_at: t(3, n), error_detail: 'boom', ...over })

beforeEach(() => {
  failing = new Set()
  failingHead = new Set()
  renderEnabled = true
  tables = {
    projects: [{ id: P1, user_id: ME, name: 'Portal Norte' }, { id: P2, user_id: ME, name: 'Outro Project' }],
    productions: [
      { id: PR1, user_id: ME, project_id: P1, title: 'Campanha de outono', intention: 'Campanha' },
      { id: PR2, user_id: ME, project_id: P1, title: 'Lançamento', intention: null },
      { id: PRX, user_id: ME, project_id: P2, title: 'Produção do P2', intention: null },
      { id: PR_THEIRS, user_id: OTHER, project_id: u(12), title: 'Alheia', intention: null },
    ],
    images: [], image_generation_attempts: [], image_drafts: [], library_files: [], video_generations: [], render_executions: [], video_drafts: [], channel_pieces: [], editorial_contents: [],
  }
})

async function run(query: Partial<Parameters<typeof loadGalleryOutputs>[1]> = {}, userId = ME): Promise<GalleryOutputsResponse> {
  const user = createGalleryFakeDb(tables, failing, failingHead)
  const render = createGalleryFakeDb(tables, failing, failingHead)
  log = [...user.log, ...render.log]
  const response = await loadGalleryOutputs(
    { userDb: user.db, renderDb: renderEnabled ? render.db : null, userId },
    { types: GALLERY_OUTPUT_TYPES, projectId: null, limit: 48, positions: {}, includeTotals: false, ...query },
  )
  log = [...user.log, ...render.log]
  return response
}

const byId = (response: GalleryOutputsResponse, id: string) => response.items.find((entry) => entry.id === id)!

describe('source family 1: AI images', () => {
  it('an image with Attempts takes its Session, its newest Attempt and its verified Production - once, however many Attempts name it', async () => {
    tables.images = [image(1)]
    tables.image_generation_attempts = [attempt(1, 1, { session_id: u(301), completed_at: t(1, 1) }), attempt(2, 1, { session_id: u(301), completed_at: t(1, 5) }), attempt(3, 1, { session_id: u(301), completed_at: t(1, 3) })]
    const response = await run()
    expect(response.items).toHaveLength(1)
    expect(response.items[0]).toMatchObject({
      key: `image:${u(101)}`, type: 'image', mediaType: 'image', projectId: P1, projectName: 'Portal Norte', productionId: PR1, productionName: 'Campanha de outono',
      productionState: 'resolved', productionHref: `/projetos/${P1}/producoes/${PR1}`, provenance: { kind: 'image_session', sessionId: u(301), attemptId: u(202) },
      sourceHref: `/imagens/geracoes/${u(301)}`, status: 'generated', occurredAtKind: 'created',
    })
  })

  it('an image whose Attempts disagree about the Production is a conflict: no Production is guessed', async () => {
    tables.images = [image(1)]
    tables.image_generation_attempts = [attempt(1, 1, { production_id: PR1 }), attempt(2, 1, { production_id: PR2 })]
    const entry = (await run()).items[0]
    expect(entry).toMatchObject({ productionId: null, productionName: null, productionHref: null, productionState: 'conflict' })
    expect(entry.projectId).toBe(P1)
  })

  it('a Production claim of another Project, or of another user, does not count', async () => {
    tables.images = [image(1), image(2)]
    tables.image_generation_attempts = [attempt(1, 1, { production_id: PRX }), attempt(2, 2, { production_id: PR_THEIRS })]
    const response = await run()
    for (const entry of response.items) expect(entry).toMatchObject({ productionId: null, productionState: 'unscoped' })
  })

  it('legacy draft: used only when no Attempt names the image, and its Production still has to verify', async () => {
    tables.images = [image(1), image(2), image(3)]
    tables.image_drafts = [
      { id: u(700), user_id: ME, project_id: P1, production_id: PR1, current_image_id: u(101) },
      { id: u(701), user_id: ME, project_id: P1, production_id: PR2, current_image_id: u(102) }, // image 102 also has an Attempt: the Attempt wins
      { id: u(702), user_id: ME, project_id: P1, production_id: PRX, current_image_id: u(103) }, // wrong Project: unverifiable
    ]
    tables.image_generation_attempts = [attempt(1, 2, { production_id: PR1, session_id: null })]
    const response = await run()
    expect(byId(response, u(101))).toMatchObject({ productionId: PR1, provenance: { kind: 'legacy_image_draft', draftId: u(700) }, sourceHref: null })
    expect(byId(response, u(102))).toMatchObject({ productionId: PR1, provenance: { kind: 'image_attempt', attemptId: u(201) } })
    expect(byId(response, u(103))).toMatchObject({ productionId: null, productionState: 'unscoped' })
  })

  it('preserves a valid legacy image whose Attempt and Draft are unknown - unscoped, never invented', async () => {
    tables.images = [image(1, { project_id: null }), image(2)]
    const response = await run()
    expect(byId(response, u(101))).toMatchObject({ projectId: null, projectName: null, productionId: null, productionState: 'unscoped', provenance: null, sourceHref: null })
    expect(byId(response, u(102))).toMatchObject({ projectId: P1, productionId: null, productionState: 'unscoped', provenance: null })
  })

  it('lists only images that carry an asset, and only the caller\'s', async () => {
    tables.images = [image(1), image(2, { image_url: null, thumbnail_url: null, storage_path: null, thumbnail_path: null }), image(3, { user_id: OTHER })]
    expect((await run()).items.map((entry) => entry.id)).toEqual([u(101)])
  })

  it('carries the review status of the image and an annotation for live saved files only', async () => {
    tables.images = [image(1, { status: 'approved' }), image(2, { status: 'rejected' })]
    tables.library_files = [
      { id: u(800), user_id: ME, source_image_id: u(101), deleted_at: null, created_at: t(5) },
      { id: u(801), user_id: ME, source_image_id: u(101), deleted_at: t(6), created_at: t(5) },
      { id: u(802), user_id: OTHER, source_image_id: u(101), deleted_at: null, created_at: t(5) },
    ]
    const response = await run()
    expect(byId(response, u(101))).toMatchObject({ status: 'approved', savedLibraryFileIds: [u(800)] })
    expect(byId(response, u(102))).toMatchObject({ status: 'rejected', savedLibraryFileIds: [] })
  })
})

describe('source family 2: AI videos', () => {
  it('Session-linked and standalone historical generations both stay visible; a Session is never invented', async () => {
    tables.video_generations = [videoGeneration(1, { session_id: u(350) }), videoGeneration(2)]
    const response = await run({ types: ['video_generation'] })
    expect(byId(response, u(401))).toMatchObject({ type: 'video_generation', mediaType: 'video', provenance: { kind: 'video_session', sessionId: u(350) }, sourceHref: `/videos/geracoes/${u(350)}` })
    expect(byId(response, u(402))).toMatchObject({ provenance: { kind: 'video_standalone' }, sourceHref: null, productionId: PR1, productionHref: `/projetos/${P1}/producoes/${PR1}` })
  })

  it('lists only succeeded generations with a stored object', async () => {
    tables.video_generations = [
      videoGeneration(1), videoGeneration(2, { status: 'processing' }), videoGeneration(3, { status: 'failed' }), videoGeneration(4, { status: 'queued' }),
      videoGeneration(5, { storage_path: null }), videoGeneration(6, { user_id: OTHER }),
    ]
    expect((await run({ types: ['video_generation'] })).items.map((entry) => entry.id)).toEqual([u(401)])
  })

  it('a Production of another Project does not verify; the saved-file annotation only counts while the file is live', async () => {
    tables.video_generations = [videoGeneration(1, { production_id: PRX }), videoGeneration(2, { library_file_id: u(810) }), videoGeneration(3, { library_file_id: u(811) })]
    tables.library_files = [{ id: u(810), user_id: ME, deleted_at: null }, { id: u(811), user_id: ME, deleted_at: t(9) }]
    const response = await run({ types: ['video_generation'] })
    expect(byId(response, u(401))).toMatchObject({ productionId: null, productionState: 'unscoped' })
    expect(byId(response, u(402)).savedLibraryFileIds).toEqual([u(810)])
    expect(byId(response, u(403)).savedLibraryFileIds).toEqual([])
  })
})

describe('source families 3 and 4: Creative Editor renders', () => {
  beforeEach(() => {
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser de outono' }]
    tables.channel_pieces = [{ id: u(650), user_id: ME, editorial_content_id: u(660) }]
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P1, production_id: PR1, title: 'Carrossel de abertura' }]
  })

  it('a completed video render resolves its Production through its VideoDraft and opens the Creative Editor', async () => {
    tables.render_executions = [execution(1)]
    const entry = (await run({ types: ['video_render'] })).items[0]
    expect(entry).toMatchObject({
      key: `video_render:${u(501)}`, mediaType: 'video', title: 'Teaser de outono', occurredAtKind: 'completed', occurredAt: t(3, 1), productionId: PR1, productionState: 'resolved',
      provenance: { kind: 'video_draft', videoDraftId: u(601) }, sourceHref: `/creative-editor/video/${u(601)}`, media: { mimeType: 'video/mp4', durationMs: 5000, width: 1080, height: 1920 },
    })
  })

  it('a completed static render resolves its Production through ChannelPiece -> EditorialContent and names the slide', async () => {
    tables.render_executions = [execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650), output_mime_type: 'image/png', output_duration_ms: null })]
    const entry = (await run({ types: ['static_render'] })).items[0]
    expect(entry).toMatchObject({
      key: `static_render:${u(502)}`, mediaType: 'image', title: 'Carrossel de abertura · Slide 2/5', productionId: PR1, productionState: 'resolved',
      provenance: { kind: 'channel_piece', channelPieceId: u(650), editorialContentId: u(660) },
      sourceHref: `/projetos/${P1}/conteudos/${u(660)}/channel-pieces/${u(650)}/editar-visual`,
    })
  })

  it('a render whose draft/content now sits in another Project is a conflict, not a guess', async () => {
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P2, production_id: PRX, name: 'Movido' }]
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P2, production_id: PRX, title: 'Movido' }]
    tables.render_executions = [execution(1), execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) })]
    const response = await run()
    expect(byId(response, u(501))).toMatchObject({ projectId: P1, productionId: null, productionState: 'conflict' })
    expect(byId(response, u(502))).toMatchObject({ projectId: P1, productionId: null, productionState: 'conflict' })
  })

  it('a static render with no Production on its content is unscoped', async () => {
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P1, production_id: null, title: 'Sem produção' }]
    tables.render_executions = [execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) })]
    expect((await run({ types: ['static_render'] })).items[0]).toMatchObject({ productionId: null, productionState: 'unscoped', productionName: null })
  })

  it('splits the two kinds, keeps only completed ones, and never mixes another user\'s renders in', async () => {
    tables.render_executions = [
      execution(1), execution(2, { status: 'queued' }), execution(3, { status: 'claimed' }), execution(4, { status: 'failed' }), execution(5, { user_id: OTHER }),
      execution(6, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) }), execution(7, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650), status: 'failed' }),
    ]
    const response = await run()
    expect(response.items.map((entry) => entry.key).sort()).toEqual([`static_render:${u(506)}`, `video_render:${u(501)}`].sort())
  })

  it('DEDUPLICATION: several saved LibraryFiles of one execution are one output, annotated; deleted files are ignored', async () => {
    tables.render_executions = [execution(6, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) })]
    tables.library_files = [
      { id: u(820), user_id: ME, source_render_execution_id: u(506), origin: 'studio_render', deleted_at: null, created_at: t(4, 1) },
      { id: u(821), user_id: ME, source_render_execution_id: u(506), origin: 'studio_render', deleted_at: null, created_at: t(4, 2) },
      { id: u(822), user_id: ME, source_render_execution_id: u(506), origin: 'studio_render', deleted_at: null, created_at: t(4, 3) },
      { id: u(823), user_id: ME, source_render_execution_id: u(506), origin: 'studio_render', deleted_at: t(9), created_at: t(4, 4) },
    ]
    const response = await run()
    expect(response.items).toHaveLength(1)
    expect(response.items[0].savedLibraryFileIds).toEqual([u(820), u(821), u(822)])
  })

  it('a saved LibraryFile is never an output by itself, even when its render is no longer listed', async () => {
    tables.library_files = [{ id: u(830), user_id: ME, source_render_execution_id: u(999), origin: 'studio_render', kind: 'image', deleted_at: null, created_at: t(4) }]
    const response = await run()
    expect(response.items).toEqual([])
    expect(log.some((entry) => entry.table === 'library_files')).toBe(false) // no page row asked for any annotation
  })
})

describe('ownership and what the response may reveal', () => {
  beforeEach(() => {
    tables.images = [image(1), image(2, { user_id: OTHER })]
    tables.image_generation_attempts = [attempt(1, 1), attempt(2, 1, { user_id: OTHER, production_id: PR_THEIRS })]
    tables.video_generations = [videoGeneration(1), videoGeneration(2, { user_id: OTHER })]
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser' }]
    tables.render_executions = [execution(1), execution(2, { user_id: OTHER })]
  })

  it('every query carries the caller\'s user_id, and the other user sees only their own rows', async () => {
    const mine = await run()
    expect(mine.items.map((entry) => entry.id).sort()).toEqual([u(101), u(401), u(501)].sort())
    for (const entry of log) expect(entry.filters, `${entry.table} must be owner-filtered`).toContain('eq:user_id')

    const theirs = await run({}, OTHER)
    expect(theirs.items.map((entry) => entry.id).sort()).toEqual([u(102), u(402), u(502)].sort())
    expect(theirs.items.find((entry) => entry.id === u(102))!.productionId).toBeNull() // their Attempt does not exist for u(102)
  })

  it('exposes no storage path, bucket, worker, lease, snapshot, provider URL or signed URL - they are not even selected', async () => {
    const serialized = JSON.stringify(await run())
    for (const forbidden of ['storage_path', 'output_storage_path', 'output_bucket', 'public_url', 'claimed_by', 'lease_expires_at', 'input_snapshot', 'error_detail', 'private-bucket', 'https://', 'X-Amz', 'users/', '/videos/ai/', 'frozen', 'secret']) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }
    for (const entry of log) {
      for (const column of ['storage_path', 'thumbnail_path', 'image_url', 'public_url', 'output_storage_path', 'output_bucket', 'claimed_by', 'lease_expires_at', 'error_detail']) {
        expect(entry.select.split(',').map((part) => part.trim()), `${entry.table} selects ${column}`).not.toContain(column)
      }
      expect(entry.select).not.toContain('*')
      expect(entry.select).not.toMatch(/input_snapshot(?!->)/)
    }
  })

  it('the access paths are the existing per-item endpoints, not URLs', async () => {
    for (const entry of (await run()).items) {
      expect(entry.access.previewEndpoint).toMatch(/^\/api\/(images|video-generations|render-executions)\//)
      expect(entry.access.downloadEndpoint).toMatch(/^\/api\/(images|video-generations|render-executions)\//)
    }
  })

  it('is read-only: the fake throws on any write, and nothing was thrown', async () => {
    await expect(run()).resolves.toBeDefined()
  })
})

describe('filters and bounded queries', () => {
  beforeEach(() => {
    tables.images = [image(1)]
    tables.video_generations = [videoGeneration(1)]
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'Teaser' }]
    tables.render_executions = [execution(1)]
  })

  it('type filtering is server-side: unselected sources are skipped, never queried, never reported empty', async () => {
    const response = await run({ types: ['static_render', 'image'] })
    expect(response.items.map((entry) => entry.type)).toEqual(['image'])
    expect(response.sources.video_generation).toEqual({ state: 'skipped' })
    expect(response.sources.video_render).toEqual({ state: 'skipped' })
    expect(response.sources.static_render).toMatchObject({ state: 'ok' })
    expect(log.some((entry) => entry.table === 'video_generations')).toBe(false)
    expect(log.filter((entry) => entry.table === 'render_executions').length).toBe(1) // only the static kind
  })

  it('project filter is server-side on every source', async () => {
    tables.images.push(image(2, { project_id: P2 }))
    tables.video_generations.push(videoGeneration(2, { project_id: P2, production_id: PRX }))
    tables.render_executions.push(execution(2, { project_id: P2 }))
    const response = await run({ projectId: P2 })
    expect(response.items.map((entry) => entry.id).sort()).toEqual([u(102), u(402), u(502)].sort())
  })

  it('every list query is bounded by limit + 1 and ordered by (instant, id) descending', async () => {
    await run({ limit: 5 })
    const lists = log.filter((entry) => ['images', 'video_generations', 'render_executions'].includes(entry.table) && !entry.head)
    expect(lists).toHaveLength(4)
    for (const entry of lists) {
      expect(entry.limit).toBe(6)
      expect(entry.order.slice(-1)).toEqual(['id'])
    }
    for (const entry of log.filter((query) => !query.head && !['images', 'video_generations', 'render_executions'].includes(query.table))) {
      expect(entry.filters.some((filter) => filter.startsWith('in:')) || entry.limit !== undefined, `${entry.table} lookup must be id-bounded`).toBe(true)
    }
  })
})

describe('ordering and pagination', () => {
  async function walk(query: Partial<Parameters<typeof loadGalleryOutputs>[1]>): Promise<{ keys: string[]; pages: GalleryOutputsResponse[] }> {
    const pages: GalleryOutputsResponse[] = []
    const keys: string[] = []
    let positions = {}
    const types = (query.types ?? GALLERY_OUTPUT_TYPES) as GalleryOutputType[]
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await run({ ...query, positions })
      pages.push(page)
      keys.push(...page.items.map((entry) => entry.key))
      if (!page.nextCursor) break
      const decoded = decodeGalleryCursor(page.nextCursor, filterFingerprint(types, query.projectId ?? null))
      if (!decoded.ok) throw new Error('cursor did not decode')
      positions = decoded.positions
    }
    return { keys, pages }
  }

  beforeEach(() => {
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'x' }]
    tables.channel_pieces = [{ id: u(650), user_id: ME, editorial_content_id: u(660) }]
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P1, production_id: PR1, title: 'c' }]
  })

  it('orders all four sources by the persisted instant, newest first, never by updated_at', async () => {
    tables.images = [image(1, { created_at: t(1), updated_at: t(30) })]
    tables.video_generations = [videoGeneration(1, { created_at: t(5), updated_at: t(2) })]
    tables.render_executions = [execution(1, { completed_at: t(4) }), execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650), completed_at: t(3) })]
    const response = await run()
    expect(response.items.map((entry) => entry.type)).toEqual(['video_generation', 'video_render', 'static_render', 'image'])
  })

  it('tied instants across sources are ordered by key; tied instants inside one source by id', async () => {
    const tie = t(7, 12, 123456)
    tables.images = [image(1, { created_at: tie }), image(2, { created_at: tie })]
    tables.video_generations = [videoGeneration(1, { created_at: tie })]
    const response = await run({ limit: 10 })
    expect(response.items.map((entry) => entry.key)).toEqual([`video_generation:${u(401)}`, `image:${u(102)}`, `image:${u(101)}`])
  })

  it('walking the pages one output at a time yields every output exactly once, in global order, across tied instants', async () => {
    const tie = t(7, 12, 55)
    tables.images = [image(1, { created_at: tie }), image(2, { created_at: tie }), image(3, { created_at: t(7, 11) })]
    tables.video_generations = [videoGeneration(1, { created_at: tie }), videoGeneration(2, { created_at: t(7, 13) })]
    tables.render_executions = [execution(1, { completed_at: tie }), execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650), completed_at: t(8) })]
    const everything = (await run({ limit: 100 })).items.map((entry) => entry.key)
    expect(everything).toHaveLength(7)
    for (const limit of [1, 2, 3]) {
      const { keys, pages } = await walk({ limit })
      expect(keys).toEqual(everything)
      expect(new Set(keys).size).toBe(keys.length)
      expect(pages.at(-1)!.nextCursor).toBeNull()
      expect(pages.every((page) => page.items.length <= limit)).toBe(true)
    }
  })

  it('cursor boundaries: microsecond neighbours and an exact-limit last page', async () => {
    tables.images = [image(1, { created_at: t(7, 10, 1) }), image(2, { created_at: t(7, 10, 2) }), image(3, { created_at: t(7, 10, 3) })]
    const first = await run({ limit: 3 })
    expect(first.items).toHaveLength(3)
    expect(first.nextCursor).toBeNull() // exactly `limit` outputs: nothing more is claimed
    const { keys } = await walk({ limit: 1, types: ['image'] })
    expect(keys).toEqual([`image:${u(103)}`, `image:${u(102)}`, `image:${u(101)}`])
  })

  it('the cursor bounds a repeated request: the same position returns the same page', async () => {
    tables.images = [image(1), image(2), image(3)]
    const first = await run({ limit: 1, types: ['image'] })
    const decoded = decodeGalleryCursor(first.nextCursor, filterFingerprint(['image'], null))
    if (!decoded.ok) throw new Error('bad cursor')
    const a = await run({ limit: 1, types: ['image'], positions: decoded.positions })
    const b = await run({ limit: 1, types: ['image'], positions: decoded.positions })
    expect(a.items.map((entry) => entry.key)).toEqual(b.items.map((entry) => entry.key))
  })
})

describe('source failures', () => {
  beforeEach(() => {
    tables.images = [image(1)]
    tables.video_generations = [videoGeneration(1)]
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'x' }]
    tables.channel_pieces = [{ id: u(650), user_id: ME, editorial_content_id: u(660) }]
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P1, production_id: PR1, title: 'c' }]
    tables.render_executions = [execution(1), execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) })]
  })

  it('one failing source is reported as failed, never as empty, and the other three keep their results', async () => {
    failing = new Set(['video_generations'])
    const response = await run()
    expect(response.sources.video_generation).toEqual({ state: 'failed', code: 'VIDEO_GENERATIONS_UNAVAILABLE' })
    for (const type of ['image', 'video_render', 'static_render'] as const) expect(response.sources[type]).toMatchObject({ state: 'ok' })
    expect(response.items.map((entry) => entry.type).sort()).toEqual(['image', 'static_render', 'video_render'])
    expect(response.partial).toBe(true)
    expect(response.hasMore).toBe(true) // the failed source still owes outputs
    expect(JSON.stringify(response)).not.toContain('secret database detail')
  })

  it('a source is atomic: a failing provenance lookup fails the images source instead of showing images with invented context', async () => {
    failing = new Set(['image_generation_attempts'])
    const response = await run()
    expect(response.sources.image).toEqual({ state: 'failed', code: 'ATTEMPTS_UNAVAILABLE' })
    expect(response.items.some((entry) => entry.type === 'image')).toBe(false)
    expect(response.items.length).toBeGreaterThan(0)
  })

  it('a failing Production/Project lookup also fails the source rather than turning outputs into "unscoped"', async () => {
    tables.image_generation_attempts = [attempt(1, 1)]
    failing = new Set(['productions'])
    const response = await run()
    for (const type of GALLERY_OUTPUT_TYPES) expect(response.sources[type]).toMatchObject({ state: 'failed', code: 'CONTEXT_UNAVAILABLE' })
  })

  it('without the service-role client only the two render sources fail', async () => {
    renderEnabled = false
    const response = await run()
    expect(response.sources.video_render).toEqual({ state: 'failed', code: 'RENDER_SERVICE_UNAVAILABLE' })
    expect(response.sources.static_render).toEqual({ state: 'failed', code: 'RENDER_SERVICE_UNAVAILABLE' })
    expect(response.items.map((entry) => entry.type).sort()).toEqual(['image', 'video_generation'])
  })

  it('an empty user with every source healthy is genuinely empty: ok sources, no cursor, not partial', async () => {
    tables.images = []; tables.video_generations = []; tables.render_executions = []
    const response = await run()
    expect(response).toMatchObject({ items: [], nextCursor: null, hasMore: false, partial: false })
    for (const type of GALLERY_OUTPUT_TYPES) expect(response.sources[type]).toEqual({ state: 'ok', hasMore: false })
  })

  it('PARTIAL FAILURE WITHOUT PAGINATION LOSS: the failed source\'s outputs surface once it recovers, and nothing is listed twice', async () => {
    tables.images = [image(1, { created_at: t(9) }), image(2, { created_at: t(8) }), image(3, { created_at: t(7) })]
    tables.video_generations = [videoGeneration(1, { created_at: t(10) }), videoGeneration(2, { created_at: t(6) })]
    tables.render_executions = []
    const healthy = (await run({ limit: 100 })).items.map((entry) => entry.key)

    const seen: string[] = []
    let positions = {}
    for (let page = 0; page < 20; page += 1) {
      failing = page === 0 ? new Set(['video_generations']) : new Set() // the source is down for the FIRST page only
      const response = await run({ limit: 2, positions })
      seen.push(...response.items.map((entry) => entry.key))
      if (!response.nextCursor) break
      const decoded = decodeGalleryCursor(response.nextCursor, filterFingerprint(GALLERY_OUTPUT_TYPES, null))
      if (!decoded.ok) throw new Error('bad cursor')
      positions = decoded.positions
    }
    expect([...seen].sort()).toEqual([...healthy].sort()) // nothing skipped, nothing duplicated
    expect(seen.filter((key) => key.startsWith('video_generation:')).length).toBe(2)
  })

  it('a source that keeps failing keeps the cursor open instead of ending the list', async () => {
    failing = new Set(['video_generations'])
    tables.images = []; tables.render_executions = []
    const response = await run()
    expect(response.items).toEqual([])
    expect(response.partial).toBe(true)
    expect(response.nextCursor).not.toBeNull()
  })
})

describe('totals', () => {
  beforeEach(() => {
    tables.images = [image(1), image(2), image(3, { image_url: null, thumbnail_url: null, storage_path: null, thumbnail_path: null })]
    tables.video_generations = [videoGeneration(1), videoGeneration(2, { status: 'failed' })]
    tables.video_drafts = [{ id: u(601), user_id: ME, project_id: P1, production_id: PR1, name: 'x' }]
    tables.channel_pieces = [{ id: u(650), user_id: ME, editorial_content_id: u(660) }]
    tables.editorial_contents = [{ id: u(660), user_id: ME, project_id: P1, production_id: PR1, title: 'c' }]
    tables.render_executions = [execution(1), execution(2, { kind: 'static_still', video_draft_id: null, channel_piece_id: u(650) }), execution(3, { status: 'queued' })]
  })

  it('are exact per source and globally when every source listed and counted', async () => {
    const response = await run({ includeTotals: true, limit: 1 })
    expect(response.totals).toEqual({ bySource: { image: 2, video_generation: 1, video_render: 1, static_render: 1 }, global: 5, globalExact: true })
  })

  it('are only requested when asked for', async () => {
    expect((await run()).totals).toBeUndefined()
    expect(log.some((entry) => entry.head)).toBe(false)
  })

  it('the global total disappears when one count fails, but the exact per-source numbers stay', async () => {
    failingHead = new Set(['video_generations'])
    const totals = (await run({ includeTotals: true })).totals!
    expect(totals).toMatchObject({ global: null, globalExact: false })
    expect(totals.bySource).toEqual({ image: 2, video_generation: null, video_render: 1, static_render: 1 })
  })

  it('the global total disappears when a source failed to list - an incomplete list never shows a complete number', async () => {
    failing = new Set(['render_executions'])
    const totals = (await run({ includeTotals: true })).totals!
    expect(totals).toMatchObject({ global: null, globalExact: false })
  })

  it('count only the selected types', async () => {
    const totals = (await run({ includeTotals: true, types: ['image'] })).totals!
    expect(totals).toEqual({ bySource: { image: 2 }, global: 2, globalExact: true })
  })
})

describe('no hidden truncation', () => {
  it('refuses to show images when the Attempt lookup could be truncated', async () => {
    tables.images = [image(1)]
    tables.image_generation_attempts = Array.from({ length: 1000 }, (_, n) => attempt(1000 + n, 1, { id: u(5000 + n), session_id: u(6000 + n) }))
    const response = await run({ types: ['image'] })
    expect(response.sources.image).toMatchObject({ state: 'failed', code: 'ATTEMPTS_UNAVAILABLE' })
  })

  it('a row whose instant cannot be read fails its source instead of disappearing', async () => {
    tables.images = [image(1, { created_at: 'garbage' })]
    const response = await run({ types: ['image'] })
    expect(response.sources.image).toMatchObject({ state: 'failed', code: 'INVALID_INSTANT' })
    const unused: GalleryOutput[] = response.items
    expect(unused).toEqual([])
  })
})
