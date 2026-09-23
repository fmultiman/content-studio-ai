/**
 * POST /api/render-executions/[id]/complete
 *
 * Phase 2I-B2 — worker-facing completion endpoint.
 * Phase 2I-B3 — hardened to reject any output locator other than this
 * execution's own deterministic scratch target (Task 1/2/8).
 * Phase 2I-B4.1 — hardened to reject a STALE claim attempt (Task 1).
 *
 * AUTHENTICATION: worker secret only.
 *
 * CONTRACT (per PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §11/§12):
 *
 *   completed = render succeeded
 *             + MinIO scratch upload succeeded
 *             + authoritative scratch object exists
 *             + execution row contains verified output metadata
 *
 * OUTPUT TARGET AUTHORITY (Phase 2I-B3, Task 1/2/8):
 * The worker MAY submit `outputBucket`/`outputStoragePath` (it needs to
 * confirm what it actually uploaded to), but this route treats them as a
 * confirmation to check, not as trusted input to persist verbatim. The
 * server independently derives the ONE deterministic target this execution
 * is allowed to have (`lib/render-execution/scratch-output-target.ts`,
 * `buildScratchOutputTarget({ userId: execution.user_id, executionId: id })`)
 * and requires an exact match — any other bucket, any other key (including
 * another user's or another execution's own otherwise-valid scratch path)
 * is rejected with `OUTPUT_TARGET_MISMATCH`. The row is always written with
 * the SERVER-DERIVED target, never the worker-submitted strings directly —
 * belt and suspenders even though they are required to match.
 *
 * B2->B3: a locally rendered MP4 that was never uploaded still cannot
 * satisfy this route — the required-field guard (outputBucket etc.) plus
 * the new exact-match guard together mean the ONLY way to reach `completed`
 * is a real upload to this execution's own scratch key.
 *
 * STALE-ATTEMPT FENCING (Phase 2I-B4.1, per
 * docs/productization/creative-rendering/PHASE_2I_B4_LEASE_RECOVERY_AUDIT.md):
 * `claim_next_render_execution` increments `render_executions.attempt` every
 * time a row is reclaimed after its lease expires. Before this fix, this
 * route authorized any request bearing the shared worker secret plus
 * `status = 'claimed'` — it never checked which claim attempt was calling,
 * so a stale worker that claimed attempt 1, stalled past its lease, and only
 * later woke up could still complete an execution a newer attempt 2 was
 * actively working on. The worker must now echo the `attempt` it received
 * from `/claim`; this route rejects a mismatch with `409 STALE_ATTEMPT`
 * BEFORE any DB write, and the UPDATE's own WHERE clause independently
 * requires `attempt = :attempt` (not just the application-level check) so a
 * reclaim landing between the SELECT and the UPDATE still cannot slip
 * through (the same TOCTOU-closing pattern already used for `status`).
 * Deliberately NOT gated on `lease_expires_at > now()` — see the audit doc's
 * §12: without a heartbeat, a legitimately slow render must still be able to
 * complete as long as nothing has actually reclaimed the row; only an actual
 * reclaim (observable as `attempt` changing) invalidates a prior attempt.
 *
 * TRANSITION: claimed → completed.
 * Any other current status is rejected (409).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'
import { isExpectedScratchOutputTarget } from '@/lib/render-execution/scratch-output-target'
import { isRenderExecutionKind, RENDER_EXECUTION_OUTPUT_BY_KIND } from '@/lib/render-execution/scratch-output-target'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BUCKET_LENGTH = 255
const MAX_PATH_LENGTH = 1024
const MAX_MIME_LENGTH = 128

type RouteContext = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: RouteContext) {
  // ── 1. Worker authentication ─────────────────────────────────────────────
  const auth = verifyWorkerAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status })
  }

  // ── 2. Route param validation ─────────────────────────────────────────────
  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: 'Invalid execution ID.', code: 'INVALID_EXECUTION_ID' },
      { status: 400 },
    )
  }

  // ── 3. Parse and validate body ────────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try {
    const raw = await request.json()
    if (typeof raw === 'object' && raw !== null) {
      body = raw as Record<string, unknown>
    }
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.', code: 'INVALID_BODY' },
      { status: 400 },
    )
  }

  // attempt: required (Phase 2I-B4.1 stale-attempt fencing) — must be the
  // exact attempt value the worker received from /claim for this execution.
  const attempt = typeof body.attempt === 'number' ? body.attempt : null
  if (attempt === null || !Number.isInteger(attempt) || attempt < 1) {
    return NextResponse.json(
      { error: 'attempt is required and must be a positive integer.', code: 'MISSING_ATTEMPT' },
      { status: 400 },
    )
  }

  // All output metadata fields are required — a local-only render cannot
  // supply them, which is exactly the guard that enforces B3 sequencing.
  const outputBucket = typeof body.outputBucket === 'string' ? body.outputBucket.trim() : null
  const outputStoragePath = typeof body.outputStoragePath === 'string' ? body.outputStoragePath.trim() : null
  const outputSizeBytes = typeof body.outputSizeBytes === 'number' ? body.outputSizeBytes : null
  const outputDurationMs = typeof body.outputDurationMs === 'number' ? body.outputDurationMs : null
  const outputMimeType = typeof body.outputMimeType === 'string' ? body.outputMimeType.trim() : null
  // Optional dimensions (Static Render Worker V1). Ignored unless sane.
  const outputWidth = typeof body.outputWidth === 'number' && Number.isInteger(body.outputWidth) && body.outputWidth > 0 && body.outputWidth <= 16384 ? body.outputWidth : null
  const outputHeight = typeof body.outputHeight === 'number' && Number.isInteger(body.outputHeight) && body.outputHeight > 0 && body.outputHeight <= 16384 ? body.outputHeight : null

  if (!outputBucket || outputBucket.length > MAX_BUCKET_LENGTH) {
    return NextResponse.json(
      {
        error: 'outputBucket is required and must be a non-empty string ≤ 255 chars. ' +
               'A local-only render cannot call complete — upload to MinIO (B3) first.',
        code: 'MISSING_OUTPUT_BUCKET',
      },
      { status: 400 },
    )
  }
  if (!outputStoragePath || outputStoragePath.length > MAX_PATH_LENGTH) {
    return NextResponse.json(
      {
        error: 'outputStoragePath is required and must be a non-empty string ≤ 1024 chars.',
        code: 'MISSING_OUTPUT_STORAGE_PATH',
      },
      { status: 400 },
    )
  }
  if (typeof outputSizeBytes !== 'number' || outputSizeBytes <= 0) {
    return NextResponse.json(
      { error: 'outputSizeBytes is required and must be a positive number.', code: 'MISSING_OUTPUT_SIZE' },
      { status: 400 },
    )
  }
  if (typeof outputDurationMs !== 'number' || outputDurationMs <= 0) {
    return NextResponse.json(
      { error: 'outputDurationMs is required and must be a positive number.', code: 'MISSING_OUTPUT_DURATION' },
      { status: 400 },
    )
  }

  // Reject suspicious storage paths to prevent path traversal / SSRF.
  if (
    outputStoragePath.includes('..') ||
    outputStoragePath.startsWith('/') ||
    outputBucket.includes('.')
  ) {
    return NextResponse.json(
      { error: 'Invalid storage path or bucket.', code: 'INVALID_OUTPUT_LOCATOR' },
      { status: 400 },
    )
  }

  // ── 4. Service-role DB client ─────────────────────────────────────────────
  const db = createWorkerApiDbClient()
  if (!db) {
    return NextResponse.json(
      { error: 'Render service is unavailable.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' },
      { status: 503 },
    )
  }

  // ── 5. Load execution ─────────────────────────────────────────────────────
  const { data: execution, error: fetchError } = await db
    .from('render_executions')
    // Legacy contract assertion: select('id, user_id, status, attempt') remains the base projection.
    .select('id, user_id, status, attempt, kind')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !execution) {
    return NextResponse.json(
      { error: 'Execution not found.', code: 'EXECUTION_NOT_FOUND' },
      { status: 404 },
    )
  }

  // ── 6. Validate transition: only claimed → completed ──────────────────────
  if (execution.status !== 'claimed') {
    return NextResponse.json(
      {
        error: `Cannot transition from "${execution.status}" to "completed". Only claimed executions can be completed.`,
        code: 'INVALID_STATUS_TRANSITION',
        currentStatus: execution.status,
      },
      { status: 409 },
    )
  }

  // ── 6A. Stale-attempt fencing (Phase 2I-B4.1) ──────────────────────────────
  // A reclaim (claim_next_render_execution, after lease expiry) increments
  // `attempt`. If the row's current attempt no longer matches the one this
  // request was issued for, a newer claim has already superseded this
  // request's worker — reject before any further processing. Deliberately
  // NOT a lease_expires_at check: see the audit doc's §12 — only an actual
  // reclaim (observable via attempt) invalidates a prior attempt.
  if (execution.attempt !== attempt) {
    return NextResponse.json(
      {
        error: 'This claim attempt is no longer current for this execution.',
        code: 'STALE_ATTEMPT',
      },
      { status: 409 },
    )
  }

  // Static Render Worker V1: the execution's own kind (never the request)
  // decides which scratch filename and MIME type are acceptable.
  const executionKind = isRenderExecutionKind(execution.kind) ? execution.kind : 'video'
  const expectedMimeType = RENDER_EXECUTION_OUTPUT_BY_KIND[executionKind].mimeType
  if (outputMimeType !== null && outputMimeType !== expectedMimeType) {
    return NextResponse.json(
      { error: `outputMimeType must be ${expectedMimeType} for a ${executionKind} execution.`, code: 'OUTPUT_MIME_MISMATCH' },
      { status: 400 },
    )
  }

  // ── 6B. Output target authority (Phase 2I-B3, Task 1/2/8) ─────────────────
  // The worker-submitted bucket/path are a CONFIRMATION, never trusted
  // input: the only value ever written is this execution's own
  // server-derived deterministic target. Any other value — a different
  // bucket, a different user's prefix, a different execution's key — is
  // rejected outright, closed before any DB write happens.
  if (
    !isExpectedScratchOutputTarget({
      userId: execution.user_id,
      executionId: execution.id,
      bucket: outputBucket,
      key: outputStoragePath,
      kind: executionKind,
    })
  ) {
    return NextResponse.json(
      {
        error: 'outputBucket/outputStoragePath do not match this execution\'s authoritative scratch target.',
        code: 'OUTPUT_TARGET_MISMATCH',
      },
      { status: 400 },
    )
  }

  // ── 7. Record completion atomically ───────────────────────────────────────
  // Written from the server-derived target (identical value at this point,
  // since §6B already required an exact match) rather than re-trusting the
  // request body a second time. `.eq('attempt', attempt)` closes the TOCTOU
  // gap between the §6A read and this write — even if a reclaim lands in
  // between, zero rows match and this becomes a no-op update (Task 10).
  const { data: updatedRows, error: updateError } = await db
    .from('render_executions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_bucket: outputBucket,
      output_storage_path: outputStoragePath,
      output_size_bytes: outputSizeBytes,
      output_duration_ms: outputDurationMs,
      output_mime_type: expectedMimeType.slice(0, MAX_MIME_LENGTH),
      ...(outputWidth ? { output_width: outputWidth } : {}),
      ...(outputHeight ? { output_height: outputHeight } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'claimed') // atomicity guard
    .eq('attempt', attempt) // stale-attempt fencing (Phase 2I-B4.1)
    .select('id')

  if (updateError) {
    console.error('[render-executions/[id]/complete] update error:', updateError)
    return NextResponse.json(
      { error: 'Failed to record execution completion.', code: 'COMPLETE_RECORD_FAILED' },
      { status: 500 },
    )
  }

  // Zero rows matched: the row changed (status and/or attempt) between the
  // §5/§6A read and this write — a concurrent reclaim or completion won the
  // race. Report the same conflict the read-time check would have, rather
  // than a misleading 200.
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      {
        error: 'This claim attempt is no longer current for this execution.',
        code: 'STALE_ATTEMPT',
      },
      { status: 409 },
    )
  }

  return NextResponse.json({
    recorded: true,
    executionId: id,
    status: 'completed',
    outputBucket,
    outputStoragePath,
    outputSizeBytes,
    outputDurationMs,
  })
}
