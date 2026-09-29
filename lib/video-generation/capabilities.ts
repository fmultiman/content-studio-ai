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
// (text_to_video, image_to_video) and the five controls the product exposes
// today (duration, resolution, aspect ratio, audio, multi-shot). Both real
// connections express every one of them as a DISCRETE set of allowed values,
// so that is the only representation modelled (no range type until a real
// connection needs one).

export const VIDEO_OPERATIONS = ['image_to_video', 'text_to_video'] as const
export type VideoOperation = (typeof VIDEO_OPERATIONS)[number]

export function isVideoOperation(value: unknown): value is VideoOperation {
  return typeof value === 'string' && (VIDEO_OPERATIONS as readonly string[]).includes(value)
}

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
   * Server-side mapping hint (MCP): the model declares an output-count
   * argument, which is always pinned to 1. Stripped from browser descriptors.
   */
  outputCountArg?: boolean
}

export interface VideoOperationCapability {
  operation: VideoOperation
  models: VideoModelCapability[]
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

export interface VideoGenerationConnectionDescriptor {
  /** Opaque, server-resolvable reference (see connection-ref.ts). Never trusted without resolution. */
  ref: string
  provider: 'kling'
  connectionMethod: VideoConnectionMethod
  transport: VideoTransport
  /** Product-facing name, e.g. "Kling API" / "Minha conta Kling". */
  label: string
  /** Secondary technical detail, e.g. "REST · usa o pacote da API Kling". */
  detail: string
  /** Whose balance a generation consumes. Unrelated to Content Studio Credits, which do not exist. */
  funding: 'kling_api_package' | 'kling_web_credits'
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
export const PREFERRED_DEFAULT_MODEL_IDS = ['kling-v3', 'kling-video-v3_0'] as const

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

export function defaultDuration(model: VideoModelCapability): number {
  return model.durations.includes(DEFAULT_DURATION_SECONDS) ? DEFAULT_DURATION_SECONDS : model.durations[0]
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
