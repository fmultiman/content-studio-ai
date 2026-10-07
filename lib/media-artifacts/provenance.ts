// VIDEO_MEDIA_ARTIFACT_AND_STREAMING_FOUNDATION_V1
//
// The ONE writer of `media_artifact_provenance` rows. The table identifies a
// provenance relationship by `(artifact_id, provenance_key)` (migration 057:
// `provenance_key` is NOT NULL and is the only unique key besides the primary
// key), so every writer must derive the key from the typed source ids here.
// Keys for image generation intentionally equal the ones migration 058 wrote
// when it bridged existing Image Reviews, so re-registration stays a no-op.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MediaArtifactProvenanceKind } from './contracts'

export type ProvenanceRef =
  | { kind: 'image_generation'; attemptId: string; outputId: string }
  | { kind: 'video_generation'; videoGenerationId: string }
  | { kind: 'render_execution'; renderExecutionId: string }
  | { kind: 'library' | 'upload'; libraryFileId: string }

export type ProvenanceScope = {
  userId: string
  projectId: string | null
  productionId: string | null
}

export function provenanceKey(ref: ProvenanceRef): string {
  switch (ref.kind) {
    case 'image_generation': return `image_generation:${ref.attemptId}:${ref.outputId}`
    case 'video_generation': return `video_generation:${ref.videoGenerationId}`
    case 'render_execution': return `render_execution:${ref.renderExecutionId}`
    // `library` and `upload` describe the SAME LibraryFile; one key keeps the row unique per file.
    case 'library':
    case 'upload': return `library:${ref.libraryFileId}`
  }
}

/** The typed foreign-key column that identifies the source entity, and its value. */
export function provenanceSourceColumn(ref: ProvenanceRef): { column: string; value: string } {
  switch (ref.kind) {
    case 'image_generation': return { column: 'image_output_id', value: ref.outputId }
    case 'video_generation': return { column: 'video_generation_id', value: ref.videoGenerationId }
    case 'render_execution': return { column: 'render_execution_id', value: ref.renderExecutionId }
    case 'library':
    case 'upload': return { column: 'library_file_id', value: ref.libraryFileId }
  }
}

function provenanceColumns(ref: ProvenanceRef): Record<string, string> {
  switch (ref.kind) {
    case 'image_generation': return { image_generation_attempt_id: ref.attemptId, image_output_id: ref.outputId }
    case 'video_generation': return { video_generation_id: ref.videoGenerationId }
    case 'render_execution': return { render_execution_id: ref.renderExecutionId }
    case 'library':
    case 'upload': return { library_file_id: ref.libraryFileId }
  }
}

/** Idempotent: an existing `(artifact, key)` row is left exactly as it is. */
export async function attachArtifactProvenance(
  db: SupabaseClient,
  params: { artifactId: string; scope: ProvenanceScope; ref: ProvenanceRef },
) {
  const kind: MediaArtifactProvenanceKind = params.ref.kind
  const result = await db.from('media_artifact_provenance').upsert({
    artifact_id: params.artifactId,
    user_id: params.scope.userId,
    project_id: params.scope.projectId,
    production_id: params.scope.productionId,
    provenance_kind: kind,
    provenance_key: provenanceKey(params.ref),
    ...provenanceColumns(params.ref),
  }, { onConflict: 'artifact_id,provenance_key', ignoreDuplicates: true })
  if (result.error) throw result.error
}
