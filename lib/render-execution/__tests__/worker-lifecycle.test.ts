/**
 * Phase 2I-B3 — worker coordinator lifecycle decision tests (Task 14).
 *
 * These are the pure policy functions the (untested-by-vitest, bundled)
 * infra/render-worker-runtime/coordinator.mjs wires together imperatively.
 * Testing them here proves the DECISIONS are correct without needing a live
 * MinIO server, live control plane, or Chromium.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_COMPLETE_RETRY_ATTEMPTS,
  completeRetryDelayMs,
  isRetryableCompleteFailure,
  shouldCallComplete,
  shouldDeleteLocalFileAfterCompleteRetriesExhausted,
  shouldDeleteLocalFileAfterSuccess,
  shouldDeleteLocalFileAfterUploadFailure,
  shouldReportFailAfterUploadFailure,
  shouldRetryComplete,
} from '@/lib/render-execution/worker-lifecycle'

describe('shouldCallComplete / shouldReportFailAfterUploadFailure — upload gates completion', () => {
  it('a successful upload permits calling complete', () => {
    const outcome = { ok: true as const, bucket: 'content-studio', key: 'k', sizeBytes: 100 }
    expect(shouldCallComplete(outcome)).toBe(true)
    expect(shouldReportFailAfterUploadFailure(outcome)).toBe(false)
  })

  it('a failed upload NEVER permits calling complete', () => {
    const outcome = { ok: false as const, error: 'network error' }
    expect(shouldCallComplete(outcome)).toBe(false)
    expect(shouldReportFailAfterUploadFailure(outcome)).toBe(true)
  })
})

describe('complete retry policy (Task 10) — bounded, transient-only', () => {
  it('retries up to MAX_COMPLETE_RETRY_ATTEMPTS', () => {
    expect(shouldRetryComplete(1)).toBe(true)
    expect(shouldRetryComplete(MAX_COMPLETE_RETRY_ATTEMPTS - 1)).toBe(true)
    expect(shouldRetryComplete(MAX_COMPLETE_RETRY_ATTEMPTS)).toBe(false)
  })

  it('backoff delay grows exponentially and is capped', () => {
    const d1 = completeRetryDelayMs(1)
    const d2 = completeRetryDelayMs(2)
    const d3 = completeRetryDelayMs(3)
    expect(d2).toBeGreaterThan(d1)
    expect(d3).toBeGreaterThan(d2)
    const dLarge = completeRetryDelayMs(20)
    expect(dLarge).toBeLessThanOrEqual(30_000)
  })

  it('a transient failure (network/5xx) is retryable', () => {
    expect(isRetryableCompleteFailure({ ok: false, transient: true, error: 'HTTP 503' })).toBe(true)
  })

  it('a non-transient failure (4xx / already terminal) is NOT retryable', () => {
    expect(isRetryableCompleteFailure({ ok: false, transient: false, error: 'HTTP 409' })).toBe(false)
  })

  it('a success is never "retryable" (nothing to retry)', () => {
    expect(isRetryableCompleteFailure({ ok: true })).toBe(false)
  })
})

describe('local file cleanup timing (Task 12)', () => {
  it('deletes the local file after a fully successful lifecycle', () => {
    expect(shouldDeleteLocalFileAfterSuccess({ ok: true })).toBe(true)
  })

  it('does NOT delete the local file while complete has not yet succeeded', () => {
    expect(shouldDeleteLocalFileAfterSuccess({ ok: false, transient: true, error: 'pending retry' })).toBe(false)
  })

  it('deletes the local file immediately after an upload failure (nothing left to upload)', () => {
    expect(shouldDeleteLocalFileAfterUploadFailure()).toBe(true)
  })

  it('deletes the local file once complete retries are exhausted (object already durably in MinIO)', () => {
    expect(shouldDeleteLocalFileAfterCompleteRetriesExhausted()).toBe(true)
  })
})
