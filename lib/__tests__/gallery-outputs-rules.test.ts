import { describe, expect, it, vi } from 'vitest'
import {
  accessEndpoints,
  assembleGalleryPage,
  assembleGalleryTotals,
  clampGalleryLimit,
  compareOutputs,
  decodeGalleryCursor,
  encodeGalleryCursor,
  filterFingerprint,
  GALLERY_CURSOR_MAX_LENGTH,
  GALLERY_MAX_LIMIT,
  GALLERY_OUTPUT_TYPES,
  normalizeInstant,
  outputKey,
  promptPreview,
  resolveImageProvenance,
  resolveProductionClaims,
  sourceHrefFor,
  type GalleryOutput,
  type GalleryOutputType,
  type SourceResult,
} from '@/lib/gallery/outputs'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (second: number, micro = 0) => `2026-10-10T10:00:${String(second).padStart(2, '0')}.${String(micro).padStart(6, '0')}Z`

function item(type: GalleryOutputType, n: number, occurredAt: string): GalleryOutput {
  return {
    key: outputKey(type, u(n)), type, id: u(n), mediaType: type === 'image' || type === 'static_render' ? 'image' : 'video', title: `${type} ${n}`, prompt: null,
    occurredAt, occurredAtKind: 'created', projectId: null, projectName: null, productionId: null, productionName: null, productionState: 'unscoped', productionHref: null,
    provenance: null, status: 'generated', media: { mimeType: null, durationMs: null, width: null, height: null, provider: null, model: null, mode: null },
    availability: 'unverified', savedLibraryFileIds: [], sourceHref: null, access: accessEndpoints(type, u(n)),
  }
}

const FINGERPRINT = filterFingerprint(GALLERY_OUTPUT_TYPES, null)
const ok = (type: GalleryOutputType, items: GalleryOutput[]): SourceResult => ({ type, state: 'ok', items })
const failed = (type: GalleryOutputType): SourceResult => ({ type, state: 'failed', code: 'X_UNAVAILABLE' })
const skipped = (type: GalleryOutputType): SourceResult => ({ type, state: 'skipped' })

describe('typed identity', () => {
  it('is source kind + canonical id, so equal ids of different kinds never collide', () => {
    expect(outputKey('static_render', u(1))).toBe(`static_render:${u(1)}`)
    expect(outputKey('video_render', u(1))).not.toBe(outputKey('static_render', u(1)))
  })
})

describe('instants', () => {
  it('normalises to fixed-width UTC microseconds, whatever offset the database printed', () => {
    expect(normalizeInstant('2026-04-27T07:22:49.729+00:00')).toBe('2026-04-27T07:22:49.729000Z')
    expect(normalizeInstant('2026-04-27 07:22:49.729123+00')).toBe('2026-04-27T07:22:49.729123Z')
    expect(normalizeInstant('2026-04-27T04:22:49-03:00')).toBe('2026-04-27T07:22:49.000000Z')
    expect(normalizeInstant('2026-04-27T07:22:49Z')).toBe('2026-04-27T07:22:49.000000Z')
  })
  it('keeps microsecond differences that a JS Date would tie', () => {
    const a = normalizeInstant('2026-04-27T07:22:49.123456Z')!
    const b = normalizeInstant('2026-04-27T07:22:49.123789Z')!
    expect(Date.parse(a)).toBe(Date.parse(b))
    expect(a < b).toBe(true)
  })
  it('rejects things that are not timestamps', () => {
    for (const bad of [null, undefined, 42, '', 'yesterday', '2026-13-40T00:00:00Z', '2026-02-31T00:00:00Z']) expect(normalizeInstant(bad)).toBeNull()
  })
})

describe('limits', () => {
  it('clamps to 1..100 with a default of 48', () => {
    expect(clampGalleryLimit(null)).toBe(48)
    expect(clampGalleryLimit('abc')).toBe(48)
    expect(clampGalleryLimit('0')).toBe(48)
    expect(clampGalleryLimit('7')).toBe(7)
    expect(clampGalleryLimit('5000')).toBe(GALLERY_MAX_LIMIT)
  })
})

describe('cursor', () => {
  const positions = { image: { at: at(5), id: u(1) }, static_render: { at: at(4, 123456), id: u(2) } }
  it('round-trips per-source positions for the same filters', () => {
    const decoded = decodeGalleryCursor(encodeGalleryCursor(FINGERPRINT, positions), FINGERPRINT)
    expect(decoded).toEqual({ ok: true, positions })
  })
  it('no cursor means the start of every source', () => {
    expect(decodeGalleryCursor(null, FINGERPRINT)).toEqual({ ok: true, positions: {} })
    expect(decodeGalleryCursor('', FINGERPRINT)).toEqual({ ok: true, positions: {} })
  })
  it('never crosses a changed filter', () => {
    const cursor = encodeGalleryCursor(FINGERPRINT, positions)
    expect(decodeGalleryCursor(cursor, filterFingerprint(['image'], null))).toEqual({ ok: false, reason: 'FILTER_MISMATCH' })
    expect(decodeGalleryCursor(cursor, filterFingerprint(GALLERY_OUTPUT_TYPES, u(9)))).toEqual({ ok: false, reason: 'FILTER_MISMATCH' })
  })
  const forgeCursor = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

  it('bounds the input BEFORE decoding or parsing it', () => {
    // A legitimate cursor (four sources, a long filter) is far below the bound.
    const full = encodeGalleryCursor(filterFingerprint(GALLERY_OUTPUT_TYPES, u(9)), Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, { at: at(5, 123456), id: u(7) }])))
    expect(full.length).toBeLessThan(GALLERY_CURSOR_MAX_LENGTH / 2)
    expect(decodeGalleryCursor(full, filterFingerprint(GALLERY_OUTPUT_TYPES, u(9)))).toMatchObject({ ok: true })

    // Over the bound is refused without touching Buffer/JSON, even when the content would be perfectly valid JSON.
    const oversized = 'A'.repeat(GALLERY_CURSOR_MAX_LENGTH + 1)
    const fromBase64 = vi.spyOn(Buffer, 'from')
    const parse = vi.spyOn(JSON, 'parse')
    try {
      expect(decodeGalleryCursor(oversized, FINGERPRINT)).toEqual({ ok: false, reason: 'MALFORMED' })
      expect(fromBase64).not.toHaveBeenCalled()
      expect(parse).not.toHaveBeenCalled()
    } finally {
      fromBase64.mockRestore()
      parse.mockRestore()
    }
    // Padding a valid payload past the bound is refused too; at the bound itself it is still parsed (and rejected only on content).
    const padded = forgeCursor({ v: 1, f: FINGERPRINT, p: {}, pad: 'x'.repeat(GALLERY_CURSOR_MAX_LENGTH) })
    expect(padded.length).toBeGreaterThan(GALLERY_CURSOR_MAX_LENGTH)
    expect(decodeGalleryCursor(padded, FINGERPRINT)).toEqual({ ok: false, reason: 'MALFORMED' })
    expect(decodeGalleryCursor('A'.repeat(GALLERY_CURSOR_MAX_LENGTH), FINGERPRINT)).toEqual({ ok: false, reason: 'MALFORMED' }) // parsed, then judged on content
  })

  it('is NOT tamper-evident: an edited cursor of valid shape is accepted and only names another position', () => {
    const original = encodeGalleryCursor(FINGERPRINT, { image: { at: at(5), id: u(1) } })
    const edited = forgeCursor({ v: 1, f: FINGERPRINT, p: { image: [at(40, 7), u(999)], video_render: [at(1), u(5)] } })
    expect(edited).not.toBe(original)
    expect(decodeGalleryCursor(edited, FINGERPRINT)).toEqual({ ok: true, positions: { image: { at: at(40, 7), id: u(999) }, video_render: { at: at(1), id: u(5) } } })
  })

  it('whatever it accepts is made only of canonical instants and UUIDs - nothing a query filter could misread', () => {
    const decoded = decodeGalleryCursor(forgeCursor({ v: 1, f: FINGERPRINT, p: { image: [at(40, 7), u(999)] } }), FINGERPRINT)
    if (!decoded.ok) throw new Error('expected an accepted cursor')
    const position = decoded.positions.image!
    expect(position.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    expect(position.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    for (const hostile of [`${at(1)},id.gt.0`, `${at(1)})`, `${at(1)}"`, "2026-10-10T10:00:00.000000Z'--", `${u(1)},or(id.gt.0)`]) {
      expect(decodeGalleryCursor(forgeCursor({ v: 1, f: FINGERPRINT, p: { image: [hostile, u(1)] } }), FINGERPRINT)).toMatchObject({ ok: false })
      expect(decodeGalleryCursor(forgeCursor({ v: 1, f: FINGERPRINT, p: { image: [at(1), hostile] } }), FINGERPRINT)).toMatchObject({ ok: false })
    }
  })

  it('refuses anything that is not a well-formed cursor for these filters, before it can reach a filter', () => {
    const forge = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const bad = [
      'not-base64-json', forge([]), forge({ v: 2, f: FINGERPRINT, p: {} }), forge({ v: 1, f: FINGERPRINT, p: [] }),
      forge({ v: 1, f: FINGERPRINT, p: { image: [at(1), 'not-a-uuid'] } }),
      forge({ v: 1, f: FINGERPRINT, p: { image: ['2026-10-10 10:00:01+00', u(1)] } }), // not canonical: would be re-normalised
      forge({ v: 1, f: FINGERPRINT, p: { image: [at(1)] } }),
      forge({ v: 1, f: FINGERPRINT, p: { library_file: [at(1), u(1)] } }),
      forge({ v: 1, f: FINGERPRINT, p: { image: [`${at(1)}",id.gt.0`, u(1)] } }), // filter-injection attempt
    ]
    for (const cursor of bad) expect(decodeGalleryCursor(cursor, FINGERPRINT)).toMatchObject({ ok: false })
  })
})

describe('global order', () => {
  it('is newest first across kinds, with the key as the deterministic tie-break', () => {
    const a = item('image', 1, at(5))
    const b = item('video_generation', 2, at(5))
    const c = item('static_render', 3, at(9))
    const sorted = [a, b, c].sort(compareOutputs)
    expect(sorted.map((entry) => entry.type)).toEqual(['static_render', 'video_generation', 'image']) // tie: 'video_generation:' > 'image:'
    expect(compareOutputs(a, a)).toBe(0)
  })
  it('separates instants that only differ by microseconds', () => {
    const a = item('image', 1, at(5, 1))
    const b = item('image', 2, at(5, 2))
    expect([a, b].sort(compareOutputs).map((entry) => entry.id)).toEqual([u(2), u(1)])
  })
})

describe('page assembly', () => {
  it('merges the four sources into one globally ordered page and reports exact per-source hasMore', () => {
    const page = assembleGalleryPage({
      results: [
        ok('image', [item('image', 1, at(9)), item('image', 2, at(3)), item('image', 3, at(1))]),
        ok('video_generation', [item('video_generation', 4, at(8))]),
        ok('video_render', [item('video_render', 5, at(7))]),
        ok('static_render', [item('static_render', 6, at(6))]),
      ],
      previous: {}, limit: 3, fingerprint: FINGERPRINT,
    })
    expect(page.items.map((entry) => entry.id)).toEqual([u(1), u(4), u(5)])
    expect(page.sources.image).toEqual({ state: 'ok', hasMore: true })
    expect(page.sources.video_generation).toEqual({ state: 'ok', hasMore: false })
    expect(page.sources.static_render).toEqual({ state: 'ok', hasMore: true }) // fetched, not on this page
    expect(page.partial).toBe(false)
    expect(page.nextCursor).not.toBeNull()
  })

  it('advances each source only by what it contributed; a source with nothing on the page keeps its previous position', () => {
    const previous = { static_render: { at: at(40), id: u(99) } }
    const page = assembleGalleryPage({
      results: [
        ok('image', [item('image', 1, at(9)), item('image', 2, at(8))]),
        ok('video_generation', []), ok('video_render', []),
        ok('static_render', [item('static_render', 6, at(2))]),
      ],
      previous, limit: 2, fingerprint: FINGERPRINT,
    })
    const decoded = decodeGalleryCursor(page.nextCursor, FINGERPRINT)
    expect(decoded).toEqual({ ok: true, positions: { image: { at: at(8), id: u(2) }, static_render: previous.static_render } })
  })

  it('ends (null cursor) only when every source is exhausted', () => {
    const page = assembleGalleryPage({
      results: [ok('image', [item('image', 1, at(9))]), ok('video_generation', []), ok('video_render', []), ok('static_render', [])],
      previous: {}, limit: 5, fingerprint: FINGERPRINT,
    })
    expect(page.nextCursor).toBeNull()
  })

  it('a failed source is not an empty source: partial, cursor kept open, its position untouched', () => {
    const previous = { video_generation: { at: at(30), id: u(77) } }
    const page = assembleGalleryPage({
      results: [ok('image', [item('image', 1, at(9))]), failed('video_generation'), skipped('video_render'), ok('static_render', [])],
      previous, limit: 5, fingerprint: FINGERPRINT,
    })
    expect(page.items.map((entry) => entry.id)).toEqual([u(1)])
    expect(page.partial).toBe(true)
    expect(page.sources.video_generation).toEqual({ state: 'failed', code: 'X_UNAVAILABLE' })
    expect(page.sources.video_render).toEqual({ state: 'skipped' })
    expect(page.nextCursor).not.toBeNull()
    const decoded = decodeGalleryCursor(page.nextCursor, FINGERPRINT)
    expect(decoded).toEqual({ ok: true, positions: { ...previous, image: { at: at(9), id: u(1) } } })
  })

  it('every source failing still never reports the Gallery as complete', () => {
    const page = assembleGalleryPage({ results: GALLERY_OUTPUT_TYPES.map(failed), previous: {}, limit: 5, fingerprint: FINGERPRINT })
    expect(page.items).toEqual([])
    expect(page.partial).toBe(true)
    expect(page.nextCursor).not.toBeNull()
  })

  it('lists an output once even if two results carry the same key', () => {
    const duplicate = item('image', 1, at(9))
    const page = assembleGalleryPage({ results: [ok('image', [duplicate]), ok('image', [duplicate])], previous: {}, limit: 5, fingerprint: FINGERPRINT })
    expect(page.items).toHaveLength(1)
  })
})

describe('totals', () => {
  const sources = (states: Partial<Record<GalleryOutputType, 'ok' | 'failed'>>) =>
    Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, states[type] === 'failed' ? { state: 'failed', code: 'X' } : { state: 'ok', hasMore: false }])) as never
  it('is a global exact total only when every selected source listed and counted', () => {
    expect(assembleGalleryTotals(GALLERY_OUTPUT_TYPES, sources({}), { image: 3, video_generation: 2, video_render: 1, static_render: 4 })).toEqual({
      bySource: { image: 3, video_generation: 2, video_render: 1, static_render: 4 }, global: 10, globalExact: true,
    })
  })
  it('hides the global number when one count is unknown, and keeps the exact per-source ones', () => {
    const totals = assembleGalleryTotals(GALLERY_OUTPUT_TYPES, sources({}), { image: 3, video_generation: null, video_render: 1, static_render: 4 })
    expect(totals).toMatchObject({ global: null, globalExact: false })
    expect(totals.bySource).toMatchObject({ image: 3, video_generation: null })
  })
  it('hides the global number when a source failed to list even if its count worked', () => {
    const totals = assembleGalleryTotals(GALLERY_OUTPUT_TYPES, sources({ static_render: 'failed' }), { image: 3, video_generation: 2, video_render: 1, static_render: 4 })
    expect(totals).toMatchObject({ global: null, globalExact: false })
  })
})

describe('Production claims', () => {
  const owned = new Map([
    ['pr-1', { id: 'pr-1', project_id: 'p-1' }],
    ['pr-2', { id: 'pr-2', project_id: 'p-1' }],
    ['pr-x', { id: 'pr-x', project_id: 'p-2' }],
  ])
  it('resolves exactly one verified claim, however many records repeat it', () => {
    expect(resolveProductionClaims({ claims: ['pr-1', 'pr-1', null], projectId: 'p-1', productions: owned })).toEqual({ state: 'resolved', productionId: 'pr-1' })
  })
  it('no claim stays unscoped - never a sole-Production, name or date heuristic', () => {
    expect(resolveProductionClaims({ claims: [], projectId: 'p-1', productions: owned })).toEqual({ state: 'unscoped', productionId: null })
    expect(resolveProductionClaims({ claims: [null, undefined], projectId: 'p-1', productions: owned })).toEqual({ state: 'unscoped', productionId: null })
  })
  it('contradicting verified claims are a conflict and pick nothing', () => {
    expect(resolveProductionClaims({ claims: ['pr-1', 'pr-2'], projectId: 'p-1', productions: owned })).toEqual({ state: 'conflict', productionId: null })
  })
  it('a claim for a Production the owner does not have, or of another Project, does not count', () => {
    expect(resolveProductionClaims({ claims: ['pr-ghost'], projectId: 'p-1', productions: owned })).toEqual({ state: 'unscoped', productionId: null })
    expect(resolveProductionClaims({ claims: ['pr-x'], projectId: 'p-1', productions: owned })).toEqual({ state: 'unscoped', productionId: null })
    expect(resolveProductionClaims({ claims: ['pr-1', 'pr-x'], projectId: 'p-1', productions: owned })).toEqual({ state: 'resolved', productionId: 'pr-1' })
  })
  it('an output without a Project cannot verify any Production', () => {
    expect(resolveProductionClaims({ claims: ['pr-1'], projectId: null, productions: owned })).toEqual({ state: 'unscoped', productionId: null })
  })
})

describe('image provenance', () => {
  const attempt = (id: string, session: string | null, completed: string | null = at(1)) => ({ id, session_id: session, production_id: null, completed_at: completed })
  it('several Attempts of one Session are one provenance, pointing at the newest Attempt', () => {
    expect(resolveImageProvenance([attempt('a1', 's1', at(1)), attempt('a3', 's1', at(3)), attempt('a2', 's1', at(2))], ['d-1'])).toEqual({ kind: 'image_session', sessionId: 's1', attemptId: 'a3' })
  })
  it('Attempts of different Sessions prove no single Session', () => {
    expect(resolveImageProvenance([attempt('a1', 's1'), attempt('a2', 's2')], [])).toBeNull()
  })
  it('a lone Attempt without a Session is named as an Attempt', () => {
    expect(resolveImageProvenance([attempt('a1', null)], [])).toEqual({ kind: 'image_attempt', attemptId: 'a1' })
  })
  it('the legacy draft is used only when no Attempt names the image; an unknown origin stays null', () => {
    expect(resolveImageProvenance([], ['d-1', 'd-1'])).toEqual({ kind: 'legacy_image_draft', draftId: 'd-1' })
    expect(resolveImageProvenance([], ['d-1', 'd-2'])).toBeNull()
    expect(resolveImageProvenance([], [])).toBeNull()
  })
})

describe('links and endpoints', () => {
  it('opens only what a verified provenance proves', () => {
    expect(sourceHrefFor({ kind: 'image_session', sessionId: u(1), attemptId: u(2) }, { projectId: null })).toBe(`/imagens/geracoes/${u(1)}`)
    expect(sourceHrefFor({ kind: 'video_session', sessionId: u(1) }, { projectId: null })).toBe(`/videos/geracoes/${u(1)}`)
    expect(sourceHrefFor({ kind: 'video_draft', videoDraftId: u(3) }, { projectId: null })).toBe(`/creative-editor/video/${u(3)}`)
    expect(sourceHrefFor({ kind: 'channel_piece', channelPieceId: 'cp', editorialContentId: 'ec' }, { projectId: 'p' })).toBe('/projetos/p/conteudos/ec/channel-pieces/cp/editar-visual')
  })
  it('never fabricates a Session link for a standalone video, an unknown origin or an attempt-only image', () => {
    expect(sourceHrefFor({ kind: 'video_standalone' }, { projectId: 'p' })).toBeNull()
    expect(sourceHrefFor(null, { projectId: 'p' })).toBeNull()
    expect(sourceHrefFor({ kind: 'image_attempt', attemptId: u(1) }, { projectId: 'p' })).toBeNull()
    expect(sourceHrefFor({ kind: 'channel_piece', channelPieceId: 'cp', editorialContentId: 'ec' }, { projectId: null })).toBeNull()
  })
  it('exposes the existing per-item endpoints as paths, with inline and attachment kept apart', () => {
    expect(accessEndpoints('video_generation', u(1))).toEqual({ previewEndpoint: `/api/video-generations/${u(1)}/playback-url`, downloadEndpoint: `/api/video-generations/${u(1)}/playback-url?disposition=attachment` })
    expect(accessEndpoints('static_render', u(1)).previewEndpoint).toBe(`/api/render-executions/${u(1)}/output-url`)
    expect(accessEndpoints('video_render', u(1)).downloadEndpoint).toContain('disposition=attachment')
    expect(accessEndpoints('image', u(1)).previewEndpoint).toBe(`/api/images/${u(1)}/signed-url`)
  })
  it('caps the prompt preview', () => {
    expect(promptPreview('x'.repeat(2000))!.length).toBeLessThanOrEqual(500)
    expect(promptPreview('   ')).toBeNull()
  })
})
