#!/usr/bin/env node
/**
 * Phase 2I-A1 — isolated Content Studio Remotion render-worker HTTP wrapper.
 *
 * Deliberately minimal, per the phase scope: no Supabase, no auth, no
 * queue, no render_executions, no S3 upload, no retries, no cancellation,
 * no progress percentages. It receives an already-prepared
 * `ResolvedTimelineInput` (the same shape `prepareVideoDraftTimeline`
 * already produces in the main app) and renders it with the SAME renderer
 * calls `scripts/creative/render-timeline-manifest.ts`'s
 * `renderResolvedTimelineInput` already uses in the main repo — this file
 * does not reimplement rendering, it re-authors that one function's body in
 * plain JS (no TypeScript toolchain) so Node can execute it directly,
 * while still bundling the *actual* TimelineComposition/TemplateSegment/
 * DocumentaryCard/QuoteCard source (copied verbatim by export.mjs) through
 * `@remotion/bundler`, which transpiles their TS/TSX itself.
 *
 * Node module resolution: this file expects `remotion`, `@remotion/bundler`,
 * `@remotion/renderer`, `react`, and `react-dom` to already be available via
 * the normal node_modules parent-directory walk-up (the VPS base image
 * already provides these under /app/node_modules; for the local proof, the
 * main repo's own node_modules is used the same way).
 */
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, 'remotion-entry.tsx')
const publicDir = path.join(here, 'public')
const port = Number(process.env.PORT ?? 3456)
const outputDir = process.env.RENDER_OUTPUT_DIR ?? path.join(os.tmpdir(), 'content-studio-render-worker')
const coordinatorStatusFile = process.env.CONTENT_STUDIO_COORDINATOR_STATUS_FILE ?? path.join(outputDir, 'coordinator-status.json')

/**
 * Phase 2I — Production Video Operational Closure. Reads the small status
 * file entrypoint.mjs (the resident supervisor) writes whenever it starts or
 * loses the coordinator child. server.mjs and the supervisor are separate OS
 * processes with no shared memory, so a file is the simplest boundary that
 * doesn't require server.mjs to gain any new dependency or import a TS
 * helper (it deliberately has none — see README.md §2/§9).
 *
 * Returns `null` when no status file exists (a local `node server.mjs` proof
 * run started without the supervisor) — that case is NOT degraded, since
 * server.mjs's own render capability is unaffected by the coordinator's
 * absence; only reported explicitly so ops can tell the two situations apart.
 */
function readCoordinatorStatus() {
  try {
    const raw = readFileSync(coordinatorStatusFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Mirrors lib/render-execution/resident-supervisor-policy.ts's buildHealthPayload
 * — duplicated here in plain JS (not imported) because server.mjs never
 * bundles or resolves TypeScript source; see the module header for why. */
function buildHealthPayload(coordinatorStatus) {
  const coordinatorHealthy = coordinatorStatus === null || coordinatorStatus.running === true
  return {
    status: coordinatorHealthy ? 'ok' : 'degraded',
    coordinator: coordinatorStatus,
  }
}

/** Cached across requests: bundling is the expensive, repeatable part. */
let bundleLocationPromise

function getBundleLocation() {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle(entry, undefined, {
      publicDir,
      publicPath: '/',
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...(config.resolve?.alias ?? {}),
            '@': here,
          },
        },
      }),
    })
  }
  return bundleLocationPromise
}

/** Minimum required-input validation — deliberately not a full zod schema
 * pass (the worker boundary starts from an already-resolved
 * ResolvedTimelineInput; the producing side is responsible for schema
 * correctness). This only guards against obviously malformed requests. */
function validateResolvedInput(body) {
  const errors = []
  const resolvedInput = body?.resolvedInput
  if (!resolvedInput || typeof resolvedInput !== 'object') {
    errors.push('resolvedInput is required and must be an object')
    return { valid: false, errors }
  }
  if (!resolvedInput.manifest?.specification) errors.push('resolvedInput.manifest.specification is required')
  if (!Array.isArray(resolvedInput.resolvedTemplateSegments)) errors.push('resolvedInput.resolvedTemplateSegments must be an array')
  if (!resolvedInput.tokens) errors.push('resolvedInput.tokens is required')
  if (!resolvedInput.typography) errors.push('resolvedInput.typography is required')
  return { valid: errors.length === 0, errors, resolvedInput }
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? JSON.parse(raw) : {}
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function handleRender(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Request body must be valid JSON.' })
  }

  const { valid, errors, resolvedInput } = validateResolvedInput(body)
  if (!valid) return sendJson(res, 400, { error: 'Invalid render request.', details: errors })

  const startedAt = Date.now()
  try {
    const bundleLocation = await getBundleLocation()
    const inputProps = { resolvedInput }
    const composition = await selectComposition({ serveUrl: bundleLocation, id: 'TimelineManifestVideo', inputProps })

    await mkdir(outputDir, { recursive: true })
    const outputLocation = path.join(outputDir, `content-studio-proof-${randomUUID()}.mp4`)

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      concurrency: 1,
      inputProps,
      outputLocation,
    })

    return sendJson(res, 200, {
      status: 'succeeded',
      output_path: outputLocation,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      duration_frames: composition.durationInFrames,
      duration_ms: Date.now() - startedAt,
    })
  } catch (error) {
    return sendJson(res, 500, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startedAt,
    })
  }
}

/**
 * Static Render Worker V1 — minimum shape guard for a claimed static still.
 * The control plane already validated + resolved the frozen
 * StaticRenderManifest at claim time; this only rejects malformed calls.
 */
function validateStaticInput(body) {
  const errors = []
  const staticInput = body?.staticInput
  if (!staticInput || typeof staticInput !== 'object') {
    errors.push('staticInput is required and must be an object')
    return { valid: false, errors }
  }
  const canvas = staticInput.resolvedInput?.manifest?.canvas
  if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height)) errors.push('staticInput.resolvedInput.manifest.canvas is required')
  if (!staticInput.resolvedInput?.resolvedTemplate?.descriptor?.component_key) errors.push('staticInput.resolvedInput.resolvedTemplate is required')
  if (!staticInput.resolvedInput?.typography) errors.push('staticInput.resolvedInput.typography is required')
  return { valid: errors.length === 0, errors, staticInput }
}

/**
 * POST /render-still — real Remotion `renderStill` of the SAME
 * `StaticRenderManifestStill` composition the app's Root registers. Never a
 * one-frame MP4. Produces a PNG in the local output dir; the coordinator
 * uploads it to the execution's private scratch key.
 */
async function handleRenderStill(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: 'Request body must be valid JSON.' })
  }

  const { valid, errors, staticInput } = validateStaticInput(body)
  if (!valid) return sendJson(res, 400, { error: 'Invalid static render request.', details: errors })

  const startedAt = Date.now()
  try {
    const bundleLocation = await getBundleLocation()
    const inputProps = {
      resolvedInput: staticInput.resolvedInput,
      overrides: staticInput.overrides,
      primitiveMaterials: staticInput.primitiveMaterials,
      primitiveTransforms: staticInput.primitiveTransforms,
      // Creative Editor Template Foundation V1: frozen template + element
      // stack. DocumentaryCard normalizes them with the same helper the
      // Editor preview uses (lib/creative/templates/element-stack.ts).
      templateId: staticInput.templateId,
      elementOrder: staticInput.elementOrder,
    }
    const composition = await selectComposition({ serveUrl: bundleLocation, id: 'StaticRenderManifestStill', inputProps })

    await mkdir(outputDir, { recursive: true })
    const outputLocation = path.join(outputDir, `content-studio-still-${randomUUID()}.png`)

    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: outputLocation,
      inputProps,
      imageFormat: 'png',
    })

    return sendJson(res, 200, {
      status: 'succeeded',
      output_path: outputLocation,
      width: composition.width,
      height: composition.height,
      duration_ms: Date.now() - startedAt,
    })
  } catch (error) {
    return sendJson(res, 500, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startedAt,
    })
  }
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, buildHealthPayload(readCoordinatorStatus()))
  }
  if (req.method === 'POST' && req.url === '/render') {
    return void handleRender(req, res)
  }
  if (req.method === 'POST' && req.url === '/render-still') {
    return void handleRenderStill(req, res)
  }
  return sendJson(res, 404, { error: 'Not found.' })
})

server.listen(port, () => {
  console.log(`[content-studio-render-worker] listening on :${port}`)
  console.log(`[content-studio-render-worker] output dir: ${outputDir}`)
})
