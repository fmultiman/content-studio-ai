// VIDEO_REVIEW_UI_AND_HISTORY_V1
//
// READ-ONLY Video Review history for one typed source.
//
//   typed source -> owner-scoped existence check -> provenance rows for THIS source -> the artifacts they
//   point at -> owner-scoped Video Reviews of those artifacts, newest first.
//
// Invariants (each one is asserted by a test):
//   * only SELECTs are issued; there is no insert, update, upsert or delete anywhere in this module;
//   * it never registers an artifact, never writes provenance, never creates a Review;
//   * it never opens, reads, hashes or probes media, and never contacts a provider;
//   * a source that has no artifact yet returns an empty history, truthfully;
//   * another user's source is indistinguishable from a missing one (404).
//
// It is meant to run with the USER's session client: row-level security (owner SELECT on every table read
// here) is then a second, structural guard on top of the explicit user_id filters.

import type { SupabaseClient } from '@supabase/supabase-js'
import { provenanceSourceColumn, type ProvenanceRef } from '@/lib/media-artifacts/provenance'
import type { VideoReviewSource } from './contracts'
import { ReviewServiceError } from './errors'
import { MEDIA_REVIEW_COLUMNS, type MediaReviewRow } from './repository'
import { toVideoReviewHistoryItem, type VideoReviewHistoryItem } from './video-review-dto'

const HISTORY_LIMIT = 50

const SOURCE_TABLE: Record<VideoReviewSource['kind'], string> = {
  video_generation: 'video_generations',
  render_execution: 'render_executions',
  library_file: 'library_files',
}

function provenanceRef(source: VideoReviewSource): ProvenanceRef {
  if (source.kind === 'video_generation') return { kind: 'video_generation', videoGenerationId: source.id }
  if (source.kind === 'render_execution') return { kind: 'render_execution', renderExecutionId: source.id }
  return { kind: 'library', libraryFileId: source.id }
}

function storeError() {
  return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
}

export async function getVideoReviewHistory(params: {
  db: SupabaseClient
  userId: string
  source: VideoReviewSource
}): Promise<{ items: VideoReviewHistoryItem[] }> {
  const { db, userId, source } = params

  // 1. The source must exist AND belong to the caller. Cross-user and unknown ids are indistinguishable.
  const owned = await db.from(SOURCE_TABLE[source.kind]).select('id').eq('id', source.id).eq('user_id', userId).maybeSingle()
  if (owned.error) throw storeError()
  if (!owned.data) throw new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.')

  // 2. Artifacts this exact source is registered against (provenance). None yet = empty history.
  const { column, value } = provenanceSourceColumn(provenanceRef(source))
  const provenance = await db.from('media_artifact_provenance').select('artifact_id').eq('user_id', userId).eq(column, value)
  if (provenance.error) throw storeError()
  const artifactIds = [...new Set(((provenance.data ?? []) as Array<{ artifact_id: string }>).map((row) => row.artifact_id))]
  if (!artifactIds.length) return { items: [] }

  // 3. Video Reviews of those artifacts, owner-scoped, newest first.
  const reviews = await db.from('media_reviews')
    .select(MEDIA_REVIEW_COLUMNS)
    .eq('user_id', userId)
    .eq('subject_media_type', 'video')
    .in('media_artifact_id', artifactIds)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (reviews.error) throw storeError()
  return { items: ((reviews.data ?? []) as unknown as MediaReviewRow[]).map(toVideoReviewHistoryItem) }
}
