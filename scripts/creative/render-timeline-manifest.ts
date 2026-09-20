/**
 * Official local Wave 8 video execution path.
 *
 * The TimelineManifest JSON is the only creative input. It is parsed and
 * resolved before Remotion is selected. Renderer options below are execution
 * concerns and never enter the neutral manifest.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle, type WebpackConfiguration, type WebpackOverrideFn } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import { resolveTimelineManifest, type ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { timelineAdapterDiagnostics } from '@/remotion/timeline'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const defaultFixture = path.join(scriptDir, 'fixtures', 'timeline-manifests', 'documentary-card-cover-1080x1920-a.json')
const outputDir = path.join(repoRoot, '.tmp', 'creative', 'timeline-render')
export const OFFICIAL_TIMELINE_OUTPUT_PATH = '.tmp/creative/timeline-render/documentary-card-cover-1080x1920-a.mp4'
const outputPath = path.join(repoRoot, OFFICIAL_TIMELINE_OUTPUT_PATH)
const entry = path.join(repoRoot, 'remotion', 'index.ts')

export type VideoRenderOptions = {
  codec: 'h264'
  concurrency: number
}

export const DEFAULT_VIDEO_RENDER_OPTIONS: VideoRenderOptions = {
  codec: 'h264',
  concurrency: 1,
}

export type TimelineVideoExecutionResult = {
  status: 'succeeded'
  execution_kind: 'video'
  timeline_manifest: string
  template_keys: string[]
  component_keys: string[]
  canvas: { width: number; height: number; unit: 'px' }
  fps: number
  duration_frames: number
  duration_seconds: number
  output_path: string
  codec: string
  started_at: string
  finished_at: string
  duration_ms: number
  diagnostics: unknown[]
  source_manifest_fixture: string
  extracted_frames: Array<{ label: string; frame_path: string }>
  renderer_options: VideoRenderOptions
}

export class TimelineRenderValidationError extends Error {
  readonly diagnostics: unknown[]

  constructor(message: string, diagnostics: unknown[]) {
    super(message)
    this.name = 'TimelineRenderValidationError'
    this.diagnostics = diagnostics
  }
}

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

export async function readTimelineManifest(fixturePath = defaultFixture): Promise<{ manifest: TimelineManifest; sourcePath: string }> {
  const sourcePath = path.resolve(fixturePath)
  const raw = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown
  return { manifest: raw as TimelineManifest, sourcePath }
}

export function resolveOfficialTimeline(manifest: unknown): ResolvedTimelineInput {
  const resolved = resolveTimelineManifest(manifest)
  if (!resolved.valid) {
    throw new TimelineRenderValidationError('TimelineManifest could not be resolved for video render.', resolved.errors)
  }
  const adapterDiagnostics = timelineAdapterDiagnostics(resolved.value)
  if (adapterDiagnostics.length > 0) {
    throw new TimelineRenderValidationError('Timeline contains segments unsupported by the visual video adapter.', adapterDiagnostics)
  }
  return resolved.value
}

function probeVideo(filePath: string): { codec: string; width: number; height: number; fps: number; durationSeconds: number } {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ], { encoding: 'utf8' })
  const probe = JSON.parse(raw) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }>
    format?: { duration?: string }
  }
  const stream = probe.streams?.find((candidate) => candidate.codec_type === 'video')
  if (!stream || !stream.width || !stream.height || !stream.r_frame_rate) throw new Error('ffprobe did not find a valid video stream')
  const [numerator, denominator] = stream.r_frame_rate.split('/').map(Number)
  const durationSeconds = Number(stream.duration ?? probe.format?.duration ?? 0)
  return {
    codec: stream.codec_name ?? 'unknown',
    width: stream.width,
    height: stream.height,
    fps: denominator ? numerator / denominator : numerator,
    durationSeconds,
  }
}

function extractFrame(videoPath: string, label: string, seekArgs: string[]): string {
  const framePath = path.join(outputDir, `extracted-${label}.png`)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...seekArgs,
    '-i', videoPath,
    '-frames:v', '1',
    framePath,
  ])
  return repoRelative(framePath)
}

export async function renderOfficialTimelineManifest(
  fixturePath = defaultFixture,
  options: VideoRenderOptions = DEFAULT_VIDEO_RENDER_OPTIONS,
): Promise<TimelineVideoExecutionResult> {
  const { manifest, sourcePath } = await readTimelineManifest(fixturePath)
  const resolvedInput = resolveOfficialTimeline(manifest)
  const started = new Date()
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
  const inputProps = { resolvedInput }
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'TimelineManifestVideo',
    inputProps,
  })
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: options.codec,
    concurrency: options.concurrency,
    inputProps,
    outputLocation: outputPath,
  })

  const metadata = probeVideo(outputPath)
  const extractedFrames = [
    { label: 'start', frame_path: extractFrame(outputPath, 'start', []) },
    { label: 'middle', frame_path: extractFrame(outputPath, 'middle', ['-ss', '3']) },
    { label: 'end', frame_path: extractFrame(outputPath, 'end', ['-sseof', '-0.1']) },
  ]
  const finished = new Date()
  const templateKeys = [...new Set(resolvedInput.resolvedTemplateSegments.map(({ resolvedTemplate }) => `${resolvedTemplate.ref.id}@${resolvedTemplate.ref.version}`))]
  const componentKeys = [...new Set(resolvedInput.resolvedTemplateSegments.map(({ resolvedTemplate }) => resolvedTemplate.descriptor.component_key))]
  const result: TimelineVideoExecutionResult = {
    status: 'succeeded',
    execution_kind: 'video',
    timeline_manifest: manifest.manifest_id,
    template_keys: templateKeys,
    component_keys: componentKeys,
    canvas: {
      width: resolvedInput.manifest.specification.width,
      height: resolvedInput.manifest.specification.height,
      unit: 'px',
    },
    fps: metadata.fps,
    duration_frames: resolvedInput.manifest.specification.duration_frames,
    duration_seconds: metadata.durationSeconds,
    output_path: repoRelative(outputPath),
    codec: metadata.codec,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    diagnostics: resolvedInput.diagnostics,
    source_manifest_fixture: repoRelative(sourcePath),
    extracted_frames: extractedFrames,
    renderer_options: options,
  }
  await writeFile(path.join(outputDir, 'execution-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return result
}
