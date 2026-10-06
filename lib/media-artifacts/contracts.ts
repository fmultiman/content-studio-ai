import { z } from 'zod'

export const MEDIA_ARTIFACT_MEDIA_TYPES = ['image', 'video'] as const
export const MEDIA_ARTIFACT_IDENTITY_MODES = ['sha256', 'legacy_storage_snapshot'] as const
export const MEDIA_ARTIFACT_PROVENANCE_KINDS = [
  'image_generation',
  'video_generation',
  'render_execution',
  'library',
  'upload',
] as const

export const MediaArtifactFactsSchema = z.object({
  mimeType: z.string().min(1).max(160),
  byteSize: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
}).strict()

export type MediaArtifactMediaType = typeof MEDIA_ARTIFACT_MEDIA_TYPES[number]
export type MediaArtifactIdentityMode = typeof MEDIA_ARTIFACT_IDENTITY_MODES[number]
export type MediaArtifactProvenanceKind = typeof MEDIA_ARTIFACT_PROVENANCE_KINDS[number]

export type MediaArtifactRow = {
  id: string
  user_id: string
  project_id: string | null
  production_id: string | null
  media_type: MediaArtifactMediaType
  identity_mode: MediaArtifactIdentityMode
  storage_provider: string
  storage_path: string
  content_hash: string | null
  identity_fingerprint: string
  version: number
  mime_type: string
  byte_size: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  created_at: string
  updated_at: string
}
