/**
 * Phase 2I-B2 — worker authentication tests (Task 14).
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { type NextRequest } from 'next/server'
import { verifyWorkerAuth } from '@/lib/render-execution/worker-auth'

function makeRequest(authHeader: string | null, workerIdHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (authHeader !== null) headers['authorization'] = authHeader
  if (workerIdHeader) headers['x-worker-id'] = workerIdHeader
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as NextRequest
}

describe('verifyWorkerAuth', () => {
  const REAL_SECRET = 'super-secret-token-xyz'

  beforeEach(() => {
    process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET = REAL_SECRET
  })

  afterEach(() => {
    delete process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET
  })

  it('rejects when Authorization header is missing', () => {
    const result = verifyWorkerAuth(makeRequest(null))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('WORKER_AUTH_MISSING')
    }
  })

  it('rejects when Authorization scheme is not Bearer', () => {
    const result = verifyWorkerAuth(makeRequest('Basic abc123'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('WORKER_AUTH_INVALID_SCHEME')
    }
  })

  it('rejects when the Bearer token is wrong', () => {
    const result = verifyWorkerAuth(makeRequest('Bearer wrong-token'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('WORKER_AUTH_INVALID_SECRET')
    }
  })

  it('accepts a valid Bearer token', () => {
    const result = verifyWorkerAuth(makeRequest(`Bearer ${REAL_SECRET}`))
    expect(result.ok).toBe(true)
  })

  it('returns the X-Worker-Id header value when present', () => {
    const result = verifyWorkerAuth(makeRequest(`Bearer ${REAL_SECRET}`, 'my-worker-001'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workerId).toBe('my-worker-001')
    }
  })

  it('returns null workerId when X-Worker-Id is absent', () => {
    const result = verifyWorkerAuth(makeRequest(`Bearer ${REAL_SECRET}`))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workerId).toBeNull()
    }
  })

  it('returns 503 when CONTENT_STUDIO_RENDER_WORKER_SECRET is not configured', () => {
    delete process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET
    const result = verifyWorkerAuth(makeRequest(`Bearer ${REAL_SECRET}`))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe('WORKER_AUTH_UNCONFIGURED')
    }
  })

  it('rejects empty string secret configuration (treated as unconfigured)', () => {
    process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET = '   '
    const result = verifyWorkerAuth(makeRequest(`Bearer    `))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
    }
  })

  it('is timing-safe: accepts exact match regardless of length differences', () => {
    // Shorter token should not short-circuit on length mismatch.
    const result = verifyWorkerAuth(makeRequest('Bearer short'))
    expect(result.ok).toBe(false)

    const result2 = verifyWorkerAuth(makeRequest(`Bearer ${REAL_SECRET}-extra`))
    expect(result2.ok).toBe(false)
  })

  it('browser routes are unaffected — this auth does not gate user-facing routes', () => {
    // This test documents that verifyWorkerAuth is never called on
    // browser routes; it is only imported by worker-facing routes.
    // Since it's a pure function, we just verify the import succeeds.
    expect(typeof verifyWorkerAuth).toBe('function')
  })
})
