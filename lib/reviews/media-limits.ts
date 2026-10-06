// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Inexpensive local Review media guardrails, reusable by the later Video Review
// adapter. They are product caps below provider hard limits, not provider claims.

import { ReviewProviderError, type ReviewMediaKind } from './execution-provider'

/** Initial Video Review product caps (preflight). */
export const REVIEW_VIDEO_MAX_BYTES = 500 * 1024 * 1024
export const REVIEW_VIDEO_MAX_DURATION_MS = 10 * 60 * 1000
/** Image bytes are sent inline to Gemini (20 MB request ceiling incl. base64 overhead). */
export const REVIEW_IMAGE_MAX_BYTES = 15 * 1024 * 1024

/**
 * Fails closed: a video with unknown size or duration cannot be cost-bounded,
 * so it is rejected before any upload or model call.
 */
export function assertReviewMediaWithinLimits(input: { kind: ReviewMediaKind; byteSize: number | null; durationMs: number | null }) {
  if (input.kind === 'image') {
    if (input.byteSize !== null && input.byteSize > REVIEW_IMAGE_MAX_BYTES) {
      throw new ReviewProviderError('media_limit_exceeded', 'Image exceeds the Review size limit.')
    }
    return
  }
  if (input.byteSize === null || input.durationMs === null) {
    throw new ReviewProviderError('media_limit_exceeded', 'Video size and duration must be known before Review.')
  }
  if (input.byteSize > REVIEW_VIDEO_MAX_BYTES) throw new ReviewProviderError('media_limit_exceeded', 'Video exceeds the Review size limit (500 MB).')
  if (input.durationMs > REVIEW_VIDEO_MAX_DURATION_MS) throw new ReviewProviderError('media_limit_exceeded', 'Video exceeds the Review duration limit (10 minutes).')
}
