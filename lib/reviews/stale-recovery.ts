// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046)
//
// Request-time recovery of an abandoned in-flight Review, shared by Image and Video. It runs ONLY inside an
// explicit execution request (POST), after clientRequestId idempotency and before any new insert or provider
// call. History GET never reaches it.
//
//   active Review blocks a new request
//     -> not stale                      : 'in_flight'  (caller answers 409 REVIEW_IN_PROGRESS)
//     -> stale: guarded UPDATE -> failed: 'recovered'  (caller proceeds to the normal insert)
//     -> guarded UPDATE matched nothing : re-read; terminal => 'settled' (proceed), else 'in_flight'
//
// The database stays the authority: the guarded UPDATE re-evaluates status + updated_at under the row lock,
// and the partial unique in-flight indexes still decide who may insert next.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ReviewServiceError } from './errors'
import { findReviewById, markReviewStaleFailed, type MediaReviewRow } from './repository'
import { REVIEW_STALE_AFTER_MS, REVIEW_STALE_FAILURE_CODE, REVIEW_STALE_FAILURE_MESSAGE, isReviewStale, reviewIdleMs } from './stale-policy'

export type StaleRecoveryOutcome = 'recovered' | 'settled' | 'in_flight'

function storeError() {
  return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
}

export async function recoverStaleActiveReview(db: SupabaseClient, active: MediaReviewRow, options: { userId: string; nowMs: number }): Promise<StaleRecoveryOutcome> {
  if (!isReviewStale(active, options.nowMs)) return 'in_flight'
  // Captured before the write: the facts about the Review AS READ, independent of any later mutation of `active`.
  const { id: reviewId, status: previousStatus, subject_media_type: mediaType } = active
  const staleAgeMs = reviewIdleMs(active, options.nowMs) ?? 0
  const recovered = await markReviewStaleFailed(db, {
    id: reviewId,
    userId: options.userId,
    cutoffIso: new Date(options.nowMs - REVIEW_STALE_AFTER_MS).toISOString(),
    code: REVIEW_STALE_FAILURE_CODE,
    message: REVIEW_STALE_FAILURE_MESSAGE,
    details: { recovery: { reason: 'execution_stale', previousStatus, staleAgeMs, thresholdMs: REVIEW_STALE_AFTER_MS } },
  })
  if (recovered.error) throw storeError()
  if (recovered.data) {
    // Safe metadata only: ids, kind, ages. Never keys, provider payloads or signed URLs.
    console.warn('[reviews] stale in-flight Review recovered', { reviewId, mediaType, previousStatus, staleAgeMs, outcome: 'recovered' })
    return 'recovered'
  }
  // Zero rows: the Review finished, was recovered by someone else, or made progress since it was read.
  const current = await findReviewById(db, options.userId, reviewId)
  if (current.error) throw storeError()
  if (!current.data || (current.data.status !== 'pending' && current.data.status !== 'running')) return 'settled'
  return 'in_flight'
}
