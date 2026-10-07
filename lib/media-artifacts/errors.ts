// VIDEO_MEDIA_ARTIFACT_AND_STREAMING_FOUNDATION_V1

export type MediaArtifactErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_READY'
  | 'UNTRUSTED_STORAGE_PATH'
  | 'STORAGE_UNAVAILABLE'
  | 'SIZE_MISMATCH'
  | 'STORE_FAILED'

/**
 * Normalised registration failure. Messages are safe to log: they never carry
 * storage keys, bucket names, credentials or provider bodies.
 */
export class MediaArtifactError extends Error {
  readonly code: MediaArtifactErrorCode
  constructor(code: MediaArtifactErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'MediaArtifactError'
    this.code = code
  }
}
