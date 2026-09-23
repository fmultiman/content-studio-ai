/**
 * Phase 2I-B3 — worker-only MinIO/S3-compatible client configuration.
 *
 * Pure config parsing/shaping only — no network call, no SDK import here.
 * This module is imported by the worker's own upload wrapper
 * (infra/render-worker-runtime/minio-upload.mjs, bundled at export time —
 * see export.mjs) so the env-reading and PutObject-shape logic is written
 * once and unit-tested under lib/**, even though the worker executes on a
 * separate VPS runtime.
 *
 * These are DELIBERATELY a different env-var family from the main app's own
 * `S3_*` vars (lib/storage/s3.ts) — per B0 §10/§12, the worker's MinIO
 * credential is a separate, narrower, worker-only secret, never the
 * Vercel-side Supabase/S3 credential set. It must never be read by any
 * Vercel-side route.
 */

export type MinioClientConfig = {
  endpoint: string
  bucket: string
  region: string
  forcePathStyle: true
  accessKeyId: string
  secretAccessKey: string
}

/**
 * Returns null when any required var is absent — the worker fails closed
 * (skips upload, reports a structured failure) rather than attempting a
 * request with a partially-configured client.
 */
export function readMinioClientConfig(env: Record<string, string | undefined> = process.env): MinioClientConfig | null {
  const endpoint = env.CONTENT_STUDIO_MINIO_ENDPOINT
  const bucket = env.CONTENT_STUDIO_MINIO_BUCKET
  const accessKeyId = env.CONTENT_STUDIO_MINIO_ACCESS_KEY
  const secretAccessKey = env.CONTENT_STUDIO_MINIO_SECRET_KEY
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null

  return {
    endpoint,
    bucket,
    region: env.CONTENT_STUDIO_MINIO_REGION || 'us-east-1',
    // MinIO (unlike AWS S3) requires path-style addressing (bucket.host
    // virtual-hosted style is an S3-only convention) — fixed true, not
    // env-configurable, per the given infrastructure facts.
    forcePathStyle: true,
    accessKeyId,
    secretAccessKey,
  }
}

/**
 * Shapes the PutObjectCommand input for one scratch upload. Pure — takes an
 * already-known byte size (obtained from the local filesystem by the
 * caller, never guessed/streamed-without-length) and an already-open
 * request body (a Node Readable stream in the real worker; any value in
 * tests). ContentLength is passed explicitly so the SDK does not need to
 * buffer the whole file to compute it.
 */
export function buildPutObjectParams(input: {
  bucket: string
  key: string
  sizeBytes: number
  body: unknown
  /** Static Render Worker V1: 'image/png' for static stills; defaults to the original video/mp4. */
  contentType?: string
}) {
  return {
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType ?? 'video/mp4',
    ContentLength: input.sizeBytes,
  }
}
