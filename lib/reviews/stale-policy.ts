// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046)
//
// The single stale policy for in-flight (`pending` / `running`) Reviews. Pure and client-safe: the server
// recovery and the Video Review UI read the same number.
//
// DERIVATION (see docs/discovery/creative-rendering/REVIEW_STALE_RUNNING_RECOVERY_V1.md). A live Review row
// can be in flight for at most the provider execution envelope that runs between its insert and its terminal
// write. Worst case by code, Gemini video (the longest path):
//
//   upload      <= 900 s   total-upload deadline 600 s is checked between chunks, so the last chunk may
//                          still run its own 300 s request timeout
//   processing  <= 210 s   180 s wait deadline + one 30 s status check
//   generate    <= 120 s
//   cleanup     <=  15 s
//   -----------------------------------------------------------------------------------------------
//   total       <= 1245 s  (20.75 min)        OpenAI Image: 60 s        Gemini Image: ~120 s
//
// Vercel additionally kills the video route at maxDuration = 300 s, so a live request is normally gone long
// before this; the threshold deliberately follows the code envelope, not the platform cap, so it stays safe
// if the cap is raised or the service is run elsewhere. 30 min leaves ~9 min (~44%) of margin over it.
// A test pins this relation to the real provider constants so a future timeout increase fails loudly.
//
// Timestamp authority: `media_reviews.updated_at`. Only lifecycle writes update the table (insert,
// markRunning, markCompleted, markFailed) and the trigger stamps it on each one, so it is the time of the
// last lifecycle progress. There is no heartbeat; none is needed because the envelope above is bounded.

export const REVIEW_STALE_AFTER_MS = 30 * 60_000

/** Normalized failure code written when a stale in-flight Review is recovered (lowercase, like every other code). */
export const REVIEW_STALE_FAILURE_CODE = 'execution_stale'

/** Safe, provider-neutral meaning. It never claims Gemini/OpenAI failed, the media was invalid, or the user cancelled. */
export const REVIEW_STALE_FAILURE_MESSAGE = 'The previous Review execution was interrupted and did not complete.'

/** Age of the last lifecycle write, or null when the timestamp is unreadable (treated as NOT stale: fail safe). */
export function reviewIdleMs(row: { updated_at: string }, nowMs: number): number | null {
  const updated = Date.parse(row.updated_at)
  return Number.isFinite(updated) ? nowMs - updated : null
}

export function isReviewStale(row: { status: string; updated_at: string }, nowMs: number): boolean {
  if (row.status !== 'pending' && row.status !== 'running') return false
  const idle = reviewIdleMs(row, nowMs)
  return idle !== null && idle > REVIEW_STALE_AFTER_MS
}
