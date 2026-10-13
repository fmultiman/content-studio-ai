// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// The bounded, Content-Studio-owned VIDEO capability contract.
//
//   provider/connection-specific discovery
//     -> normalization adapter (rest-capabilities.ts / mcp-capabilities.ts)
//     -> THIS contract
//     -> the /videos form and the server-side validator
//
// Raw MCP schemas or provider JSON never reach the UI. Content Studio owns the
// product vocabulary; provider tool names, argument names and model ids are
// integration details that stay behind the adapters.
//
// Deliberately NOT a universal framework: it models exactly two operations
// (text_to_video, image_to_video) and the controls the product exposes today:
// duration, resolution, aspect ratio, audio, multi-shot, the MCP advanced
// controls (ASMR, audio prompt, music prompt) and, for image_to_video, an optional
// LAST frame (VEO_KLING_FIRST_LAST_FRAME_V1) - a per-model capability, never a global list. Both real connections express
// the discrete ones as a DISCRETE set of allowed values, so that is the only
// representation modelled (no range type until a real connection needs one).

export const VIDEO_OPERATIONS = ['image_to_video', 'text_to_video'] as const
export type VideoOperation = (typeof VIDEO_OPERATIONS)[number]

export function isVideoOperation(value: unknown): value is VideoOperation {
  return typeof value === 'string' && (VIDEO_OPERATIONS as readonly string[]).includes(value)
}

/** Bounds of a plausible duration control (seconds); shared by MCP normalization and request validation. */
export const MIN_DURATION_SECONDS = 1
export const MAX_DURATION_SECONDS = 120

export const VIDEO_RESOLUTIONS = ['720p', '1080p', '4k'] as const
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]

export type VideoAudio = 'off' | 'on'

export type VideoTransport = 'rest' | 'mcp'
export type VideoConnectionMethod = 'api_key' | 'mcp_oauth'

/** What one model can do for one operation. Provider ids stay server-side keys; `label` is for people. */
export interface VideoModelCapability {
  /** Provider model id (canonical, server-side authority). */
  id: string
  label: string
  /** Discrete allowed durations in seconds, ascending. */
  durations: number[]
  resolutions: VideoResolution[]
  /** Empty = the control is not offered (always empty for image_to_video). */
  aspectRatios: VideoAspectRatio[]
  /** The model has an audio control. When false the control is hidden and nothing is sent. */
  audio: boolean
  /** The model has a multi-shot control. When false the control is hidden and nothing is sent. */
  multiShot: boolean
  /** Audio can only be switched on at this resolution (provider-documented model constraint). */
  audioRequiresResolution?: VideoResolution
  /**
   * The model supports generating ASMR audio (boolean).
   */
  asmr: boolean
  /**
   * The model supports an explicit audio prompt description.
   */
  audioPrompt: boolean
  /**
   * The model supports an explicit music prompt description.
   */
  musicPrompt: boolean
  /**
   * Server-side mapping hint (MCP): the model declares an output-count
   * argument, which is always pinned to 1. Stripped from browser descriptors.
   */
  outputCountArg?: boolean
  /**
   * image_to_video only: the model accepts a first frame AND a last frame. Derived from the effective model/connection
   * contract (REST code, MCP `tail_image` input, Veo `lastFrame`) — never from a commercial name.
   */
  lastFrame?: VideoLastFrameCapability
  /**
   * Some providers only allow certain durations at certain resolutions (Veo 3.1: 1080p and 4k require 8 s).
   * When a resolution is listed here only these durations are valid at it; others keep the model's `durations`.
   */
  durationsByResolution?: Partial<Record<VideoResolution, number[]>>
  /**
   * The provider always generates audio with the video and exposes no switch (Veo). `audio` stays false (no control,
   * nothing sent); this flag only lets the UI say so truthfully.
   */
  nativeAudio?: boolean
}

/**
 * VEO_KLING_FIRST_LAST_FRAME_V1 — what one model needs when an image_to_video request also carries a LAST frame
 * (first-frame + last-frame). Absent on a model = the model does NOT accept a last frame, so a request that carries
 * one is rejected (never sent with the last frame silently dropped).
 *
 * This is a different capability from "reference images" (identity / appearance / style guidance), which this
 * product does not offer: a first/last frame DEFINES the start and the end of the clip.
 */
export interface VideoLastFrameCapability {
  /** The provider only accepts a last frame at this resolution (Kling 2.6: tail image requires 1080p). */
  requiresResolution?: VideoResolution
  /** false = audio must be 'off' when a last frame is sent (Kling 2.6: audio is not supported with a tail image). */
  audioAllowed: boolean
  /** false = multi-shot must be off when a last frame is sent (two frames define ONE continuous shot). */
  multiShotAllowed: boolean
}

export interface VideoOperationCapability {
  operation: VideoOperation
  models: VideoModelCapability[]
}

/** Declarative capability specification per operation for a specific model */
export interface VideoModelOperationsCapability {
  id: string
  label: string
  text_to_video?: VideoModelCapability
  image_to_video?: VideoModelCapability
}

export type VideoCapabilityFreshness =
  /** Code-backed (REST): always current. */
  | 'static'
  | 'fresh'
  | 'stale'
  /** No usable snapshot: the connection must be refreshed before it can drive the form. */
  | 'missing'

/**
 * Why a connection cannot start a generation right now. Distinct truths —
 * never collapsed into "no models" or "not connected".
 */
export type VideoConnectionBlockedReason =
  | 'not_configured'
  | 'authorization_required'
  | 'connection_error'
  | 'generation_authorization_required'
  | 'capabilities_missing'
  | 'capabilities_expired'
  | 'no_supported_models'
  /** The provider path is built but its release switch is off (Google Veo before the owner-authorized paid canary). */
  | 'feature_disabled'

/** Video providers a generation can be routed to. `gemini` = Google Veo through the user's own Gemini API key. */
export type VideoProviderId = 'kling' | 'gemini'

export interface VideoGenerationConnectionDescriptor {
  /** Opaque, server-resolvable reference (see connection-ref.ts). Never trusted without resolution. */
  ref: string
  provider: VideoProviderId
  connectionMethod: VideoConnectionMethod
  transport: VideoTransport
  /** Product-facing name, e.g. "Kling API" / "Minha conta Kling". */
  label: string
  /** Secondary technical detail, e.g. "REST · usa o pacote da API Kling". */
  detail: string
  /** Whose balance a generation consumes. Unrelated to Content Studio Credits, which do not exist. */
  funding: 'kling_api_package' | 'kling_web_credits' | 'google_gemini_api'
  status: 'connected' | 'not_configured' | 'authorization_required' | 'error'
  canGenerate: boolean
  blockedReason?: VideoConnectionBlockedReason
  /** True when the only thing missing is the explicit generation grant (read-only connection). */
  needsGenerationAuthorization: boolean
  /** Safe recognition hint (membership label / last digits) — never an identifier that could authorize anything. */
  accountLabel: string | null
  capabilitiesFreshness: VideoCapabilityFreshness
  capabilitiesCheckedAt: string | null
  /** Operations the form may offer. Empty when nothing usable is known. */
  operations: VideoOperationCapability[]
}

/** Body of GET /api/video-generations/connections (a 5xx carries `{ error, code }` instead). */
export interface VideoConnectionsResponse {
  connections: VideoGenerationConnectionDescriptor[]
}

/** Continuity with the REST integration's historical Kling 3.0 default; deliberately not a "best model" ranking. */
export const PREFERRED_DEFAULT_MODEL_IDS = ['kling-v3', 'kling-video-v3_0', 'veo-3.1-fast-generate-preview'] as const

/** Canonical logical model groups (REST id <-> MCP id) to preserve selection across transport switches */
export const LOGICAL_MODEL_MAPPING: Record<string, string[]> = {
  kling_3_0: ['kling-v3', 'kling-video-v3_0'],
  kling_2_6: ['kling-v2-6', 'kling-video-v2_6']
}

export function areLogicallyEquivalentModels(idA: string, idB: string): boolean {
  if (idA === idB) return true
  for (const group of Object.values(LOGICAL_MODEL_MAPPING)) {
    if (group.includes(idA) && group.includes(idB)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Explicit defaults
// ---------------------------------------------------------------------------
// Content Studio never relies on a provider default for a control it exposes:
// the value the user sees is the value the server sends. These pick a
// deterministic, valid default from what the model allows.

export const DEFAULT_DURATION_SECONDS = 5
export const DEFAULT_RESOLUTION: VideoResolution = '720p'
export const DEFAULT_ASPECT_RATIO: VideoAspectRatio = '16:9'
export const DEFAULT_AUDIO: VideoAudio = 'off'
export const DEFAULT_MULTI_SHOT = false
export const DEFAULT_ASMR = false
export const DEFAULT_AUDIO_PROMPT = ''
export const DEFAULT_MUSIC_PROMPT = ''

/** Durations valid for this model AT this resolution (some providers tie them together; see durationsByResolution). */
export function allowedDurations(model: VideoModelCapability, resolution?: VideoResolution | null): number[] {
  const restricted = resolution ? model.durationsByResolution?.[resolution] : undefined
  return restricted ? model.durations.filter((value) => restricted.includes(value)) : model.durations
}

export function defaultDuration(model: VideoModelCapability, resolution?: VideoResolution | null): number {
  const allowed = allowedDurations(model, resolution)
  if (allowed.includes(DEFAULT_DURATION_SECONDS)) return DEFAULT_DURATION_SECONDS
  // Prefer the longest clip when the provider offers no 5 s option (Veo: 4/6/8 -> 8): it is valid at every resolution.
  return allowed.length > 0 ? allowed[allowed.length - 1] : model.durations[0]
}

/**
 * Why a first+last-frame request is not valid for this model and context. Empty = valid. Shared by the UI (which
 * explains the reason) and the server validator (which rejects), so both always agree.
 */
export type LastFrameConflict = 'UNSUPPORTED_MODEL' | 'RESOLUTION' | 'AUDIO' | 'MULTI_SHOT'

export function lastFrameConflicts(
  model: VideoModelCapability,
  context: { resolution: VideoResolution | null; audio: VideoAudio | null; multiShot: boolean | null },
): LastFrameConflict[] {
  const capability = model.lastFrame
  if (!capability) return ['UNSUPPORTED_MODEL']
  const conflicts: LastFrameConflict[] = []
  if (capability.requiresResolution && context.resolution !== capability.requiresResolution) conflicts.push('RESOLUTION')
  if (!capability.audioAllowed && context.audio === 'on') conflicts.push('AUDIO')
  if (!capability.multiShotAllowed && context.multiShot === true) conflicts.push('MULTI_SHOT')
  return conflicts
}

export const LAST_FRAME_CONFLICT_MESSAGE: Record<LastFrameConflict, (model: VideoModelCapability) => string> = {
  UNSUPPORTED_MODEL: (model) => `${model.label} não aceita imagem final neste modo. Remova a imagem final ou escolha outro modelo.`,
  RESOLUTION: (model) => `${model.label} só aceita imagem final em ${model.lastFrame?.requiresResolution ?? 'outra resolução'}. Ajuste a resolução ou remova a imagem final.`,
  AUDIO: (model) => `${model.label} não permite áudio automático com imagem final. Desligue o áudio ou remova a imagem final.`,
  MULTI_SHOT: (model) => `${model.label} não permite multi-shot com imagem final. Desligue o multi-shot ou remova a imagem final.`,
}

export function defaultResolution(model: VideoModelCapability): VideoResolution {
  return model.resolutions.includes(DEFAULT_RESOLUTION) ? DEFAULT_RESOLUTION : model.resolutions[0]
}

export function defaultAspectRatio(model: VideoModelCapability): VideoAspectRatio | null {
  if (model.aspectRatios.length === 0) return null
  return model.aspectRatios.includes(DEFAULT_ASPECT_RATIO) ? DEFAULT_ASPECT_RATIO : model.aspectRatios[0]
}

export function defaultModel(models: VideoModelCapability[]): VideoModelCapability | null {
  if (models.length === 0) return null
  for (const id of PREFERRED_DEFAULT_MODEL_IDS) {
    const preferred = models.find((model) => model.id === id)
    if (preferred) return preferred
  }
  return models[0]
}

export function findOperation(
  operations: VideoOperationCapability[],
  operation: VideoOperation,
): VideoOperationCapability | undefined {
  return operations.find((entry) => entry.operation === operation && entry.models.length > 0)
}

export function findModel(
  operations: VideoOperationCapability[],
  operation: VideoOperation,
  modelId: string,
): VideoModelCapability | undefined {
  return findOperation(operations, operation)?.models.find((model) => model.id === modelId)
}

/** Whether the model lets the user pick audio 'on' at this resolution. */
export function audioAllowedAt(model: VideoModelCapability, resolution: VideoResolution): boolean {
  return model.audio && (!model.audioRequiresResolution || model.audioRequiresResolution === resolution)
}
