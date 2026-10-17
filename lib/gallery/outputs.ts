// STRUCTURAL WAVE 1A-2, STEP S1 - Multimodal Gallery read model (pure rules).
//
// The Gallery is a READ-ONLY PROJECTION of completed outputs. There is no Output table: an output is identified by the
// persisted record it comes from, and a LibraryFile that was saved from it is only an annotation, never another output.
//
//   type              canonical output ID                      "completed" means
//   image             images.id                                 the row carries a stored/provider asset
//   video_generation  video_generations.id                      status = 'succeeded' with a stored object
//   video_render      render_executions.id (kind = 'video')     status = 'completed'
//   static_render     render_executions.id (kind = 'static_still') status = 'completed'
//
// This module holds everything that is pure and testable without a database: identity, instants, the cursor, the global
// merge, Production provenance rules and the response contract. The data access lives in `outputs-data.ts`.

import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import { productionHref } from '@/lib/draft-hub'
import { imageSessionHref, videoSessionHref } from '@/lib/session-continuity'
import { isUuid } from '@/lib/library/production-scope'

// -- Identity ----------------------------------------------------------------------------------------------------------------------

export const GALLERY_OUTPUT_TYPES = ['image', 'video_generation', 'video_render', 'static_render'] as const
export type GalleryOutputType = (typeof GALLERY_OUTPUT_TYPES)[number]

/** Typed identity = source kind + canonical output ID. Never a LibraryFile id, a prompt or a Session. */
export type GalleryOutputKey = `${GalleryOutputType}:${string}`

export function outputKey(type: GalleryOutputType, id: string): GalleryOutputKey {
  return `${type}:${id}`
}

export function isGalleryOutputType(value: unknown): value is GalleryOutputType {
  return typeof value === 'string' && (GALLERY_OUTPUT_TYPES as readonly string[]).includes(value)
}

export const GALLERY_DEFAULT_LIMIT = 48
export const GALLERY_MAX_LIMIT = 100
/** Prompt text carried in the list is a preview, never the whole prompt. */
export const GALLERY_PROMPT_PREVIEW_MAX = 500
const TITLE_MAX = 72

export function clampGalleryLimit(raw: string | null): number {
  const parsed = Number(raw)
  if (!raw || !Number.isFinite(parsed) || parsed < 1) return GALLERY_DEFAULT_LIMIT
  return Math.min(Math.floor(parsed), GALLERY_MAX_LIMIT)
}

// -- Instants ----------------------------------------------------------------------------------------------------------------------

const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/

/**
 * A persisted timestamp as a fixed-width, UTC, microsecond string (`YYYY-MM-DDTHH:mm:ss.ffffffZ`). Postgres keeps microseconds
 * and JS `Date` does not: comparing as `Date` would tie rows the database orders, and a page boundary would then drift from
 * the keyset. Fixed width makes the plain string order the chronological order. null for anything that is not a timestamp.
 */
export function normalizeInstant(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = INSTANT_RE.exec(raw.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second, fraction = '', zone = 'Z'] = match
  let offsetMinutes = 0
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '')
    offsetMinutes = (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0)) * (zone[0] === '-' ? -1 : 1)
  }
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offsetMinutes * 60_000
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  // Reject impossible calendar dates (Date.UTC rolls 02-31 over to March).
  if (zone === 'Z' && (date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day))) return null
  return `${date.toISOString().slice(0, 19)}.${(fraction + '000000').slice(0, 6)}Z`
}

// -- Output contract ---------------------------------------------------------------------------------------------------------------

export type GalleryOutputStatus = 'generated' | 'approved' | 'rejected' | 'generating'

/**
 * resolved   exactly one verified Production claim (owned, same Project as the output)
 * unscoped   no claim, or no claim that can be verified: the output has no Production for the Gallery
 * conflict   claims that contradict each other (or the output's own Project): no Production is guessed
 */
export type GalleryProductionState = 'resolved' | 'unscoped' | 'conflict'

export type GalleryProvenance =
  | { kind: 'image_session'; sessionId: string; attemptId: string }
  | { kind: 'image_attempt'; attemptId: string }
  | { kind: 'legacy_image_draft'; draftId: string }
  | { kind: 'video_session'; sessionId: string }
  | { kind: 'video_standalone' }
  | { kind: 'video_draft'; videoDraftId: string }
  | { kind: 'channel_piece'; channelPieceId: string; editorialContentId: string }
  | null

export interface GalleryOutput {
  /** `<type>:<canonical id>` - the stable identity, unique across the whole response. */
  key: GalleryOutputKey
  type: GalleryOutputType
  id: string
  mediaType: 'image' | 'video'
  title: string
  prompt: string | null
  /** The persisted instant the global chronology uses (microsecond UTC). Never `updated_at`. */
  occurredAt: string
  occurredAtKind: 'created' | 'completed'
  projectId: string | null
  projectName: string | null
  productionId: string | null
  productionName: string | null
  productionState: GalleryProductionState
  productionHref: string | null
  provenance: GalleryProvenance
  /** Only AI images can be approved/rejected; every other output is simply 'generated'. */
  status: GalleryOutputStatus
  media: {
    mimeType: string | null
    durationMs: number | null
    width: number | null
    height: number | null
    provider: string | null
    model: string | null
    mode: string | null
  }
  /** Never 'available': existence of the stored object is verified lazily, on access (decision D2). */
  availability: 'unverified'
  /** Live LibraryFiles that were explicitly saved from this output. An annotation, not an output. */
  savedLibraryFileIds: string[]
  /** Canonical resume/open target when the provenance proves one, otherwise null. */
  sourceHref: string | null
  /** The existing secure per-item endpoints: the media access boundary. These are paths, never signed URLs. */
  access: { previewEndpoint: string; downloadEndpoint: string }
}

export type GallerySourceState =
  | { state: 'ok'; hasMore: boolean }
  | { state: 'failed'; code: string }
  | { state: 'skipped' }

export interface GalleryTotals {
  /** Per source: an exact count, or null when it could not be read. */
  bySource: Partial<Record<GalleryOutputType, number | null>>
  /** The global total, only when every selected source listed AND counted successfully. Otherwise null. */
  global: number | null
  globalExact: boolean
}

export interface GalleryOutputsResponse {
  items: GalleryOutput[]
  /** Non-null while there may be more outputs, INCLUDING while a failed source still owes its outputs. */
  nextCursor: string | null
  hasMore: boolean
  /** true when at least one selected source failed: the list is incomplete, never "all there is". */
  partial: boolean
  limit: number
  sources: Record<GalleryOutputType, GallerySourceState>
  totals?: GalleryTotals
}

// -- Endpoints / links ---------------------------------------------------------------------------------------------------------------

export function accessEndpoints(type: GalleryOutputType, id: string): GalleryOutput['access'] {
  switch (type) {
    case 'image':
      return { previewEndpoint: `/api/images/${id}/signed-url`, downloadEndpoint: `/api/images/${id}/signed-url` }
    case 'video_generation':
      return { previewEndpoint: `/api/video-generations/${id}/playback-url`, downloadEndpoint: `/api/video-generations/${id}/playback-url?disposition=attachment` }
    case 'video_render':
    case 'static_render':
      return { previewEndpoint: `/api/render-executions/${id}/output-url`, downloadEndpoint: `/api/render-executions/${id}/output-url?disposition=attachment` }
  }
}

/** The one canonical open/resume target a verified provenance justifies; null when it proves none (never a guess). */
export function sourceHrefFor(provenance: GalleryProvenance, scope: { projectId: string | null }): string | null {
  if (!provenance) return null
  switch (provenance.kind) {
    case 'image_session':
      return imageSessionHref(provenance.sessionId)
    case 'video_session':
      return videoSessionHref(provenance.sessionId)
    case 'video_draft':
      return videoCreativeEditorHref(provenance.videoDraftId)
    case 'channel_piece':
      return scope.projectId
        ? `/projetos/${scope.projectId}/conteudos/${provenance.editorialContentId}/channel-pieces/${provenance.channelPieceId}/editar-visual`
        : null
    default:
      return null
  }
}

export function galleryProductionHref(projectId: string | null, productionId: string | null): string | null {
  return productionHref(projectId, productionId)
}

// -- Text ----------------------------------------------------------------------------------------------------------------------------

export function titleFromText(text: string | null | undefined, fallback: string): string {
  const firstLine = (text ?? '').split('\n')[0].trim()
  if (!firstLine) return fallback
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 3).trim()}...` : firstLine
}

export function promptPreview(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return null
  return trimmed.length > GALLERY_PROMPT_PREVIEW_MAX ? `${trimmed.slice(0, GALLERY_PROMPT_PREVIEW_MAX - 3).trim()}...` : trimmed
}

export function imageOutputStatus(status: unknown): GalleryOutputStatus {
  if (status === 'approved' || status === 'rejected' || status === 'generating') return status
  return 'generated'
}

// -- Production provenance ----------------------------------------------------------------------------------------------------------

export interface VerifiableProduction {
  id: string
  project_id: string
}

/**
 * The Production of an output, from the persisted relationships that name one - and nothing else.
 *
 * `claims` are the production ids the output's own records state (Attempts, legacy drafts, the row itself, its VideoDraft,
 * its EditorialContent). A claim only counts when it names a Production the owner really has (`productions`, already loaded
 * under the owner's filter) AND that Production belongs to the output's Project. Names, a sole Production, folders, prompts and
 * dates are never inputs. Exactly one distinct verified claim resolves; none stays unscoped; several contradict -> conflict.
 */
export function resolveProductionClaims(input: {
  claims: ReadonlyArray<string | null | undefined>
  projectId: string | null
  productions: ReadonlyMap<string, VerifiableProduction>
}): { state: GalleryProductionState; productionId: string | null } {
  const verified = new Set<string>()
  for (const claim of input.claims) {
    if (!claim) continue
    const production = input.productions.get(claim)
    if (production && input.projectId && production.project_id === input.projectId) verified.add(production.id)
  }
  if (verified.size === 0) return { state: 'unscoped', productionId: null }
  if (verified.size > 1) return { state: 'conflict', productionId: null }
  return { state: 'resolved', productionId: [...verified][0] }
}

export interface ImageAttemptClaim {
  id: string
  session_id: string | null
  production_id: string | null
  completed_at: string | null
}

/**
 * The provenance of an AI image, from its Attempts (the current writers) and, only when no Attempt names it, the legacy draft
 * that holds it as its current image. An image whose origin is unknown stays a valid output with `provenance: null`.
 * Several Attempts of one Session are the same provenance; Attempts of several Sessions prove no single Session.
 */
export function resolveImageProvenance(attempts: readonly ImageAttemptClaim[], legacyDraftIds: readonly string[]): GalleryProvenance {
  if (attempts.length > 0) {
    const latest = [...attempts].sort((a, b) => (normalizeInstant(b.completed_at) ?? '').localeCompare(normalizeInstant(a.completed_at) ?? '') || b.id.localeCompare(a.id))[0]
    const sessions = new Set(attempts.map((attempt) => attempt.session_id).filter((id): id is string => Boolean(id)))
    if (sessions.size === 1) {
      const sessionId = [...sessions][0]
      const inSession = attempts.filter((attempt) => attempt.session_id === sessionId)
      const newest = [...inSession].sort((a, b) => (normalizeInstant(b.completed_at) ?? '').localeCompare(normalizeInstant(a.completed_at) ?? '') || b.id.localeCompare(a.id))[0]
      return { kind: 'image_session', sessionId, attemptId: newest.id }
    }
    if (sessions.size === 0 && attempts.length === 1) return { kind: 'image_attempt', attemptId: latest.id }
    return null
  }
  const drafts = [...new Set(legacyDraftIds)]
  return drafts.length === 1 ? { kind: 'legacy_image_draft', draftId: drafts[0] } : null
}

// -- Global ordering, cursor and page assembly -----------------------------------------------------------------------------------------

/** Newest first; the key breaks every tie, so the order is total and identical on every request. */
export function compareOutputs(a: Pick<GalleryOutput, 'occurredAt' | 'key'>, b: Pick<GalleryOutput, 'occurredAt' | 'key'>): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1
  if (a.key === b.key) return 0
  return a.key < b.key ? 1 : -1
}

/** Where one source resumes: strictly after (instant, id) in that source's own (instant DESC, id DESC) order. */
export interface SourcePosition {
  at: string
  id: string
}

export type SourcePositions = Partial<Record<GalleryOutputType, SourcePosition>>

interface CursorPayload {
  v: 1
  /** Fingerprint of the filters the cursor belongs to: a cursor never crosses a changed filter. */
  f: string
  p: Partial<Record<GalleryOutputType, [string, string]>>
}

export function filterFingerprint(types: readonly GalleryOutputType[], projectId: string | null): string {
  return `${[...types].sort().join(',')}|${projectId ?? ''}`
}

export function encodeGalleryCursor(fingerprint: string, positions: SourcePositions): string {
  const p: CursorPayload['p'] = {}
  for (const type of GALLERY_OUTPUT_TYPES) {
    const position = positions[type]
    if (position) p[type] = [position.at, position.id]
  }
  return Buffer.from(JSON.stringify({ v: 1, f: fingerprint, p } satisfies CursorPayload), 'utf8').toString('base64url')
}

export type CursorDecode = { ok: true; positions: SourcePositions } | { ok: false; reason: 'MALFORMED' | 'FILTER_MISMATCH' }

/** Anything that is not exactly a cursor this endpoint produced for these filters is refused BEFORE it reaches a query. */
export function decodeGalleryCursor(raw: string | null, fingerprint: string): CursorDecode {
  if (raw === null || raw === '') return { ok: true, positions: {} }
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorPayload>
    if (!parsed || parsed.v !== 1 || typeof parsed.f !== 'string' || typeof parsed.p !== 'object' || parsed.p === null || Array.isArray(parsed.p)) {
      return { ok: false, reason: 'MALFORMED' }
    }
    if (parsed.f !== fingerprint) return { ok: false, reason: 'FILTER_MISMATCH' }
    const positions: SourcePositions = {}
    for (const [type, value] of Object.entries(parsed.p)) {
      if (!isGalleryOutputType(type) || !Array.isArray(value) || value.length !== 2) return { ok: false, reason: 'MALFORMED' }
      const [at, id] = value as [unknown, unknown]
      // The instant must already be in the canonical form: re-normalising it must not change it.
      if (typeof at !== 'string' || normalizeInstant(at) !== at || !isUuid(id)) return { ok: false, reason: 'MALFORMED' }
      positions[type] = { at, id }
    }
    return { ok: true, positions }
  } catch {
    return { ok: false, reason: 'MALFORMED' }
  }
}

export type SourceResult =
  | { type: GalleryOutputType; state: 'ok'; /** In the source's own order; loaders fetch limit + 1. */ items: GalleryOutput[] }
  | { type: GalleryOutputType; state: 'failed'; code: string }
  | { type: GalleryOutputType; state: 'skipped' }

export interface AssembledPage {
  items: GalleryOutput[]
  nextCursor: string | null
  partial: boolean
  sources: Record<GalleryOutputType, GallerySourceState>
}

/**
 * One globally ordered page out of the per-source results.
 *
 *  - A source advances ONLY by the last item of its own that made it into the page. A source with nothing on the page, a failed
 *    source and a skipped source keep the position they had, so nothing a source still owes can be skipped by a later page.
 *  - `hasMore` of a source is exact: it fetched more rows than it contributed (loaders fetch limit + 1).
 *  - A failed source never counts as empty or exhausted: the cursor stays open for it and `partial` is true.
 *  - An output that a source returned twice, or two sources returned under one key, appears once.
 */
export function assembleGalleryPage(input: {
  results: readonly SourceResult[]
  previous: SourcePositions
  limit: number
  fingerprint: string
}): AssembledPage {
  const seen = new Set<GalleryOutputKey>()
  const merged: GalleryOutput[] = []
  for (const result of input.results) {
    if (result.state !== 'ok') continue
    for (const item of result.items) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      merged.push(item)
    }
  }
  merged.sort(compareOutputs)
  const items = merged.slice(0, input.limit)

  const positions: SourcePositions = { ...input.previous }
  const sources = {} as Record<GalleryOutputType, GallerySourceState>
  let anyMore = false
  let partial = false
  for (const result of input.results) {
    if (result.state === 'skipped') {
      sources[result.type] = { state: 'skipped' }
      continue
    }
    if (result.state === 'failed') {
      sources[result.type] = { state: 'failed', code: result.code }
      partial = true
      anyMore = true
      continue
    }
    const emitted = items.filter((item) => item.type === result.type)
    if (emitted.length > 0) {
      const last = emitted[emitted.length - 1]
      positions[result.type] = { at: last.occurredAt, id: last.id }
    }
    const hasMore = result.items.length > emitted.length
    if (hasMore) anyMore = true
    sources[result.type] = { state: 'ok', hasMore }
  }
  return { items, nextCursor: anyMore ? encodeGalleryCursor(input.fingerprint, positions) : null, partial, sources }
}

/** The honest global total: only when every selected source listed and counted, and every count is exact. */
export function assembleGalleryTotals(
  selected: readonly GalleryOutputType[],
  sources: Record<GalleryOutputType, GallerySourceState>,
  counts: Partial<Record<GalleryOutputType, number | null>>,
): GalleryTotals {
  const bySource: GalleryTotals['bySource'] = {}
  let global = 0
  let exact = true
  for (const type of selected) {
    const count = counts[type] ?? null
    bySource[type] = count
    if (count === null || sources[type].state !== 'ok') exact = false
    else global += count
  }
  return { bySource, global: exact ? global : null, globalExact: exact }
}
