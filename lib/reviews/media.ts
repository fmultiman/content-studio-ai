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
import { readS3Object } from '@/lib/storage/s3'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import type { MediaArtifactRow } from '@/lib/media-artifacts/contracts'
import { ReviewServiceError } from './errors'
import { ReviewProviderError, type AuthorizedReviewMedia, type ReviewMediaKind } from './execution-provider'
import { REVIEW_IMAGE_MAX_BYTES, REVIEW_VIDEO_MAX_BYTES, assertReviewMediaWithinLimits } from './media-limits'

const ARTIFACT_COLUMNS = 'id,user_id,project_id,production_id,media_type,identity_mode,storage_provider,storage_path,content_hash,version,mime_type,byte_size,width,height,duration_ms'

function isTrustedArtifactPath(artifact: MediaArtifactRow) {
  if (artifact.storage_provider !== 's3') return false
  if (isTrustedLibraryStoragePath(artifact.user_id, artifact.storage_path)) return true
  if (artifact.media_type === 'image') return isTrustedImageStoragePath(artifact.user_id, artifact.storage_path, 'original')
  return isTenantVideoStoragePath(artifact.storage_path, { user_id: artifact.user_id, project_id: artifact.project_id })
}

export type ReviewObjectReader = (path: string, options: { maxBytes: number }) => Promise<{ bytes: Uint8Array; contentType: string } | null>

export async function resolveAuthorizedReviewMedia(
  db: SupabaseClient,
  params: { userId: string; artifactId: string; expectedKind?: ReviewMediaKind; url?: string; readObject?: ReviewObjectReader },
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
  return {
    kind: artifact.media_type,
    artifactId: artifact.id,
    mimeType: artifact.mime_type,
    byteSize: artifact.byte_size,
    durationMs: artifact.duration_ms,
    url: params.url,
    async load() {
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
