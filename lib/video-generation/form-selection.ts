// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Deterministic reconciliation of the /videos form selection against the
// capabilities of the selected connection/operation/model. Pure and
// framework-free so the exact same rules are unit-tested and drive the UI.
//
// Principles
//   - A previous value survives ONLY if the new context still allows it;
//     otherwise it is reset to a valid explicit default — never left as an
//     invisible invalid state.
//   - A control the selected model does not offer is `null` (hidden) and is
//     never submitted.
//   - Kling REST stays the default connection when it is usable. MCP is never
//     chosen automatically just because it offers more.

import {
  VIDEO_OPERATIONS,
  allowedDurations,
  audioAllowedAt,
  areLogicallyEquivalentModels,
  defaultAspectRatio,
  defaultDuration,
  defaultModel,
  defaultResolution,
  findModel,
  findOperation,
  lastFrameConflicts,
  type LastFrameConflict,
  type VideoAspectRatio,
  type VideoAudio,
  type VideoGenerationConnectionDescriptor,
  type VideoModelCapability,
  type VideoOperation,
  type VideoResolution,
} from './capabilities'

export interface VideoFormSelection {
  connectionRef: string | null
  operation: VideoOperation | null
  modelId: string | null
  duration: number | null
  resolution: VideoResolution | null
  aspectRatio: VideoAspectRatio | null
  audio: VideoAudio | null
  multiShot: boolean | null
  asmr: boolean | null
  audioPrompt: string | null
  musicPrompt: string | null
}

export const EMPTY_SELECTION: VideoFormSelection = {
  connectionRef: null,
  operation: null,
  modelId: null,
  duration: null,
  resolution: null,
  aspectRatio: null,
  audio: null,
  multiShot: null,
  asmr: null,
  audioPrompt: null,
  musicPrompt: null,
}

/** Which controls the selected model offers. Drives rendering; hidden controls are never submitted. */
export interface VisibleControls {
  aspectRatio: boolean
  audio: boolean
  multiShot: boolean
  asmr: boolean
  audioPrompt: boolean
  musicPrompt: boolean
}

export function visibleControls(model: VideoModelCapability | null): VisibleControls {
  return {
    aspectRatio: !!model && model.aspectRatios.length > 0,
    audio: !!model && model.audio,
    multiShot: !!model && model.multiShot,
    asmr: !!model && model.asmr,
    audioPrompt: !!model && model.audioPrompt,
    musicPrompt: !!model && model.musicPrompt,
  }
}

function pickDefaultConnection(connections: VideoGenerationConnectionDescriptor[]): VideoGenerationConnectionDescriptor | null {
  if (connections.length === 0) return null
  // Preserve the existing REST behaviour: it is the default whenever it can generate.
  const usableRest = connections.find((entry) => entry.transport === 'rest' && entry.canGenerate)
  if (usableRest) return usableRest
  const usable = connections.find((entry) => entry.canGenerate)
  if (usable) return usable
  return connections.find((entry) => entry.transport === 'rest') ?? connections[0]
}

export function selectedConnection(
  connections: VideoGenerationConnectionDescriptor[],
  selection: VideoFormSelection,
): VideoGenerationConnectionDescriptor | null {
  return connections.find((entry) => entry.ref === selection.connectionRef) ?? null
}

export function selectedModel(
  connections: VideoGenerationConnectionDescriptor[],
  selection: VideoFormSelection,
): VideoModelCapability | null {
  const connection = selectedConnection(connections, selection)
  if (!connection || !selection.operation || !selection.modelId) return null
  return findModel(connection.operations, selection.operation, selection.modelId) ?? null
}

/**
 * VEO_KLING_FIRST_LAST_FRAME_V1 - the form-level answer to "can this selection be sent with a last frame?".
 * Empty = yes. Anything else is shown to the user next to the last-frame slot and blocks the submit: the frame is never
 * dropped silently and the model/resolution/audio is never changed behind the user's back.
 */
export function lastFrameBlockers(model: VideoModelCapability | null, selection: VideoFormSelection): LastFrameConflict[] {
  if (!model) return ['UNSUPPORTED_MODEL']
  return lastFrameConflicts(model, { resolution: selection.resolution, audio: selection.audio, multiShot: selection.multiShot, duration: selection.duration })
}

export function reconcileSelection(
  connections: VideoGenerationConnectionDescriptor[],
  previous: VideoFormSelection = EMPTY_SELECTION,
): VideoFormSelection {
  const connection =
    connections.find((entry) => entry.ref === previous.connectionRef) ?? pickDefaultConnection(connections)
  if (!connection) return { ...EMPTY_SELECTION }

  const operation =
    previous.operation && findOperation(connection.operations, previous.operation)
      ? previous.operation
      : (VIDEO_OPERATIONS.find((candidate) => findOperation(connection.operations, candidate)) ?? null)
  if (!operation) return { ...EMPTY_SELECTION, connectionRef: connection.ref }

  const models = findOperation(connection.operations, operation)!.models
  const model =
    models.find((entry) => entry.id === previous.modelId) ??
    models.find((entry) => previous.modelId && areLogicallyEquivalentModels(entry.id, previous.modelId)) ??
    defaultModel(models)!

  const resolution =
    previous.resolution !== null && model.resolutions.includes(previous.resolution)
      ? previous.resolution
      : defaultResolution(model)

  // Duration is judged AFTER the resolution: some providers tie them together (Veo 1080p/4k -> 8 s only).
  const duration =
    previous.duration !== null && allowedDurations(model, resolution).includes(previous.duration)
      ? previous.duration
      : defaultDuration(model, resolution)

  const aspectRatio =
    model.aspectRatios.length === 0
      ? null
      : previous.aspectRatio !== null && model.aspectRatios.includes(previous.aspectRatio)
        ? previous.aspectRatio
        : defaultAspectRatio(model)

  let audio: VideoAudio | null = null
  if (model.audio) {
    audio = previous.audio ?? 'off'
    if (audio === 'on' && !audioAllowedAt(model, resolution)) audio = 'off'
  }

  const multiShot = model.multiShot ? (previous.multiShot ?? false) : null
  const asmr = model.asmr ? (previous.asmr ?? false) : null
  const audioPrompt = model.audioPrompt ? (previous.audioPrompt ?? '') : null
  const musicPrompt = model.musicPrompt ? (previous.musicPrompt ?? '') : null

  return { connectionRef: connection.ref, operation, modelId: model.id, duration, resolution, aspectRatio, audio, multiShot, asmr, audioPrompt, musicPrompt }
}

/** Body fields for POST /api/video-generations — visible controls only. */
export function toSubmitControls(selection: VideoFormSelection): Record<string, unknown> {
  return {
    connectionRef: selection.connectionRef,
    mode: selection.operation,
    model: selection.modelId,
    duration: selection.duration,
    resolution: selection.resolution,
    ...(selection.aspectRatio !== null ? { aspect_ratio: selection.aspectRatio } : {}),
    ...(selection.audio !== null ? { audio: selection.audio } : {}),
    ...(selection.multiShot !== null ? { multi_shot: selection.multiShot } : {}),
    ...(selection.asmr !== null ? { asmr: selection.asmr } : {}),
    ...(selection.audioPrompt !== null ? { audio_prompt: selection.audioPrompt } : {}),
    ...(selection.musicPrompt !== null ? { music_prompt: selection.musicPrompt } : {}),
  }
}
