// VIDEO_MEDIA_ARTIFACT_AND_STREAMING_FOUNDATION_V1
//
// Canonical runtime registration of immutable VIDEO media as `media_artifacts`.
//
//   source (owner-scoped row)  ->  trusted storage coordinates  ->  artifact + provenance
//
// The caller passes a typed source id, never a URL or a storage key. The server
// loads the source row filtered by the authenticated owner, proves the stored
// key is inside that owner's namespace for that source family, and only then
// reads the object. Identity follows the existing Universal Media Review
// contract: `(user, media_type, storage_provider, storage_path, content_hash)`
// with `identity_mode = 'sha256'`. Provenance is a separate typed row, so one
// physical object has ONE artifact however many sources point at it.
//
// Memory: the object is hashed as a stream (O(1) state); duration and
// dimensions come from ranged reads of the MP4 `moov` box, not from a
// download. Facts already recorded by a trusted writer are reused, and a fact
// nobody can prove stays null.
//
// Registration is lazy and idempotent. Nothing in the provider-completion or
// render-completion paths calls it, so Review infrastructure can never make a
// generation or a render fail.

import type { SupabaseClient } from '@supabase/supabase-js'
import { openS3ObjectStream } from '@/lib/storage/s3'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import { ownedProductionIdOrNull } from '@/lib/library/production-scope'
import { validateVideoRenderLibrarySource, type VideoRenderLibrarySource } from '@/lib/render-execution/video-render-library'
import type { MediaArtifactRow } from './contracts'
import { MediaArtifactError } from './errors'
import { artifactIdentityFingerprint } from './image'
import { probeMp4, type Mp4Facts } from './mp4-metadata'
import {
  attachArtifactProvenance,
  provenanceSourceColumn,
  type ProvenanceRef,
  type ProvenanceScope,
} from './provenance'
import { sha256OfStream, type ObjectStreamOpener } from './streaming'

const ARTIFACT_COLUMNS = [
  'id', 'user_id', 'project_id', 'production_id', 'media_type', 'identity_mode',
  'storage_provider', 'storage_path', 'content_hash', 'identity_fingerprint', 'version', 'mime_type',
  'byte_size', 'width', 'height', 'duration_ms', 'created_at', 'updated_at',
].join(',')

export type VideoArtifactSource =
  | { kind: 'video_generation'; videoGenerationId: string }
  | { kind: 'render_execution'; renderExecutionId: string }
  | { kind: 'library'; libraryFileId: string }

export type KnownVideoFacts = {
  byteSize: number | null
  durationMs: number | null
  width: number | null
  height: number | null
}

/** A source after owner scoping and storage-path trust checks; the only input to registration. */
export type ResolvedVideoSource = {
  scope: ProvenanceScope
  ref: ProvenanceRef
  storageProvider: 's3'
  storagePath: string
  mimeType: string
  known: KnownVideoFacts
}

export type VideoArtifactDeps = {
  /** Streaming reader for a trusted key. Default: the server S3 client. */
  openObject?: ObjectStreamOpener
}

const openDefault: ObjectStreamOpener = (path, options) => openS3ObjectStream(path, options)

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function isVideoMime(value: unknown): value is string {
  return typeof value === 'string' && /^video\/[A-Za-z0-9.+-]+$/.test(value)
}

function storeFailure(error: unknown): never {
  if (error instanceof MediaArtifactError) throw error
  throw new MediaArtifactError('STORE_FAILED', 'Media artifact storage operation failed.')
}

// ── Source resolution (owner-scoped, trusted paths only) ────────────────────

export async function resolveVideoArtifactSource(
  db: SupabaseClient,
  params: { userId: string; source: VideoArtifactSource },
): Promise<ResolvedVideoSource> {
  const { userId, source } = params
  if (source.kind === 'video_generation') return resolveVideoGeneration(db, userId, source.videoGenerationId)
  if (source.kind === 'render_execution') return resolveRenderExecution(db, userId, source.renderExecutionId)
  return resolveLibraryVideo(db, userId, source.libraryFileId)
}

async function resolveVideoGeneration(db: SupabaseClient, userId: string, id: string): Promise<ResolvedVideoSource> {
  const { data, error } = await db.from('video_generations')
    .select('id,user_id,project_id,production_id,status,storage_path,result_metadata')
    .eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) storeFailure(error)
  if (!data) throw new MediaArtifactError('SOURCE_NOT_FOUND')
  if (data.status !== 'succeeded' || !data.storage_path) throw new MediaArtifactError('SOURCE_NOT_READY')
  if (!isTenantVideoStoragePath(data.storage_path, { user_id: data.user_id, project_id: data.project_id })) {
    throw new MediaArtifactError('UNTRUSTED_STORAGE_PATH')
  }
  const meta = (data.result_metadata ?? {}) as Record<string, unknown>
  return {
    scope: { userId, projectId: data.project_id, productionId: data.production_id ?? null },
    ref: { kind: 'video_generation', videoGenerationId: data.id },
    storageProvider: 's3',
    storagePath: data.storage_path,
    // The key is validated as a single `.mp4` object, so the fallback is a fact of the path rule, not a guess.
    mimeType: isVideoMime(meta.mime) ? meta.mime : 'video/mp4',
    known: { byteSize: positiveInt(meta.size), durationMs: null, width: null, height: null },
  }
}

async function resolveRenderExecution(db: SupabaseClient, userId: string, id: string): Promise<ResolvedVideoSource> {
  const { data, error } = await db.from('render_executions')
    .select('id,user_id,project_id,video_draft_id,kind,status,output_bucket,output_storage_path,output_mime_type,output_size_bytes,output_duration_ms,output_width,output_height')
    .eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) storeFailure(error)
  if (!data) throw new MediaArtifactError('SOURCE_NOT_FOUND')
  const eligibility = validateVideoRenderLibrarySource(data as unknown as VideoRenderLibrarySource)
  if (!eligibility.ok) {
    throw new MediaArtifactError(eligibility.code === 'INVALID_OUTPUT_TARGET' ? 'UNTRUSTED_STORAGE_PATH' : 'SOURCE_NOT_READY')
  }
  // Production comes from the server chain render -> VideoDraft -> Production, exactly like Library promotion.
  let productionId: string | null = null
  if (data.video_draft_id) {
    const draft = await db.from('video_drafts').select('production_id').eq('id', data.video_draft_id).eq('user_id', userId).maybeSingle()
    if (draft.error) storeFailure(draft.error)
    productionId = await ownedProductionIdOrNull(db, { userId, projectId: data.project_id, productionId: draft.data?.production_id ?? null })
  }
  return {
    scope: { userId, projectId: data.project_id, productionId },
    ref: { kind: 'render_execution', renderExecutionId: data.id },
    storageProvider: 's3',
    storagePath: eligibility.storagePath,
    mimeType: eligibility.mimeType,
    known: {
      byteSize: eligibility.sizeBytes,
      durationMs: positiveInt(data.output_duration_ms),
      width: positiveInt(data.output_width),
      height: positiveInt(data.output_height),
    },
  }
}

async function resolveLibraryVideo(db: SupabaseClient, userId: string, id: string): Promise<ResolvedVideoSource> {
  const { data, error } = await db.from('library_files')
    .select('id,user_id,project_id,production_id,kind,mime_type,file_size,storage_provider,storage_path,origin,deleted_at')
    .eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) storeFailure(error)
  if (!data) throw new MediaArtifactError('SOURCE_NOT_FOUND')
  if (data.kind !== 'video' || data.deleted_at || !isVideoMime(data.mime_type)) throw new MediaArtifactError('SOURCE_NOT_READY')
  // `storage_path` of a LibraryFile is a user-writable claim: prove it is inside the owner's Library namespace.
  if (data.storage_provider !== 's3' || !isTrustedLibraryStoragePath(userId, data.storage_path)) {
    throw new MediaArtifactError('UNTRUSTED_STORAGE_PATH')
  }
  return {
    scope: { userId, projectId: data.project_id ?? null, productionId: data.production_id ?? null },
    ref: { kind: data.origin === 'upload' ? 'upload' : 'library', libraryFileId: data.id },
    storageProvider: 's3',
    storagePath: data.storage_path,
    mimeType: data.mime_type,
    known: { byteSize: positiveInt(data.file_size), durationMs: null, width: null, height: null },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

async function findArtifactsByPath(db: SupabaseClient, source: ResolvedVideoSource): Promise<MediaArtifactRow[]> {
  const { data, error } = await db.from('media_artifacts')
    .select(ARTIFACT_COLUMNS)
    .eq('user_id', source.scope.userId)
    .eq('media_type', 'video')
    .eq('storage_provider', source.storageProvider)
    .eq('storage_path', source.storagePath)
  if (error) storeFailure(error)
  return (data ?? []) as unknown as MediaArtifactRow[]
}

/** Existing provenance for this exact source whose artifact still describes the source's CURRENT object. */
async function findArtifactByProvenance(db: SupabaseClient, source: ResolvedVideoSource): Promise<MediaArtifactRow | null> {
  const { column, value } = provenanceSourceColumn(source.ref)
  const provenance = await db.from('media_artifact_provenance')
    .select('artifact_id')
    .eq('user_id', source.scope.userId)
    .eq(column, value)
  if (provenance.error) storeFailure(provenance.error)
  const ids = ((provenance.data ?? []) as Array<{ artifact_id: string }>).map((row) => row.artifact_id)
  if (!ids.length) return null
  const artifacts = await db.from('media_artifacts')
    .select(ARTIFACT_COLUMNS)
    .eq('user_id', source.scope.userId)
    .in('id', ids)
  if (artifacts.error) storeFailure(artifacts.error)
  // A Library move rewrites the path: provenance alone must not resurrect an artifact for a key that no longer exists.
  return ((artifacts.data ?? []) as unknown as MediaArtifactRow[]).find((artifact) =>
    artifact.media_type === 'video'
    && artifact.identity_mode === 'sha256'
    && artifact.storage_provider === source.storageProvider
    && artifact.storage_path === source.storagePath) ?? null
}

async function collect(stream: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.byteLength
    if (total > limit) throw new MediaArtifactError('STORAGE_UNAVAILABLE', 'Unexpected ranged read size.')
    parts.push(chunk)
  }
  return Buffer.concat(parts)
}

async function probeFacts(open: ObjectStreamOpener, source: ResolvedVideoSource, size: number): Promise<Mp4Facts> {
  try {
    return await probeMp4(async (start, end) => {
      const opened = await open(source.storagePath, { range: { start, end } })
      if (!opened) throw new MediaArtifactError('STORAGE_UNAVAILABLE')
      return collect(opened.stream, Math.max(end - start + 1, 1))
    }, size)
  } catch {
    // Facts are optional. A probe failure must not block registration, and must not invent values.
    return { durationMs: null, width: null, height: null }
  }
}

async function insertArtifact(
  db: SupabaseClient,
  source: ResolvedVideoSource,
  facts: { hash: string; byteSize: number; durationMs: number | null; width: number | null; height: number | null },
  version: number,
) {
  return db.from('media_artifacts').insert({
    user_id: source.scope.userId,
    project_id: source.scope.projectId,
    production_id: source.scope.productionId,
    media_type: 'video',
    identity_mode: 'sha256',
    storage_provider: source.storageProvider,
    storage_path: source.storagePath,
    content_hash: facts.hash,
    version,
    mime_type: source.mimeType,
    byte_size: facts.byteSize,
    width: facts.width,
    height: facts.height,
    duration_ms: facts.durationMs,
    identity_fingerprint: artifactIdentityFingerprint({
      userId: source.scope.userId,
      storageProvider: source.storageProvider,
      storagePath: source.storagePath,
      contentHash: facts.hash,
      mimeType: source.mimeType,
      fileSize: facts.byteSize,
      width: facts.width,
      height: facts.height,
      durationMs: facts.durationMs,
      version,
    }),
  }).select(ARTIFACT_COLUMNS).single()
}

/**
 * Creates or reuses the canonical artifact for one already-authorized video
 * source and records its provenance. Safe to call repeatedly and concurrently.
 */
export async function registerVideoArtifact(
  db: SupabaseClient,
  source: ResolvedVideoSource,
  deps: VideoArtifactDeps = {},
): Promise<MediaArtifactRow> {
  const open = deps.openObject ?? openDefault
  const attach = (artifactId: string) => attachArtifactProvenance(db, { artifactId, scope: source.scope, ref: source.ref })
    .catch((error) => { throw error instanceof MediaArtifactError ? error : new MediaArtifactError('STORE_FAILED', 'Media artifact provenance could not be recorded.') })

  // 1. Fast path: no storage access when this source is already registered.
  const registered = await findArtifactByProvenance(db, source)
  if (registered) return registered

  // 2. Stream-hash the object (bounded memory) and cross-check its length.
  let opened
  try {
    opened = await open(source.storagePath)
  } catch {
    throw new MediaArtifactError('STORAGE_UNAVAILABLE')
  }
  if (!opened) throw new MediaArtifactError('STORAGE_UNAVAILABLE')
  const expected = source.known.byteSize
  if (opened.contentLength !== null && expected !== null && opened.contentLength !== expected) {
    opened.stream.destroy?.()
    throw new MediaArtifactError('SIZE_MISMATCH')
  }
  let digest: { hash: string; byteLength: number }
  try {
    digest = await sha256OfStream(opened.stream)
  } catch {
    throw new MediaArtifactError('STORAGE_UNAVAILABLE')
  }
  if ((expected !== null && digest.byteLength !== expected) || (opened.contentLength !== null && digest.byteLength !== opened.contentLength)) {
    throw new MediaArtifactError('SIZE_MISMATCH')
  }
  if (digest.byteLength <= 0) throw new MediaArtifactError('SOURCE_NOT_READY')

  // 3. Container facts: trust a recorded fact, otherwise read it from the file header/moov, otherwise leave null.
  const needsProbe = source.known.durationMs === null || source.known.width === null || source.known.height === null
  const probed = needsProbe ? await probeFacts(open, source, digest.byteLength) : { durationMs: null, width: null, height: null }
  const facts = {
    hash: digest.hash,
    byteSize: digest.byteLength,
    durationMs: source.known.durationMs ?? probed.durationMs,
    width: source.known.width ?? probed.width,
    height: source.known.height ?? probed.height,
  }

  // 4. Reuse the artifact for these exact bytes at this exact key, else create the next version of the key.
  const resolveExisting = async () => {
    const rows = await findArtifactsByPath(db, source)
    return { same: rows.find((row) => row.content_hash === facts.hash) ?? null, nextVersion: rows.reduce((max, row) => Math.max(max, row.version), 0) + 1 }
  }
  let { same, nextVersion } = await resolveExisting()
  if (same) {
    await attach(same.id)
    return same
  }
  let inserted = await insertArtifact(db, source, facts, nextVersion)
  if (inserted.error || !inserted.data) {
    if ((inserted.error as { code?: string } | null)?.code === '23505') {
      // Lost an insert race: converge on the canonical row instead of failing or duplicating.
      ;({ same, nextVersion } = await resolveExisting())
      if (same) {
        await attach(same.id)
        return same
      }
      inserted = await insertArtifact(db, source, facts, nextVersion)
    }
    if (inserted.error || !inserted.data) throw new MediaArtifactError('STORE_FAILED', 'Media artifact could not be created.')
  }
  const artifact = inserted.data as unknown as MediaArtifactRow
  await attach(artifact.id)
  return artifact
}

/** Server entry point: typed source id in, canonical artifact out. Owner-authorized, no URLs. */
export async function ensureVideoArtifact(
  db: SupabaseClient,
  params: { userId: string; source: VideoArtifactSource },
  deps: VideoArtifactDeps = {},
): Promise<MediaArtifactRow> {
  const resolved = await resolveVideoArtifactSource(db, params)
  return registerVideoArtifact(db, resolved, deps)
}
