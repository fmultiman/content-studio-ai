#!/usr/bin/env node
/**
 * Phase 2I-B2 — Content Studio render-worker coordination loop.
 *
 * This file is a plain-Node ES Module that sits ALONGSIDE server.mjs but
 * does NOT replace it. server.mjs remains the local Remotion HTTP wrapper;
 * this file adds the control-plane polling loop that dispatches real renders.
 *
 * ─── Responsibility boundaries ────────────────────────────────────────────
 *   server.mjs     : Remotion bundle + renderMedia (unchanged)
 *   coordinator.mjs: poll → claim → call server.mjs → fail-report
 *
 * Keeping them separate ensures coordination tests do not need Chromium and
 * the renderer can be exercised without a live control plane (Task 15).
 *
 * ─── Safe B2 behavior for successfully rendered MP4s ──────────────────────
 * B3 is not yet implemented (MinIO upload). Therefore this coordinator runs
 * in PROOF_ONLY mode by default:
 *
 *   - It polls and claims exactly ONE execution per run.
 *   - It invokes the renderer (real Chromium, real MP4 output).
 *   - On render success it logs the local output path and records the
 *     locally-rendered proof, but does NOT call /complete, because
 *     completed requires an authoritative scratch-bucket locator.
 *   - On render failure it calls /fail so the server records the error.
 *   - After one execution (success or fail) the process exits.
 *
 * This prevents continuously claiming new work and stranding successful
 * executions in "claimed" state until lease expiry because upload is absent.
 *
 * When CONTENT_STUDIO_RENDER_LOOP=1 the coordinator runs a continuous polling
 * loop. This flag MUST NOT be set until B3 is in place and the loop calls
 * /complete after a successful upload.
 *
 * ─── Environment contract ─────────────────────────────────────────────────
 *   CONTENT_STUDIO_CONTROL_PLANE_URL   required — Vercel deployment URL
 *   CONTENT_STUDIO_RENDER_WORKER_SECRET required — shared secret for Bearer
 *   CONTENT_STUDIO_RENDER_WORKER_ID    optional — stable worker identity
 *   CONTENT_STUDIO_RENDER_POLL_INTERVAL_MS optional (default 8000)
 *   CONTENT_STUDIO_RENDER_LOOP         optional — set to "1" for continuous
 *   PORT                               optional (default 3456) — renderer port
 *
 * ─── Security notes ───────────────────────────────────────────────────────
 *   - No Supabase credential ever held by the worker.
 *   - The shared secret is sent header-only (Authorization: Bearer).
 *   - resolvedInput comes from the control plane — real presigned S3 URLs
 *     generated server-side from DB-verified LibraryFile records.
 *   - Worker identity goes into claimed_by for audit; it is not a secret.
 */

import { randomUUID } from 'node:crypto'

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
if (!CONTINUOUS_LOOP) {
  console.log('[coordinator] NOTE: CONTENT_STUDIO_RENDER_LOOP is not set.')
  console.log('              Complete API will NOT be called (B3 required for MinIO upload).')
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/**
 * Makes a fetch request with the worker Authorization header.
 * Throws on network error; returns { ok, status, body } on HTTP success/failure.
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
 */
async function reportFail(executionId, errorCode, errorMessage, errorDetail) {
  try {
    const result = await workerFetch(
      `${CONTROL_PLANE_URL}/api/render-executions/${executionId}/fail`,
      {
        method: 'POST',
        body: JSON.stringify({ errorCode, errorMessage, errorDetail }),
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

// ─── Renderer call ────────────────────────────────────────────────────────────

/**
 * Calls the local render server (server.mjs) with a resolved timeline input.
 * Returns { ok: true, outputPath, durationMs } or { ok: false, error }.
 *
 * This is the only place the coordinator touches the renderer — separation
 * of concerns means coordination tests can stub this function without
 * needing Chromium.
 */
async function invokeRenderer(resolvedInput) {
  try {
    const response = await fetch(`${RENDERER_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolvedInput }),
    })
    const result = await response.json()
    if (result.status === 'succeeded') {
      return { ok: true, outputPath: result.output_path, durationMs: result.duration_ms, meta: result }
    }
    return { ok: false, error: result.error ?? 'Renderer returned non-succeeded status.', meta: result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Exponential backoff state ────────────────────────────────────────────────

let consecutiveNetworkErrors = 0
const MAX_BACKOFF_MS = 60_000

function backoffMs() {
  return Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveNetworkErrors), MAX_BACKOFF_MS)
}

// ─── Single execution cycle ───────────────────────────────────────────────────

/**
 * Runs one full poll-claim-render-report cycle.
 * Returns 'no_work' | 'rendered' | 'failed' | 'network_error'.
 */
async function runOneCycle() {
  // Concurrency guard: the coordinator never starts a second render while
  // one is in progress — this is enforced architecturally by the single-
  // cycle loop exiting after one render in proof-only mode, and by the
  // continuous loop awaiting each cycle sequentially.
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

  const { executionId, attempt, resolvedInput, warnings } = claim
  console.log(`[coordinator] Claimed execution ${executionId} (attempt ${attempt})`)
  if (warnings?.length) {
    console.warn('[coordinator] Resolution warnings:', warnings)
  }

  // ── Invoke renderer ────────────────────────────────────────────────────────
  const renderResult = await invokeRenderer(resolvedInput)

  if (!renderResult.ok) {
    const errorMessage = renderResult.error?.slice(0, 500) ?? 'Unknown render error'
    console.error(`[coordinator] Render failed for ${executionId}:`, errorMessage)
    await reportFail(executionId, 'RENDER_FAILED', errorMessage, renderResult.meta ? JSON.stringify(renderResult.meta).slice(0, 4000) : undefined)
    return 'failed'
  }

  // ── Render succeeded ───────────────────────────────────────────────────────
  console.log(`[coordinator] Render succeeded for ${executionId}`)
  console.log(`[coordinator]   Output  : ${renderResult.outputPath}`)
  console.log(`[coordinator]   Duration: ${renderResult.durationMs}ms`)
  console.log(`[coordinator]   NOTE: NOT calling /complete — MinIO upload (B3) required first.`)
  console.log(`[coordinator]   The execution will remain in "claimed" state until lease expires.`)
  console.log(`[coordinator]   This is the expected B2 safe-hold behavior before B3 is available.`)

  // In proof-only mode (default) we do not call /complete. The row will
  // expire and be re-claimable if B3 is not yet deployed, which is safe —
  // idempotency of rendering is acceptable; false completions are not.
  //
  // B3 CONTRACT: after adding MinIO upload, replace this block with:
  //   1. Upload renderResult.outputPath to MinIO scratch bucket
  //   2. await reportComplete(executionId, { outputBucket, outputStoragePath,
  //        outputSizeBytes, outputDurationMs })
  //   3. return 'rendered'

  return 'rendered'
}

// ─── Main loop ────────────────────────────────────────────────────────────────

if (CONTINUOUS_LOOP) {
  console.warn('[coordinator] CONTINUOUS LOOP mode is active.')
  console.warn('[coordinator] WARNING: Do not use this mode until B3 (MinIO upload) is implemented.')
  console.warn('[coordinator] Successful renders will leave executions claimed until lease expiry.')
}

let running = true
process.on('SIGTERM', () => { running = false; console.log('[coordinator] SIGTERM received — stopping after current cycle.') })
process.on('SIGINT',  () => { running = false; console.log('[coordinator] SIGINT received — stopping after current cycle.') })

async function main() {
  while (running) {
    const result = await runOneCycle()

    if (!CONTINUOUS_LOOP) {
      // Proof-only mode: exit after the first execution (success, fail, or
      // first non-empty response). On no_work or network_error we continue
      // polling briefly so the proof can complete even under load.
      if (result === 'rendered' || result === 'failed') {
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
