/** Wave 7 local frame extraction proof. This is not the official video path. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle, type WebpackConfiguration, type WebpackOverrideFn } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { timelineAdapterDiagnostics } from '@/remotion/timeline'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const outputDir = path.join(repoRoot, '.tmp', 'creative', 'timeline-preview')
const entry = path.join(repoRoot, 'remotion', 'index.ts')
const proofFrames = [0, 45, 90, 135, 179]

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

export async function renderTimelinePreview(): Promise<Record<string, unknown>> {
  const resolved = resolveTimelineManifest(documentaryCardTimelinePreview)
  if (!resolved.valid) throw new Error(`Timeline manifest failed resolution: ${JSON.stringify(resolved.errors)}`)

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
    adapter_diagnostics: timelineAdapterDiagnostics(resolved.value),
    frames: outputs,
  }
  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  return summary
}
