// VEO_KLING_FIRST_LAST_FRAME_V1 — official Google Veo client (Gemini API, user BYOK key). SERVER ONLY.
//
// Contract (ai.google.dev/gemini-api/docs/veo):
//   submit   POST {base}/v1beta/models/{model}:predictLongRunning
//            { instances: [{ prompt, image?, lastFrame? }], parameters: { aspectRatio, resolution, durationSeconds, numberOfVideos } }
//            `image` / `lastFrame` = { inlineData: { mimeType, data } }; `lastFrame` is only valid together with `image`.
//   status   GET  {base}/v1beta/{operation.name}        -> { done, error?, response.generateVideoResponse.generatedSamples[0].video.uri }
//   download GET  {video.uri} with the same `x-goog-api-key` header (the provider keeps the result for 2 days).
//
// Rules this module enforces:
//   - the API key travels ONLY in the `x-goog-api-key` header, never in a URL, and never in an error message;
//   - a submit is made EXACTLY ONCE (no retry): a transport failure or a 5xx may have created (and billed) the job,
//     so it is reported as an UNKNOWN outcome, and a definitive refusal (4xx) as a certain one;
//   - an operation name and a result URI are validated before they are used (no path/host steering);
//   - provider bodies are never copied into errors; only bounded, classified messages leave this module.
//
// No client-side retry, no polling loop here: the product's poller owns scheduling (lib/video-generation/polling.ts).

import { GEMINI_API_BASE } from './client'
import type { VideoAspectRatio, VideoResolution } from '@/lib/video-generation/capabilities'

/** The submit route allows 60 s in total (image loading included): fail as an UNKNOWN outcome inside that window, never be killed mid-flight. */
export const VEO_SUBMIT_TIMEOUT_MS = 45_000
export const VEO_STATUS_TIMEOUT_MS = 30_000
/** The only host a Veo result may be downloaded from (it needs the user's key, so it must never be steerable). */
export const VEO_RESULT_HOST = new URL(GEMINI_API_BASE).hostname
/** Gemini accepts ~20 MB of inline request data; two base64 frames must fit with the prompt. */
export const VEO_MAX_FRAME_BYTES = 7 * 1000 * 1000

const OPERATION_NAME = /^models\/[A-Za-z0-9._-]{1,120}\/operations\/[A-Za-z0-9._-]{1,200}$/
const MODEL_ID = /^veo-[a-z0-9.-]{1,80}$/

export type VeoFrameMime = 'image/png' | 'image/jpeg'
export interface VeoFrame {
  bytes: Uint8Array
  mimeType: VeoFrameMime
}

export interface VeoSubmitParams {
  apiKey: string
  model: string
  prompt: string
  duration: number
  resolution: VideoResolution
  aspectRatio: VideoAspectRatio
  /** image_to_video: the first frame. Absent = text_to_video. */
  firstFrame?: VeoFrame
  /** The last frame; only valid together with `firstFrame`. */
  lastFrame?: VeoFrame
}

export type VeoErrorKind =
  | 'invalid_credential'
  | 'quota'
  | 'unsupported_model'
  | 'rejected'
  | 'provider_unavailable'
  | 'unreadable_response'
  | 'invalid_input'

export class VeoError extends Error {
  readonly kind: VeoErrorKind
  /** True when the request may have reached Google and been billed but we cannot confirm it. Never retried. */
  readonly outcomeUnknown: boolean
  readonly status: number | null

  constructor(kind: VeoErrorKind, message: string, options: { outcomeUnknown?: boolean; status?: number | null } = {}) {
    super(message)
    this.name = 'VeoError'
    this.kind = kind
    this.outcomeUnknown = options.outcomeUnknown ?? false
    this.status = options.status ?? null
  }
}

export function isVeoError(error: unknown): error is VeoError {
  return error instanceof VeoError
}

export interface VeoClientOptions {
  fetchImpl?: typeof fetch
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

function inlineFrame(frame: VeoFrame) {
  return { inlineData: { mimeType: frame.mimeType, data: toBase64(frame.bytes) } }
}

/** The exact JSON sent to Google. Exported so tests can assert the wire contract without any network. */
export function buildVeoSubmitBody(params: Omit<VeoSubmitParams, 'apiKey'>) {
  if (params.lastFrame && !params.firstFrame) {
    throw new VeoError('invalid_input', 'A last frame requires a first frame.')
  }
  const frames = [params.firstFrame, params.lastFrame].filter((frame): frame is VeoFrame => !!frame)
  if (frames.some((frame) => frame.bytes.byteLength === 0 || frame.bytes.byteLength > VEO_MAX_FRAME_BYTES)) {
    throw new VeoError('invalid_input', 'A frame image is empty or too large for Veo.')
  }
  return {
    instances: [
      {
        prompt: params.prompt,
        ...(params.firstFrame ? { image: inlineFrame(params.firstFrame) } : {}),
        ...(params.lastFrame ? { lastFrame: inlineFrame(params.lastFrame) } : {}),
      },
    ],
    parameters: {
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      durationSeconds: params.duration,
      // One action -> one VideoGeneration -> one video.
      numberOfVideos: 1,
    },
  }
}

function classifyHttp(status: number): VeoError {
  if (status === 401 || status === 403) {
    return new VeoError('invalid_credential', 'O Google recusou a chave Gemini ou ela não tem acesso ao Veo (requer uma conta com faturamento ativo).', { status })
  }
  if (status === 429) return new VeoError('quota', 'O limite de uso da sua conta Google foi atingido. Tente novamente mais tarde.', { status })
  if (status === 404) return new VeoError('unsupported_model', 'O Google não encontrou este modelo Veo para a sua chave.', { status })
  if (status >= 500) return new VeoError('provider_unavailable', 'O Google Veo está indisponível no momento.', { status, outcomeUnknown: true })
  return new VeoError('rejected', 'O Google recusou esta geração (parâmetros ou conteúdo não aceitos).', { status })
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export type VeoSubmitResult = { operationName: string }

/**
 * Starts ONE video generation. Never retried.
 *   - transport failure / timeout / 5xx / unreadable 2xx  -> outcomeUnknown = true (the job may exist and be billed)
 *   - 4xx                                                  -> definitive refusal, nothing was started
 */
export async function submitVeoVideo(params: VeoSubmitParams, options: VeoClientOptions = {}): Promise<VeoSubmitResult> {
  if (!MODEL_ID.test(params.model)) throw new VeoError('invalid_input', 'Unsupported Veo model id.')
  // Built (and validated) BEFORE any network I/O, so an invalid input can never reach Google.
  const body = JSON.stringify(buildVeoSubmitBody(params))
  const fetchImpl = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(`${GEMINI_API_BASE}/v1beta/models/${params.model}:predictLongRunning`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': params.apiKey },
      body,
      signal: AbortSignal.timeout(VEO_SUBMIT_TIMEOUT_MS),
    })
  } catch {
    // The request may have been received before the connection dropped: unknown, never retried.
    throw new VeoError('provider_unavailable', 'Não foi possível confirmar o envio ao Google Veo.', { outcomeUnknown: true })
  }

  if (!response.ok) throw classifyHttp(response.status)

  const payload = (await readJson(response)) as { name?: unknown } | null
  const name = typeof payload?.name === 'string' ? payload.name : ''
  if (!OPERATION_NAME.test(name)) {
    // Google answered 2xx but we cannot find the operation: possibly billed.
    throw new VeoError('unreadable_response', 'O Google aceitou o envio, mas a resposta não pôde ser lida.', { outcomeUnknown: true, status: response.status })
  }
  return { operationName: name }
}

export type VeoOperationState =
  | { state: 'processing' }
  | { state: 'succeeded'; videoUri: string }
  /** Finished without a video (provider error or safety filter). Google only charges for generated videos. */
  | { state: 'failed'; code: 'PROVIDER_FAILED' | 'PROVIDER_CONTENT_FILTERED'; message: string }

export function isSafeVeoResultUri(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === VEO_RESULT_HOST && !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

interface RawOperation {
  done?: unknown
  error?: { code?: unknown; message?: unknown }
  response?: {
    generateVideoResponse?: RawVideoResponse
    generatedVideos?: Array<{ video?: { uri?: unknown } }>
  }
}
interface RawVideoResponse {
  generatedSamples?: Array<{ video?: { uri?: unknown } }>
  raiMediaFilteredCount?: unknown
  raiMediaFilteredReasons?: unknown
}

export function parseVeoOperation(payload: unknown): VeoOperationState {
  const operation = payload as RawOperation | null
  if (!operation || typeof operation !== 'object') throw new VeoError('unreadable_response', 'Resposta ilegível do Google Veo.')
  if (operation.done !== true) return { state: 'processing' }

  if (operation.error) {
    return { state: 'failed', code: 'PROVIDER_FAILED', message: 'O Google Veo não concluiu esta geração.' }
  }
  const video = operation.response?.generateVideoResponse
  const uri = video?.generatedSamples?.[0]?.video?.uri ?? operation.response?.generatedVideos?.[0]?.video?.uri
  if (typeof uri === 'string' && uri) {
    if (!isSafeVeoResultUri(uri)) {
      return { state: 'failed', code: 'PROVIDER_FAILED', message: 'O resultado do Google Veo não pôde ser copiado com segurança.' }
    }
    return { state: 'succeeded', videoUri: uri }
  }
  const filtered = typeof video?.raiMediaFilteredCount === 'number' && video.raiMediaFilteredCount > 0
  return {
    state: 'failed',
    code: filtered ? 'PROVIDER_CONTENT_FILTERED' : 'PROVIDER_FAILED',
    message: filtered
      ? 'O Google Veo bloqueou o resultado pelos filtros de segurança. Ajuste o prompt ou as imagens. Gerações bloqueadas não são cobradas.'
      : 'O Google Veo terminou sem entregar um vídeo.',
  }
}

/** Reads one operation. Transient problems throw VeoError('provider_unavailable'); the poller retries them later. */
export async function getVeoOperation(
  apiKey: string,
  operationName: string,
  options: VeoClientOptions = {},
): Promise<VeoOperationState> {
  if (!OPERATION_NAME.test(operationName)) throw new VeoError('invalid_input', 'Invalid operation name.')
  const fetchImpl = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(`${GEMINI_API_BASE}/v1beta/${operationName}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(VEO_STATUS_TIMEOUT_MS),
    })
  } catch {
    throw new VeoError('provider_unavailable', 'Não foi possível consultar o Google Veo agora.')
  }
  if (response.status === 404) {
    // The operation is gone (the provider keeps results for 2 days): definitive for this generation.
    return { state: 'failed', code: 'PROVIDER_FAILED', message: 'O Google não encontrou mais esta geração (resultados expiram em 2 dias).' }
  }
  if (!response.ok) {
    const error = classifyHttp(response.status)
    // A status read never creates a job: even a 5xx is just "try again later".
    throw new VeoError(error.kind, error.message, { status: response.status })
  }
  return parseVeoOperation(await readJson(response))
}
