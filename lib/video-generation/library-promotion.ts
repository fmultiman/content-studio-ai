// VIDEO_GENERATION_LIBRARY_PROMOTION_V1
//
// Pure policy for the explicit VideoGeneration -> LibraryFile boundary.
//
// A generated video is SOURCE MEDIA. It becomes a LibraryFile only when the user
// asks for it ("Salvar em Arquivos"), and only from Content Studio's own storage:
// the provider is never contacted. The browser names a generation; everything
// else (owner, project, object key, size) is resolved server-side from the row.

import { isTenantVideoStoragePath } from './storage-path'

/** library_files.file_size is a 32-bit INTEGER. */
export const MAX_LIBRARY_FILE_SIZE_BYTES = 2_147_483_647

export type PromotableGeneration = {
  id: string
  user_id: string
  project_id: string | null
  status: string
  storage_path: string | null
  library_file_id?: string | null
  result_metadata?: { size?: unknown; mime?: unknown } | null
}

export type GenerationLibraryEligibility =
  | { ok: true; storagePath: string; mimeType: 'video/mp4'; expectedSizeBytes: number | null }
  | { ok: false; code: 'GENERATION_NOT_COMPLETED' | 'MISSING_PROJECT' | 'MISSING_STORAGE_PATH' | 'INVALID_STORAGE_PATH' | 'OUTPUT_TOO_LARGE' }

/**
 * Only a SUCCEEDED generation whose stored object lies inside its owner's own
 * project namespace may be promoted. `storage_path` is a database string, not an
 * authority: it is re-validated here, exactly as before presigning.
 */
export function validateGenerationForLibrary(generation: PromotableGeneration): GenerationLibraryEligibility {
  if (generation.status !== 'succeeded') return { ok: false, code: 'GENERATION_NOT_COMPLETED' }
  if (!generation.project_id) return { ok: false, code: 'MISSING_PROJECT' }
  if (!generation.storage_path) return { ok: false, code: 'MISSING_STORAGE_PATH' }
  if (!isTenantVideoStoragePath(generation.storage_path, generation)) return { ok: false, code: 'INVALID_STORAGE_PATH' }

  // A recorded size is only a cross-check for the copied object; historical rows may not carry one.
  const recorded = generation.result_metadata?.size
  const expectedSizeBytes = typeof recorded === 'number' && Number.isFinite(recorded) && recorded > 0 ? recorded : null
  if (expectedSizeBytes !== null && expectedSizeBytes > MAX_LIBRARY_FILE_SIZE_BYTES) return { ok: false, code: 'OUTPUT_TOO_LARGE' }

  return { ok: true, storagePath: generation.storage_path, mimeType: 'video/mp4', expectedSizeBytes }
}

/** Default display name: readable, never a provider task id. The user can rename it in Arquivos as usual. */
export function videoGenerationLibraryFilename(generationId: string): string {
  return `video-ia-${generationId.slice(0, 8)}.mp4`
}
