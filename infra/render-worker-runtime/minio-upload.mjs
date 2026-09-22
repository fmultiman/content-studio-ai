/**
 * Phase 2I-B3 — worker-side MinIO scratch upload.
 *
 * This file is the ONLY place in the worker package that imports
 * `@aws-sdk/client-s3` (a class-100 "extra npm runtime dependency", see
 * README.md's dependency classification, disclosed and justified below).
 * It is never run directly with plain `node` on the VPS — export.mjs
 * bundles this module's entry point (coordinator.mjs) with esbuild into a
 * single, self-contained `coordinator.bundle.mjs` that inlines this SDK
 * (and its own transitive dependencies) so the VPS's `/app/node_modules`
 * (which — per README.md §2 — provides ONLY `remotion`/`@remotion/*`/
 * `react`/`react-dom`, and nothing else) never needs to resolve it.
 *
 * Deliberately imports the shared deterministic-target logic
 * (`lib/render-execution/scratch-output-target.ts`) and the shared config
 * parser (`lib/render-execution/minio-client-config.ts`) directly from the
 * main repo by relative path — NOT a copy — so the worker and the Control
 * Plane's complete route can never silently drift apart on the key
 * convention. esbuild transpiles the referenced .ts files as part of the
 * bundle; Node itself never sees them directly.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { readMinioClientConfig, buildPutObjectParams } from '../../lib/render-execution/minio-client-config.ts'
import { buildScratchOutputTarget } from '../../lib/render-execution/scratch-output-target.ts'

let cachedClient = null

function getClient(config) {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }
  return cachedClient
}

/**
 * Uploads a local MP4 file to this execution's deterministic scratch key.
 *
 * Returns { ok: true, bucket, key, sizeBytes } on a successful PutObject
 * (proof-of-existence rationale: see PHASE_2I_B3 docs §7 — a successful SDK
 * response is treated as sufficient; MinIO is strongly consistent, so no
 * additional HEAD verification round-trip is performed).
 *
 * Returns { ok: false, error } on any failure — env misconfiguration, file
 * missing, or the PutObject call itself throwing. The error is a short,
 * sanitized string (never a raw stack trace) — safe to pass through to the
 * bounded /fail report.
 */
export async function uploadRenderOutputToScratch({ userId, executionId, localFilePath, env = process.env }) {
  const config = readMinioClientConfig(env)
  if (!config) {
    return { ok: false, error: 'MinIO client is not configured (CONTENT_STUDIO_MINIO_* env vars missing).' }
  }

  let sizeBytes
  try {
    const stats = await stat(localFilePath)
    sizeBytes = stats.size
  } catch (err) {
    return { ok: false, error: `Local render output not found: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: 'Local render output is empty (0 bytes).' }
  }

  const target = buildScratchOutputTarget({ userId, executionId })
  // The worker's own configured bucket must agree with the deterministic
  // target's expected bucket — if an operator misconfigures
  // CONTENT_STUDIO_MINIO_BUCKET to point somewhere else, fail loudly here
  // rather than uploading to the wrong bucket and having the Control
  // Plane's independent check (route-side isExpectedScratchOutputTarget)
  // reject it after the fact.
  if (config.bucket !== target.bucket) {
    return {
      ok: false,
      error: `CONTENT_STUDIO_MINIO_BUCKET ("${config.bucket}") does not match the expected scratch bucket ("${target.bucket}").`,
    }
  }

  try {
    const client = getClient(config)
    const body = createReadStream(localFilePath)
    const params = buildPutObjectParams({ bucket: target.bucket, key: target.key, sizeBytes, body })
    await client.send(new PutObjectCommand(params))
    return { ok: true, bucket: target.bucket, key: target.key, sizeBytes }
  } catch (err) {
    // Sanitize: never persist/forward a raw AWS SDK stack trace (mirrors
    // the existing repo convention of truncating/short-forming renderer
    // errors before they reach a structured failure report).
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `MinIO upload failed: ${message}`.slice(0, 500) }
  }
}
