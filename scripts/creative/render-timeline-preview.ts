/** Wave 7 local frame extraction proof. This is not the official video path. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle, type WebpackConfiguration, type WebpackOverrideFn } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { timelineAdapterDiagnostics } from '@/remotion/timeline'
import { prepareTypography } from '@/lib/creative/typography/prepare-typography'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const outputDir = path.join(repoRoot, '.tmp', 'creative', 'timeline-preview')
const entry = path.join(repoRoot, 'remotion', 'index.ts')

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

async function defaultTimelineManifest(): Promise<TimelineManifest> {
  const fixturePath = process.env.CREATIVE_TIMELINE_FIXTURE
  if (!fixturePath) return documentaryCardTimelinePreview
  return JSON.parse(await readFile(path.resolve(repoRoot, fixturePath), 'utf8')) as TimelineManifest
}

export async function renderTimelinePreview(manifest?: TimelineManifest): Promise<Record<string, unknown>> {
  const selectedManifest = manifest ?? await defaultTimelineManifest()
  const resolved = resolveTimelineManifest(selectedManifest)
  if (!resolved.valid) throw new Error(`Timeline manifest failed resolution: ${JSON.stringify(resolved.errors)}`)
  const typography = await prepareTypography(resolved.value.tokens)
  if (!typography.valid) throw new Error(`Typography preparation failed: ${JSON.stringify(typography.errors)}`)

  await mkdir(outputDir, { recursive: true })
  const webpackOverride: WebpackOverrideFn = (config: WebpackConfiguration) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...((config.resolve?.alias as Record<string, string> | undefined) ?? {}),
        '@': repoRoot,
      },
    },
  })
  const bundleLocation = await bundle(entry, undefined, {
    publicDir: path.join(repoRoot, 'public'),
    publicPath: '/',
    webpackOverride,
  })
  const inputProps = { resolvedInput: resolved.value }
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'TimelineManifestPreview',
    inputProps,
  })
  const proofFrames = [0, Math.floor(resolved.value.manifest.specification.duration_frames / 2), resolved.value.manifest.specification.duration_frames - 1]
  const outputs: Array<Record<string, unknown>> = []
  for (const frame of proofFrames) {
    const outputPath = path.join(outputDir, `frame-${String(frame).padStart(3, '0')}.png`)
    await renderStill({ composition, serveUrl: bundleLocation, inputProps, frame, output: outputPath })
    outputs.push({ frame, output_path: repoRelative(outputPath) })
  }

  const summary = {
    status: 'succeeded',
    preview: 'local-frame-extraction-only',
    manifest_id: resolved.value.manifest.manifest_id,
    specification: resolved.value.manifest.specification,
    component_key: resolved.value.resolvedTemplateSegments[0]?.resolvedTemplate.descriptor.component_key,
    motion: resolved.value.resolvedTemplateSegments[0]?.segment.payload.motion,
    typography_preparation_ms: typography.value.preparation_ms,
    adapter_diagnostics: timelineAdapterDiagnostics(resolved.value),
    frames: outputs,
  }
  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summary
}
