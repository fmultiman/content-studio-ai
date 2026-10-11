import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createOperatorPrivilegedClient } from '@/lib/credentials/api-credential-store'
import { MAX_SWEEP_BATCH_SIZE, MAX_SWEEP_BATCHES, UUID_PATTERN, runCredentialSweep, type SweepReport } from '@/lib/credentials/credential-backfill-sweep'
import { isProviderCredentialUnavailableError } from '@/lib/credentials/credential-errors'
import { classifyExecutionEnvironment } from '@/lib/providers/execution-policy'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — OPERATOR-ONLY credential backfill sweep / migration-completeness report.
//
// There is no user session here and the route is NOT linked from the app, NOT scheduled and NOT called by any deployment step.
// It does nothing unless the operator has deliberately provisioned a dedicated shared secret:
//
//     POST /api/internal/credential-backfill
//     Authorization: Bearer <CREDENTIAL_BACKFILL_OPERATOR_SECRET>
//     { "dryRun": true, "batchSize": 10, "maxBatches": 1, "cursor": null }
//
//   * the secret is optional and unset by default — without it the route answers 503 and performs nothing (fail closed);
//   * a wrong or missing header is rejected (401) before any database access; only POST exists;
//   * it runs only in a production-class runtime (the shared database must be written with the production BYOK key only);
//   * DRY RUN is the default. Migrating requires BOTH `"dryRun": false` AND `"confirm": "migrate-legacy-credentials"`, and the
//     credential store must be in `dual` mode (otherwise 409);
//   * the body is allow-listed: there is NO owner/user/provider/credential field — owners are enumerated server-side, and any
//     unknown field is rejected (400);
//   * the response is counts only (see SweepReport) plus the resume cursor (the last processed owner id, a UUID): no key, hash,
//     ciphertext or database message.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SECRET_ENV = 'CREDENTIAL_BACKFILL_OPERATOR_SECRET'
const MIN_SECRET_LENGTH = 32
const CONFIRMATION = 'migrate-legacy-credentials'
const ALLOWED_FIELDS = new Set(['dryRun', 'batchSize', 'maxBatches', 'cursor', 'confirm'])

const digest = (value: string) => createHash('sha256').update(value).digest()
const isAuthorized = (header: string | null, secret: string) => !!header && timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
const noStore = { 'Cache-Control': 'no-store' }

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ error, code }, { status, headers: noStore })
}

function integerField(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null
}

export async function POST(request: NextRequest) {
  const secret = process.env[SECRET_ENV]
  if (!secret || secret.length < MIN_SECRET_LENGTH) return fail(503, 'CREDENTIAL_BACKFILL_NOT_CONFIGURED', 'Credential backfill is not configured.')
  if (!isAuthorized(request.headers.get('authorization'), secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })

  const environment = classifyExecutionEnvironment()
  if (environment !== 'production' && environment !== 'test') return fail(403, 'CREDENTIAL_BACKFILL_ENVIRONMENT_NOT_ALLOWED', 'Credential backfill runs only in the production runtime.')

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json().catch(() => ({}))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'INVALID_BODY', 'Invalid request body.')
    body = parsed as Record<string, unknown>
  } catch {
    return fail(400, 'INVALID_BODY', 'Invalid request body.')
  }
  if (Object.keys(body).some((field) => !ALLOWED_FIELDS.has(field))) return fail(400, 'INVALID_BODY', 'Unknown field in request body.')

  const batchSize = integerField(body.batchSize, 1, MAX_SWEEP_BATCH_SIZE)
  const maxBatches = integerField(body.maxBatches, 1, MAX_SWEEP_BATCHES)
  const cursor = body.cursor === undefined || body.cursor === null ? null : typeof body.cursor === 'string' && UUID_PATTERN.test(body.cursor) ? body.cursor : undefined
  if (batchSize === null || maxBatches === null || cursor === undefined) return fail(400, 'INVALID_BODY', 'Invalid batch parameters.')
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return fail(400, 'INVALID_BODY', 'dryRun must be a boolean.')

  const dryRun = body.dryRun !== false
  if (!dryRun && body.confirm !== CONFIRMATION) return fail(400, 'CONFIRMATION_REQUIRED', 'Executing the sweep requires explicit confirmation.')

  let report: SweepReport
  try {
    report = await runCredentialSweep(createOperatorPrivilegedClient(), { dryRun, batchSize, maxBatches, cursor })
  } catch (error) {
    // Class and reason only: never a message, owner, key or query.
    console.error('[credential-backfill] sweep failed:', isProviderCredentialUnavailableError(error) ? error.reason : error instanceof Error ? error.name : 'unknown')
    return fail(isProviderCredentialUnavailableError(error) ? 503 : 500, 'CREDENTIAL_BACKFILL_FAILED', 'Credential backfill failed.')
  }

  const t = report.totals
  console.info(`[credential-backfill] sweep dryRun=${report.dryRun} mode=${report.mode} users=${report.usersScanned} legacyOnly=${t.legacyOnly} migrated=${t.migrated} failed=${t.failed} integrity=${t.integrityErrors} divergent=${t.divergent} done=${report.done} stopped=${report.stopped ?? 'none'}`)
  const status = report.stopped === 'encryption_not_configured' || report.stopped === 'mode_must_be_dual' ? 409 : 200
  return NextResponse.json({ ok: report.stopped === null, report }, { status, headers: noStore })
}
