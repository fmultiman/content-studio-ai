// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Normalization adapter: Kling MCP `who_am_i` output  ->  Content Studio's
// bounded video capability contract (lib/video-generation/capabilities.ts).
//
// This is the ONLY place that reads Kling's per-model argument specs. The raw
// spec is never persisted or sent to the browser: only the normalized result
// is stored (provider_connections.capabilities.video) and consumed.
//
// A model is EXPOSED for an operation only when Content Studio can fill every
// required argument/input from the controls it actually offers:
//   - required arguments are a subset of {prompt}
//   - text_to_video requires no inputs; image_to_video requires exactly one,
//     `first_image` (one source image). Multi-reference "omni"/o1 image models
//     (numbered image_1..image_7 references) and subjects/elements are intentionally not exposed.
//   - VEO_KLING_FIRST_LAST_FRAME_V1: an OPTIONAL `tail_image` input on such a model means it also accepts a LAST frame
//     (`lastFrame` capability). The 1080p / no-audio constraints are read from the provider's own argument text.
// Anything else the provider offers (extra arguments, more operations, other
// tools) is ignored until it is productized deliberately.
//
// Values are clamped to the product vocabulary (durations 1-120 s, the known
// resolutions and aspect ratios): an unknown value never becomes a control.

import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_OPERATIONS,
  VIDEO_RESOLUTIONS,
  type VideoAspectRatio,
  type VideoLastFrameCapability,
  type VideoModelCapability,
  type VideoOperation,
  type VideoOperationCapability,
  type VideoResolution,
} from '@/lib/video-generation/capabilities'

export const KLING_MCP_VIDEO_SNAPSHOT_VERSION = 1

/** Persisted under provider_connections.capabilities.video. Normalized only — never raw provider schema. */
export interface KlingMcpVideoSnapshot {
  schemaVersion: typeof KLING_MCP_VIDEO_SNAPSHOT_VERSION
  operations: VideoOperationCapability[]
}

const MAX_MODELS_PER_OPERATION = 20
const SAFE_MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Friendly names for known ids; anything else is shown by its id (truthful, not guessed). */
const MODEL_LABELS: Record<string, string> = {
  'kling-video-v2_5': 'Kling 2.5',
  'kling-video-v2_6': 'Kling 2.6',
  'kling-video-o1': 'Kling O1',
  'kling-video-v3_0': 'Kling 3.0',
  'kling-video-v3_0_omni': 'Kling 3.0 Omni',
  'kling-video-v3_0_turbo': 'Kling 3.0 Turbo',
}

/**
 * Provider-documented model constraints that the argument schema cannot
 * express. Kling 2.6 image-to-video: audio "only at resolution=1080p".
 */
const AUDIO_REQUIRES_RESOLUTION: Record<string, VideoResolution> = {
  'image_to_video:kling-video-v2_6': '1080p',
}

export function klingModelLabel(id: string): string {
  return MODEL_LABELS[id] ?? id
}

interface RawArgument {
  name?: unknown
  required?: unknown
  allowedValues?: unknown
  description?: unknown
}

const descriptionOf = (arg: RawArgument | undefined): string => (typeof arg?.description === 'string' ? arg.description : '')

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function findArgument(args: RawArgument[], name: string): RawArgument | undefined {
  return args.find((entry) => entry && entry.name === name)
}

function allowedStrings(arg: RawArgument | undefined): string[] {
  if (!arg) return []
  return toArray(arg.allowedValues).filter((value): value is string => typeof value === 'string')
}

function isBooleanControl(arg: RawArgument | undefined): boolean {
  const values = allowedStrings(arg)
  return values.includes('true') && values.includes('false')
}

function normalizeModel(operation: VideoOperation, raw: unknown): VideoModelCapability | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as { model?: unknown; arguments?: unknown; inputs?: unknown }

  const id = typeof entry.model === 'string' ? entry.model : ''
  if (!SAFE_MODEL_ID.test(id)) return null

  const args = toArray(entry.arguments) as RawArgument[]
  const inputs = toArray(entry.inputs) as Array<{ name?: unknown; required?: unknown }>

  // Every required argument must be one we supply.
  const requiredArgs = args.filter((arg) => arg && arg.required === true).map((arg) => arg.name)
  if (requiredArgs.some((name) => name !== 'prompt')) return null

  // Every required input must be one we supply.
  const requiredInputs = inputs.filter((input) => input && input.required === true).map((input) => input.name)
  if (operation === 'text_to_video' && requiredInputs.length > 0) return null
  if (operation === 'image_to_video' && !(requiredInputs.length === 1 && requiredInputs[0] === 'first_image')) return null

  const durations = [
    ...new Set(
      allowedStrings(findArgument(args, 'duration'))
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= MIN_DURATION_SECONDS && value <= MAX_DURATION_SECONDS),
    ),
  ].sort((a, b) => a - b)

  const resolutions = allowedStrings(findArgument(args, 'resolution'))
    .filter((value): value is VideoResolution => (VIDEO_RESOLUTIONS as readonly string[]).includes(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => VIDEO_RESOLUTIONS.indexOf(a) - VIDEO_RESOLUTIONS.indexOf(b))

  // Both are always-present controls for a usable model.
  if (durations.length === 0 || resolutions.length === 0) return null

  // Aspect ratio is a text_to_video control only; image_to_video takes its
  // framing from the source image (same rule as the REST integration).
  const aspectRatios =
    operation === 'text_to_video'
      ? allowedStrings(findArgument(args, 'aspect_ratio'))
          .filter((value): value is VideoAspectRatio => (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value))
          .filter((value, index, all) => all.indexOf(value) === index)
      : []

  const audio = isBooleanControl(findArgument(args, 'enable_audio'))
  const audioRequiresResolution = audio ? AUDIO_REQUIRES_RESOLUTION[`${operation}:${id}`] : undefined

  // VEO_KLING_FIRST_LAST_FRAME_V1: an OPTIONAL `tail_image` input means the model accepts a last frame. This is read from
  // the effective model/connection contract, never from the model's commercial name. Models that take their images as
  // numbered references (image_1..image_7, "omni") or declare no tail input are NOT first/last-frame models here.
  const hasTailImage = operation === 'image_to_video' && inputs.some((input) => input && input.name === 'tail_image' && input.required !== true)
  let lastFrame: VideoLastFrameCapability | undefined
  if (hasTailImage) {
    const resolutionNote = descriptionOf(findArgument(args, 'resolution'))
    const audioNote = descriptionOf(findArgument(args, 'enable_audio'))
    lastFrame = {
      // "Tail image requires 1080p." (Kling 2.6)
      ...(/tail image requires 1080p/i.test(resolutionNote) && resolutions.includes('1080p') ? { requiresResolution: '1080p' as const } : {}),
      // "not supported with a tail image" (Kling 2.6)
      audioAllowed: !/not supported with a tail image/i.test(audioNote),
      // Two frames define one continuous shot; multi-shot stays off wherever the model has that control (conservative).
      multiShotAllowed: findArgument(args, 'prefer_multi_shots') === undefined,
    }
  }

  return {
    id,
    label: klingModelLabel(id),
    durations,
    resolutions,
    aspectRatios,
    audio,
    multiShot: isBooleanControl(findArgument(args, 'prefer_multi_shots')),
    asmr: isBooleanControl(findArgument(args, 'enable_asmr')),
    audioPrompt: findArgument(args, 'audio_prompt') !== undefined,
    musicPrompt: findArgument(args, 'music_prompt') !== undefined,
    ...(audioRequiresResolution && resolutions.includes(audioRequiresResolution) ? { audioRequiresResolution } : {}),
    // Server-side mapping hint: send imageCount=1 only when the model declares it.
    outputCountArg: findArgument(args, 'imageCount') !== undefined,
    ...(lastFrame ? { lastFrame } : {}),
  }
}

/** Normalizes `who_am_i`. Pure: no I/O, no logging, tolerant of any malformed input. */
export function normalizeKlingMcpVideoCapabilities(whoAmI: Record<string, unknown>): KlingMcpVideoSnapshot {
  const available = whoAmI.availableModels as Record<string, { models?: unknown }> | undefined

  const operations: VideoOperationCapability[] = VIDEO_OPERATIONS.map((operation) => {
    const models: VideoModelCapability[] = []
    const seen = new Set<string>()
    for (const raw of toArray(available?.[operation]?.models)) {
      const model = normalizeModel(operation, raw)
      if (!model || seen.has(model.id)) continue
      seen.add(model.id)
      models.push(model)
      if (models.length >= MAX_MODELS_PER_OPERATION) break
    }
    return { operation, models }
  })

  return { schemaVersion: KLING_MCP_VIDEO_SNAPSHOT_VERSION, operations }
}
