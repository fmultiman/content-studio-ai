/**
 * Phase 2I — Production Video Operational Closure.
 * Unit tests for the resident-supervisor pure decision logic. See
 * resident-supervisor-policy.ts for why this is split from entrypoint.mjs.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEALTH_WAIT_MAX_ATTEMPTS,
  DEFAULT_MIN_STABLE_UPTIME_MS,
  DEFAULT_RESTART_MAX_DELAY_MS,
  buildCoordinatorEnv,
  buildHealthPayload,
  describeChildExit,
  healthWaitDelayMs,
  isHealthCheckPassing,
  nextRestartDelayMs,
  resolveCoordinatorScriptName,
  shouldKeepWaitingForHealth,
  shouldResetRestartCounter,
  shouldRestartChild,
} from '@/lib/render-execution/resident-supervisor-policy'

describe('nextRestartDelayMs — bounded exponential backoff (Task A3)', () => {
  it('returns the base delay for the first failure', () => {
    expect(nextRestartDelayMs(0)).toBe(2_000)
  })

  it('grows exponentially with consecutive failures', () => {
    expect(nextRestartDelayMs(1)).toBe(4_000)
    expect(nextRestartDelayMs(2)).toBe(8_000)
    expect(nextRestartDelayMs(3)).toBe(16_000)
  })

  it('never busy-loops: is capped at the max delay', () => {
    expect(nextRestartDelayMs(10)).toBe(DEFAULT_RESTART_MAX_DELAY_MS)
    expect(nextRestartDelayMs(100)).toBe(DEFAULT_RESTART_MAX_DELAY_MS)
  })

  it('never returns 0 or a negative delay', () => {
    for (let i = 0; i < 20; i++) {
      expect(nextRestartDelayMs(i)).toBeGreaterThan(0)
    }
  })
})

describe('shouldRestartChild — graceful shutdown (Task A3)', () => {
  it('restarts a child that exited unexpectedly while running', () => {
    expect(shouldRestartChild({ shuttingDown: false })).toBe(true)
  })

  it('never restarts a child once shutdown has begun (SIGTERM/SIGINT)', () => {
    expect(shouldRestartChild({ shuttingDown: true })).toBe(false)
  })
})

describe('health-wait bounds (Task A3 — no busy-loop startup)', () => {
  it('keeps waiting before the attempt cap', () => {
    expect(shouldKeepWaitingForHealth(0, 5)).toBe(true)
    expect(shouldKeepWaitingForHealth(4, 5)).toBe(true)
  })

  it('stops waiting once the attempt cap is reached — never polls forever', () => {
    expect(shouldKeepWaitingForHealth(5, 5)).toBe(false)
    expect(shouldKeepWaitingForHealth(999, 5)).toBe(false)
  })

  it('defaults to a bounded attempt cap', () => {
    expect(shouldKeepWaitingForHealth(DEFAULT_HEALTH_WAIT_MAX_ATTEMPTS - 1)).toBe(true)
    expect(shouldKeepWaitingForHealth(DEFAULT_HEALTH_WAIT_MAX_ATTEMPTS)).toBe(false)
  })

  it('health wait delay is a fixed, positive interval (not a busy loop)', () => {
    expect(healthWaitDelayMs()).toBeGreaterThan(0)
    expect(healthWaitDelayMs(250)).toBe(250)
  })
})

describe('isHealthCheckPassing', () => {
  it('passes only for HTTP 200 with status: ok', () => {
    expect(isHealthCheckPassing(200, { status: 'ok' })).toBe(true)
  })

  it('fails for a non-200 status code', () => {
    expect(isHealthCheckPassing(500, { status: 'ok' })).toBe(false)
    expect(isHealthCheckPassing(0, { status: 'ok' })).toBe(false)
  })

  it('fails for a malformed or missing body', () => {
    expect(isHealthCheckPassing(200, null)).toBe(false)
    expect(isHealthCheckPassing(200, undefined)).toBe(false)
    expect(isHealthCheckPassing(200, 'ok')).toBe(false)
    expect(isHealthCheckPassing(200, { status: 'degraded' })).toBe(false)
  })
})

describe('buildCoordinatorEnv — resident model always forces continuous loop (Task A1/A2)', () => {
  it('forces CONTENT_STUDIO_RENDER_LOOP=1 regardless of the base environment', () => {
    const env = buildCoordinatorEnv({ FOO: 'bar' })
    expect(env.CONTENT_STUDIO_RENDER_LOOP).toBe('1')
    expect(env.FOO).toBe('bar')
  })

  it('overrides an explicit CONTENT_STUDIO_RENDER_LOOP=0 from the base environment', () => {
    const env = buildCoordinatorEnv({ CONTENT_STUDIO_RENDER_LOOP: '0' })
    expect(env.CONTENT_STUDIO_RENDER_LOOP).toBe('1')
  })

  it('does not mutate the base environment object', () => {
    const base = { CONTENT_STUDIO_RENDER_LOOP: '0' }
    buildCoordinatorEnv(base)
    expect(base.CONTENT_STUDIO_RENDER_LOOP).toBe('0')
  })
})

describe('resolveCoordinatorScriptName — prefer the bundled artifact', () => {
  it('prefers coordinator.bundle.cjs when present', () => {
    expect(resolveCoordinatorScriptName(true)).toBe('coordinator.bundle.cjs')
  })

  it('falls back to coordinator.mjs for local/dev runs with no bundle', () => {
    expect(resolveCoordinatorScriptName(false)).toBe('coordinator.mjs')
  })
})

describe('buildHealthPayload — meaningful health endpoint (Task A3)', () => {
  it('is ok when the renderer is healthy and no supervisor is present (local proof run)', () => {
    const payload = buildHealthPayload({ rendererOk: true, coordinator: null })
    expect(payload.status).toBe('ok')
    expect(payload.coordinator).toBeNull()
  })

  it('is ok when both the renderer and the coordinator are running', () => {
    const payload = buildHealthPayload({
      rendererOk: true,
      coordinator: { running: true, restartCount: 0, lastExitCode: null, lastExitSignal: null, lastStartedAt: '2026-09-22T00:00:00.000Z' },
    })
    expect(payload.status).toBe('ok')
  })

  it('is degraded when the coordinator has died', () => {
    const payload = buildHealthPayload({
      rendererOk: true,
      coordinator: { running: false, restartCount: 3, lastExitCode: 1, lastExitSignal: null, lastStartedAt: '2026-09-22T00:00:00.000Z' },
    })
    expect(payload.status).toBe('degraded')
  })

  it('is degraded when the renderer itself is unhealthy, independent of the coordinator', () => {
    const payload = buildHealthPayload({ rendererOk: false, coordinator: { running: true, restartCount: 0, lastExitCode: null, lastExitSignal: null, lastStartedAt: null } })
    expect(payload.status).toBe('degraded')
  })
})

describe('shouldResetRestartCounter — stable uptime forgives past failures', () => {
  it('does not reset the counter for a fast crash loop', () => {
    expect(shouldResetRestartCounter(500)).toBe(false)
  })

  it('resets the counter once the child ran stably long enough', () => {
    expect(shouldResetRestartCounter(DEFAULT_MIN_STABLE_UPTIME_MS)).toBe(true)
    expect(shouldResetRestartCounter(DEFAULT_MIN_STABLE_UPTIME_MS + 1)).toBe(true)
  })
})

describe('describeChildExit — fatal startup errors are never hidden (Task A3)', () => {
  it('formats an exit-code failure with the consecutive failure count', () => {
    const message = describeChildExit('coordinator', { code: 1, signal: null }, 3)
    expect(message).toContain('coordinator')
    expect(message).toContain('exit code 1')
    expect(message).toContain('3')
  })

  it('formats a signal-terminated exit', () => {
    const message = describeChildExit('renderer', { code: null, signal: 'SIGKILL' }, 1)
    expect(message).toContain('signal SIGKILL')
  })
})
