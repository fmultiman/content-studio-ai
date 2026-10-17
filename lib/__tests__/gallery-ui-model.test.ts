import { describe, expect, it } from 'vitest'
import { accessEndpoints, GALLERY_OUTPUT_TYPES, outputKey, type GalleryOutput, type GalleryOutputType, type GallerySourceState } from '@/lib/gallery/outputs'
import {
  decideGalleryPanel,
  describeCount,
  describeFailedSources,
  describeMediaFailure,
  downloadFilename,
  exactTypeCount,
  failedSourceTypes,
  filterLoadedOutputs,
  hasLocalFilters,
  hasServerFilters,
  isOutputsResponse,
  isStandaloneVideo,
  mediaRenderer,
  mergeOutputs,
  outputsQuery,
  productionLabel,
  projectLabel,
  readMediaAnswer,
  savedLabel,
  serverFilterKey,
  summarizeCount,
} from '@/lib/gallery/ui-model'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (type: GalleryOutputType, n: number, over: Partial<GalleryOutput> = {}): GalleryOutput => ({
  key: outputKey(type, u(n)), type, id: u(n), mediaType: type === 'image' || type === 'static_render' ? 'image' : 'video', title: `Título ${n}`, prompt: null,
  occurredAt: `2026-10-10T10:00:${String(n).padStart(2, '0')}.000000Z`, occurredAtKind: 'created', projectId: u(90), projectName: 'Portal', productionId: u(91), productionName: 'Campanha',
  productionState: 'resolved', productionHref: '/p', provenance: null, status: 'generated',
  media: { mimeType: null, durationMs: null, width: null, height: null, provider: null, model: null, mode: null }, availability: 'unverified', savedLibraryFileIds: [], sourceHref: null,
  access: accessEndpoints(type, u(n)), ...over,
})

describe('server filters', () => {
  it('build a query only from real filters; every type selected is the same collection as none', () => {
    expect(outputsQuery({ types: [], projectId: null, productionId: null })).toBe('')
    expect(outputsQuery({ types: [...GALLERY_OUTPUT_TYPES], projectId: null, productionId: null })).toBe('')
    expect(outputsQuery({ types: ['video_render', 'image'], projectId: null, productionId: null })).toBe('?type=image%2Cvideo_render')
  })
  it('Production is sent alone (its Project is implied), Project only when there is no Production', () => {
    expect(outputsQuery({ types: [], projectId: u(1), productionId: u(2) })).toBe(`?productionId=${u(2)}`)
    expect(outputsQuery({ types: [], projectId: u(1), productionId: null })).toBe(`?projectId=${u(1)}`)
  })
  it('totals only on request, the cursor verbatim, limit when asked', () => {
    expect(outputsQuery({ types: [], projectId: null, productionId: null }, { totals: true, limit: 24 })).toBe('?limit=24&totals=1')
    expect(outputsQuery({ types: [], projectId: null, productionId: null }, { cursor: 'abc_-' })).toBe('?cursor=abc_-')
  })
  it('have a stable identity that ignores selection order and changes with every filter', () => {
    const base = { types: ['image', 'video_render'] as GalleryOutputType[], projectId: u(1), productionId: null }
    expect(serverFilterKey(base)).toBe(serverFilterKey({ ...base, types: ['video_render', 'image'] }))
    const keys = new Set([serverFilterKey(base), serverFilterKey({ ...base, projectId: null }), serverFilterKey({ ...base, productionId: u(2) }), serverFilterKey({ ...base, types: ['image'] })])
    expect(keys.size).toBe(4)
    expect(hasServerFilters({ types: [], projectId: null, productionId: null })).toBe(false)
    expect(hasServerFilters(base)).toBe(true)
  })
})

describe('pages', () => {
  it('merge by typed key (no duplicate card) and keep the canonical chronological order, wherever an output arrives', () => {
    const a = item('image', 5)
    const b = item('video_generation', 3)
    const late = item('static_render', 9) // a recovered source delivering a NEWER output after older pages
    const merged = mergeOutputs([a, b], [b, late])
    expect(merged.map((entry) => entry.key)).toEqual([late.key, a.key, b.key])
    expect(mergeOutputs(merged, merged)).toHaveLength(3)
  })
  it('different families with one id are two outputs', () => {
    expect(mergeOutputs([item('video_render', 1)], [item('static_render', 1)])).toHaveLength(2)
  })
  it('the newer copy of an output replaces the older one (e.g. a saved-file mark that appeared)', () => {
    const merged = mergeOutputs([item('image', 1)], [item('image', 1, { savedLibraryFileIds: [u(7)] })])
    expect(merged).toHaveLength(1)
    expect(merged[0].savedLibraryFileIds).toEqual([u(7)])
  })
  it('recognises only a well-formed envelope', () => {
    const sources = Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, { state: 'ok', hasMore: false }]))
    expect(isOutputsResponse({ items: [], nextCursor: null, partial: false, sources })).toBe(true)
    for (const bad of [null, {}, { items: [], nextCursor: undefined, partial: false, sources }, { items: 'x', nextCursor: null, partial: false, sources }, { error: 'x' }]) expect(isOutputsResponse(bad)).toBe(false)
  })
})

describe('failed sources', () => {
  const sources = (failed: GalleryOutputType[]) => Object.fromEntries(GALLERY_OUTPUT_TYPES.map((type) => [type, failed.includes(type) ? { state: 'failed', code: 'X' } : { state: 'ok', hasMore: false }])) as Record<GalleryOutputType, GallerySourceState>
  it('are listed in canonical order and named for people', () => {
    expect(failedSourceTypes(sources(['static_render', 'image']))).toEqual(['image', 'static_render'])
    expect(failedSourceTypes(null)).toEqual([])
    expect(describeFailedSources(['image'])).toBe('imagens IA')
    expect(describeFailedSources(['image', 'video_render'])).toBe('imagens IA e renders de vídeo')
    expect(describeFailedSources(['image', 'video_generation', 'static_render'])).toBe('imagens IA, vídeos IA e renders estáticos')
    expect(describeFailedSources([])).toBe('')
  })
})

describe('totals', () => {
  const exact = { bySource: { image: 3, video_render: 1 }, global: 4, globalExact: true }
  it('an exact number only when the API reported it exact and nothing is partial', () => {
    expect(summarizeCount({ loaded: 2, totals: exact, hasMore: true, partial: false })).toEqual({ kind: 'exact', total: 4, loaded: 2 })
    expect(describeCount({ kind: 'exact', total: 4, loaded: 2 })).toBe('2 de 4 outputs carregados')
    expect(describeCount({ kind: 'exact', total: 4, loaded: 4 })).toBe('4 outputs no total')
    expect(describeCount({ kind: 'exact', total: 1, loaded: 1 })).toBe('1 output no total')
  })
  it('never an exact number from a partial result, an inexact total or no totals', () => {
    expect(summarizeCount({ loaded: 2, totals: exact, hasMore: true, partial: true }).kind).toBe('loaded')
    expect(summarizeCount({ loaded: 2, totals: { ...exact, globalExact: false, global: null }, hasMore: false, partial: false }).kind).toBe('loaded')
    expect(summarizeCount({ loaded: 2, totals: { ...exact, global: null }, hasMore: false, partial: false }).kind).toBe('loaded')
    expect(summarizeCount({ loaded: 2, totals: null, hasMore: false, partial: false }).kind).toBe('loaded')
  })
  it('describes what is loaded, whether more exists and whether the list is incomplete', () => {
    expect(describeCount({ kind: 'loaded', loaded: 1, more: false, incomplete: false })).toBe('1 output carregado')
    expect(describeCount({ kind: 'loaded', loaded: 3, more: true, incomplete: false })).toBe('3 outputs carregados · há mais para carregar')
    expect(describeCount({ kind: 'loaded', loaded: 3, more: true, incomplete: true })).toBe('3 outputs carregados · lista incompleta (falha em alguma fonte)')
  })
  it('per-type numbers are shown only when reported', () => {
    expect(exactTypeCount(exact as never, 'image')).toBe(3)
    expect(exactTypeCount(exact as never, 'static_render')).toBeNull()
    expect(exactTypeCount({ bySource: { image: null }, global: null, globalExact: false }, 'image')).toBeNull()
    expect(exactTypeCount(null, 'image')).toBeNull()
  })
})

describe('local search and status (loaded items only)', () => {
  const items = [item('image', 1, { title: 'Pôr do sol', status: 'approved' }), item('video_render', 2, { title: 'Teaser', prompt: 'um barco no mar', productionName: 'Lançamento' }), item('static_render', 3, { projectName: 'Outro' })]
  it('matches title, prompt, Project, Production and the type label, ignoring case', () => {
    expect(filterLoadedOutputs(items, { search: 'SOL', status: 'all' }).map((entry) => entry.id)).toEqual([u(1)])
    expect(filterLoadedOutputs(items, { search: 'barco', status: 'all' }).map((entry) => entry.id)).toEqual([u(2)])
    expect(filterLoadedOutputs(items, { search: 'lançamento', status: 'all' }).map((entry) => entry.id)).toEqual([u(2)])
    expect(filterLoadedOutputs(items, { search: 'outro', status: 'all' }).map((entry) => entry.id)).toEqual([u(3)])
    expect(filterLoadedOutputs(items, { search: 'render estático', status: 'all' }).map((entry) => entry.id)).toEqual([u(3)])
  })
  it('status narrows too, and both combine; nothing is a no-op', () => {
    expect(filterLoadedOutputs(items, { search: '', status: 'approved' }).map((entry) => entry.id)).toEqual([u(1)])
    expect(filterLoadedOutputs(items, { search: 'teaser', status: 'approved' })).toEqual([])
    expect(filterLoadedOutputs(items, { search: '  ', status: 'all' })).toHaveLength(3)
    expect(hasLocalFilters({ search: ' ', status: 'all' })).toBe(false)
    expect(hasLocalFilters({ search: 'x', status: 'all' })).toBe(true)
    expect(hasLocalFilters({ search: '', status: 'rejected' })).toBe(true)
  })
})

describe('the panel decision (when the Gallery may say "empty")', () => {
  const base = { phase: 'ready' as const, loaded: 0, visible: 0, partial: false, hasMore: false, serverFiltered: false }
  it('empty only when ready, nothing loaded, nothing failed, nothing left', () => {
    expect(decideGalleryPanel(base)).toEqual({ kind: 'empty', filtered: false })
    expect(decideGalleryPanel({ ...base, serverFiltered: true })).toEqual({ kind: 'empty', filtered: true })
  })
  it('a failed source or a remaining page is never empty', () => {
    expect(decideGalleryPanel({ ...base, partial: true })).toEqual({ kind: 'incomplete-empty', failed: true })
    expect(decideGalleryPanel({ ...base, hasMore: true })).toEqual({ kind: 'incomplete-empty', failed: false })
    expect(decideGalleryPanel({ ...base, partial: true, hasMore: true, serverFiltered: true })).toMatchObject({ kind: 'incomplete-empty' })
  })
  it('loading and error are their own states and an error never reads as empty', () => {
    expect(decideGalleryPanel({ ...base, phase: 'loading' })).toEqual({ kind: 'loading' })
    expect(decideGalleryPanel({ ...base, phase: 'error' })).toEqual({ kind: 'error' })
  })
  it('loaded outputs hidden by the local filters are "no match", not "empty"', () => {
    expect(decideGalleryPanel({ ...base, loaded: 5, visible: 0, hasMore: true })).toEqual({ kind: 'local-no-match', loaded: 5, hasMore: true })
    expect(decideGalleryPanel({ ...base, loaded: 5, visible: 2 })).toEqual({ kind: 'results' })
  })
  it('keeps showing results while a reload of the same filters is loading', () => {
    expect(decideGalleryPanel({ ...base, phase: 'loading', loaded: 3, visible: 3 })).toEqual({ kind: 'results' })
  })
})

describe('labels', () => {
  it('say honestly when there is no Production, or when records conflict', () => {
    expect(productionLabel({ productionName: 'Campanha', productionState: 'resolved' })).toBe('Campanha')
    expect(productionLabel({ productionName: null, productionState: 'unscoped' })).toBe('Sem Production associada')
    expect(productionLabel({ productionName: null, productionState: 'conflict' })).toBe('Production indefinida (registros conflitantes)')
    expect(projectLabel({ projectName: 'Portal', projectId: u(1) })).toBe('Portal')
    expect(projectLabel({ projectName: null, projectId: u(1) })).toBe('Project indisponível')
    expect(projectLabel({ projectName: null, projectId: null })).toBe('Project não identificado')
  })
  it('mark saved files as an annotation and standalone videos as such', () => {
    expect(savedLabel({ savedLibraryFileIds: [] })).toBeNull()
    expect(savedLabel({ savedLibraryFileIds: [u(1)] })).toBe('Salvo em Arquivos')
    expect(savedLabel({ savedLibraryFileIds: [u(1), u(2), u(3)] })).toBe('Salvo em Arquivos (3)')
    expect(isStandaloneVideo({ provenance: { kind: 'video_standalone' } })).toBe(true)
    expect(isStandaloneVideo({ provenance: { kind: 'video_session', sessionId: u(1) } })).toBe(false)
    expect(isStandaloneVideo({ provenance: null })).toBe(false)
  })
})

describe('media answers (three different shapes, one reader)', () => {
  it('AI images answer { imageUrl, thumbnailUrl, publicUrl }: thumbnails prefer the thumbnail, everything else the full image', () => {
    const body = { imageUrl: 'https://s/full', thumbnailUrl: 'https://s/thumb', publicUrl: 'https://s/pub' }
    expect(readMediaAnswer('image', 200, body, 'thumbnail')).toEqual({ ok: true, url: 'https://s/thumb' })
    expect(readMediaAnswer('image', 200, body, 'preview')).toEqual({ ok: true, url: 'https://s/full' })
    expect(readMediaAnswer('image', 200, body, 'download')).toEqual({ ok: true, url: 'https://s/full' })
    expect(readMediaAnswer('image', 200, { thumbnailUrl: 'https://s/t' }, 'thumbnail')).toEqual({ ok: true, url: 'https://s/t' })
    expect(readMediaAnswer('image', 200, { thumbnailUrl: null, imageUrl: 'https://s/full' }, 'thumbnail')).toEqual({ ok: true, url: 'https://s/full' })
    expect(readMediaAnswer('image', 200, { publicUrl: 'https://s/pub' }, 'preview')).toEqual({ ok: true, url: 'https://s/pub' })
  })
  it('AI videos and renders answer { url, expiresAt }', () => {
    for (const type of ['video_generation', 'video_render', 'static_render'] as const) {
      expect(readMediaAnswer(type, 200, { url: 'https://s/x', expiresAt: 'later' }, 'preview')).toEqual({ ok: true, url: 'https://s/x' })
      expect(readMediaAnswer(type, 200, { imageUrl: 'https://s/not-mine' }, 'preview')).toEqual({ ok: false, reason: 'unavailable' })
    }
  })
  it('missing, expired or inaccessible media are typed, never a throw', () => {
    expect(readMediaAnswer('image', 404, {}, 'preview')).toEqual({ ok: false, reason: 'unavailable' })
    expect(readMediaAnswer('video_render', 409, {}, 'preview')).toEqual({ ok: false, reason: 'unavailable' })
    expect(readMediaAnswer('video_render', 401, {}, 'preview')).toEqual({ ok: false, reason: 'denied' })
    expect(readMediaAnswer('video_render', 403, {}, 'preview')).toEqual({ ok: false, reason: 'denied' })
    expect(readMediaAnswer('video_render', 500, {}, 'preview')).toEqual({ ok: false, reason: 'failed' })
    expect(readMediaAnswer('video_render', 200, null, 'preview')).toEqual({ ok: false, reason: 'failed' })
    expect(readMediaAnswer('video_render', 200, { url: '' }, 'preview')).toEqual({ ok: false, reason: 'unavailable' })
    for (const reason of ['unavailable', 'denied', 'failed'] as const) expect(describeMediaFailure(reason).length).toBeGreaterThan(10)
    expect(describeMediaFailure('unavailable')).toContain('permanece no histórico')
  })
  it('pictures are images, videos are players', () => {
    expect(mediaRenderer({ mediaType: 'image' })).toBe('image')
    expect(mediaRenderer({ mediaType: 'video' })).toBe('video')
  })
  it('names downloads by title and by what the file is', () => {
    expect(downloadFilename({ title: 'Pôr do sol!', type: 'image', id: u(1) })).toBe('por-do-sol.png')
    expect(downloadFilename({ title: 'x', type: 'image', id: u(1) }, 'image/webp')).toBe('x.webp')
    expect(downloadFilename({ title: 'x', type: 'image', id: u(1) }, 'image/jpeg')).toBe('x.jpg')
    expect(downloadFilename({ title: 'Teaser', type: 'video_render', id: u(1) })).toBe('teaser.mp4')
    expect(downloadFilename({ title: '???', type: 'video_generation', id: u(1) })).toBe('video-generation.mp4')
  })
})
