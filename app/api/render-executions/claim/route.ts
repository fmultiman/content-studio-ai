/**
 * POST /api/render-executions/claim
 *
 * Phase 2I-B2 — worker-facing claim endpoint.
 *
 * AUTHENTICATION: worker secret (CONTENT_STUDIO_RENDER_WORKER_SECRET via
 * Authorization: Bearer). No browser/user session is accepted.
 *
 * CONTRACT (per PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §16):
 * 1. Authenticate worker secret — fail closed on any error.
 * 2. Call claim_next_render_execution(worker_id, lease_seconds) via service-role.
 * 3. If no eligible row: return { claimed: false }.
 * 4. If row is claimed:
 *    a. Load all active LibraryFiles scoped to the execution's project.
 *    b. Resolve runtime input (fresh presigned URLs from frozen manifest).
 *    c. If resolution fails: immediately record the row as failed (Task 12)
 *       so it is not silently left claimed until lease expiry.
 *    d. Return execution metadata + ResolvedTimelineInput to the worker.
 *
 * SECURITY (per B0 §9/§10/PHASE_2I_B1.1):
 * - Service-role key stays in Vercel — worker never holds it.
 * - LibraryFile storage paths come from DB (ownership-scoped), not from the
 *   browser-authored snapshot — no arbitrary URL enters the presign call.
 * - The snapshot's asset refs are UUIDs; real paths are loaded from the DB
 *   before being passed to the presigner. SSRF surface is the same as the
 *   existing product-facing presign path.
 * - Worker identity from X-Worker-Id header is used for claimed_by logging
 *   only, not for access control (secret is the gate).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'
import { resolveRuntimeInput } from '@/lib/render-execution/resolve-runtime-input'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { withTrustedStoragePaths } from '@/lib/storage/library-path'
import type { LibraryFile } from '@/lib/types'

const DEFAULT_LEASE_SECONDS = 300

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // ── 1. Worker authentication ─────────────────────────────────────────────
  const auth = verifyWorkerAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status })
  }

  // ── 2. Service-role DB client ─────────────────────────────────────────────
  const db = createWorkerApiDbClient()
  if (!db) {
    console.error('[render-executions/claim] SUPABASE_SERVICE_ROLE_KEY is not configured')
    return NextResponse.json(
      { error: 'Render service is unavailable.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' },
      { status: 503 },
    )
  }

  // Determine worker identity for claimed_by and optional custom lease.
  const workerId =
    auth.workerId ??
    process.env.CONTENT_STUDIO_RENDER_WORKER_ID ??
    'content-studio-render-worker-default'

  let leaseSeconds = DEFAULT_LEASE_SECONDS
  try {
    const body = await request.json().catch(() => null)
    if (body && typeof body.leaseSeconds === 'number' && body.leaseSeconds > 0) {
      leaseSeconds = Math.min(Math.max(body.leaseSeconds, 60), 1800) // 1–30 min
    }
  } catch {
    // ignore — lease is optional
  }

  // ── 3. Atomic claim via Postgres function ──────────────────────────────────
  const { data: claimedRow, error: claimError } = await db.rpc('claim_next_render_execution', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  })

  if (claimError) {
    console.error('[render-executions/claim] claim RPC error:', claimError)
    return NextResponse.json(
      { error: 'Failed to claim execution.', code: 'CLAIM_RPC_FAILED' },
      { status: 500 },
    )
  }

  // The function returns the full row; id IS NULL when nothing was eligible.
  if (!claimedRow || !claimedRow.id) {
    return NextResponse.json({ claimed: false, message: 'No eligible execution found.' })
  }

  const execution = claimedRow as {
    id: string
    user_id: string
    project_id: string
    // Static Render Worker V1 (migration 034): discriminates the payload the
    // worker receives. Rows created before 034 default to 'video'.
    kind?: string | null
    video_draft_id: string | null
    channel_piece_id?: string | null
    status: string
    attempt: number
    claimed_by: string | null
    lease_expires_at: string | null
    input_schema_version: string
    input_snapshot: unknown
  }

  // ── 4a. Load LibraryFiles scoped to the execution's project ───────────────
  // These are loaded from the DB with project-scoped ownership — no path
  // comes from the browser-authored snapshot. This is the SSRF boundary.
  const { data: rawLibraryFiles, error: lfError } = await db
    .from('library_files')
    .select('id, user_id, project_id, name, storage_path, mime_type, kind, file_size, deleted_at, created_at, updated_at')
    .eq('project_id', execution.project_id)
    .eq('user_id', execution.user_id)
    .is('deleted_at', null)

  if (lfError) {
    console.error('[render-executions/claim] library_files load error:', lfError)
    // Record as failed — resolution is already compromised.
    await recordClaimTimeFail(db, execution.id, 'LIBRARY_FILE_LOAD_FAILED', 'Failed to load project LibraryFiles at claim time.')
    return NextResponse.json(
      { error: 'Failed to load project assets.', code: 'LIBRARY_FILE_LOAD_FAILED' },
      { status: 500 },
    )
  }

  // LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1: a row's storage_path is a claim, not proof. A row whose
  // key is not provably the EXECUTION OWNER's own Library key loses its path here, so the resolvers
  // below treat it as a missing file and fail closed instead of presigning another tenant's object.
  const libraryFiles = withTrustedStoragePaths((rawLibraryFiles ?? []) as Array<{ user_id: string; storage_path: string | null }>)

  const kind = execution.kind ?? 'video'
  console.log(`[render-executions/claim] claimed ${execution.id} kind=${kind} attempt=${execution.attempt}`)

  // ── 4b-static. Static still: frozen StaticRenderManifest snapshot ─────────
  // Never translated into a TimelineManifest — a separate contract rendered
  // by the worker's renderStill path. Same SSRF boundary as video: only
  // DB-loaded, project-scoped LibraryFiles are ever presigned.
  if (kind === 'static_still') {
    const staticResolution = await resolveStaticRuntimeInput({
      rawSnapshot: execution.input_snapshot,
      libraryFiles: (libraryFiles ?? []) as LibraryFile[],
      createPresignedReadUrl: (path: string) => createPresignedReadUrl(path),
    })
    if (!staticResolution.ok) {
      console.error('[render-executions/claim] static resolution failed:', execution.id, staticResolution.code, staticResolution.message)
      await recordClaimTimeFail(db, execution.id, staticResolution.code, staticResolution.message)
      return NextResponse.json({ error: staticResolution.message, code: staticResolution.code }, { status: 422 })
    }
    return NextResponse.json({
      claimed: true,
      kind: 'static_still',
      executionId: execution.id,
      userId: execution.user_id,
      attempt: execution.attempt,
      leaseExpiresAt: execution.lease_expires_at,
      warnings: staticResolution.warnings,
      staticInput: staticResolution.staticInput,
    })
  }

  if (kind !== 'video') {
    await recordClaimTimeFail(db, execution.id, 'UNSUPPORTED_EXECUTION_KIND', `Unsupported execution kind "${String(kind).slice(0, 40)}".`)
    return NextResponse.json({ error: 'Unsupported execution kind.', code: 'UNSUPPORTED_EXECUTION_KIND' }, { status: 422 })
  }

  // ── 4b. Resolve runtime input from frozen snapshot (video) ────────────────
  const resolution = await resolveRuntimeInput({
    rawSnapshot: execution.input_snapshot,
    libraryFiles: (libraryFiles ?? []) as LibraryFile[],
    createPresignedReadUrl: (path: string) => createPresignedReadUrl(path),
  })

  if (!resolution.ok) {
    console.error('[render-executions/claim] runtime resolution failed:', resolution.code, resolution.message)
    // Task 12: record failure immediately rather than leaving the row claimed
    // until lease expiry — the server already knows the input is invalid.
    await recordClaimTimeFail(db, execution.id, resolution.code, resolution.message)
    return NextResponse.json(
      { error: resolution.message, code: resolution.code },
      { status: 422 },
    )
  }

  // ── 4c. Return worker payload ─────────────────────────────────────────────
  // The resolved input is returned in-memory to the worker; it is never
  // persisted back to input_snapshot or any other column.
  return NextResponse.json({
    claimed: true,
    kind: 'video',
    executionId: execution.id,
    // userId is required by the worker (Phase 2I-B3) to compute the
    // deterministic scratch output target (users/{userId}/renders/scratch/
    // {executionId}/output.mp4, see lib/render-execution/scratch-output-target.ts)
    // — it is not sensitive (an opaque UUID the worker already implicitly
    // operates within the scope of for this one claimed execution).
    userId: execution.user_id,
    attempt: execution.attempt,
    leaseExpiresAt: execution.lease_expires_at,
    warnings: resolution.warnings,
    resolvedInput: resolution.resolvedInput,
  })
}

/**
 * Records a terminal failure for an execution that was just claimed but could
 * not be resolved. Uses service-role direct UPDATE since no UPDATE policy
 * exists for browser roles (this is a server-only path).
 */
async function recordClaimTimeFail(
  db: ReturnType<typeof createWorkerApiDbClient>,
  executionId: string,
  errorCode: string,
  errorMessage: string,
) {
  if (!db) return
  const { error } = await db
    .from('render_executions')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_code: errorCode,
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', executionId)
    .eq('status', 'claimed') // safety: only transition from claimed
  if (error) {
    console.error('[render-executions/claim] failed to record claim-time failure:', error)
  }
}
