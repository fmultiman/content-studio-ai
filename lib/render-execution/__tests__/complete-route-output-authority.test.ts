/**
 * Phase 2I-B3 — complete route hardening wiring proof (Task 1/2/8).
 *
 * The actual decision logic (what counts as this execution's ONE valid
 * output target) is already exhaustively tested against the real,
 * imported, shared helper in scratch-output-target.test.ts — arbitrary
 * bucket, cross-user, cross-execution, and path-traversal targets are all
 * proven rejected there. Exercising the route handler itself end-to-end
 * would require a live Supabase connection (the route's early steps depend
 * on a real DB round-trip before reaching the output-target check), which
 * no test in this repository does — the existing convention
 * (worker-coordination-contracts.test.ts) is a static/wiring proof for
 * exactly this reason.
 *
 * This test closes the gap between "the helper is correct" and "the route
 * actually calls it" by statically confirming the route source imports and
 * invokes `isExpectedScratchOutputTarget` (not a re-implementation, not a
 * bypassed check) before ever reaching the DB write.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROUTE_PATH = path.resolve(
  here,
  '../../../app/api/render-executions/[id]/complete/route.ts',
)

describe('complete route — output target authority wiring', () => {
  // Normalize CRLF to LF: this file's on-disk line endings depend on the
  // checkout's core.autocrlf state, but the literal `\n`-based searches
  // below assert on logical adjacency, not on a specific line-ending byte.
  const source = readFileSync(ROUTE_PATH, 'utf8').replace(/\r\n/g, '\n')

  it('imports the shared, tested isExpectedScratchOutputTarget helper', () => {
    expect(source).toContain("import { isExpectedScratchOutputTarget } from '@/lib/render-execution/scratch-output-target'")
  })

  it('calls isExpectedScratchOutputTarget before the DB update that records completion', () => {
    const checkIndex = source.indexOf('isExpectedScratchOutputTarget({')
    const updateIndex = source.indexOf(".from('render_executions')\n    .update({")
    expect(checkIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(checkIndex).toBeLessThan(updateIndex)
  })

  it('rejects with a 400 + OUTPUT_TARGET_MISMATCH code when the check fails', () => {
    expect(source).toContain('OUTPUT_TARGET_MISMATCH')
    expect(source).toMatch(/OUTPUT_TARGET_MISMATCH[\s\S]{0,80}status: 400/)
  })

  it('derives the check from the execution row\'s own user_id, not the request body', () => {
    expect(source).toContain('userId: execution.user_id')
  })

  it('still requires the transition to be claimed -> completed (unchanged from B2)', () => {
    expect(source).toContain("execution.status !== 'claimed'")
  })
})
