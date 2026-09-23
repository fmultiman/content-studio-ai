/**
 * Phase 2I-B3 — pure lifecycle/policy decisions for the worker coordinator.
 *
 * These functions contain no I/O (no fetch, no fs, no AWS SDK) so they are
 * unit-testable under lib/** even though the imperative wiring that calls
 * them (infra/render-worker-runtime/coordinator.mjs, bundled at export
 * time) runs on a separate VPS runtime. Keeping the *decisions* here and
 * the *I/O* in the worker package is what lets Task 14's coverage
 * (upload-before-complete ordering, upload-failure-never-completes,
 * complete-retry policy, cleanup timing) be proven without a live MinIO
 * server or live control plane.
 */

export type UploadOutcome =
  | { ok: true; bucket: string; key: string; sizeBytes: number }
  | { ok: false; error: string }

export type CompleteOutcome = { ok: true } | { ok: false; transient: boolean; error: string }

/**
 * completed is reachable ONLY after a successful upload (B0 §11/§12 —
 * "completed" means render succeeded AND the scratch object exists). A
 * failed upload must never lead to calling /complete.
 */
export function shouldCallComplete(uploadOutcome: UploadOutcome): boolean {
  return uploadOutcome.ok === true
}

/** The inverse of shouldCallComplete — an upload failure is always reported via /fail. */
export function shouldReportFailAfterUploadFailure(uploadOutcome: UploadOutcome): boolean {
  return uploadOutcome.ok === false
}

// ---------------------------------------------------------------------------
// Bounded complete-call retry (Task 10) — PutObject succeeded but the
// control-plane call failed for a transient reason (network blip, 5xx).
// This is intentionally NOT a general durable queue: it is a small, capped,
// in-process retry for the one HTTP call left after a successful upload.
// ---------------------------------------------------------------------------

export const MAX_COMPLETE_RETRY_ATTEMPTS = 5
const BASE_COMPLETE_RETRY_DELAY_MS = 2000
const MAX_COMPLETE_RETRY_DELAY_MS = 30000

/** 1-indexed attempt number. Attempt 1 is the first call, not a retry. */
export function shouldRetryComplete(attempt: number, maxAttempts: number = MAX_COMPLETE_RETRY_ATTEMPTS): boolean {
  return attempt < maxAttempts
}

/** Exponential backoff, capped — attempt is 1-indexed (delay applies BEFORE the next attempt). */
export function completeRetryDelayMs(attempt: number): number {
  return Math.min(BASE_COMPLETE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_COMPLETE_RETRY_DELAY_MS)
}

/**
 * Only a non-transient (4xx, e.g. the execution is no longer 'claimed',
 * or validation rejected the payload) complete failure should stop
 * retrying early — those will never succeed by retrying. A transient
 * failure (network error, 5xx) is always worth retrying up to the cap.
 */
export function isRetryableCompleteFailure(outcome: CompleteOutcome): boolean {
  return outcome.ok === false && outcome.transient === true
}

// ---------------------------------------------------------------------------
// Local /tmp cleanup (Task 12)
// ---------------------------------------------------------------------------

/**
 * The local MP4 is deleted only once the FULL lifecycle (upload + complete)
 * has succeeded. Deleting earlier would strand a bounded complete-retry
 * (Task 10) with no way to re-upload if it ever needed to; deleting on
 * upload failure is a separate, existing worker policy (§ below) — this
 * function specifically governs the "everything succeeded" path.
 */
export function shouldDeleteLocalFileAfterSuccess(completeOutcome: CompleteOutcome): boolean {
  return completeOutcome.ok === true
}

/**
 * On an upload failure, the local file is no longer useful (a fresh render
 * is a new attempt, not a re-upload of the same bytes) — safe to delete
 * immediately to bound /tmp growth, mirroring server.mjs's existing
 * "clean up eagerly" posture for failed renders.
 */
export function shouldDeleteLocalFileAfterUploadFailure(): boolean {
  return true
}

/**
 * While a complete retry is still pending (upload succeeded, complete has
 * not yet succeeded or exhausted its attempts), the local file must NOT be
 * deleted — it is the only source that could still be needed if a future
 * retry strategy ever needed to re-upload. Once retries are exhausted
 * (§ below), the object is already durably in MinIO (the upload itself
 * succeeded) — the local copy is deleted because leaving it would grow
 * /tmp unboundedly with no further use for it; the orphaned MinIO object
 * is the documented residual failure (see PHASE_2I_B3 docs §10).
 */
export function shouldDeleteLocalFileAfterCompleteRetriesExhausted(): boolean {
  return true
}

// ── Static Render Worker V1 — claim dispatch ──────────────────────────────────

export type WorkerRenderDispatch =
  | { ok: true; kind: 'video'; rendererPath: '/render'; body: { resolvedInput: unknown }; outputMimeType: 'video/mp4' }
  | { ok: true; kind: 'static_still'; rendererPath: '/render-still'; body: { staticInput: unknown }; outputMimeType: 'image/png' }
  | { ok: false; errorCode: 'UNSUPPORTED_EXECUTION_KIND' | 'MISSING_RENDER_INPUT'; errorMessage: string }

/**
 * Chooses the renderer path for one claimed execution from its explicit
 * `kind` discriminator — never inferred from which payload fields happen to
 * be present. A claim with no `kind` is a pre-034 control plane response
 * and is treated as video (backward compatible: the worker can be deployed
 * before the app). Static stills go to `/render-still` (renderStill -> PNG);
 * video keeps `/render` (renderMedia -> MP4) exactly as before.
 */
export function dispatchClaimedExecution(claim: { kind?: unknown; resolvedInput?: unknown; staticInput?: unknown }): WorkerRenderDispatch {
  const kind = claim.kind === undefined || claim.kind === null ? 'video' : claim.kind
  if (kind === 'video') {
    if (!claim.resolvedInput) return { ok: false, errorCode: 'MISSING_RENDER_INPUT', errorMessage: 'Video claim has no resolvedInput.' }
    return { ok: true, kind: 'video', rendererPath: '/render', body: { resolvedInput: claim.resolvedInput }, outputMimeType: 'video/mp4' }
  }
  if (kind === 'static_still') {
    if (!claim.staticInput) return { ok: false, errorCode: 'MISSING_RENDER_INPUT', errorMessage: 'Static claim has no staticInput.' }
    return { ok: true, kind: 'static_still', rendererPath: '/render-still', body: { staticInput: claim.staticInput }, outputMimeType: 'image/png' }
  }
  return { ok: false, errorCode: 'UNSUPPORTED_EXECUTION_KIND', errorMessage: `Unsupported execution kind "${String(kind).slice(0, 40)}".` }
}
