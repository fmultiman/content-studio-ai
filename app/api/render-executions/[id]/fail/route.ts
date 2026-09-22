/**
 * POST /api/render-executions/[id]/fail
 *
 * Phase 2I-B2 — worker-facing failure reporting endpoint.
 *
 * AUTHENTICATION: worker secret only (no browser/user session).
 *
 * CONTRACT (per PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §13/§14):
 * - Execution must exist and be owned by the expected execution context.
 * - Only valid transition: claimed → failed.
 * - Structured error_code is required.
 * - error_message is bounded (max 500 chars) and sanitized.
 * - error_detail (stack trace / internal detail) max 4000 chars, never
 *   returned to browser GET — internal-only column.
 * - attempt / claimed_by are not re-writable here (set at claim time).
 * - Terminal failure is recorded atomically.
 *
 * RETRYABLE vs TERMINAL (B0 §13):
 * - If attempt < max_attempts: mark failed and the stale-claim reclaim
 *   in claim_next_render_execution will reclaim it on next poll cycle.
 * - If attempt >= max_attempts: mark failed and it stays failed.
 *   (No automatic user notification in this phase — that is 2I-C.)
 * - The worker always reports via this endpoint regardless of attempt count;
 *   the server decides whether to surface the row as permanently failed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_ERROR_DETAIL_LENGTH = 4000
const MAX_ERROR_CODE_LENGTH = 64

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

  // ── 3. Parse body ─────────────────────────────────────────────────────────
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

  // error_code: required, max 64 chars, alphanumeric + underscores
  const rawCode = body.errorCode
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    return NextResponse.json(
      { error: 'errorCode is required.', code: 'MISSING_ERROR_CODE' },
      { status: 400 },
    )
  }
  const errorCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, MAX_ERROR_CODE_LENGTH)

  // error_message: optional, bounded and sanitized
  const errorMessage =
    typeof body.errorMessage === 'string'
      ? body.errorMessage.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
      : null

  // error_detail: optional internal detail (stack trace, etc.) — never returned to browser
  const errorDetail =
    typeof body.errorDetail === 'string'
      ? body.errorDetail.trim().slice(0, MAX_ERROR_DETAIL_LENGTH)
      : null

  // ── 4. Service-role DB client ─────────────────────────────────────────────
  const db = createWorkerApiDbClient()
  if (!db) {
    console.error('[render-executions/[id]/fail] SUPABASE_SERVICE_ROLE_KEY is not configured')
    return NextResponse.json(
      { error: 'Render service is unavailable.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' },
      { status: 503 },
    )
  }

  // ── 5. Load the execution row (service-role, no RLS) ─────────────────────
  const { data: execution, error: fetchError } = await db
    .from('render_executions')
    .select('id, status, attempt, max_attempts')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !execution) {
    return NextResponse.json(
      { error: 'Execution not found.', code: 'EXECUTION_NOT_FOUND' },
      { status: 404 },
    )
  }

  // ── 6. Validate transition: only claimed → failed is allowed ──────────────
  if (execution.status !== 'claimed') {
    return NextResponse.json(
      {
        error: `Cannot transition from "${execution.status}" to "failed". Only claimed executions can be failed.`,
        code: 'INVALID_STATUS_TRANSITION',
        currentStatus: execution.status,
      },
      { status: 409 },
    )
  }

  // ── 7. Record failure atomically ──────────────────────────────────────────
  // Per B0 §4: an explicit fail report is always terminal for this row,
  // regardless of attempt count — it is a worker-reported terminal error,
  // not a lease expiry. Lease-expiry reclaim (a *different* transition,
  // handled entirely inside claim_next_render_execution, never here) is the
  // only path that reopens a row for another attempt. A user-initiated retry
  // after an explicit fail always creates a new row (B0 §4.2), never
  // resurrects this one. `isTerminal` below is a product-facing hint only
  // (whether "Tentar novamente" should read as more/less expected), not a
  // signal that this row becomes reclaimable.
  const isTerminal = execution.attempt >= execution.max_attempts

  const { error: updateError } = await db
    .from('render_executions')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: errorMessage,
      error_detail: errorDetail,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'claimed') // atomicity: only if still claimed

  if (updateError) {
    console.error('[render-executions/[id]/fail] update error:', updateError)
    return NextResponse.json(
      { error: 'Failed to record execution failure.', code: 'FAIL_RECORD_FAILED' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    recorded: true,
    executionId: id,
    status: 'failed',
    isTerminal,
    attempt: execution.attempt,
    maxAttempts: execution.max_attempts,
  })
}
