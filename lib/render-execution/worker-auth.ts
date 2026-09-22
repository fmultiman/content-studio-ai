/**
 * Phase 2I-B2 — worker authentication helper.
 *
 * The render-worker never holds a Supabase credential. Instead, it
 * authenticates every request to the control-plane worker API with a single
 * shared secret delivered in the Authorization header (Bearer scheme).
 *
 * Requirements satisfied here:
 * - missing secret → closed (401)
 * - wrong secret → closed (401)
 * - timing-safe comparison (no short-circuit leak)
 * - secret never reaches browser bundles (no NEXT_PUBLIC_ prefix)
 * - secret never appears in API responses
 * - query-string delivery is not accepted (header-only)
 *
 * The env var is CONTENT_STUDIO_RENDER_WORKER_SECRET.
 * When absent the server is considered misconfigured and all worker routes
 * fail with 503 rather than silently accepting any request.
 */

import { NextRequest } from 'next/server'

/**
 * Constant-time string comparison to prevent timing attacks.
 * Falls back to a length-mismatch short-circuit only AFTER the full scan,
 * so the comparison always takes the same number of operations regardless
 * of where the strings diverge.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a)
  const bBytes = Buffer.from(b)
  if (aBytes.length !== bBytes.length) {
    // Scan a full fake comparison to prevent timing leak on length diff.
    let diff = 0
    for (let i = 0; i < aBytes.length; i++) {
      diff |= aBytes[i] ^ (bBytes[i % bBytes.length] ?? 0)
    }
    return false
  }
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i]
  }
  return diff === 0
}

type AuthResult =
  | { ok: true; workerId: string | null }
  | { ok: false; status: 401 | 503; code: string; message: string }

/**
 * Verifies the worker Authorization header against the
 * CONTENT_STUDIO_RENDER_WORKER_SECRET environment variable.
 *
 * Returns { ok: true } if authorized, or an error descriptor that the caller
 * should convert to a NextResponse.
 *
 * `workerId` is the value of the X-Worker-Id header when present — useful
 * for logging/associating claims, not used for access control.
 */
export function verifyWorkerAuth(req: NextRequest): AuthResult {
  const configured = process.env.CONTENT_STUDIO_RENDER_WORKER_SECRET
  if (!configured || configured.trim() === '') {
    return {
      ok: false,
      status: 503,
      code: 'WORKER_AUTH_UNCONFIGURED',
      message:
        'CONTENT_STUDIO_RENDER_WORKER_SECRET is not configured. Worker API is unavailable.',
    }
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return {
      ok: false,
      status: 401,
      code: 'WORKER_AUTH_MISSING',
      message: 'Authorization header is required.',
    }
  }

  // Accept "Bearer <secret>" only — no query-string, no Basic.
  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      status: 401,
      code: 'WORKER_AUTH_INVALID_SCHEME',
      message: 'Authorization must use Bearer scheme.',
    }
  }

  const presented = authHeader.slice(7) // strip "Bearer "
  if (!timingSafeEqual(presented, configured)) {
    return {
      ok: false,
      status: 401,
      code: 'WORKER_AUTH_INVALID_SECRET',
      message: 'Invalid worker secret.',
    }
  }

  // Optional stable worker identifier for log correlation / claimed_by.
  const workerId = req.headers.get('x-worker-id') ?? null

  return { ok: true, workerId }
}
