// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Server-side authorization of Review media. The Review request carries only
// an artifact identity; this module turns it into `AuthorizedReviewMedia` after
//
//   1. proving the `media_artifacts` row belongs to the authenticated owner,
//   2. proving its storage path is inside that owner's trusted namespace,
//   3. applying the inexpensive local size/duration guardrails, and
//   4. (on load) re-verifying the SHA-256 of sha256-identified artifacts.
//
// Execution providers never receive a client URL and never choose a path.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { openS3ObjectStream, readS3Object } from '@/lib/storage/s3'
import { buildScratchOutputKey } from '@/lib/render-execution/scratch-output-target'
import { verifyingChunks, type ObjectStreamOpener } from '@/lib/media-artifacts/streaming'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import type { MediaArtifactRow } from '@/lib/media-artifacts/contracts'
import { ReviewServiceError } from './errors'
import { ReviewProviderError, type AuthorizedReviewMedia, type ReviewMediaKind } from './execution-provider'
import { REVIEW_IMAGE_MAX_BYTES, REVIEW_VIDEO_MAX_BYTES, assertReviewMediaWithinLimits } from './media-limits'

const ARTIFACT_COLUMNS = 'id,user_id,project_id,production_id,media_type,identity_mode,storage_provider,storage_path,content_hash,version,mime_type,byte_size,width,height,duration_ms'

const RENDER_SCRATCH_SEGMENTS = /^users\/([^/]+)\/renders\/scratch\/([0-9a-f-]{36})\/output\.mp4$/i

/** `users/{owner}/renders/scratch/{executionId}/output.mp4`: the one deterministic key a completed video render may have. */
function isTrustedRenderScratchVideoPath(userId: string, storagePath: string) {
  const match = RENDER_SCRATCH_SEGMENTS.exec(storagePath)
  if (!match || match[1] !== userId) return false
  try {
    return buildScratchOutputKey({ userId, executionId: match[2], kind: 'video' }) === storagePath
  } catch {
    return false
  }
}

function isTrustedArtifactPath(artifact: MediaArtifactRow) {
  if (artifact.storage_provider !== 's3') return false
  if (isTrustedLibraryStoragePath(artifact.user_id, artifact.storage_path)) return true
  if (artifact.media_type === 'image') return isTrustedImageStoragePath(artifact.user_id, artifact.storage_path, 'original')
  return isTenantVideoStoragePath(artifact.storage_path, { user_id: artifact.user_id, project_id: artifact.project_id })
    || isTrustedRenderScratchVideoPath(artifact.user_id, artifact.storage_path)
}

const OUTPUT_UNAVAILABLE = () => new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media could not be read from storage.')

/** Storage and integrity failures while streaming surface as one normalized, key-free error. */
async function* normalizeStreamErrors(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of chunks) yield chunk
  } catch (error) {
    if (error instanceof ReviewServiceError || error instanceof ReviewProviderError) throw error
    const mismatch = (error as { name?: string } | null)?.name === 'MediaIntegrityError'
    throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', mismatch ? 'Review media no longer matches its immutable artifact.' : 'Review media could not be read from storage.')
  }
}

export type ReviewObjectReader = (path: string, options: { maxBytes: number }) => Promise<{ bytes: Uint8Array; contentType: string } | null>

export async function resolveAuthorizedReviewMedia(
  db: SupabaseClient,
  params: { userId: string; artifactId: string; expectedKind?: ReviewMediaKind; url?: string; readObject?: ReviewObjectReader; openObject?: ObjectStreamOpener },
): Promise<AuthorizedReviewMedia> {
  const found = await db.from('media_artifacts').select(ARTIFACT_COLUMNS).eq('id', params.artifactId).eq('user_id', params.userId).maybeSingle()
  if (found.error) throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
  const artifact = found.data as unknown as MediaArtifactRow | null
  // Cross-user and unknown ids are indistinguishable by design.
  if (!artifact) throw new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review media artifact was not found.')
  if (params.expectedKind && artifact.media_type !== params.expectedKind) {
    throw new ReviewProviderError('unsupported_capability', `Artifact is ${artifact.media_type}, expected ${params.expectedKind}.`)
  }
  if (!isTrustedArtifactPath(artifact)) throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media storage path is not trusted.')

  assertReviewMediaWithinLimits({ kind: artifact.media_type, byteSize: artifact.byte_size, durationMs: artifact.duration_ms })

  const maxBytes = artifact.media_type === 'video' ? REVIEW_VIDEO_MAX_BYTES : REVIEW_IMAGE_MAX_BYTES
  const read = params.readObject ?? readS3Object
  const open: ObjectStreamOpener = params.openObject ?? ((path, options) => openS3ObjectStream(path, options))
  return {
    kind: artifact.media_type,
    artifactId: artifact.id,
    mimeType: artifact.mime_type,
    byteSize: artifact.byte_size,
    durationMs: artifact.duration_ms,
    url: params.url,
    async openStream() {
      if (artifact.media_type !== 'video' || artifact.byte_size === null) throw OUTPUT_UNAVAILABLE()
      let opened: Awaited<ReturnType<ObjectStreamOpener>>
      try {
        opened = await open(artifact.storage_path)
      } catch {
        throw OUTPUT_UNAVAILABLE()
      }
      if (!opened) throw OUTPUT_UNAVAILABLE()
      // The stored object must be the artifact's object: a different length is a different file.
      if (opened.contentLength !== null && opened.contentLength !== artifact.byte_size) {
        opened.stream.destroy?.()
        throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media no longer matches its immutable artifact.')
      }
      return {
        byteLength: artifact.byte_size,
        abort: () => { opened.stream.destroy?.() },
        chunks: normalizeStreamErrors(verifyingChunks(opened.stream, {
          byteLength: artifact.byte_size,
          sha256: artifact.identity_mode === 'sha256' ? artifact.content_hash : null,
        })),
      }
    },
    async load() {
      // Whole-object buffering is for small images only; a video must be streamed with openStream().
      if (artifact.media_type === 'video') throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Video media must be streamed, not loaded whole.')
      let stored: Awaited<ReturnType<ReviewObjectReader>>
      try {
        stored = await read(artifact.storage_path, { maxBytes })
      } catch {
        throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media could not be read from storage.')
      }
      if (!stored) throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media could not be read from storage.')
      if (artifact.identity_mode === 'sha256' && artifact.content_hash) {
        const digest = createHash('sha256').update(stored.bytes).digest('hex')
        if (digest !== artifact.content_hash) {
          throw new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media no longer matches its immutable artifact hash.')
        }
      }
      return stored.bytes
    },
  }
}
