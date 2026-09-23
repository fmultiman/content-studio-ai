/**
 * Phase 2I — Production Video Operational Closure.
 *
 * Static-source proofs for the resident consumer's lifecycle contract. The
 * coordinator's own control-plane calls run on a separate bundled VPS
 * runtime vitest never executes (same constraint documented in
 * worker-secret-not-logged.test.ts), so — following this repo's existing
 * convention for that boundary — these tests scan the actual shipped source
 * files for the specific invariants the production smoke exposed, rather
 * than exercising real child processes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const WORKER_DIR = path.resolve(here, '../../../infra/render-worker-runtime')

const entrypointSource = readFileSync(path.join(WORKER_DIR, 'entrypoint.mjs'), 'utf8')
const coordinatorSource = readFileSync(path.join(WORKER_DIR, 'coordinator.mjs'), 'utf8')
const exportSource = readFileSync(path.join(WORKER_DIR, 'export.mjs'), 'utf8')
const serverSource = readFileSync(path.join(WORKER_DIR, 'server.mjs'), 'utf8')

describe('resident loop starts automatically (no manual invocation required)', () => {
  it('entrypoint spawns the renderer (server.mjs)', () => {
    expect(entrypointSource).toMatch(/spawnChild\(\s*'renderer'\s*,\s*rendererScript/)
    expect(entrypointSource).toMatch(/path\.join\(here, 'server\.mjs'\)/)
  })

  it('entrypoint spawns the coordinator with the continuous loop forced on', () => {
    expect(entrypointSource).toMatch(/spawnChild\(\s*'coordinator'\s*,\s*coordinatorScript/)
    expect(entrypointSource).toMatch(/buildCoordinatorEnv\(process\.env\)/)
  })

  it('buildCoordinatorEnv forces CONTENT_STUDIO_RENDER_LOOP=1 (verified in resident-supervisor-policy.test.ts)', () => {
    // Cross-reference: entrypoint.mjs delegates the actual env decision to
    // the pure, unit-tested helper rather than re-deciding it inline.
    expect(entrypointSource).not.toMatch(/CONTENT_STUDIO_RENDER_LOOP:\s*['"]1['"]/)
    expect(entrypointSource).toMatch(/buildCoordinatorEnv/)
  })

  it('export.mjs bundles entrypoint.mjs into a deployable artifact', () => {
    expect(exportSource).toMatch(/bundleEntrypoint/)
    expect(exportSource).toMatch(/entrypoint\.bundle\.cjs/)
  })

  it('export.mjs instructs the VPS service command to run the resident entrypoint, not a manual per-process command', () => {
    expect(exportSource).toMatch(/node entrypoint\.bundle\.cjs/)
    expect(exportSource).toMatch(/starts \+ supervises BOTH server\.mjs and coordinator\.bundle\.cjs automatically/)
  })
})

describe('idle loop does not busy-spin (Task A3)', () => {
  it('entrypoint bounds its renderer health wait using the shared policy helpers, not a tight loop', () => {
    expect(entrypointSource).toMatch(/shouldKeepWaitingForHealth/)
    expect(entrypointSource).toMatch(/healthWaitDelayMs/)
    expect(entrypointSource).toMatch(/await sleep\(healthWaitDelayMs\(\)\)/)
  })

  it('coordinator sleeps between cycles rather than spinning (pre-existing, unchanged)', () => {
    expect(coordinatorSource).toMatch(/await sleep\(waitMs\)/)
  })
})

describe('sequential processing — no uncontrolled parallel renders (Task A2)', () => {
  it('coordinator\'s main loop awaits each cycle fully before starting the next', () => {
    // A single `await runOneCycle()` inside the while loop, not
    // `Promise.all`/`.then` fan-out — one claim, one render, in flight at a
    // time, matching the documented single-worker-VPS concurrency model.
    expect(coordinatorSource).toMatch(/const result = await runOneCycle\(\)/)
    expect(coordinatorSource).not.toMatch(/Promise\.all/)
  })

  it('entrypoint never spawns more than one coordinator process', () => {
    const coordinatorSpawnCalls = entrypointSource.match(/spawnChild\(\s*'coordinator'/g) ?? []
    expect(coordinatorSpawnCalls.length).toBe(1)
  })
})

describe('terminal outcomes return to polling; failures do not kill the loop', () => {
  it('completed and failed cycles both fall through to the same wait/continue path', () => {
    expect(coordinatorSource).toMatch(/result === 'completed' \|\| result === 'failed'/)
    expect(coordinatorSource).toMatch(/while \(running\)/)
  })

  it('a render/upload/complete failure returns a status string rather than throwing', () => {
    expect(coordinatorSource).toMatch(/return 'failed'/)
  })
})

describe('graceful shutdown (Task A3)', () => {
  it('entrypoint handles SIGTERM and SIGINT', () => {
    expect(entrypointSource).toMatch(/process\.on\('SIGTERM', \(\) => shutdown\('SIGTERM'\)\)/)
    expect(entrypointSource).toMatch(/process\.on\('SIGINT', \(\) => shutdown\('SIGINT'\)\)/)
  })

  it('shutdown forwards the signal to children and does not restart them afterwards', () => {
    expect(entrypointSource).toMatch(/entry\.child\.kill\(signal\)/)
    expect(entrypointSource).toMatch(/shouldRestartChild\(\{ shuttingDown \}\)/)
  })

  it('coordinator itself still handles SIGTERM/SIGINT independently (pre-existing, unchanged)', () => {
    expect(coordinatorSource).toMatch(/process\.on\('SIGTERM'/)
    expect(coordinatorSource).toMatch(/process\.on\('SIGINT'/)
  })
})

describe('fatal startup errors are never hidden (Task A3)', () => {
  it('entrypoint exits non-zero if the renderer never becomes healthy', () => {
    expect(entrypointSource).toMatch(/process\.exit\(1\)/)
    expect(entrypointSource).toMatch(/renderer never became healthy/)
  })

  it('every child exit is logged via describeChildExit, never swallowed', () => {
    expect(entrypointSource).toMatch(/console\.error\(describeChildExit\(name, \{ code, signal \}, failures\)\)/)
  })
})

describe('health endpoint stays meaningful for the whole resident service (Task A3)', () => {
  it('server.mjs reports coordinator liveness on /health', () => {
    expect(serverSource).toMatch(/req\.url === '\/health'/)
    expect(serverSource).toMatch(/readCoordinatorStatus/)
    expect(serverSource).toMatch(/buildHealthPayload/)
  })
})

describe('stale-attempt / lease semantics untouched (Task A2)', () => {
  it('the resident-consumer change touches no claim/complete/fail authority logic', () => {
    for (const forbidden of ['claim_next_render_execution', 'FOR UPDATE SKIP LOCKED', 'lease_expires_at']) {
      expect(entrypointSource.includes(forbidden)).toBe(false)
    }
  })
})
