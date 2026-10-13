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
  LAST_FRAME_CONFLICT_MESSAGE,
  allowedDurations,
  lastFrameConflicts,
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
  asmr?: unknown
  audio_prompt?: unknown
  music_prompt?: unknown
  outputCount?: unknown
  /** VEO_KLING_FIRST_LAST_FRAME_V1: true when the request carries a LAST frame (the route resolves the identity). */
  lastFrame?: unknown
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
  asmr: boolean | null
  audioPrompt: string | null
  musicPrompt: string | null
  /** image_to_video with a first AND a last frame. false = first frame only (or text_to_video). */
  lastFrame: boolean
}

export type VideoRequestFailureCode =
  | 'UNSUPPORTED_OPERATION'
  | 'UNSUPPORTED_MODEL'
  | 'UNSUPPORTED_DURATION'
  | 'UNSUPPORTED_RESOLUTION'
  | 'UNSUPPORTED_ASPECT_RATIO'
  | 'UNSUPPORTED_AUDIO'
  | 'UNSUPPORTED_MULTI_SHOT'
  | 'UNSUPPORTED_ASMR'
  | 'UNSUPPORTED_AUDIO_PROMPT'
  | 'UNSUPPORTED_MUSIC_PROMPT'
  | 'AUDIO_RESOLUTION_CONFLICT'
  | 'UNSUPPORTED_OUTPUT_COUNT'
  | 'UNSUPPORTED_LAST_FRAME'
  | 'LAST_FRAME_RESOLUTION_CONFLICT'
  | 'LAST_FRAME_AUDIO_CONFLICT'
  | 'LAST_FRAME_MULTI_SHOT_CONFLICT'
  | 'LAST_FRAME_DURATION_CONFLICT'
  | 'DURATION_RESOLUTION_CONFLICT'

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

  let duration: number
  if (raw.duration === undefined) {
    duration = defaultDuration(model, resolution)
  } else {
    duration = Number(raw.duration)
    if (!model.durations.includes(duration)) return fail('UNSUPPORTED_DURATION', 'Unsupported duration value.')
    if (!allowedDurations(model, resolution).includes(duration)) {
      return fail('DURATION_RESOLUTION_CONFLICT', `${model.label} só permite ${allowedDurations(model, resolution).join(' / ')} s em ${resolution}.`)
    }
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

  let asmr: boolean | null
  if (raw.asmr === undefined) {
    asmr = model.asmr ? false : null
  } else if (!model.asmr) {
    return fail('UNSUPPORTED_ASMR', 'This model does not support ASMR.')
  } else if (typeof raw.asmr !== 'boolean') {
    return fail('UNSUPPORTED_ASMR', 'asmr must be a boolean.')
  } else {
    asmr = raw.asmr
  }

  let audioPrompt: string | null
  if (raw.audio_prompt === undefined) {
    audioPrompt = model.audioPrompt ? '' : null
  } else if (!model.audioPrompt) {
    return fail('UNSUPPORTED_AUDIO_PROMPT', 'This model does not support an audio prompt.')
  } else if (typeof raw.audio_prompt !== 'string') {
    return fail('UNSUPPORTED_AUDIO_PROMPT', 'audio_prompt must be a string.')
  } else {
    audioPrompt = raw.audio_prompt
  }

  let musicPrompt: string | null
  if (raw.music_prompt === undefined) {
    musicPrompt = model.musicPrompt ? '' : null
  } else if (!model.musicPrompt) {
    return fail('UNSUPPORTED_MUSIC_PROMPT', 'This model does not support a music prompt.')
  } else if (typeof raw.music_prompt !== 'string') {
    return fail('UNSUPPORTED_MUSIC_PROMPT', 'music_prompt must be a string.')
  } else {
    musicPrompt = raw.music_prompt
  }

  // First + last frame: never sent when the model/context cannot honour it, never sent with the frame dropped.
  let lastFrame = false
  if (raw.lastFrame !== undefined && raw.lastFrame !== false) {
    if (raw.lastFrame !== true) return fail('UNSUPPORTED_LAST_FRAME', 'lastFrame must be a boolean.')
    if (operation !== 'image_to_video') return fail('UNSUPPORTED_LAST_FRAME', 'A last frame is only valid for image_to_video.')
    const conflicts = lastFrameConflicts(model, { resolution, audio, multiShot, duration })
    if (conflicts.includes('UNSUPPORTED_MODEL')) return fail('UNSUPPORTED_LAST_FRAME', LAST_FRAME_CONFLICT_MESSAGE.UNSUPPORTED_MODEL(model))
    if (conflicts.includes('RESOLUTION')) return fail('LAST_FRAME_RESOLUTION_CONFLICT', LAST_FRAME_CONFLICT_MESSAGE.RESOLUTION(model))
    if (conflicts.includes('AUDIO')) return fail('LAST_FRAME_AUDIO_CONFLICT', LAST_FRAME_CONFLICT_MESSAGE.AUDIO(model))
    if (conflicts.includes('MULTI_SHOT')) return fail('LAST_FRAME_MULTI_SHOT_CONFLICT', LAST_FRAME_CONFLICT_MESSAGE.MULTI_SHOT(model))
    if (conflicts.includes('DURATION')) return fail('LAST_FRAME_DURATION_CONFLICT', LAST_FRAME_CONFLICT_MESSAGE.DURATION(model))
    lastFrame = true
  }

  return {
    ok: true,
    model,
    request: { operation, model: model.id, duration, resolution, aspectRatio, audio, multiShot, asmr, audioPrompt, musicPrompt, lastFrame },
  }
}

/**
 * Cheap, connection-independent vocabulary check that runs BEFORE any database
 * access: shape and known-value errors are rejected without touching the store.
 * Capability-level rules (which model allows what) run later against the
 * server-resolved connection in validateVideoRequest().
 */
export function validateControlVocabulary(
  operation: unknown,
  raw: RawVideoControls,
  options: { imageToVideoAspectRatio?: boolean } = {},
): VideoRequestValidation | null {
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
  if (raw.asmr !== undefined && typeof raw.asmr !== 'boolean') {
    return fail('UNSUPPORTED_ASMR', 'asmr must be a boolean.')
  }
  if (raw.audio_prompt !== undefined && typeof raw.audio_prompt !== 'string') {
    return fail('UNSUPPORTED_AUDIO_PROMPT', 'audio_prompt must be a string.')
  }
  if (raw.music_prompt !== undefined && typeof raw.music_prompt !== 'string') {
    return fail('UNSUPPORTED_MUSIC_PROMPT', 'music_prompt must be a string.')
  }
  if (operation === 'image_to_video') {
    // Kling takes its framing from the source image: no aspect ratio, for any Kling connection. Google Veo takes an
    // explicit 16:9 / 9:16 for image input too, so the caller (which knows the connection pointer WITHOUT a database
    // read) opts in; validateVideoRequest() still enforces the per-model rule against the resolved capabilities.
    if (raw.aspect_ratio !== undefined && raw.aspect_ratio !== null && raw.aspect_ratio !== '') {
      if (!options.imageToVideoAspectRatio) return fail('UNSUPPORTED_ASPECT_RATIO', 'aspect_ratio is not supported for image_to_video.')
      if (!(VIDEO_ASPECT_RATIOS as readonly string[]).includes(raw.aspect_ratio as string)) {
        return fail('UNSUPPORTED_ASPECT_RATIO', 'Unsupported aspect_ratio for image_to_video.')
      }
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
