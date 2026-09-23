/**
 * Phase 2I-B3 — deterministic scratch output target derivation.
 *
 * Single source of truth for "where does this execution's rendered MP4 live
 * before an explicit Save (B0 §11/§12)." Both sides of the claim/complete
 * boundary import this exact module:
 *
 *   - The worker (infra/render-worker-runtime/minio-upload.mjs, bundled via
 *     esbuild at export time — see export.mjs) uses it to compute the exact
 *     key it uploads to.
 *   - The Control Plane (app/api/render-executions/[id]/complete/route.ts)
 *     uses it to compute the ONLY bucket/key it will ever accept as this
 *     execution's output — any other worker-submitted value is rejected.
 *
 * This is deliberately the only place either side computes this path, so
 * the two can never silently drift apart (B0 §11's convention, restated
 * here as the single derivation used everywhere it matters).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** B0 §11 — reuse the existing bucket, do not invent a second one. */
export const RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT = 'content-studio'

export type ScratchOutputTarget = {
  bucket: string
  key: string
}

/**
 * Static Render Worker V1 — the execution kinds this plane carries. The
 * scratch key's filename is a strict function of the kind, so a video row
 * can never be completed with a PNG key and vice versa.
 */
export type RenderExecutionKind = 'video' | 'static_still'

export const RENDER_EXECUTION_OUTPUT_BY_KIND: Readonly<Record<RenderExecutionKind, { filename: string; mimeType: string }>> = {
  video: { filename: 'output.mp4', mimeType: 'video/mp4' },
  static_still: { filename: 'output.png', mimeType: 'image/png' },
}

export function isRenderExecutionKind(value: unknown): value is RenderExecutionKind {
  return value === 'video' || value === 'static_still'
}

/**
 * The expected bucket name, server-side. Reuses the same env vars the main
 * app's own S3 helper (`lib/storage/s3.ts`) already reads for the one
 * physical bucket this repo has ever used, falling back to the literal name
 * B0 §11 already settled on if no env override is configured.
 */
export function getExpectedScratchBucket(env: Record<string, string | undefined> = process.env): string {
  return (
    env.RENDER_EXECUTION_SCRATCH_BUCKET ||
    env.S3_BUCKET_NAME ||
    env.S3_BUCKET ||
    RENDER_EXECUTION_SCRATCH_BUCKET_DEFAULT
  )
}

/**
 * Builds the deterministic scratch key for one execution:
 *   users/{userId}/renders/scratch/{executionId}/output.mp4   (kind 'video', the default)
 *   users/{userId}/renders/scratch/{executionId}/output.png   (kind 'static_still')
 *
 * Both segments are validated as UUIDs — not because untrusted input flows
 * here directly (callers always supply DB-sourced values), but so that a
 * future caller mistake (e.g. accidentally passing a raw request field)
 * fails loudly instead of silently producing a path-traversal-shaped key.
 */
export function buildScratchOutputKey(input: { userId: string; executionId: string; kind?: RenderExecutionKind }): string {
  if (!UUID_RE.test(input.userId)) {
    throw new Error('buildScratchOutputKey: userId must be a UUID')
  }
  if (!UUID_RE.test(input.executionId)) {
    throw new Error('buildScratchOutputKey: executionId must be a UUID')
  }
  const kind = input.kind ?? 'video'
  if (!isRenderExecutionKind(kind)) {
    throw new Error('buildScratchOutputKey: unknown execution kind')
  }
  return `users/${input.userId}/renders/scratch/${input.executionId}/${RENDER_EXECUTION_OUTPUT_BY_KIND[kind].filename}`
}

/**
 * The full deterministic target (bucket + key) for one execution.
 *
 * Same executionId -> same target every time (safe to overwrite on a
 * worker retry of the SAME execution, per B0 §4.1's infra-retry model).
 * Different executionId -> a different, non-overlapping key (a user-facing
 * retry always creates a new execution row, per B0 §4.2, and therefore
 * always gets its own key — no cross-execution overwrite is possible).
 */
export function buildScratchOutputTarget(
  input: { userId: string; executionId: string; kind?: RenderExecutionKind },
  env?: Record<string, string | undefined>,
): ScratchOutputTarget {
  return {
    bucket: getExpectedScratchBucket(env),
    key: buildScratchOutputKey(input),
  }
}

/**
 * True only if the given bucket/key are EXACTLY the deterministic target
 * for this (userId, executionId) pair. Used by the complete route to reject
 * any worker-submitted output locator that isn't the one authoritative
 * target this execution is allowed to write to (Task 1/2/8 hardening) — no
 * arbitrary bucket, no arbitrary path, no cross-user/cross-execution
 * destination.
 */
export function isExpectedScratchOutputTarget(
  input: { userId: string; executionId: string; bucket: string; key: string; kind?: RenderExecutionKind },
  env?: Record<string, string | undefined>,
): boolean {
  try {
    const expected = buildScratchOutputTarget(input, env)
    return input.bucket === expected.bucket && input.key === expected.key
  } catch {
    return false
  }
}
