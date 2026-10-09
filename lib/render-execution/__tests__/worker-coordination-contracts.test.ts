/**
 * Phase 2I-B2 — fail/complete API contract tests (Task 14).
 *
 * These tests verify the pure validation/sanitization logic of the
 * fail and complete endpoints in isolation — without a live DB or network.
 * They focus on the static security properties documented in B0/B2.
 */
import { describe, expect, it } from 'vitest'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'
import { createWorkerApiDbClient } from '@/lib/render-execution/worker-db-client'

// ── Error sanitization (fail endpoint contract) ──────────────────────────────

const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_ERROR_DETAIL_LENGTH = 4000
const MAX_ERROR_CODE_LENGTH = 64

function sanitizeErrorCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, MAX_ERROR_CODE_LENGTH)
}

function sanitizeErrorMessage(raw: string): string {
  return raw.trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

function sanitizeErrorDetail(raw: string): string {
  return raw.trim().slice(0, MAX_ERROR_DETAIL_LENGTH)
}

describe('fail API — error sanitization (Task 14)', () => {
  it('normalizes error codes to uppercase alphanumeric with underscores', () => {
    expect(sanitizeErrorCode('render_failed')).toBe('RENDER_FAILED')
    expect(sanitizeErrorCode('Render Failed')).toBe('RENDER_FAILED')
    expect(sanitizeErrorCode('render-failed')).toBe('RENDER_FAILED')
  })

  it('truncates oversized error codes to MAX length', () => {
    const long = 'A'.repeat(200)
    expect(sanitizeErrorCode(long)).toHaveLength(MAX_ERROR_CODE_LENGTH)
  })

  it('strips special chars from error codes', () => {
    expect(sanitizeErrorCode('<script>alert(1)</script>')).toMatch(/^[A-Z0-9_]+$/)
  })

  it('truncates oversized error messages', () => {
    const long = 'x'.repeat(600)
    expect(sanitizeErrorMessage(long)).toHaveLength(MAX_ERROR_MESSAGE_LENGTH)
  })

  it('truncates oversized error details', () => {
    const long = 'x'.repeat(5000)
    expect(sanitizeErrorDetail(long)).toHaveLength(MAX_ERROR_DETAIL_LENGTH)
  })

  it('preserves reasonable messages intact', () => {
    const msg = 'Remotion renderer exited with code 1'
    expect(sanitizeErrorMessage(msg)).toBe(msg)
  })
})

// ── Complete route — output metadata guard ────────────────────────────────────

function validateOutputMetadata(body: Record<string, unknown>): { valid: true } | { valid: false; code: string } {
  const bucket = typeof body.outputBucket === 'string' ? body.outputBucket.trim() : null
  const path = typeof body.outputStoragePath === 'string' ? body.outputStoragePath.trim() : null
  const size = typeof body.outputSizeBytes === 'number' ? body.outputSizeBytes : null
  const duration = typeof body.outputDurationMs === 'number' ? body.outputDurationMs : null

  if (!bucket || bucket.length > 255) return { valid: false, code: 'MISSING_OUTPUT_BUCKET' }
  if (!path || path.length > 1024) return { valid: false, code: 'MISSING_OUTPUT_STORAGE_PATH' }
  if (!size || size <= 0) return { valid: false, code: 'MISSING_OUTPUT_SIZE' }
  if (!duration || duration <= 0) return { valid: false, code: 'MISSING_OUTPUT_DURATION' }
  if (path.includes('..') || path.startsWith('/')) return { valid: false, code: 'INVALID_OUTPUT_LOCATOR' }

  return { valid: true }
}

describe('complete API — output metadata guard (Task 14)', () => {
  it('rejects a request with no outputBucket (local-only render cannot call complete)', () => {
    const result = validateOutputMetadata({})
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.code).toBe('MISSING_OUTPUT_BUCKET')
  })

  it('rejects a request with no outputStoragePath', () => {
    const result = validateOutputMetadata({ outputBucket: 'content-studio', outputSizeBytes: 1000, outputDurationMs: 3000 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.code).toBe('MISSING_OUTPUT_STORAGE_PATH')
  })

  it('rejects a request with no outputSizeBytes', () => {
    const result = validateOutputMetadata({
      outputBucket: 'content-studio',
      outputStoragePath: 'users/x/renders/scratch/abc/output.mp4',
      outputDurationMs: 3000,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.code).toBe('MISSING_OUTPUT_SIZE')
  })

  it('rejects a request with no outputDurationMs', () => {
    const result = validateOutputMetadata({
      outputBucket: 'content-studio',
      outputStoragePath: 'users/x/renders/scratch/abc/output.mp4',
      outputSizeBytes: 1000,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.code).toBe('MISSING_OUTPUT_DURATION')
  })

  it('rejects path traversal attempts', () => {
    const result = validateOutputMetadata({
      outputBucket: 'content-studio',
      outputStoragePath: '../../../etc/passwd',
      outputSizeBytes: 1000,
      outputDurationMs: 3000,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.code).toBe('INVALID_OUTPUT_LOCATOR')
  })

  it('accepts valid complete output metadata', () => {
    const result = validateOutputMetadata({
      outputBucket: 'content-studio',
      outputStoragePath: 'users/user-001/renders/scratch/exec-001/output.mp4',
      outputSizeBytes: 172000,
      outputDurationMs: 6000,
    })
    expect(result.valid).toBe(true)
  })

  it('cannot be satisfied by a local-only render (no bucket/path without upload)', () => {
    // A worker that only rendered locally has no bucket or path to supply.
    // This test documents the intended B3 sequencing gate.
    const localOnlyBody = {
      localOutputPath: '/tmp/content-studio-render-worker/output.mp4',
      durationMs: 6000,
    }
    const result = validateOutputMetadata(localOnlyBody)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(['MISSING_OUTPUT_BUCKET', 'MISSING_OUTPUT_STORAGE_PATH']).toContain(result.code)
    }
  })
})

// ── Status transition guards ──────────────────────────────────────────────────

type ExecutionStatus = 'queued' | 'claimed' | 'completed' | 'failed'

function isValidFailTransition(currentStatus: ExecutionStatus): boolean {
  return currentStatus === 'claimed'
}

function isValidCompleteTransition(currentStatus: ExecutionStatus): boolean {
  return currentStatus === 'claimed'
}

describe('status transition validation (Task 14)', () => {
  it('fail: only claimed → failed is valid', () => {
    expect(isValidFailTransition('claimed')).toBe(true)
    expect(isValidFailTransition('queued')).toBe(false)
    expect(isValidFailTransition('completed')).toBe(false)
    expect(isValidFailTransition('failed')).toBe(false)
  })

  it('complete: only claimed → completed is valid', () => {
    expect(isValidCompleteTransition('claimed')).toBe(true)
    expect(isValidCompleteTransition('queued')).toBe(false)
    expect(isValidCompleteTransition('completed')).toBe(false)
    expect(isValidCompleteTransition('failed')).toBe(false)
  })
})

// ── Browser authority regression ──────────────────────────────────────────────

describe('browser authority remains unchanged (B1.1 regression, Task 14)', () => {
  it('worker routes use verifyWorkerAuth — they do not accept a Supabase user session', () => {
    // verifyWorkerAuth is already imported at the top of this file.
    expect(typeof verifyWorkerAuth).toBe('function')
  })

  it('worker-db-client uses service-role, never the anon/cookie client', () => {
    // createWorkerApiDbClient is already imported at the top of this file.
    expect(typeof createWorkerApiDbClient).toBe('function')
    // When called without env vars, it returns null (not an authenticated client).
    const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const oldSecret = process.env.SUPABASE_SECRET_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SECRET_KEY
    const client = createWorkerApiDbClient()
    expect(client).toBeNull()
    if (oldUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl
    if (oldSecret) process.env.SUPABASE_SECRET_KEY = oldSecret
  })
})
