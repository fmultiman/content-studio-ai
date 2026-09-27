import { isExpectedScratchOutputTarget } from './scratch-output-target'

export const MAX_LIBRARY_FILE_SIZE_BYTES = 2_147_483_647

export type VideoRenderLibrarySource = {
  id: string
  user_id: string
  project_id: string | null
  video_draft_id: string | null
  kind: string | null
  status: string
  output_bucket: string | null
  output_storage_path: string | null
  output_mime_type: string | null
  output_size_bytes: number | null
}

export type VideoRenderLibraryEligibility =
  | { ok: true; bucket: string; storagePath: string; mimeType: 'video/mp4'; sizeBytes: number }
  | { ok: false; code: 'NOT_VIDEO_RENDER' | 'EXECUTION_NOT_COMPLETED' | 'MISSING_PROJECT' | 'MISSING_VIDEO_DRAFT' | 'OUTPUT_UNAVAILABLE' | 'INVALID_OUTPUT_TARGET' | 'INVALID_OUTPUT_MIME' | 'OUTPUT_TOO_LARGE' }

/** Pure policy for the render-output -> durable-Library boundary. */
export function validateVideoRenderLibrarySource(
  execution: VideoRenderLibrarySource,
  env?: Record<string, string | undefined>,
): VideoRenderLibraryEligibility {
  if (execution.kind !== 'video') return { ok: false, code: 'NOT_VIDEO_RENDER' }
  if (execution.status !== 'completed') return { ok: false, code: 'EXECUTION_NOT_COMPLETED' }
  if (!execution.project_id) return { ok: false, code: 'MISSING_PROJECT' }
  if (!execution.video_draft_id) return { ok: false, code: 'MISSING_VIDEO_DRAFT' }
  if (!execution.output_bucket || !execution.output_storage_path || !execution.output_size_bytes || execution.output_size_bytes <= 0) {
    return { ok: false, code: 'OUTPUT_UNAVAILABLE' }
  }
  if (execution.output_size_bytes > MAX_LIBRARY_FILE_SIZE_BYTES) return { ok: false, code: 'OUTPUT_TOO_LARGE' }
  if (execution.output_mime_type !== 'video/mp4') return { ok: false, code: 'INVALID_OUTPUT_MIME' }
  if (!isExpectedScratchOutputTarget({
    userId: execution.user_id,
    executionId: execution.id,
    bucket: execution.output_bucket,
    key: execution.output_storage_path,
    kind: 'video',
  }, env)) {
    return { ok: false, code: 'INVALID_OUTPUT_TARGET' }
  }
  return {
    ok: true,
    bucket: execution.output_bucket,
    storagePath: execution.output_storage_path,
    mimeType: 'video/mp4',
    sizeBytes: execution.output_size_bytes,
  }
}

export function videoRenderLibraryFilename(executionId: string): string {
  return `render-${executionId}.mp4`
}
