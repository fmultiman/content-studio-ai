/**
 * Phase 2I-B4.1 — stale-attempt fencing tests.
 *
 * docs/productization/creative-rendering/PHASE_2I_B4_LEASE_RECOVERY_AUDIT.md
 * proved /complete and /fail previously authorized any request bearing the
 * shared worker secret plus status='claimed' — never checking WHICH claim
 * attempt was calling. This file proves the fix two ways, matching this
 * repo's existing no-live-DB test convention:
 *
 *   1. A faithful in-memory simulation of the exact WHERE-clause semantics
 *      both routes now use (id match AND status='claimed' AND attempt
 *      match) — run through every scenario the audit/implementation
 *      missions specified (same/different worker ID, lease-expired-without-
 *      reclaim, reclaim, TOCTOU).
 *   2. Static wiring proofs (matching complete-route-output-authority.test.ts's
 *      established pattern) confirming the REAL route source actually reads
 *      `attempt`, compares it, and includes it in the UPDATE predicate —
 *      not just that a hypothetical predicate would be correct.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const COMPLETE_ROUTE_PATH = path.resolve(here, '../../../app/api/render-executions/[id]/complete/route.ts')
const FAIL_ROUTE_PATH = path.resolve(here, '../../../app/api/render-executions/[id]/fail/route.ts')
const COORDINATOR_PATH = path.resolve(here, '../../../infra/render-worker-runtime/coordinator.mjs')

// ── In-memory row model, faithful to the real SQL/Supabase semantics ────────

type Row = { id: string; status: 'queued' | 'claimed' | 'completed' | 'failed'; attempt: number; claimedBy: string | null }

/** Mirrors claim_next_render_execution's reclaim effect on a 'claimed' row. */
function reclaim(row: Row, workerId: string): Row {
  return { ...row, status: 'claimed', attempt: row.attempt + 1, claimedBy: workerId }
}

/**
 * Mirrors the REAL route's exact three-part UPDATE predicate:
 *   WHERE id = :id AND status = 'claimed' AND attempt = :attempt
 * Returns the new row on a match (>=1 row "affected"), or null (0 rows
 * affected — exactly what the real Supabase `.update(...).select('id')`
 * returns as an empty array) on no match.
 */
function attemptMutation(
  row: Row,
  request: { id: string; attempt: number },
  nextStatus: 'completed' | 'failed',
): Row | null {
  if (row.id !== request.id) return null
  if (row.status !== 'claimed') return null
  if (row.attempt !== request.attempt) return null
  return { ...row, status: nextStatus }
}

const EXEC_ID = 'exec-0001'

describe('stale-attempt fencing — same worker ID (Task 6)', () => {
  it('attempt 1 complete is rejected, attempt 2 complete is accepted, when claimed_by never changes', () => {
    const STABLE_ID = 'vps-render-worker-01'
    let row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: STABLE_ID }

    // Stale reclaim by the SAME worker ID (e.g. a process restart).
    row = reclaim(row, STABLE_ID)
    expect(row.attempt).toBe(2)
    expect(row.claimedBy).toBe(STABLE_ID)

    // Attempt 1's stale complete request (echoing the OLD attempt value).
    const staleResult = attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'completed')
    expect(staleResult).toBeNull() // rejected — would map to 409 STALE_ATTEMPT

    // Attempt 1's stale fail request — also rejected.
    const staleFail = attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'failed')
    expect(staleFail).toBeNull()

    // Attempt 2's current complete request succeeds.
    const currentResult = attemptMutation(row, { id: EXEC_ID, attempt: 2 }, 'completed')
    expect(currentResult).not.toBeNull()
    expect(currentResult?.status).toBe('completed')
  })
})

describe('stale-attempt fencing — different worker ID (Task 7)', () => {
  it('correctness derives from attempt, not from worker identity', () => {
    let row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'worker-A' }
    row = reclaim(row, 'worker-B')
    expect(row.claimedBy).toBe('worker-B')

    // worker-A's stale attempt-1 mutation is rejected purely because
    // attempt no longer matches — claimed_by is never even consulted.
    expect(attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'completed')).toBeNull()
    expect(attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'failed')).toBeNull()

    // worker-B's current attempt succeeds.
    expect(attemptMutation(row, { id: EXEC_ID, attempt: 2 }, 'completed')?.status).toBe('completed')
  })
})

describe('lease expired but NOT reclaimed — no wall-clock check (Task 8)', () => {
  it('a legitimately slow (>300s) attempt 1 completion is still accepted when nothing reclaimed it', () => {
    // Nominal lease expiry is irrelevant here — no reclaim() call happens,
    // so attempt stays 1. This models B0's no-heartbeat contract: only an
    // ACTUAL reclaim (attempt increment) invalidates a prior attempt.
    const row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'vps-render-worker-01' }
    const result = attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'completed')
    expect(result).not.toBeNull()
    expect(result?.status).toBe('completed')
  })

  it('the same holds for a slow fail report', () => {
    const row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'vps-render-worker-01' }
    const result = attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'failed')
    expect(result).not.toBeNull()
  })
})

describe('reclaim produces no duplicate row (Task 9)', () => {
  it('reclaim mutates the SAME row id, never creates a second one', () => {
    const original: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'worker-A' }
    const reclaimed = reclaim(original, 'worker-B')
    expect(reclaimed.id).toBe(original.id) // same row
    expect(reclaimed.attempt).toBe(original.attempt + 1)
  })

  it('after reclaim, only the current attempt can transition the row to a terminal state', () => {
    let row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'worker-A' }
    row = reclaim(row, 'worker-B')
    const completed = attemptMutation(row, { id: EXEC_ID, attempt: 2 }, 'completed')
    expect(completed?.status).toBe('completed')
    // Once terminal, even the CURRENT attempt cannot mutate it again
    // (status is no longer 'claimed') — proves terminal states stay terminal.
    expect(attemptMutation(completed!, { id: EXEC_ID, attempt: 2 }, 'failed')).toBeNull()
  })
})

describe('TOCTOU: the UPDATE predicate itself enforces attempt, not just an app-level read (Task 10)', () => {
  it('a reclaim landing between read-time and write-time still results in zero rows matched', () => {
    // Simulates: attempt-1 worker reads the row (sees attempt=1, status='claimed'),
    // THEN a reclaim happens (attempt -> 2) BEFORE attempt-1's UPDATE runs.
    let row: Row = { id: EXEC_ID, status: 'claimed', attempt: 1, claimedBy: 'worker-A' }
    const readSnapshot = { ...row } // what attempt-1 "saw"
    void readSnapshot

    row = reclaim(row, 'worker-B') // races in between read and write

    // attempt-1's UPDATE, issued against the row's CURRENT state (as the
    // real UPDATE ... WHERE ... always does, not against a stale snapshot),
    // still finds attempt=2 now — zero rows match attempt=1.
    const staleUpdateResult = attemptMutation(row, { id: EXEC_ID, attempt: 1 }, 'completed')
    expect(staleUpdateResult).toBeNull()
  })
})

// ── Static wiring proofs — the REAL route source, not a reimplementation ────

describe('complete route — attempt fencing wiring', () => {
  const source = readFileSync(COMPLETE_ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n')

  it('selects attempt from the execution row', () => {
    expect(source).toMatch(/select\(['"]id, user_id, status, attempt['"]\)/)
  })

  it('requires attempt in the request body (MISSING_ATTEMPT)', () => {
    expect(source).toContain('MISSING_ATTEMPT')
    expect(source).toMatch(/body\.attempt/)
  })

  it('rejects a mismatched attempt with STALE_ATTEMPT before the DB write', () => {
    const checkIndex = source.indexOf('execution.attempt !== attempt')
    const updateIndex = source.indexOf(".from('render_executions')\n    .update({")
    expect(checkIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(checkIndex).toBeLessThan(updateIndex)
    expect(source).toContain('STALE_ATTEMPT')
  })

  it('includes attempt in the UPDATE WHERE predicate (TOCTOU closure)', () => {
    expect(source).toContain(".eq('attempt', attempt)")
  })

  it('does NOT add a lease_expires_at check to the UPDATE predicate', () => {
    const updateBlock = source.slice(source.indexOf(".from('render_executions')\n    .update({"))
    expect(updateBlock).not.toMatch(/\.(eq|gte|gt)\(['"]lease_expires_at['"]/)
  })

  it('still preserves the OUTPUT_TARGET_MISMATCH check from B3', () => {
    expect(source).toContain('OUTPUT_TARGET_MISMATCH')
    expect(source).toContain('isExpectedScratchOutputTarget')
  })

  it('still preserves the claimed -> completed transition guard from B2', () => {
    expect(source).toContain('INVALID_STATUS_TRANSITION')
  })

  it('returns 409 for STALE_ATTEMPT, not 401/404/500', () => {
    const matches = [...source.matchAll(/STALE_ATTEMPT[\s\S]{0,80}status: (\d+)/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) expect(m[1]).toBe('409')
  })
})

describe('fail route — attempt fencing wiring', () => {
  const source = readFileSync(FAIL_ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n')

  it('requires attempt in the request body (MISSING_ATTEMPT)', () => {
    expect(source).toContain('MISSING_ATTEMPT')
    expect(source).toMatch(/body\.attempt/)
  })

  it('rejects a mismatched attempt with STALE_ATTEMPT before the DB write', () => {
    const checkIndex = source.indexOf('execution.attempt !== attempt')
    const updateIndex = source.indexOf(".from('render_executions')\n    .update({")
    expect(checkIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(checkIndex).toBeLessThan(updateIndex)
    expect(source).toContain('STALE_ATTEMPT')
  })

  it('includes attempt in the UPDATE WHERE predicate (TOCTOU closure)', () => {
    expect(source).toContain(".eq('attempt', attempt)")
  })

  it('does NOT add a lease_expires_at check to the UPDATE predicate', () => {
    const updateBlock = source.slice(source.indexOf(".from('render_executions')\n    .update({"))
    expect(updateBlock).not.toMatch(/\.(eq|gte|gt)\(['"]lease_expires_at['"]/)
  })

  it('still preserves bounded/sanitized error fields from B2', () => {
    expect(source).toContain('MAX_ERROR_MESSAGE_LENGTH')
    expect(source).toContain('MAX_ERROR_DETAIL_LENGTH')
  })

  it('returns 409 for STALE_ATTEMPT, not 401/404/500', () => {
    const matches = [...source.matchAll(/STALE_ATTEMPT[\s\S]{0,80}status: (\d+)/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) expect(m[1]).toBe('409')
  })
})

describe('coordinator — worker echoes the claim attempt on every mutation call (Task 3/4)', () => {
  const source = readFileSync(COORDINATOR_PATH, 'utf8').replace(/\r\n/g, '\n')

  it('reportFail forwards attempt in its request body', () => {
    expect(source).toContain('body: JSON.stringify({ attempt: claimAttempt, errorCode, errorMessage, errorDetail })')
  })

  it('reportCompleteWithRetry forwards attempt in its request body', () => {
    expect(source).toContain('body: JSON.stringify({ attempt: claimAttempt, ...outputMeta })')
  })

  it('every reportFail CALL SITE (not the function declaration) passes the claim-derived attempt', () => {
    // "await reportFail(...)" only matches actual call sites — the function
    // declaration itself ("async function reportFail(...)") never has an
    // `await` prefix, so it is excluded by construction.
    const callSites = [...source.matchAll(/await reportFail\(executionId, ([^,]+),/g)].map((m) => m[1].trim())
    expect(callSites.length).toBeGreaterThanOrEqual(2) // render-failure path + upload-failure path
    for (const arg of callSites) expect(arg).toBe('attempt')
  })

  it('the reportCompleteWithRetry CALL SITE passes the claim-derived attempt', () => {
    const callSites = [...source.matchAll(/await reportCompleteWithRetry\(executionId, ([^,]+),/g)].map((m) => m[1].trim())
    expect(callSites.length).toBe(1)
    expect(callSites[0]).toBe('attempt')
  })

  it('attempt is destructured directly from the claim response, never a global mutable fallback', () => {
    expect(source).toContain('const { executionId, userId, attempt, resolvedInput, warnings } = claim')
  })
})
