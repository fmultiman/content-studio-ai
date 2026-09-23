/**
 * Phase 2I — Production Video Operational Closure.
 *
 * Pure decision logic for the render-worker's resident process supervisor
 * (`infra/render-worker-runtime/entrypoint.mjs`). No I/O, no `child_process`,
 * no `fs` — those live in the `.mjs` entrypoint, which esbuild-bundles this
 * file into itself (the exact same pattern `coordinator.mjs` already uses
 * for `worker-lifecycle.ts`, see `export.mjs`'s `bundleCoordinator()`). This
 * split is what makes the supervisor's actual decision logic unit-testable
 * under `lib/**\/*.test.ts` without spawning real child processes.
 *
 * Root cause this module closes (PHASE_2I production smoke): neither
 * `server.mjs` (the renderer HTTP wrapper) nor `coordinator.mjs` (the
 * poll/claim/render/upload/complete loop) was ever started automatically as
 * a resident process — both were only ever run manually, one command at a
 * time, during proof sessions (see PHASE_2I_B2_RENDER_WORKER_COORDINATION.md
 * §"No Docker/Portainer/VPS deployment action"). `entrypoint.mjs` becomes
 * the new resident process the worker's service command runs; it supervises
 * both children using the decision functions below.
 */

export const DEFAULT_RESTART_BASE_DELAY_MS = 2_000
export const DEFAULT_RESTART_MAX_DELAY_MS = 60_000
export const DEFAULT_HEALTH_WAIT_MAX_ATTEMPTS = 30
export const DEFAULT_HEALTH_WAIT_INTERVAL_MS = 1_000

export type ChildName = 'renderer' | 'coordinator'

export type ChildExitInfo = {
  code: number | null
  signal: string | null
}

/**
 * Exponential backoff, capped — the same shape `coordinator.mjs`'s own
 * claim/network `backoffMs()` already uses. A child that fails immediately
 * and repeatedly (e.g. a missing required env var) is retried on a bounded,
 * growing cadence rather than busy-looping the CPU or being given up on
 * permanently (giving up would require a redeploy to recover from anyway,
 * and a real transient outage — e.g. the control plane briefly unreachable
 * at boot — should still self-heal without one).
 */
export function nextRestartDelayMs(
  consecutiveFailures: number,
  baseMs: number = DEFAULT_RESTART_BASE_DELAY_MS,
  maxMs: number = DEFAULT_RESTART_MAX_DELAY_MS,
): number {
  if (consecutiveFailures <= 0) return baseMs
  return Math.min(baseMs * Math.pow(2, consecutiveFailures), maxMs)
}

/**
 * A child that is deliberately being stopped (shutdown already in progress,
 * e.g. after SIGTERM) must never be restarted — only a child that exited on
 * its own, unexpectedly, while the supervisor still wants it running.
 */
export function shouldRestartChild(params: { shuttingDown: boolean }): boolean {
  return !params.shuttingDown
}

/**
 * Bounded health-check wait for the renderer (`server.mjs`) to come up
 * before the coordinator is started — never polls forever. Reaching the
 * attempt cap without a passing health check is a fatal startup condition
 * the supervisor must surface loudly (see `describeChildExit`/exit code),
 * not silently retry indefinitely.
 */
export function shouldKeepWaitingForHealth(
  attempt: number,
  maxAttempts: number = DEFAULT_HEALTH_WAIT_MAX_ATTEMPTS,
): boolean {
  return attempt < maxAttempts
}

export function healthWaitDelayMs(intervalMs: number = DEFAULT_HEALTH_WAIT_INTERVAL_MS): number {
  return intervalMs
}

/** True only for a well-formed `200 {status:'ok', ...}` response body. */
export function isHealthCheckPassing(statusCode: number, body: unknown): boolean {
  if (statusCode !== 200) return false
  if (!body || typeof body !== 'object') return false
  return (body as Record<string, unknown>).status === 'ok'
}

/**
 * The coordinator must always run in continuous mode as a resident child —
 * `CONTENT_STUDIO_RENDER_LOOP` is forced to `'1'` here rather than left to
 * whatever the container's own environment happens to set, so the resident
 * model does not silently degrade back to proof-only (single-execution,
 * self-exiting) mode if that var is ever omitted from the service
 * definition.
 */
export function buildCoordinatorEnv(baseEnv: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...baseEnv, CONTENT_STUDIO_RENDER_LOOP: '1' }
}

/** Prefer the bundled, dependency-free coordinator artifact when present. */
export function resolveCoordinatorScriptName(bundleExists: boolean): string {
  return bundleExists ? 'coordinator.bundle.cjs' : 'coordinator.mjs'
}

export const DEFAULT_MIN_STABLE_UPTIME_MS = 30_000

/**
 * A child that ran stably for a while before exiting (real work happened)
 * should not carry its restart-backoff penalty forward into the next
 * failure — only a child that keeps crashing immediately (a genuine fatal
 * config error) should see the delay keep growing.
 */
export function shouldResetRestartCounter(
  uptimeMs: number,
  minStableUptimeMs: number = DEFAULT_MIN_STABLE_UPTIME_MS,
): boolean {
  return uptimeMs >= minStableUptimeMs
}

export type CoordinatorHealthSnapshot = {
  running: boolean
  restartCount: number
  lastExitCode: number | null
  lastExitSignal: string | null
  lastStartedAt: string | null
}

/**
 * Shape of the coordinator's contribution to `GET /health` — server.mjs
 * reads this from a status file the supervisor writes (the two are separate
 * OS processes with no shared memory) so the health endpoint stays
 * meaningful for the whole resident service, not just the renderer half.
 * `coordinator: null` means no supervisor is running at all (e.g. a local
 * `node server.mjs` proof run started without the entrypoint) — that is
 * "ok", not "degraded": server.mjs's own render capability is unaffected.
 */
export function buildHealthPayload(params: {
  rendererOk: boolean
  coordinator: CoordinatorHealthSnapshot | null
}): { status: 'ok' | 'degraded'; coordinator: CoordinatorHealthSnapshot | null } {
  const coordinatorHealthy = params.coordinator === null || params.coordinator.running
  return {
    status: params.rendererOk && coordinatorHealthy ? 'ok' : 'degraded',
    coordinator: params.coordinator,
  }
}

/**
 * A child's exit must always be logged loudly (never swallowed) — this is
 * the single formatting function the entrypoint calls for every exit, so
 * the log signature stays consistent and greppable in production.
 */
export function describeChildExit(name: ChildName, exit: ChildExitInfo, consecutiveFailures: number): string {
  const reason = exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`
  return `[supervisor] ${name} exited (${reason}) — consecutive failures: ${consecutiveFailures}`
}
