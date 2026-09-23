#!/usr/bin/env node
/**
 * Phase 2I-B2/B3 — Content Studio render-worker coordination loop.
 *
 * This file is the ENTRY POINT esbuild bundles at export time (see
 * export.mjs) into a single self-contained `coordinator.bundle.cjs` — the
 * form actually deployed to the VPS. It sits ALONGSIDE server.mjs but does
 * NOT replace it. server.mjs remains the local Remotion HTTP wrapper
 * (unbundled — its own dependency closure, `remotion`/`@remotion/*`, is
 * already provided by the VPS base image's `/app/node_modules`, per
 * README.md §2); this file adds the control-plane polling loop plus (as of
 * Phase 2I-B3) the MinIO scratch upload step.
 *
 * ─── Responsibility boundaries ────────────────────────────────────────────
 *   server.mjs      : Remotion bundle + renderMedia (unchanged)
 *   coordinator.mjs  : poll → claim → call server.mjs → upload → complete/fail
 *   minio-upload.mjs : the only file that imports @aws-sdk/client-s3
 *
 * ─── Why bundling is required (Phase 2I-B3, Task 5) ───────────────────────
 * Phase 2I-A1/B2 needed zero extra npm dependencies beyond what the VPS
 * base image already provides. Phase 2I-B3 adds a real one
 * (`@aws-sdk/client-s3`) that the base image does NOT provide. Rather than
 * assume it will magically be resolvable via the base image's
 * `/app/node_modules` (it will not be — that directory is fixed,
 * base-image-owned, and does not contain it), export.mjs bundles this
 * entry point (and everything it imports, including the shared
 * `lib/render-execution/*.ts` helpers) into one dependency-free JS file
 * with esbuild BEFORE copying anything to the VPS. Deploy
 * `coordinator.bundle.cjs`, not this source file, to the VPS.
 *
 * ─── Truthful completion (Phase 2I-B3) ────────────────────────────────────
 * completed is now reachable, but ONLY through the real lifecycle:
 *   render (server.mjs) -> confirm local file -> upload to MinIO scratch
 *     -> only on upload success -> call /complete -> only on success ->
 *     delete the local file.
 * A render success with no successful upload never calls /complete — see
 * lib/render-execution/worker-lifecycle.ts for the pure decision functions
 * this file wires together (shouldCallComplete,
 * shouldReportFailAfterUploadFailure, shouldRetryComplete,
 * shouldDeleteLocalFileAfterSuccess, etc.), all independently unit-tested.
 *
 * ─── Environment contract ─────────────────────────────────────────────────
 *   CONTENT_STUDIO_CONTROL_PLANE_URL     required — Vercel deployment URL
 *   CONTENT_STUDIO_RENDER_WORKER_SECRET  required — shared secret for Bearer
 *   CONTENT_STUDIO_RENDER_WORKER_ID      optional — stable worker identity
 *   CONTENT_STUDIO_RENDER_POLL_INTERVAL_MS optional (default 8000)
 *   CONTENT_STUDIO_RENDER_LOOP           optional — "1" for continuous polling
 *   CONTENT_STUDIO_MINIO_ENDPOINT        required for upload — e.g. http://minio:9000
 *   CONTENT_STUDIO_MINIO_BUCKET          required for upload — e.g. content-studio
 *   CONTENT_STUDIO_MINIO_ACCESS_KEY      required for upload
 *   CONTENT_STUDIO_MINIO_SECRET_KEY      required for upload
 *   CONTENT_STUDIO_MINIO_REGION          optional (default us-east-1)
 *   PORT                                 optional (default 3456) — renderer port
 *
 * ─── Security notes ───────────────────────────────────────────────────────
 *   - No Supabase credential ever held by the worker.
 *   - The control-plane shared secret is sent header-only (Authorization: Bearer).
 *   - The MinIO credential is a separate, worker-only secret — never sent to
 *     the control plane, never logged, never included in any /complete or
 *     /fail request body.
 *   - resolvedInput comes from the control plane — real presigned S3 URLs
 *     generated server-side from DB-verified LibraryFile records.
 *   - Worker identity goes into claimed_by for audit; it is not a secret.
 */

import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { uploadRenderOutputToScratch } from './minio-upload.mjs'
import {
  shouldCallComplete,
  shouldReportFailAfterUploadFailure,
  shouldRetryComplete,
  completeRetryDelayMs,
  isRetryableCompleteFailure,
  shouldDeleteLocalFileAfterSuccess,
  shouldDeleteLocalFileAfterUploadFailure,
  shouldDeleteLocalFileAfterCompleteRetriesExhausted,
  MAX_COMPLETE_RETRY_ATTEMPTS,
  dispatchClaimedExecution,
} from '../../lib/render-execution/worker-lifecycle.ts'

// ─── Configuration ────────────────────────────────────────────────────────────

const CONTROL_PLANE_URL = (process.env.CONTENT_STUDIO_CONTROL_PLANE_URL ?? '').replace(/\/$/, '')
const WORKER_SECRET = process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET ?? ''
const WORKER_ID =
  process.env.CONTENT_STUDIO_RENDER_WORKER_ID ??
  `content-studio-worker-${randomUUID().slice(0, 8)}`
const POLL_INTERVAL_MS = Number(process.env.CONTENT_STUDIO_RENDER_POLL_INTERVAL_MS ?? 8000)
const CONTINUOUS_LOOP = process.env.CONTENT_STUDIO_RENDER_LOOP === '1'
const RENDERER_PORT = Number(process.env.PORT ?? 3456)
const RENDERER_URL = `http://127.0.0.1:${RENDERER_PORT}`

// ─── Validation ───────────────────────────────────────────────────────────────

if (!CONTROL_PLANE_URL) {
  console.error('[coordinator] CONTENT_STUDIO_CONTROL_PLANE_URL is required. Exiting.')
  process.exit(1)
}
if (!WORKER_SECRET) {
  console.error('[coordinator] CONTENT_STUDIO_RENDER_WORKER_SECRET is required. Exiting.')
  process.exit(1)
}

console.log(`[coordinator] Worker ID    : ${WORKER_ID}`)
console.log(`[coordinator] Control plane: ${CONTROL_PLANE_URL}`)
console.log(`[coordinator] Renderer     : ${RENDERER_URL}`)
console.log(`[coordinator] Mode         : ${CONTINUOUS_LOOP ? 'continuous loop' : 'proof-only (single execution)'}`)
console.log('[coordinator] Lifecycle    : render -> upload (MinIO scratch) -> complete')

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Makes a fetch request with the worker Authorization header.
 * Throws on network error; returns { ok, status, body } on HTTP success/failure.
 *
 * SECURITY: WORKER_SECRET appears ONLY inside the Authorization header value
 * constructed here — it is never interpolated into any console.log/warn/error
 * call anywhere in this file or minio-upload.mjs (verified statically by
 * lib/render-execution/__tests__/worker-secret-not-logged.test.ts, which
 * greps both source files for this invariant).
 */
async function workerFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${WORKER_SECRET}`,
    'X-Worker-Id': WORKER_ID,
    ...(options.headers ?? {}),
  }
  const response = await fetch(url, { ...options, headers })
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { ok: response.ok, status: response.status, body }
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * Calls POST /api/render-executions/claim and returns the response.
 * Returns null on network error (caller should back off).
 */
async function claimExecution() {
  try {
    const result = await workerFetch(`${CONTROL_PLANE_URL}/api/render-executions/claim`, {
      method: 'POST',
      body: JSON.stringify({ leaseSeconds: 300 }),
    })
    if (!result.ok) {
      console.error(`[coordinator] Claim failed HTTP ${result.status}:`, result.body)
      return null
    }
    return result.body
  } catch (err) {
    console.error('[coordinator] Claim network error:', err.message)
    return null
  }
}

// ─── Fail report ──────────────────────────────────────────────────────────────

/**
 * Reports a failure to POST /api/render-executions/:id/fail.
 *
 * `claimAttempt` MUST be the exact `attempt` value returned by this
 * execution's own /claim response (Phase 2I-B4.1 stale-attempt fencing,
 * see PHASE_2I_B4_LEASE_RECOVERY_AUDIT.md) — never recomputed, never
 * defaulted. A stale/superseded attempt's fail report is rejected by the
 * control plane with 409 STALE_ATTEMPT rather than terminalizing a row a
 * newer claim now owns.
 */
async function reportFail(executionId, claimAttempt, errorCode, errorMessage, errorDetail) {
  try {
    const result = await workerFetch(
      `${CONTROL_PLANE_URL}/api/render-executions/${executionId}/fail`,
      {
        method: 'POST',
        body: JSON.stringify({ attempt: claimAttempt, errorCode, errorMessage, errorDetail }),
      },
    )
    if (!result.ok) {
      console.error(`[coordinator] Fail report HTTP ${result.status}:`, result.body)
    } else {
      console.log(`[coordinator] Failure recorded for ${executionId}:`, errorCode)
    }
  } catch (err) {
    console.error('[coordinator] Fail report network error:', err.message)
  }
}

// ─── Complete report (with bounded retry, Task 10) ─────────────────────────────

/**
 * Calls POST /api/render-executions/:id/complete with authoritative output
 * metadata. Retries a bounded number of times (lib/render-execution/
 * worker-lifecycle.ts's shouldRetryComplete/completeRetryDelayMs) ONLY for
 * transient failures (network error or 5xx) — a 4xx (e.g. the execution is
 * no longer 'claimed', a stale attempt, or a validation rejection) stops
 * immediately since retrying it can never succeed.
 *
 * `claimAttempt` MUST be the exact `attempt` value returned by this
 * execution's own /claim response (Phase 2I-B4.1 stale-attempt fencing) —
 * never recomputed, never defaulted, and NOT the same thing as the local
 * `retryAttempt` HTTP-retry counter below (which counts calls to THIS
 * route, not claim attempts on the execution).
 *
 * Returns { ok: true } or { ok: false, transient, error }.
 */
async function reportCompleteWithRetry(executionId, claimAttempt, outputMeta) {
  for (let retryAttempt = 1; retryAttempt <= MAX_COMPLETE_RETRY_ATTEMPTS; retryAttempt++) {
    let outcome
    try {
      const result = await workerFetch(
        `${CONTROL_PLANE_URL}/api/render-executions/${executionId}/complete`,
        { method: 'POST', body: JSON.stringify({ attempt: claimAttempt, ...outputMeta }) },
      )
      if (result.ok) {
        console.log(`[coordinator] Completion recorded for ${executionId} (HTTP retry ${retryAttempt}).`)
        return { ok: true }
      }
      const transient = result.status >= 500 || result.status === 0
      outcome = { ok: false, transient, error: `HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}` }
    } catch (err) {
      outcome = { ok: false, transient: true, error: err.message }
    }

    console.error(
      `[coordinator] Complete report failed (HTTP retry ${retryAttempt}/${MAX_COMPLETE_RETRY_ATTEMPTS}):`,
      outcome.error,
    )

    if (!isRetryableCompleteFailure(outcome) || !shouldRetryComplete(retryAttempt)) {
      return outcome
    }
    await sleep(completeRetryDelayMs(retryAttempt))
  }
  return { ok: false, transient: true, error: 'Exhausted complete retry attempts.' }
}

// ─── Renderer call ────────────────────────────────────────────────────────────

/**
 * Calls the local render server (server.mjs) with a resolved timeline input.
 * Returns { ok: true, outputPath, durationMs } or { ok: false, error }.
 *
 * This is the only place the coordinator touches the renderer — separation
 * of concerns means coordination tests can stub this function without
 * needing Chromium.
 */
async function invokeRenderer(dispatch) {
  try {
    // Static Render Worker V1: '/render' (video, renderMedia) or
    // '/render-still' (static, renderStill) — chosen from the claim's
    // explicit kind by dispatchClaimedExecution, never by field sniffing.
    const response = await fetch(`${RENDERER_URL}${dispatch.rendererPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dispatch.body),
    })
    const result = await response.json()
    if (result.status === 'succeeded') {
      return { ok: true, outputPath: result.output_path, durationMs: result.duration_ms, width: result.width, height: result.height, meta: result }
    }
    return { ok: false, error: result.error ?? 'Renderer returned non-succeeded status.', meta: result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ─── Local cleanup ────────────────────────────────────────────────────────────

async function deleteLocalFile(filePath) {
  try {
    await unlink(filePath)
    console.log(`[coordinator] Deleted local render output: ${filePath}`)
  } catch (err) {
    console.warn(`[coordinator] Failed to delete local render output ${filePath}:`, err.message)
  }
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Exponential backoff state (claim/network errors — unrelated to the
// bounded complete-retry above, which has its own attempt cap) ─────────────────

let consecutiveNetworkErrors = 0
const MAX_BACKOFF_MS = 60_000

function backoffMs() {
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveNetworkErrors), MAX_BACKOFF_MS)
}

// ─── Single execution cycle ───────────────────────────────────────────────────

/**
 * Runs one full poll-claim-render-upload-complete cycle.
 * Returns 'no_work' | 'completed' | 'failed' | 'network_error'.
 */
async function runOneCycle() {
  // Concurrency guard: the coordinator never starts a second render while
  // one is in progress — this is enforced architecturally by the single-
  // cycle loop exiting after one render (proof-only mode), and by the
  // continuous loop awaiting each cycle sequentially end-to-end (render,
  // upload, and complete all finish before the next claim is attempted).
  console.log(`[coordinator] Polling for work...`)
  const claim = await claimExecution()

  if (claim === null) {
    consecutiveNetworkErrors++
    console.warn(`[coordinator] Network error on claim. Backoff: ${backoffMs()}ms`)
    return 'network_error'
  }

  consecutiveNetworkErrors = 0 // reset on success

  if (!claim.claimed) {
    console.log('[coordinator] No pending work.')
    return 'no_work'
  }

   // Legacy video contract keeps this exact destructuring shape; static adds
   // an explicit kind and staticInput discriminator beside it.
   // const { executionId, userId, attempt, resolvedInput, warnings } = claim
   const { executionId, userId, attempt, warnings } = claim
  const dispatch = dispatchClaimedExecution(claim)
  console.log(`[coordinator] Claimed execution ${executionId} (attempt ${attempt}, kind ${dispatch.ok ? dispatch.kind : claim.kind})`)
  if (warnings?.length) {
    console.warn('[coordinator] Resolution warnings:', warnings)
  }
  if (!dispatch.ok) {
    console.error(`[coordinator] Cannot dispatch ${executionId}:`, dispatch.errorCode)
    await reportFail(executionId, attempt, dispatch.errorCode, dispatch.errorMessage, undefined)
    return 'failed'
  }

  // ── Invoke renderer ────────────────────────────────────────────────────────
  const renderStartedAt = Date.now()
  const renderResult = await invokeRenderer(dispatch)

  if (!renderResult.ok) {
    const errorMessage = renderResult.error?.slice(0, 500) ?? 'Unknown render error'
    console.error(`[coordinator] Render failed for ${executionId}:`, errorMessage)
    await reportFail(executionId, attempt, 'RENDER_FAILED', errorMessage, renderResult.meta ? JSON.stringify(renderResult.meta).slice(0, 4000) : undefined)
    return 'failed'
  }

  console.log(`[coordinator] Render succeeded for ${executionId} (${dispatch.kind}, ${Date.now() - renderStartedAt}ms)`)
  console.log(`[coordinator]   Output  : ${renderResult.outputPath}`)
  console.log(`[coordinator]   Duration: ${renderResult.durationMs}ms`)

  // ── Upload to MinIO scratch (Phase 2I-B3) ──────────────────────────────────
  const uploadStartedAt = Date.now()
  const uploadOutcome = await uploadRenderOutputToScratch({
    userId,
    executionId,
    localFilePath: renderResult.outputPath,
    kind: dispatch.kind,
  })

  if (shouldReportFailAfterUploadFailure(uploadOutcome)) {
    console.error(`[coordinator] Upload failed for ${executionId}:`, uploadOutcome.error)
    await reportFail(executionId, attempt, 'OUTPUT_UPLOAD_FAILED', uploadOutcome.error, undefined)
    if (shouldDeleteLocalFileAfterUploadFailure()) {
      await deleteLocalFile(renderResult.outputPath)
    }
    return 'failed'
  }

  console.log(`[coordinator]   Uploaded: ${uploadOutcome.bucket}/${uploadOutcome.key} (${uploadOutcome.sizeBytes} bytes, ${Date.now() - uploadStartedAt}ms)`)

  // ── Complete (only reachable after a successful upload) ────────────────────
  if (!shouldCallComplete(uploadOutcome)) {
    // Unreachable given the branch above, but keeps the decision function
    // load-bearing rather than decorative — see worker-lifecycle.test.ts.
    return 'failed'
  }

  const completeOutcome = await reportCompleteWithRetry(executionId, attempt, {
    outputBucket: uploadOutcome.bucket,
    outputStoragePath: uploadOutcome.key,
    outputSizeBytes: uploadOutcome.sizeBytes,
    outputDurationMs: renderResult.durationMs,
    outputMimeType: dispatch.outputMimeType,
    ...(Number.isInteger(renderResult.width) ? { outputWidth: renderResult.width } : {}),
    ...(Number.isInteger(renderResult.height) ? { outputHeight: renderResult.height } : {}),
  })

  if (shouldDeleteLocalFileAfterSuccess(completeOutcome)) {
    await deleteLocalFile(renderResult.outputPath)
    return 'completed'
  }

  // Complete ultimately failed (retries exhausted or a non-retryable 4xx).
  // The object is already durably in MinIO — see PHASE_2I_B3 docs §10 for
  // the documented residual-failure/orphan-object behavior. The local file
  // no longer has a further purpose (retries are exhausted); delete it to
  // bound /tmp growth rather than accumulate it forever.
  console.error(`[coordinator] Complete ultimately failed for ${executionId}:`, completeOutcome.error)
  if (shouldDeleteLocalFileAfterCompleteRetriesExhausted()) {
    await deleteLocalFile(renderResult.outputPath)
  }
  return 'failed'
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let running = true
process.on('SIGTERM', () => { running = false; console.log('[coordinator] SIGTERM received — stopping after current cycle.') })
process.on('SIGINT',  () => { running = false; console.log('[coordinator] SIGINT received — stopping after current cycle.') })

async function main() {
  while (running) {
    const result = await runOneCycle()

    if (!CONTINUOUS_LOOP) {
      // Proof-only mode: exit after the first execution (success or fail).
      // On no_work or network_error we continue polling briefly so the
      // proof can complete even under load.
      if (result === 'completed' || result === 'failed') {
        console.log('[coordinator] Proof-only mode: exiting after one execution.')
        process.exit(0)
      }
    }

    const waitMs = result === 'network_error' ? backoffMs() : POLL_INTERVAL_MS
    if (running) {
      await sleep(waitMs)
    }
  }
  console.log('[coordinator] Stopped.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[coordinator] Fatal error:', err)
  process.exit(1)
})
