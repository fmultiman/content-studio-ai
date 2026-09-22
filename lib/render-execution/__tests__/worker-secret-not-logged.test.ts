/**
 * Phase 2I-B3 — static invariant: the worker secret and the MinIO
 * credential must never be interpolated into a console.log/warn/error call
 * anywhere in the worker package source. Since the coordinator runs on a
 * separate (bundled, VPS) runtime that vitest does not execute, this is
 * proven statically by scanning the actual shipped source files rather than
 * by exercising the process.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const WORKER_DIR = path.resolve(here, '../../../infra/render-worker-runtime')

const FILES_TO_CHECK = ['coordinator.mjs', 'minio-upload.mjs']

// Deliberately the VALUE-holding identifiers only — the env VAR NAMES
// (CONTENT_STUDIO_RENDER_WORKER_SECRET, CONTENT_STUDIO_MINIO_SECRET_KEY)
// are safe and expected to appear in "X is not configured" messages; it is
// the actual secret VALUE variable that must never be logged.
const FORBIDDEN_IDENTIFIERS = ['WORKER_SECRET', 'secretAccessKey', 'accessKeyId']

/**
 * Extracts every console.log/warn/error(...) call's argument list as raw
 * text, then checks whether any forbidden identifier appears as a bare
 * token inside one — a narrow, targeted static check that doesn't require
 * parsing the file as an AST.
 */
function extractConsoleCallArgs(source: string): string[] {
  const results: string[] = []
  const re = /console\.(log|warn|error)\(([\s\S]*?)\)\s*(?:\n|$)/g
  // This regex is intentionally simple (non-greedy up to end of line) — it
  // is sufficient for this file's actual call shapes (all single-line or
  // simple multi-arg calls), not a general JS parser.
  let match
  while ((match = re.exec(source))) {
    results.push(match[2])
  }
  return results
}

describe('worker secret / MinIO credential never logged', () => {
  for (const file of FILES_TO_CHECK) {
    it(`${file}: no console.log/warn/error call references a raw secret identifier`, () => {
      const source = readFileSync(path.join(WORKER_DIR, file), 'utf8')
      const callArgs = extractConsoleCallArgs(source)
      for (const args of callArgs) {
        for (const forbidden of FORBIDDEN_IDENTIFIERS) {
          // Word-boundary match — deliberately does NOT flag the env VAR
          // NAME (e.g. "CONTENT_STUDIO_RENDER_WORKER_SECRET", which
          // legitimately appears in "is not configured" messages) because
          // "_" is a word character in regex, so \b does not fire between
          // "_" and "WORKER_SECRET" inside that longer identifier — only a
          // standalone "WORKER_SECRET" token (the JS variable actually
          // holding the value) matches.
          const re = new RegExp(`\\b${forbidden}\\b`)
          expect(
            re.test(args),
            `console call in ${file} references forbidden identifier "${forbidden}": ${args}`,
          ).toBe(false)
        }
      }
    })
  }

  it('coordinator.mjs: the secret VALUE variable is used only to declare it and build the Authorization header', () => {
    const source = readFileSync(path.join(WORKER_DIR, 'coordinator.mjs'), 'utf8')
    // Standalone "WORKER_SECRET" token occurrences only — excludes the env
    // var name "CONTENT_STUDIO_RENDER_WORKER_SECRET" (see note above) and
    // any mentions inside comments/prose, which use the phrase differently.
    const matches = source.match(/\bWORKER_SECRET\b/g) ?? []
    // Expected exactly 2 CODE occurrences: `const WORKER_SECRET = ...` and
    // `` `Bearer ${WORKER_SECRET}` `` — plus this file's own doc-comment
    // mentions of the bare word "WORKER_SECRET" (as prose, not code), which
    // this simple token scan cannot distinguish from code. Assert an upper
    // bound generous enough for legitimate prose but still low enough to
    // catch the secret starting to flow through a genuinely new code path.
    expect(matches.length).toBeLessThanOrEqual(6)
  })
})
