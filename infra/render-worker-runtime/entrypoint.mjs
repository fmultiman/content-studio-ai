#!/usr/bin/env node
/**
 * Phase 2I — Production Video Operational Closure.
 *
 * THIS FILE IS THE NEW RESIDENT ENTRY POINT for the render-worker service.
 * The worker's service/container command must run `entrypoint.bundle.cjs`
 * (produced by export.mjs, same esbuild-bundling pattern as
 * `coordinator.bundle.cjs`) instead of `server.mjs` directly.
 *
 * ─── Root cause this closes ────────────────────────────────────────────────
 * Neither `server.mjs` (the Remotion render HTTP wrapper) nor
 * `coordinator.mjs` (the poll → claim → render → upload → complete loop) was
 * ever started automatically. Both were designed and validated to be run
 * manually, one at a time, during proof sessions — see
 * PHASE_2I_B2_RENDER_WORKER_COORDINATION.md ("No Docker/Portainer/VPS
 * deployment action ... it was not deployed to any remote infrastructure
 * this phase") and export.mjs's own closing log line ("On the VPS, run:
 * node coordinator.bundle.cjs"). A user clicking "Gerar Vídeo" in production
 * therefore queues a `render_executions` row that nothing ever claims.
 *
 * ─── What this file does ───────────────────────────────────────────────────
 *   1. Spawns `server.mjs` (unchanged, unbundled — its dependency resolution
 *      model, walking up to the VPS base image's `/app/node_modules`, is
 *      untouched by this change).
 *   2. Waits (boundedly) for `GET /health` to pass before doing anything
 *      else — a renderer that never comes up is a fatal startup condition,
 *      surfaced loudly, not silently retried forever.
 *   3. Spawns the coordinator (`coordinator.bundle.cjs`, falling back to
 *      `coordinator.mjs` for local/dev runs with no bundle) with
 *      `CONTENT_STUDIO_RENDER_LOOP` forced to `'1'` — the resident,
 *      continuous polling mode the coordinator already implements but which
 *      nothing ever enabled automatically.
 *   4. Supervises both children for the lifetime of the process: an
 *      unexpected exit is logged loudly and restarted after a bounded,
 *      exponential backoff (never a busy loop, never given up on
 *      permanently — see resident-supervisor-policy.ts).
 *   5. On SIGTERM/SIGINT: stops accepting restarts, forwards the signal to
 *      both children, waits (boundedly) for them to exit, then exits
 *      itself — this is what makes lease recovery on crash/restart work:
 *      the coordinator's own in-flight claim, if any, is abandoned exactly
 *      as before (its lease expires server-side; nothing here changes that
 *      contract), and a fresh container start begins from a clean slate.
 *
 * ─── What this file deliberately does NOT do ───────────────────────────────
 *   - It does not touch render_executions, claim/complete/fail logic, lease
 *     semantics, or stale-attempt fencing — all of that remains entirely
 *     inside the already-proven claim/complete/fail routes and
 *     coordinator.mjs's own cycle. This file only ensures the coordinator
 *     process itself is always running.
 *   - It does not run more than one coordinator at a time — one child
 *     process, one sequential poll/claim/render loop, matching the
 *     documented single-worker-VPS concurrency model.
 *   - It does not add any new npm dependency, queue technology, or network
 *     protocol — only Node's own `child_process`/`http` fetch (already used
 *     by coordinator.mjs) and the pure decision functions this file imports.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  buildCoordinatorEnv,
  describeChildExit,
  healthWaitDelayMs,
  isHealthCheckPassing,
  nextRestartDelayMs,
  resolveCoordinatorScriptName,
  shouldKeepWaitingForHealth,
  shouldResetRestartCounter,
  shouldRestartChild,
} from '../../lib/render-execution/resident-supervisor-policy.ts'

// Portability smoke-test escape hatch ONLY (see export.mjs's
// smokeTestEntrypointPortability): proves the bundle's full module graph
// (including the pure resident-supervisor-policy.ts helpers) resolves and
// evaluates successfully outside the repo, without spawning real child
// processes, waiting on health checks, or touching real timers. This never
// runs in the real resident path — nothing here is a hidden shortcut around
// the actual supervisor logic below.
if (process.env.CONTENT_STUDIO_SUPERVISOR_SELFTEST === '1') {
  console.log('[supervisor] self-test: module graph loaded successfully.')
  process.exit(0)
}

// NOTE: this file is only ever executed via its esbuild-bundled CJS output
// (entrypoint.bundle.cjs, produced by export.mjs's bundleEntrypoint()) — see
// the module header. `__dirname` is therefore a real, correct CJS global at
// runtime (bound to wherever the bundle actually sits — the same directory
// as server.mjs and coordinator.bundle.cjs), not an ESM `import.meta.url`
// computation, which esbuild cannot preserve when targeting `format: 'cjs'`
// (import.meta is empty in CJS output — using it here would crash on
// startup). Running `node entrypoint.mjs` directly (unbundled) is
// unsupported, exactly like `coordinator.mjs`/`coordinator.source.mjs`.
const here = __dirname
const PORT = Number(process.env.PORT ?? 3456)
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`
const OUTPUT_DIR = process.env.RENDER_OUTPUT_DIR ?? path.join(os.tmpdir(), 'content-studio-render-worker')
const STATUS_FILE = process.env.CONTENT_STUDIO_COORDINATOR_STATUS_FILE ?? path.join(OUTPUT_DIR, 'coordinator-status.json')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeCoordinatorStatus(status) {
  try {
    mkdirSync(path.dirname(STATUS_FILE), { recursive: true })
    writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2))
  } catch (err) {
    // Best-effort only: a failure to write the status file must never take
    // down the supervisor or the render pipeline it is managing.
    console.warn('[supervisor] Failed to write coordinator status file:', err.message)
  }
}

let shuttingDown = false
const children = new Map() // name -> { child, startedAt, consecutiveFailures }

function spawnChild(name, scriptPath, env) {
  console.log(`[supervisor] Starting ${name}: node ${scriptPath}`)
  const child = spawn(process.execPath, [scriptPath], { cwd: here, stdio: 'inherit', env })
  const startedAt = Date.now()
  const previous = children.get(name)
  const consecutiveFailures = previous?.consecutiveFailures ?? 0
  children.set(name, { child, startedAt, consecutiveFailures })

  child.on('exit', (code, signal) => {
    const entry = children.get(name)
    const uptimeMs = Date.now() - (entry?.startedAt ?? startedAt)
    const failures = shouldResetRestartCounter(uptimeMs) ? 0 : (entry?.consecutiveFailures ?? 0) + 1

    console.error(describeChildExit(name, { code, signal }, failures))

    if (name === 'coordinator') {
      writeCoordinatorStatus({
        running: false,
        restartCount: failures,
        lastExitCode: code,
        lastExitSignal: signal,
        lastStartedAt: new Date(startedAt).toISOString(),
      })
    }

    if (!shouldRestartChild({ shuttingDown })) {
      children.delete(name)
      return
    }

    const delayMs = nextRestartDelayMs(failures)
    console.log(`[supervisor] Restarting ${name} in ${delayMs}ms...`)
    children.set(name, { child: null, startedAt, consecutiveFailures: failures })
    setTimeout(() => {
      if (shuttingDown) return
      spawnChild(name, scriptPath, env)
    }, delayMs).unref?.()
  })

  if (name === 'coordinator') {
    writeCoordinatorStatus({
      running: true,
      restartCount: consecutiveFailures,
      lastExitCode: null,
      lastExitSignal: null,
      lastStartedAt: new Date(startedAt).toISOString(),
    })
  }

  return child
}

async function waitForRendererHealth() {
  for (let attempt = 0; shouldKeepWaitingForHealth(attempt); attempt++) {
    try {
      const response = await fetch(HEALTH_URL)
      const body = await response.json().catch(() => null)
      if (isHealthCheckPassing(response.status, body)) {
        console.log(`[supervisor] Renderer healthy after ${attempt + 1} check(s).`)
        return true
      }
    } catch {
      // Renderer not accepting connections yet — keep waiting.
    }
    await sleep(healthWaitDelayMs())
  }
  return false
}

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[supervisor] ${signal} received — stopping children...`)

  for (const [, entry] of children) {
    if (entry.child && !entry.child.killed) entry.child.kill(signal)
  }

  const stillRunning = () => [...children.values()].some((entry) => entry.child && entry.child.exitCode === null && !entry.child.killed)

  const timeout = setTimeout(() => {
    console.warn('[supervisor] Graceful shutdown timeout exceeded — forcing exit.')
    process.exit(0)
  }, 10_000)
  timeout.unref?.()

  const pollExit = setInterval(() => {
    if (!stillRunning()) {
      clearInterval(pollExit)
      clearTimeout(timeout)
      console.log('[supervisor] All children stopped. Exiting.')
      process.exit(0)
    }
  }, 200)
  pollExit.unref?.()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

async function main() {
  const rendererScript = path.join(here, 'server.mjs')
  spawnChild('renderer', rendererScript, process.env)

  const rendererHealthy = await waitForRendererHealth()
  if (!rendererHealthy) {
    console.error('[supervisor] FATAL: renderer never became healthy within the startup bound. Exiting non-zero so the orchestrator can restart the service.')
    process.exit(1)
  }

  const coordinatorBundleExists = existsSync(path.join(here, 'coordinator.bundle.cjs'))
  const coordinatorScript = path.join(here, resolveCoordinatorScriptName(coordinatorBundleExists))
  const coordinatorEnv = buildCoordinatorEnv(process.env)
  spawnChild('coordinator', coordinatorScript, coordinatorEnv)

  console.log('[supervisor] Resident model up: renderer + coordinator (continuous loop) both running under supervision.')
}

main().catch((err) => {
  console.error('[supervisor] Fatal error during startup:', err)
  process.exit(1)
})
