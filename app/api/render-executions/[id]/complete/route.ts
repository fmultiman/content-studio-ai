/**
 * POST /api/render-executions/[id]/complete
 *
 * Phase 2I-B2 — worker-facing completion endpoint.
 *
 * AUTHENTICATION: worker secret only.
 *
 * CONTRACT (per PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §11/§12):
 *
 *   completed = render succeeded
 *             + MinIO scratch upload succeeded
 *             + authoritative scratch object exists
 *             + execution row contains verified output locator/metadata
 *
 * B3 DEFERMENT:
 * The route contract is implemented here (validated, tested, ready) but
 * the worker MUST NOT call it in B2 after a local-only render. A locally
 * rendered MP4 in /tmp is NOT a completed execution. The route enforces
 * this by requiring real output metadata (outputBucket, outputStoragePath,
 * outputSizeBytes, outputDurationMs) — omitting them returns 400.
 *
 * The B2 worker coordination code keeps successful local renders in a
 * "locally rendered, not yet uploaded" state and does NOT call this route.
 * B3 will add the MinIO upload step that precedes calling complete.
 *
 * TRANSITION: claimed → completed.
 * Any other current status is rejected (409).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'

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

  // All output metadata fields are required — a local-only render cannot
  // supply them, which is exactly the guard that enforces B3 sequencing.
  const outputBucket = typeof body.outputBucket === 'string' ? body.outputBucket.trim() : null
  const outputStoragePath = typeof body.outputStoragePath === 'string' ? body.outputStoragePath.trim() : null
  const outputSizeBytes = typeof body.outputSizeBytes === 'number' ? body.outputSizeBytes : null
  const outputDurationMs = typeof body.outputDurationMs === 'number' ? body.outputDurationMs : null
  const outputMimeType = typeof body.outputMimeType === 'string' ? body.outputMimeType.trim() : 'video/mp4'

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
    .select('id, status')
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

  // ── 7. Record completion atomically ───────────────────────────────────────
  const { error: updateError } = await db
    .from('render_executions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      output_bucket: outputBucket,
      output_storage_path: outputStoragePath,
      output_size_bytes: outputSizeBytes,
      output_duration_ms: outputDurationMs,
      output_mime_type: outputMimeType.slice(0, MAX_MIME_LENGTH),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'claimed') // atomicity guard

  if (updateError) {
    console.error('[render-executions/[id]/complete] update error:', updateError)
    return NextResponse.json(
      { error: 'Failed to record execution completion.', code: 'COMPLETE_RECORD_FAILED' },
      { status: 500 },
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
