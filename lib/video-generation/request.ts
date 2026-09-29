// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Server-side validation of a generation request against the capabilities of
// the connection the SERVER resolved. The browser is never authority: every
// value is checked against capability data read from the server's own store /
// code, never against anything the client echoed back.
//
// Rules:
//   - a control the model does not offer must be ABSENT (a hidden stale value
//     is rejected, not ignored);
//   - a control the model offers but the caller omitted gets an explicit,
//     deterministic default (never a silent provider default);
//   - output count is pinned to 1 (one action -> one VideoGeneration -> one video).

import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_RESOLUTIONS,
  audioAllowedAt,
  defaultAspectRatio,
  defaultDuration,
  defaultModel,
  defaultResolution,
  DEFAULT_AUDIO,
  DEFAULT_MULTI_SHOT,
  findOperation,
  isVideoOperation,
  type VideoAspectRatio,
  type VideoAudio,
  type VideoModelCapability,
  type VideoOperation,
  type VideoOperationCapability,
  type VideoResolution,
} from './capabilities'

export interface RawVideoControls {
  operation?: unknown
  model?: unknown
  duration?: unknown
  resolution?: unknown
  aspect_ratio?: unknown
  audio?: unknown
  multi_shot?: unknown
  outputCount?: unknown
}

/** The fully explicit request handed to a transport. Every visible control has a value. */
export interface NormalizedVideoRequest {
  operation: VideoOperation
  model: string
  duration: number
  resolution: VideoResolution
  aspectRatio: VideoAspectRatio | null
  audio: VideoAudio | null
  multiShot: boolean | null
}

export type VideoRequestFailureCode =
  | 'UNSUPPORTED_OPERATION'
  | 'UNSUPPORTED_MODEL'
  | 'UNSUPPORTED_DURATION'
  | 'UNSUPPORTED_RESOLUTION'
  | 'UNSUPPORTED_ASPECT_RATIO'
  | 'UNSUPPORTED_AUDIO'
  | 'UNSUPPORTED_MULTI_SHOT'
  | 'AUDIO_RESOLUTION_CONFLICT'
  | 'UNSUPPORTED_OUTPUT_COUNT'

export type VideoRequestValidation =
  | { ok: true; request: NormalizedVideoRequest; model: VideoModelCapability }
  | { ok: false; code: VideoRequestFailureCode; message: string }

const fail = (code: VideoRequestFailureCode, message: string): VideoRequestValidation => ({ ok: false, code, message })

export function validateVideoRequest(
  operations: VideoOperationCapability[],
  raw: RawVideoControls,
): VideoRequestValidation {
  if (raw.outputCount !== undefined && raw.outputCount !== 1) {
    return fail('UNSUPPORTED_OUTPUT_COUNT', 'Only one video per generation is supported.')
  }

  if (!isVideoOperation(raw.operation)) {
    return fail('UNSUPPORTED_OPERATION', 'Unsupported generation mode.')
  }
  const operation: VideoOperation = raw.operation
  const capability = findOperation(operations, operation)
  if (!capability) {
    return fail('UNSUPPORTED_OPERATION', 'This connection does not support that generation mode.')
  }

  let model: VideoModelCapability | null
  if (raw.model === undefined) {
    model = defaultModel(capability.models)
  } else {
    model = typeof raw.model === 'string' ? (capability.models.find((entry) => entry.id === raw.model) ?? null) : null
  }
  if (!model) return fail('UNSUPPORTED_MODEL', 'Unsupported model for this connection and mode.')

  let duration: number
  if (raw.duration === undefined) {
    duration = defaultDuration(model)
  } else {
    duration = Number(raw.duration)
    if (!model.durations.includes(duration)) return fail('UNSUPPORTED_DURATION', 'Unsupported duration value.')
  }

  let resolution: VideoResolution
  if (raw.resolution === undefined) {
    resolution = defaultResolution(model)
  } else if (
    typeof raw.resolution === 'string' &&
    (VIDEO_RESOLUTIONS as readonly string[]).includes(raw.resolution) &&
    model.resolutions.includes(raw.resolution as VideoResolution)
  ) {
    resolution = raw.resolution as VideoResolution
  } else {
    return fail('UNSUPPORTED_RESOLUTION', 'Unsupported resolution value.')
  }

  let aspectRatio: VideoAspectRatio | null
  if (raw.aspect_ratio === undefined || raw.aspect_ratio === null || raw.aspect_ratio === '') {
    aspectRatio = defaultAspectRatio(model)
  } else if (
    typeof raw.aspect_ratio === 'string' &&
    (VIDEO_ASPECT_RATIOS as readonly string[]).includes(raw.aspect_ratio) &&
    model.aspectRatios.includes(raw.aspect_ratio as VideoAspectRatio)
  ) {
    aspectRatio = raw.aspect_ratio as VideoAspectRatio
  } else {
    return fail(
      'UNSUPPORTED_ASPECT_RATIO',
      operation === 'image_to_video'
        ? 'aspect_ratio is not supported for image_to_video.'
        : 'Unsupported aspect_ratio for this model.',
    )
  }

  let audio: VideoAudio | null
  if (raw.audio === undefined) {
    audio = model.audio ? DEFAULT_AUDIO : null
  } else if (!model.audio) {
    return fail('UNSUPPORTED_AUDIO', 'This model does not offer an audio option.')
  } else if (raw.audio !== 'off' && raw.audio !== 'on') {
    return fail('UNSUPPORTED_AUDIO', 'Unsupported audio value.')
  } else {
    audio = raw.audio
  }
  if (audio === 'on' && !audioAllowedAt(model, resolution)) {
    return fail('AUDIO_RESOLUTION_CONFLICT', `Audio is only available at ${model.audioRequiresResolution} for this model.`)
  }

  let multiShot: boolean | null
  if (raw.multi_shot === undefined) {
    multiShot = model.multiShot ? DEFAULT_MULTI_SHOT : null
  } else if (!model.multiShot) {
    return fail('UNSUPPORTED_MULTI_SHOT', 'This model does not offer a multi-shot option.')
  } else if (typeof raw.multi_shot !== 'boolean') {
    return fail('UNSUPPORTED_MULTI_SHOT', 'multi_shot must be a boolean.')
  } else {
    multiShot = raw.multi_shot
  }

  return {
    ok: true,
    model,
    request: { operation, model: model.id, duration, resolution, aspectRatio, audio, multiShot },
  }
}

/**
 * Cheap, connection-independent vocabulary check that runs BEFORE any database
 * access: shape and known-value errors are rejected without touching the store.
 * Capability-level rules (which model allows what) run later against the
 * server-resolved connection in validateVideoRequest().
 */
export function validateControlVocabulary(operation: unknown, raw: RawVideoControls): VideoRequestValidation | null {
  if (raw.duration !== undefined) {
    const duration = Number(raw.duration)
    if (!Number.isInteger(duration) || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
      return fail('UNSUPPORTED_DURATION', 'Unsupported duration value.')
    }
  }
  if (raw.resolution !== undefined && !(VIDEO_RESOLUTIONS as readonly string[]).includes(raw.resolution as string)) {
    return fail('UNSUPPORTED_RESOLUTION', 'Unsupported resolution value.')
  }
  if (raw.audio !== undefined && raw.audio !== 'off' && raw.audio !== 'on') {
    return fail('UNSUPPORTED_AUDIO', 'Unsupported audio value.')
  }
  if (raw.multi_shot !== undefined && typeof raw.multi_shot !== 'boolean') {
    return fail('UNSUPPORTED_MULTI_SHOT', 'multi_shot must be a boolean.')
  }
  if (operation === 'image_to_video') {
    // Image-to-video takes its framing from the source image: no aspect ratio, for any connection.
    if (raw.aspect_ratio !== undefined && raw.aspect_ratio !== null && raw.aspect_ratio !== '') {
      return fail('UNSUPPORTED_ASPECT_RATIO', 'aspect_ratio is not supported for image_to_video.')
    }
  } else if (raw.aspect_ratio !== undefined && raw.aspect_ratio !== null && raw.aspect_ratio !== '') {
    if (!(VIDEO_ASPECT_RATIOS as readonly string[]).includes(raw.aspect_ratio as string)) {
      return fail('UNSUPPORTED_ASPECT_RATIO', 'Unsupported aspect_ratio for text_to_video.')
    }
  }
  if (raw.outputCount !== undefined && raw.outputCount !== 1) {
    return fail('UNSUPPORTED_OUTPUT_COUNT', 'Only one video per generation is supported.')
  }
  return null
}
