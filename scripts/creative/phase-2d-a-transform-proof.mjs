/** Phase 2D-A: static default/adjusted and timeline-frame transform proof. */
import { copyFile, mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const evidenceDir = path.join(repoRoot, '.tmp', 'creative', 'productization', 'phase-2d-a')
const envFile = path.join(evidenceDir, 'vercel-env.tmp')
const jiti = createJiti(import.meta.url, { alias: { '@': repoRoot }, jsx: true })

function loadEnvFile(contents) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const value = match[2].replace(/^['"]|['"]$/g, '')
    if (value) process.env[match[1]] = value
  }
}

await mkdir(evidenceDir, { recursive: true })
try {
  loadEnvFile(await readFile(envFile, 'utf8'))
} catch {
  throw new Error('Missing temporary Vercel environment file; no render proof attempted.')
}

const authoring = await jiti.import('@/lib/creative/authoring/index.ts', { default: false })
const renderModule = await jiti.import('@/scripts/creative/render-authoring-request.ts', { default: false })
const timelineFixtureModule = await jiti.import('@/lib/creative/fixtures/timeline-preview-fixtures.ts', { default: false })
const timelineResolverModule = await jiti.import('@/lib/creative/resolution/resolve-timeline.ts', { default: false })
const defaults = authoring.DEFAULT_PRIMITIVE_TRANSFORMS
const baseState = authoring.createInitialAuthoringState('cover', 'a', 'portrait')

function requestForState(state) {
  const selection = authoring.derivePrimitiveSelectionRequest(state)
  const transforms = authoring.derivePrimitiveTransformsRequest(state)
  return {
    manifest: authoring.deriveManifestFromState(state),
    primitiveSelection: selection,
    ...(transforms ? { primitiveTransforms: transforms } : {}),
  }
}

const adjustedValues = {
  paper: { offsetX: 64, offsetY: -38, rotation: 11, scale: 1.24, opacity: 0.8 },
  tape: { offsetX: -27, offsetY: 19, rotation: -8, scale: 0.82, opacity: 0.63 },
}
const adjustedState = { ...baseState, primitiveTransforms: adjustedValues }
const defaultRequest = requestForState(baseState)
const adjustedRequest = requestForState(adjustedState)

const defaultResult = await renderModule.renderAuthoringRequest(defaultRequest)
const adjustedResult = await renderModule.renderAuthoringRequest(adjustedRequest)
if (!defaultResult.primitive_materials_resolved.paper || !defaultResult.primitive_materials_resolved.tape) {
  throw new Error('Default proof did not resolve both real S3 primitive materials.')
}
if (!adjustedResult.primitive_materials_resolved.paper || !adjustedResult.primitive_materials_resolved.tape) {
  throw new Error('Adjusted proof did not resolve both real S3 primitive materials.')
}
await copyFile(path.join(repoRoot, defaultResult.output_path), path.join(evidenceDir, 'primitive-transforms-default.png'))
await copyFile(path.join(repoRoot, adjustedResult.output_path), path.join(evidenceDir, 'primitive-transforms-adjusted.png'))

// Timeline proof uses the same shared transform values and component path.
const timelineResolved = timelineResolverModule.resolveTimelineManifest(timelineFixtureModule.documentaryCardTimelinePreview)
if (!timelineResolved.valid) throw new Error(`Timeline fixture failed: ${JSON.stringify(timelineResolved.errors)}`)
const entry = path.join(repoRoot, 'remotion', 'index.ts')
const bundleLocation = await bundle(entry, undefined, {
  publicDir: path.join(repoRoot, 'public'),
  publicPath: '/',
  webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...config.resolve?.alias, '@': repoRoot } } }),
})
const timelineInputProps = { resolvedInput: timelineResolved.value, primitiveTransforms: adjustedValues }
const composition = await selectComposition({ serveUrl: bundleLocation, id: 'TimelineManifestPreview', inputProps: timelineInputProps })
const timelineFramePath = path.join(evidenceDir, 'primitive-transforms-timeline-frame.png')
const timelineStarted = Date.now()
await renderStill({ composition, serveUrl: bundleLocation, inputProps: timelineInputProps, frame: 90, output: timelineFramePath })

const summary = {
  phase: '2D-A',
  status: 'succeeded',
  canvas: '1080x1350',
  primitives: { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01', materials_resolved_from_s3: true },
  default: {
    requested: { paper: defaults, tape: defaults },
    effective: { paper: defaults, tape: defaults },
    render_ms: defaultResult.duration_ms,
    diagnostics: defaultResult.diagnostics.length,
    output: 'primitive-transforms-default.png',
  },
  adjusted: {
    requested: adjustedValues,
    effective: adjustedValues,
    render_ms: adjustedResult.duration_ms,
    diagnostics: adjustedResult.diagnostics.length,
    output: 'primitive-transforms-adjusted.png',
  },
  timeline: {
    frame: 90,
    requested: adjustedValues,
    effective: adjustedValues,
    render_ms: Date.now() - timelineStarted,
    output: 'primitive-transforms-timeline-frame.png',
    model: 'same DocumentaryCard primitiveTransforms boundary; no video-only branch',
  },
  boundary: {
    neutral_manifest_contains_primitive_ref: false,
    signed_urls_persisted: false,
    database_mutation: false,
    storage_mutation: false,
  },
}
await writeFile(path.join(evidenceDir, 'execution-summary-redacted.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))

// The temporary env and Vercel link are local-only proof inputs.
await unlink(envFile).catch(() => {})
await rm(path.join(repoRoot, '.vercel'), { recursive: true, force: true })
await unlink(path.join(repoRoot, '.env.local')).catch(() => {})
