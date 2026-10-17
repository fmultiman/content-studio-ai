// STRUCTURAL WAVE 1A-2, STEP S2 - pure UI rules of the multimodal Gallery.
//
// Everything here is free of React and of the network, so the rules that keep the Gallery honest (what a total means, when it is
// allowed to say "empty", how pages merge, how a media answer is read) are unit-tested on their own.

import {
  compareOutputs,
  GALLERY_OUTPUT_TYPES,
  type GalleryOutput,
  type GalleryOutputStatus,
  type GalleryOutputType,
  type GalleryOutputsResponse,
  type GallerySourceState,
  type GalleryTotals,
} from '@/lib/gallery/outputs'

// -- Types shown to the user ----------------------------------------------------------------------------------------------------------

export const GALLERY_TYPE_LABELS: Record<GalleryOutputType, string> = {
  image: 'Imagem IA',
  video_generation: 'Vídeo IA',
  video_render: 'Render de vídeo',
  static_render: 'Render estático',
}

/** Longer names for sentences ("Não foi possível carregar: ..."). */
export const GALLERY_TYPE_SOURCE_NAMES: Record<GalleryOutputType, string> = {
  image: 'imagens IA',
  video_generation: 'vídeos IA',
  video_render: 'renders de vídeo',
  static_render: 'renders estáticos',
}

export const GALLERY_STATUS_LABELS: Record<GalleryOutputStatus, string> = {
  generated: 'Gerada',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  generating: 'Gerando',
}

// -- Server-side filters -----------------------------------------------------------------------------------------------------------------

/** Filters that are applied by the SERVER across the whole collection. Search and status are NOT here: they are local. */
export interface ServerFilters {
  /** Empty = every type. */
  types: readonly GalleryOutputType[]
  projectId: string | null
  productionId: string | null
}

export const NO_SERVER_FILTERS: ServerFilters = { types: [], projectId: null, productionId: null }

export function hasServerFilters(filters: ServerFilters): boolean {
  return filters.types.length > 0 || Boolean(filters.projectId) || Boolean(filters.productionId)
}

/** Stable identity of a set of server filters: a change resets pagination and invalidates every in-flight request. */
export function serverFilterKey(filters: ServerFilters): string {
  return `${[...filters.types].sort().join(',')}|${filters.projectId ?? ''}|${filters.productionId ?? ''}`
}

export function outputsQuery(filters: ServerFilters, options: { cursor?: string | null; totals?: boolean; limit?: number } = {}): string {
  const params = new URLSearchParams()
  // Selecting every type is the same collection as selecting none: do not send a redundant filter.
  const types = filters.types.length === GALLERY_OUTPUT_TYPES.length ? [] : filters.types
  if (types.length > 0) params.set('type', [...types].sort().join(','))
  if (filters.productionId) params.set('productionId', filters.productionId)
  else if (filters.projectId) params.set('projectId', filters.projectId)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.totals) params.set('totals', '1')
  if (options.cursor) params.set('cursor', options.cursor)
  const query = params.toString()
  return query ? `?${query}` : ''
}

// -- Pages -------------------------------------------------------------------------------------------------------------------------------

/**
 * Appends a page to what is already loaded. An output is its typed key: the same output arriving twice (a retry, a recovered source
 * re-delivering, overlapping pages) replaces itself and never becomes a second card. The merged list is kept in the canonical global
 * order, so an output that arrives late from a recovered source takes its chronological place instead of the end of the list.
 */
export function mergeOutputs(existing: readonly GalleryOutput[], incoming: readonly GalleryOutput[]): GalleryOutput[] {
  const byKey = new Map<string, GalleryOutput>()
  for (const item of existing) byKey.set(item.key, item)
  for (const item of incoming) byKey.set(item.key, item)
  return [...byKey.values()].sort(compareOutputs)
}

export function isOutputsResponse(value: unknown): value is GalleryOutputsResponse {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<GalleryOutputsResponse>
  return Array.isArray(body.items) && typeof body.sources === 'object' && body.sources !== null && typeof body.partial === 'boolean' && (body.nextCursor === null || typeof body.nextCursor === 'string')
}

export function failedSourceTypes(sources: Partial<Record<GalleryOutputType, GallerySourceState>> | null | undefined): GalleryOutputType[] {
  if (!sources) return []
  return GALLERY_OUTPUT_TYPES.filter((type) => sources[type]?.state === 'failed')
}

export function describeFailedSources(types: readonly GalleryOutputType[]): string {
  const names = types.map((type) => GALLERY_TYPE_SOURCE_NAMES[type])
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

// -- Totals ------------------------------------------------------------------------------------------------------------------------------

/** What the toolbar may say about "how many". An exact number only when the API itself reported one as exact. */
export type CountSummary =
  | { kind: 'exact'; total: number; loaded: number }
  | { kind: 'loaded'; loaded: number; more: boolean; incomplete: boolean }

export function summarizeCount(input: { loaded: number; totals: GalleryTotals | null; hasMore: boolean; partial: boolean }): CountSummary {
  const { totals } = input
  if (totals && totals.globalExact && typeof totals.global === 'number' && !input.partial) {
    return { kind: 'exact', total: totals.global, loaded: input.loaded }
  }
  return { kind: 'loaded', loaded: input.loaded, more: input.hasMore, incomplete: input.partial }
}

export function describeCount(summary: CountSummary): string {
  const plural = (count: number) => (count === 1 ? '1 output' : `${count} outputs`)
  if (summary.kind === 'exact') {
    return summary.loaded === summary.total ? `${plural(summary.total)} no total` : `${summary.loaded} de ${plural(summary.total)} carregados`
  }
  const base = `${plural(summary.loaded)} ${summary.loaded === 1 ? 'carregado' : 'carregados'}`
  if (summary.incomplete) return `${base} · lista incompleta (falha em alguma fonte)`
  return summary.more ? `${base} · há mais para carregar` : base
}

/** A per-type exact number, or null when it must not be shown. */
export function exactTypeCount(totals: GalleryTotals | null, type: GalleryOutputType): number | null {
  const value = totals?.bySource[type]
  return typeof value === 'number' ? value : null
}

// -- Local filters (loaded items only) -----------------------------------------------------------------------------------------------

export interface LocalFilters {
  search: string
  status: GalleryOutputStatus | 'all'
}

export const NO_LOCAL_FILTERS: LocalFilters = { search: '', status: 'all' }

export function hasLocalFilters(filters: LocalFilters): boolean {
  return filters.search.trim().length > 0 || filters.status !== 'all'
}

/** Search and status act on what is loaded - never on the whole collection. */
export function filterLoadedOutputs(items: readonly GalleryOutput[], filters: LocalFilters): GalleryOutput[] {
  const search = filters.search.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.status !== 'all' && item.status !== filters.status) return false
    if (!search) return true
    return [item.title, item.prompt, item.projectName, item.productionName, GALLERY_TYPE_LABELS[item.type]]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(search))
  })
}

// -- Empty states ----------------------------------------------------------------------------------------------------------------------

export type GalleryPanel =
  | { kind: 'loading' }
  | { kind: 'error' }
  /** Nothing loaded AND the list is known to be complete: the only case that may say "empty". */
  | { kind: 'empty'; filtered: boolean }
  /** Nothing loaded, but a source failed or more pages exist: NOT an empty Gallery. */
  | { kind: 'incomplete-empty'; failed: boolean }
  /** Loaded items exist but the local search/status hides all of them. */
  | { kind: 'local-no-match'; loaded: number; hasMore: boolean }
  | { kind: 'results' }

export function decideGalleryPanel(input: {
  phase: 'loading' | 'ready' | 'error'
  loaded: number
  visible: number
  partial: boolean
  hasMore: boolean
  serverFiltered: boolean
}): GalleryPanel {
  if (input.phase === 'loading' && input.loaded === 0) return { kind: 'loading' }
  if (input.phase === 'error' && input.loaded === 0) return { kind: 'error' }
  if (input.loaded === 0) {
    if (input.partial || input.hasMore) return { kind: 'incomplete-empty', failed: input.partial }
    return { kind: 'empty', filtered: input.serverFiltered }
  }
  if (input.visible === 0) return { kind: 'local-no-match', loaded: input.loaded, hasMore: input.hasMore }
  return { kind: 'results' }
}

// -- Labels ------------------------------------------------------------------------------------------------------------------------------

export function productionLabel(item: Pick<GalleryOutput, 'productionName' | 'productionState'>): string {
  if (item.productionName) return item.productionName
  return item.productionState === 'conflict' ? 'Production indefinida (registros conflitantes)' : 'Sem Production associada'
}

export function projectLabel(item: Pick<GalleryOutput, 'projectName' | 'projectId'>): string {
  return item.projectName ?? (item.projectId ? 'Project indisponível' : 'Project não identificado')
}

export function occurredAtLabel(kind: GalleryOutput['occurredAtKind']): string {
  return kind === 'completed' ? 'Concluído' : 'Gerado'
}

export function savedLabel(item: Pick<GalleryOutput, 'savedLibraryFileIds'>): string | null {
  const count = item.savedLibraryFileIds.length
  if (count === 0) return null
  return count === 1 ? 'Salvo em Arquivos' : `Salvo em Arquivos (${count})`
}

/** A historical AI video generated outside any Session says so; it never gets an invented Session. */
export function isStandaloneVideo(item: Pick<GalleryOutput, 'provenance'>): boolean {
  return item.provenance?.kind === 'video_standalone'
}

// -- Media (per-item authenticated endpoints) ---------------------------------------------------------------------------------------

export type MediaPurpose = 'thumbnail' | 'preview' | 'download'

export type MediaAnswer = { ok: true; url: string } | { ok: false; reason: 'unavailable' | 'denied' | 'failed' }

/**
 * Reads the answer of the per-item endpoint that belongs to the output's family. The three families answer in different shapes:
 *   image            { imageUrl, thumbnailUrl, publicUrl }   (GET /api/images/:id/signed-url)
 *   video_generation { url, expiresAt }                      (GET /api/video-generations/:id/playback-url)
 *   renders          { url, expiresAt }                      (GET /api/render-executions/:id/output-url)
 * The URL is transient: callers keep it in component state only, never as an identity.
 */
export function readMediaAnswer(type: GalleryOutputType, status: number, body: unknown, purpose: MediaPurpose): MediaAnswer {
  if (status === 401 || status === 403) return { ok: false, reason: 'denied' }
  if (status === 404 || status === 409) return { ok: false, reason: 'unavailable' }
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { ok: false, reason: 'failed' }
  const data = body as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
  const url = type === 'image'
    ? purpose === 'thumbnail' ? text(data.thumbnailUrl) ?? text(data.imageUrl) : text(data.imageUrl) ?? text(data.publicUrl)
    : text(data.url)
  return url ? { ok: true, url } : { ok: false, reason: 'unavailable' }
}

export function describeMediaFailure(reason: Extract<MediaAnswer, { ok: false }>['reason']): string {
  switch (reason) {
    case 'unavailable':
      return 'O arquivo não está disponível agora (indisponível ou expirado). O registro do output permanece no histórico.'
    case 'denied':
      return 'Sem permissão para acessar este arquivo. Entre novamente e tente de novo.'
    default:
      return 'Não foi possível carregar a mídia agora. Tente novamente.'
  }
}

/** Which element renders a family: images and static PNGs are pictures, AI videos and rendered MP4s are videos. */
export function mediaRenderer(item: Pick<GalleryOutput, 'mediaType'>): 'image' | 'video' {
  return item.mediaType === 'video' ? 'video' : 'image'
}

export function downloadFilename(item: Pick<GalleryOutput, 'title' | 'type' | 'id'>, mimeType?: string | null): string {
  const slug = item.title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : item.type === 'video_generation' || item.type === 'video_render' ? 'mp4' : 'png'
  return `${slug || item.type.replace('_', '-')}.${extension}`
}
