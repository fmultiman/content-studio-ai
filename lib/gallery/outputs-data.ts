// STRUCTURAL WAVE 1A-2, STEP S1 - Multimodal Gallery read model (data access).
//
// READ-ONLY. Every query is scoped to the authenticated user, selects an explicit column list, and is bounded by `limit + 1`.
// No storage path, worker field, lease, input snapshot, provider payload or signed URL is selected or returned: media is reached
// only through the existing per-item endpoints (see `accessEndpoints`).
//
// Each source is an ATOMIC loader: it either returns its page (rows AND their provenance, already verified) or it fails as a whole.
// A source that fails is reported as failed - never as empty - and the other sources keep their results (see `assembleGalleryPage`).
//
// `userDb` is the caller's own RLS-bound client. `renderDb` is the service-role client, used ONLY for `render_executions`, whose
// RLS deliberately gives the browser role no SELECT policy; it is always filtered by `user_id` here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { combineOrGroups } from '@/lib/library/browse-query'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'
import {
  accessEndpoints,
  assembleGalleryPage,
  assembleGalleryTotals,
  filterFingerprint,
  galleryProductionHref,
  GALLERY_OUTPUT_TYPES,
  imageOutputStatus,
  normalizeInstant,
  outputKey,
  promptPreview,
  resolveImageProvenance,
  resolveProductionClaims,
  sourceHrefFor,
  titleFromText,
  type GalleryOutput,
  type GalleryOutputType,
  type GalleryOutputsResponse,
  type GalleryProvenance,
  type SourcePosition,
  type SourcePositions,
  type SourceResult,
  type VerifiableProduction,
} from '@/lib/gallery/outputs'

type Row = Record<string, any>

export class GallerySourceError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'GallerySourceError'
  }
}

/** Raised by any query that errors: the whole source fails, with a code that carries no database detail. */
function must<T>(result: { data: T | null; error: unknown }, code: string): T {
  if (result.error) throw new GallerySourceError(code)
  return (result.data ?? []) as T
}

/**
 * Auxiliary (related-data) lookups: attempts, legacy drafts, saved files, drafts, pieces, contents, Productions, Projects.
 *
 * A lookup that the database cut short (PostgREST caps every response at its configured max rows, silently) would give a page
 * incomplete saved-file metadata or a Production/Session that is missing a conflicting claim. So every lookup asks for the
 * exact total of the SAME filter and the source only continues when it received ALL matching rows. An unreadable or smaller-
 * than-total answer fails the affected source: completeness is established, never assumed. `AUX_LOOKUP_LIMIT` is an explicit
 * ceiling on top of the server cap; a lookup that matches more rows than that fails too.
 */
export const AUX_LOOKUP_LIMIT = 1000

async function readComplete(query: PromiseLike<{ data: unknown; error: unknown; count: number | null }> & { limit(count: number): any }, code: string): Promise<Row[]> {
  const result = (await query.limit(AUX_LOOKUP_LIMIT)) as { data: unknown; error: unknown; count: number | null }
  if (result.error || !Array.isArray(result.data) || typeof result.count !== 'number') throw new GallerySourceError(code)
  if (result.data.length < result.count) throw new GallerySourceError(code)
  return result.data as Row[]
}

// The images list never selects `image_url`: legacy rows hold multi-megabyte data URLs in it. "Has an asset" is filtered in SQL.
const IMAGE_ASSET_FILTER = 'image_url.not.is.null,thumbnail_url.not.is.null,storage_path.not.is.null,thumbnail_path.not.is.null'

const IMAGE_COLUMNS = 'id, project_id, user_input, generated_prompt, status, model, mime_type, created_at'
const VIDEO_GENERATION_COLUMNS = 'id, project_id, production_id, session_id, mode, prompt, provider, model, library_file_id, created_at'
const VIDEO_RENDER_COLUMNS = 'id, project_id, video_draft_id, completed_at, output_mime_type, output_duration_ms, output_width, output_height'
const STATIC_RENDER_COLUMNS = 'id, project_id, channel_piece_id, completed_at, output_mime_type, output_width, output_height, slide:input_snapshot->slide'

export interface LoaderContext {
  userDb: SupabaseClient
  /** null when the service-role client is not configured: the two render sources then fail (they are not empty). */
  renderDb: SupabaseClient | null
  userId: string
  limit: number
  projectId: string | null
  after: SourcePosition | undefined
}

/** PostgREST logic tree selecting rows strictly after (column, id) in (column DESC, id DESC) order. */
export function keysetFilterOn(column: string, position: SourcePosition): string {
  return `${column}.lt."${position.at}",and(${column}.eq."${position.at}",id.lt.${position.id})`
}

// -- Shared context (Projects / Productions) -----------------------------------------------------------------------------------------

interface OwnedContext {
  projects: Map<string, string>
  productions: Map<string, VerifiableProduction & { title: string | null; intention: string | null }>
}

async function loadOwnedContext(userDb: SupabaseClient, userId: string, projectIds: Iterable<string | null | undefined>, productionIds: Iterable<string | null | undefined>): Promise<OwnedContext> {
  const productionList = [...new Set([...productionIds].filter((id): id is string => Boolean(id)))]
  const productions = new Map<string, VerifiableProduction & { title: string | null; intention: string | null }>()
  const projectSet = new Set([...projectIds].filter((id): id is string => Boolean(id)))
  if (productionList.length > 0) {
    const rows = await readComplete(userDb.from('productions').select('id, project_id, title, intention', { count: 'exact' }).eq('user_id', userId).in('id', productionList), 'CONTEXT_UNAVAILABLE')
    for (const row of rows) {
      productions.set(row.id, { id: row.id, project_id: row.project_id, title: row.title ?? null, intention: row.intention ?? null })
      if (row.project_id) projectSet.add(row.project_id)
    }
  }
  const projects = new Map<string, string>()
  if (projectSet.size > 0) {
    const rows = await readComplete(userDb.from('projects').select('id, name', { count: 'exact' }).eq('user_id', userId).in('id', [...projectSet]), 'CONTEXT_UNAVAILABLE')
    for (const row of rows) projects.set(row.id, row.name)
  }
  return { projects, productions }
}

/** Applies a verified Production claim result to the fields of an output. */
function scopeFields(context: OwnedContext, projectId: string | null, claims: ReadonlyArray<string | null | undefined>) {
  const resolution = resolveProductionClaims({ claims, projectId, productions: context.productions })
  const production = resolution.productionId ? context.productions.get(resolution.productionId) ?? null : null
  const projectName = projectId ? context.projects.get(projectId) ?? null : null
  return {
    resolution,
    projectName,
    productionId: production?.id ?? null,
    productionName: production ? resolveProductionDisplay({ title: production.title, intention: production.intention, projectName }).title : null,
    productionHref: galleryProductionHref(projectId, production?.id ?? null),
  }
}

/** Live LibraryFiles saved from an output. Annotation only: a LibraryFile never becomes an output. */
async function loadSavedFiles(userDb: SupabaseClient, userId: string, column: 'source_render_execution_id' | 'source_image_id', ids: string[]): Promise<Map<string, string[]>> {
  const saved = new Map<string, string[]>()
  if (ids.length === 0) return saved
  const rows = await readComplete(userDb.from('library_files').select(`id, ${column}, created_at`, { count: 'exact' }).eq('user_id', userId).in(column, ids).is('deleted_at', null), 'SAVED_FILES_UNAVAILABLE')
  for (const row of [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))) {
    const list = saved.get(row[column]) ?? []
    list.push(row.id)
    saved.set(row[column], list)
  }
  return saved
}

function emptyMedia(): GalleryOutput['media'] {
  return { mimeType: null, durationMs: null, width: null, height: null, provider: null, model: null, mode: null }
}

const asPositiveInt = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null)

/** Rows whose instant cannot be read cannot be ordered: the source fails instead of dropping them silently. */
function instantOf(raw: unknown): string {
  const instant = normalizeInstant(raw)
  if (!instant) throw new GallerySourceError('INVALID_INSTANT')
  return instant
}

// -- Source: AI images -------------------------------------------------------------------------------------------------------------------

function imageQuery(userDb: SupabaseClient, userId: string, projectId: string | null, columns: string, head: boolean) {
  let query = head
    ? userDb.from('images').select('id', { count: 'exact', head: true })
    : userDb.from('images').select(columns)
  query = query.eq('user_id', userId)
  if (projectId) query = query.eq('project_id', projectId)
  return query
}

async function loadImages(ctx: LoaderContext): Promise<GalleryOutput[]> {
  let query = imageQuery(ctx.userDb, ctx.userId, ctx.projectId, IMAGE_COLUMNS, false)
  query = query.or(combineOrGroups([IMAGE_ASSET_FILTER, ...(ctx.after ? [keysetFilterOn('created_at', ctx.after)] : [])]) as string)
  const rows = must<Row[]>(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ctx.limit + 1), 'IMAGES_UNAVAILABLE')
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id as string)

  // Production provenance: the Attempts that produced the image (current writers), then the legacy draft that holds it.
  // A truncated Attempt or draft lookup could hide a conflicting claim or a Session: both are read to completion or the source fails.
  const attempts = await readComplete(
    ctx.userDb.from('image_generation_attempts').select('id, session_id, project_id, production_id, result_image_id, status, completed_at', { count: 'exact' }).eq('user_id', ctx.userId).in('result_image_id', ids),
    'ATTEMPTS_UNAVAILABLE',
  )
  const drafts = await readComplete(
    ctx.userDb.from('image_drafts').select('id, project_id, production_id, current_image_id', { count: 'exact' }).eq('user_id', ctx.userId).in('current_image_id', ids),
    'DRAFTS_UNAVAILABLE',
  )
  const saved = await loadSavedFiles(ctx.userDb, ctx.userId, 'source_image_id', ids)
  const context = await loadOwnedContext(
    ctx.userDb, ctx.userId,
    rows.map((row) => row.project_id),
    [...attempts.map((attempt) => attempt.production_id), ...drafts.map((draft) => draft.production_id)],
  )

  return rows.map((row): GalleryOutput => {
    const imageAttempts = attempts.filter((attempt) => attempt.result_image_id === row.id)
    const imageDrafts = drafts.filter((draft) => draft.current_image_id === row.id)
    const projectId: string | null = row.project_id ?? null
    // Legacy draft claims count only when no Attempt names the image: the Attempt is the authoritative writer.
    const claims = imageAttempts.length > 0 ? imageAttempts.map((attempt) => attempt.production_id) : imageDrafts.map((draft) => draft.production_id)
    const scope = scopeFields(context, projectId, claims)
    const provenance: GalleryProvenance = resolveImageProvenance(
      imageAttempts.map((attempt) => ({ id: attempt.id, session_id: attempt.session_id ?? null, production_id: attempt.production_id ?? null, completed_at: attempt.completed_at ?? null })),
      imageDrafts.map((draft) => draft.id),
    )
    const prompt = (row.user_input as string | null) || (row.generated_prompt as string | null) || null
    return {
      key: outputKey('image', row.id),
      type: 'image',
      id: row.id,
      mediaType: 'image',
      title: titleFromText(prompt, 'Imagem gerada'),
      prompt: promptPreview(prompt),
      occurredAt: instantOf(row.created_at),
      occurredAtKind: 'created',
      projectId,
      projectName: scope.projectName,
      productionId: scope.productionId,
      productionName: scope.productionName,
      productionState: scope.resolution.state,
      productionHref: scope.productionHref,
      provenance,
      status: imageOutputStatus(row.status),
      media: { ...emptyMedia(), mimeType: row.mime_type ?? null, model: row.model ?? null },
      availability: 'unverified',
      savedLibraryFileIds: saved.get(row.id) ?? [],
      sourceHref: sourceHrefFor(provenance, { projectId }),
      access: accessEndpoints('image', row.id),
    }
  })
}

async function countImages(ctx: LoaderContext): Promise<number> {
  const result = await imageQuery(ctx.userDb, ctx.userId, ctx.projectId, '', true).or(IMAGE_ASSET_FILTER)
  return exactCount(result)
}

// -- Source: AI videos -------------------------------------------------------------------------------------------------------------------

function videoGenerationQuery(userDb: SupabaseClient, userId: string, projectId: string | null, columns: string, head: boolean) {
  let query = head
    ? userDb.from('video_generations').select('id', { count: 'exact', head: true })
    : userDb.from('video_generations').select(columns)
  // "Completed" = succeeded WITH a stored object (completion writes both atomically). The path itself is never selected.
  query = query.eq('user_id', userId).eq('status', 'succeeded').not('storage_path', 'is', null)
  if (projectId) query = query.eq('project_id', projectId)
  return query
}

async function loadVideoGenerations(ctx: LoaderContext): Promise<GalleryOutput[]> {
  let query = videoGenerationQuery(ctx.userDb, ctx.userId, ctx.projectId, VIDEO_GENERATION_COLUMNS, false)
  if (ctx.after) query = query.or(keysetFilterOn('created_at', ctx.after))
  const rows = must<Row[]>(await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(ctx.limit + 1), 'VIDEO_GENERATIONS_UNAVAILABLE')
  if (rows.length === 0) return []

  const context = await loadOwnedContext(ctx.userDb, ctx.userId, rows.map((row) => row.project_id), rows.map((row) => row.production_id))
  // The pointer counts only while its LibraryFile is live (same rule as GET /api/video-generations).
  const pointerIds = [...new Set(rows.map((row) => row.library_file_id).filter((id): id is string => Boolean(id)))]
  const liveFiles = new Set<string>()
  if (pointerIds.length > 0) {
    const live = await readComplete(ctx.userDb.from('library_files').select('id', { count: 'exact' }).eq('user_id', ctx.userId).in('id', pointerIds).is('deleted_at', null), 'SAVED_FILES_UNAVAILABLE')
    for (const file of live) liveFiles.add(file.id)
  }

  return rows.map((row): GalleryOutput => {
    const projectId: string | null = row.project_id ?? null
    const scope = scopeFields(context, projectId, [row.production_id])
    // A Session is named only when the row carries one (the database validates it against owner/Project/Production).
    // Historical standalone generations never get an invented Session.
    const provenance: GalleryProvenance = row.session_id ? { kind: 'video_session', sessionId: row.session_id } : { kind: 'video_standalone' }
    return {
      key: outputKey('video_generation', row.id),
      type: 'video_generation',
      id: row.id,
      mediaType: 'video',
      title: titleFromText(row.prompt, 'Vídeo gerado por IA'),
      prompt: promptPreview(row.prompt),
      occurredAt: instantOf(row.created_at),
      occurredAtKind: 'created',
      projectId,
      projectName: scope.projectName,
      productionId: scope.productionId,
      productionName: scope.productionName,
      productionState: scope.resolution.state,
      productionHref: scope.productionHref,
      provenance,
      status: 'generated',
      media: { ...emptyMedia(), mimeType: 'video/mp4', provider: row.provider ?? null, model: row.model ?? null, mode: row.mode ?? null },
      availability: 'unverified',
      savedLibraryFileIds: row.library_file_id && liveFiles.has(row.library_file_id) ? [row.library_file_id] : [],
      sourceHref: sourceHrefFor(provenance, { projectId }),
      access: accessEndpoints('video_generation', row.id),
    }
  })
}

async function countVideoGenerations(ctx: LoaderContext): Promise<number> {
  return exactCount(await videoGenerationQuery(ctx.userDb, ctx.userId, ctx.projectId, '', true))
}

// -- Sources: Creative Editor renders ------------------------------------------------------------------------------------------------

function renderQuery(renderDb: SupabaseClient, userId: string, projectId: string | null, kind: 'video' | 'static_still', columns: string, head: boolean) {
  let query = head
    ? renderDb.from('render_executions').select('id', { count: 'exact', head: true })
    : renderDb.from('render_executions').select(columns)
  // `completed_at` is the ordering instant of a completed render; completion always writes it, a row without it cannot be ordered.
  query = query.eq('user_id', userId).eq('kind', kind).eq('status', 'completed').not('completed_at', 'is', null)
  if (projectId) query = query.eq('project_id', projectId)
  return query
}

async function loadVideoRenders(ctx: LoaderContext): Promise<GalleryOutput[]> {
  if (!ctx.renderDb) throw new GallerySourceError('RENDER_SERVICE_UNAVAILABLE')
  let query = renderQuery(ctx.renderDb, ctx.userId, ctx.projectId, 'video', VIDEO_RENDER_COLUMNS, false)
  if (ctx.after) query = query.or(keysetFilterOn('completed_at', ctx.after))
  const rows = must<Row[]>(await query.order('completed_at', { ascending: false }).order('id', { ascending: false }).limit(ctx.limit + 1), 'VIDEO_RENDERS_UNAVAILABLE')
  if (rows.length === 0) return []

  const draftIds = [...new Set(rows.map((row) => row.video_draft_id).filter((id): id is string => Boolean(id)))]
  const drafts = new Map<string, Row>()
  if (draftIds.length > 0) {
    for (const draft of await readComplete(ctx.userDb.from('video_drafts').select('id, project_id, production_id, name', { count: 'exact' }).eq('user_id', ctx.userId).in('id', draftIds), 'DRAFTS_UNAVAILABLE')) drafts.set(draft.id, draft)
  }
  const saved = await loadSavedFiles(ctx.userDb, ctx.userId, 'source_render_execution_id', rows.map((row) => row.id))
  const context = await loadOwnedContext(ctx.userDb, ctx.userId, [...rows.map((row) => row.project_id), ...[...drafts.values()].map((draft) => draft.project_id)], [...drafts.values()].map((draft) => draft.production_id))

  return rows.map((row): GalleryOutput => {
    const projectId: string | null = row.project_id ?? null
    const draft = row.video_draft_id ? drafts.get(row.video_draft_id) ?? null : null
    // The render's own Project is frozen at queue time. A draft that now sits in another Project contradicts it: no Production is guessed.
    const draftContradicts = Boolean(draft && draft.project_id !== projectId)
    const scope = scopeFields(context, projectId, draftContradicts ? [] : [draft?.production_id])
    const productionState = draftContradicts && draft?.production_id ? 'conflict' : scope.resolution.state
    const provenance: GalleryProvenance = row.video_draft_id ? { kind: 'video_draft', videoDraftId: row.video_draft_id } : null
    return {
      key: outputKey('video_render', row.id),
      type: 'video_render',
      id: row.id,
      mediaType: 'video',
      title: titleFromText(draft?.name, 'Vídeo renderizado'),
      prompt: null,
      occurredAt: instantOf(row.completed_at),
      occurredAtKind: 'completed',
      projectId,
      projectName: scope.projectName,
      productionId: scope.productionId,
      productionName: scope.productionName,
      productionState,
      productionHref: scope.productionHref,
      provenance,
      status: 'generated',
      media: { ...emptyMedia(), mimeType: row.output_mime_type ?? 'video/mp4', durationMs: asPositiveInt(row.output_duration_ms), width: asPositiveInt(row.output_width), height: asPositiveInt(row.output_height) },
      availability: 'unverified',
      savedLibraryFileIds: saved.get(row.id) ?? [],
      sourceHref: draft ? sourceHrefFor(provenance, { projectId }) : null,
      access: accessEndpoints('video_render', row.id),
    }
  })
}

async function loadStaticRenders(ctx: LoaderContext): Promise<GalleryOutput[]> {
  if (!ctx.renderDb) throw new GallerySourceError('RENDER_SERVICE_UNAVAILABLE')
  let query = renderQuery(ctx.renderDb, ctx.userId, ctx.projectId, 'static_still', STATIC_RENDER_COLUMNS, false)
  if (ctx.after) query = query.or(keysetFilterOn('completed_at', ctx.after))
  const rows = must<Row[]>(await query.order('completed_at', { ascending: false }).order('id', { ascending: false }).limit(ctx.limit + 1), 'STATIC_RENDERS_UNAVAILABLE')
  if (rows.length === 0) return []

  const pieceIds = [...new Set(rows.map((row) => row.channel_piece_id).filter((id): id is string => Boolean(id)))]
  const pieces = new Map<string, Row>()
  if (pieceIds.length > 0) {
    for (const piece of await readComplete(ctx.userDb.from('channel_pieces').select('id, editorial_content_id', { count: 'exact' }).eq('user_id', ctx.userId).in('id', pieceIds), 'PIECES_UNAVAILABLE')) pieces.set(piece.id, piece)
  }
  const contentIds = [...new Set([...pieces.values()].map((piece) => piece.editorial_content_id).filter((id): id is string => Boolean(id)))]
  const contents = new Map<string, Row>()
  if (contentIds.length > 0) {
    for (const content of await readComplete(ctx.userDb.from('editorial_contents').select('id, project_id, production_id, title', { count: 'exact' }).eq('user_id', ctx.userId).in('id', contentIds), 'CONTENTS_UNAVAILABLE')) contents.set(content.id, content)
  }
  const saved = await loadSavedFiles(ctx.userDb, ctx.userId, 'source_render_execution_id', rows.map((row) => row.id))
  const context = await loadOwnedContext(ctx.userDb, ctx.userId, [...rows.map((row) => row.project_id), ...[...contents.values()].map((content) => content.project_id)], [...contents.values()].map((content) => content.production_id))

  return rows.map((row): GalleryOutput => {
    const projectId: string | null = row.project_id ?? null
    const piece = row.channel_piece_id ? pieces.get(row.channel_piece_id) ?? null : null
    const content = piece ? contents.get(piece.editorial_content_id) ?? null : null
    const contentContradicts = Boolean(content && content.project_id !== projectId)
    const scope = scopeFields(context, projectId, contentContradicts ? [] : [content?.production_id])
    const productionState = contentContradicts && content?.production_id ? 'conflict' : scope.resolution.state
    const provenance: GalleryProvenance = piece && content ? { kind: 'channel_piece', channelPieceId: piece.id, editorialContentId: content.id } : null
    const slide = row.slide && typeof row.slide === 'object' ? (row.slide as Row) : null
    const slideLabel = slide && asPositiveInt(slide.index) && asPositiveInt(slide.total) ? ` · Slide ${slide.index}/${slide.total}` : ''
    return {
      key: outputKey('static_render', row.id),
      type: 'static_render',
      id: row.id,
      mediaType: 'image',
      title: `${titleFromText(content?.title, 'Render estático')}${slideLabel}`,
      prompt: null,
      occurredAt: instantOf(row.completed_at),
      occurredAtKind: 'completed',
      projectId,
      projectName: scope.projectName,
      productionId: scope.productionId,
      productionName: scope.productionName,
      productionState,
      productionHref: scope.productionHref,
      provenance,
      status: 'generated',
      media: { ...emptyMedia(), mimeType: row.output_mime_type ?? 'image/png', width: asPositiveInt(row.output_width), height: asPositiveInt(row.output_height) },
      availability: 'unverified',
      savedLibraryFileIds: saved.get(row.id) ?? [],
      sourceHref: sourceHrefFor(provenance, { projectId }),
      access: accessEndpoints('static_render', row.id),
    }
  })
}

async function countRenders(ctx: LoaderContext, kind: 'video' | 'static_still'): Promise<number> {
  if (!ctx.renderDb) throw new GallerySourceError('RENDER_SERVICE_UNAVAILABLE')
  return exactCount(await renderQuery(ctx.renderDb, ctx.userId, ctx.projectId, kind, '', true))
}

function exactCount(result: { count: number | null; error: unknown }): number {
  if (result.error || typeof result.count !== 'number') throw new GallerySourceError('COUNT_UNAVAILABLE')
  return result.count
}

// -- Orchestration -------------------------------------------------------------------------------------------------------------------

const LOADERS: Record<GalleryOutputType, (ctx: LoaderContext) => Promise<GalleryOutput[]>> = {
  image: loadImages,
  video_generation: loadVideoGenerations,
  video_render: loadVideoRenders,
  static_render: loadStaticRenders,
}

const COUNTERS: Record<GalleryOutputType, (ctx: LoaderContext) => Promise<number>> = {
  image: countImages,
  video_generation: countVideoGenerations,
  video_render: (ctx) => countRenders(ctx, 'video'),
  static_render: (ctx) => countRenders(ctx, 'static_still'),
}

function failureCode(error: unknown): string {
  return error instanceof GallerySourceError ? error.code : 'SOURCE_UNAVAILABLE'
}

export interface GalleryOutputsQuery {
  types: readonly GalleryOutputType[]
  projectId: string | null
  limit: number
  positions: SourcePositions
  includeTotals: boolean
}

export async function loadGalleryOutputs(deps: { userDb: SupabaseClient; renderDb: SupabaseClient | null; userId: string }, query: GalleryOutputsQuery): Promise<GalleryOutputsResponse> {
  const selected = GALLERY_OUTPUT_TYPES.filter((type) => query.types.includes(type))
  const contextFor = (type: GalleryOutputType): LoaderContext => ({ ...deps, limit: query.limit, projectId: query.projectId, after: query.positions[type] })

  const results: SourceResult[] = await Promise.all(
    GALLERY_OUTPUT_TYPES.map(async (type): Promise<SourceResult> => {
      if (!selected.includes(type)) return { type, state: 'skipped' }
      try {
        return { type, state: 'ok', items: await LOADERS[type](contextFor(type)) }
      } catch (error) {
        // Only the error name and the stable code are logged: never row data or a database message.
        console.error('[Gallery outputs] source failed:', type, failureCode(error))
        return { type, state: 'failed', code: failureCode(error) }
      }
    }),
  )

  const page = assembleGalleryPage({ results, previous: query.positions, limit: query.limit, fingerprint: filterFingerprint(selected, query.projectId) })

  let totals: GalleryOutputsResponse['totals']
  if (query.includeTotals) {
    const counts: Partial<Record<GalleryOutputType, number | null>> = {}
    await Promise.all(selected.map(async (type) => {
      try {
        counts[type] = await COUNTERS[type]({ ...contextFor(type), after: undefined })
      } catch {
        counts[type] = null
      }
    }))
    totals = assembleGalleryTotals(selected, page.sources, counts)
  }

  return { items: page.items, nextCursor: page.nextCursor, hasMore: page.nextCursor !== null, partial: page.partial, limit: query.limit, sources: page.sources, ...(totals ? { totals } : {}) }
}
