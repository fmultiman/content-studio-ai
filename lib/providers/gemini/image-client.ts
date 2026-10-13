// FUTURE-064 Slice A — official Gemini API image generation and editing client. SERVER ONLY.
//
// Contract (Google Gemini API, https://ai.google.dev/api/generate-content, verified 2026-10-11):
//   POST {GEMINI_API_BASE}/v1beta/models/{model}:generateContent   (host constant lives only in client.ts)
//   header  x-goog-api-key: <user's BYOK key>        (never in a URL, never in a message)
//   body    { contents:[{ role:'user', parts:[{ text }] }],
//             generationConfig:{ responseModalities:['IMAGE'], imageConfig:{ aspectRatio, imageSize } } }
//   reply   candidates[].content.parts[].inlineData { mimeType, data(base64) }, usageMetadata, promptFeedback
//
// This module is deliberately SEPARATE from lib/providers/gemini/client.ts: that client parses text/JSON for
// Review and prompt assistance and must not be bent to carry image payloads.
//
// Guarantees:
//   * One HTTP request per call. No retry, no fallback model, no fallback provider: a retry is a second paid call
//     and is the caller's (user's) explicit decision.
//   * The response body is read under a hard byte cap before it is parsed.
//   * The returned image has been decoded from strict base64, matches an allow-listed MIME type, carries that
//     type's file signature, and has sane dimensions. Anything else is a typed error, never an "image".
//   * Provider bodies, prompts and keys never appear in an error message.
//   * Usage is captured through the shared normalizer (`extractGeminiUsage`): unreported usage is `null`, never 0.
//     This is the contract Slice C will record; Slice A records nothing and computes no cost.
import sharp from 'sharp'
import { GEMINI_API_BASE } from './client'
import { extractGeminiUsage, type GeminiUsage } from './usage'
import { GEMINI_IMAGE_ALIASES, resolveGeminiImageModel } from './image-models'

export const GEMINI_IMAGE_TIMEOUT_MS = 120_000
/** Decoded image ceiling. A 1K Gemini image is a few MiB; anything near this is not a legitimate result. */
export const GEMINI_IMAGE_MAX_BYTES = 16 * 1024 * 1024
/** Whole JSON response ceiling (base64 inflates by 4/3, plus the surrounding envelope). */
export const GEMINI_IMAGE_MAX_RESPONSE_BYTES = 24 * 1024 * 1024
export const GEMINI_IMAGE_MIN_BYTES = 64
export const GEMINI_IMAGE_MAX_DIMENSION = 8192

export const GEMINI_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type GeminiImageMimeType = (typeof GEMINI_IMAGE_MIME_TYPES)[number]

export type GeminiImageErrorKind =
  | 'invalid_credential'
  | 'rate_limited'
  | 'unsupported_model'
  | 'invalid_request'
  | 'content_blocked'
  | 'provider_server_error'
  | 'timeout'
  | 'network'
  | 'malformed_response'
  | 'no_image'
  | 'invalid_image'
  | 'image_too_large'

// True when the provider may have processed (and billed) the request although we hold no usable result.
const OUTCOME_UNKNOWN: Record<GeminiImageErrorKind, boolean> = {
  invalid_credential: false,
  rate_limited: false,
  unsupported_model: false,
  invalid_request: false,
  content_blocked: false,
  provider_server_error: true,
  timeout: true,
  network: true,
  malformed_response: true,
  no_image: true,
  invalid_image: true,
  image_too_large: true,
}

/**
 * FUTURE-064 Slice C. What Google DID send back when a response was received (HTTP 2xx) but turned out unusable as an
 * image (blocked, no image, invalid image...). It exists so the server can account for a provider execution whose usage
 * Google reported even though no image could be kept. `usage: null` = the response reported none (unknown, NOT zero).
 * It is never set for a transport failure, a timeout, an HTTP error status or an unreadable body: in those cases Content
 * Studio holds no provider response, so it holds no usage and must not invent a ledger row.
 */
export type GeminiImageReceived = {
  usage: GeminiUsage | null
  responseId: string | null
  modelVersion: string | null
}

export class GeminiImageError extends Error {
  readonly outcomeUnknown: boolean
  /** Set (once) only when a 2xx response envelope was received; see GeminiImageReceived. */
  received: GeminiImageReceived | null = null
  constructor(readonly kind: GeminiImageErrorKind, message: string, readonly status?: number) {
    super(message)
    this.name = 'GeminiImageError'
    this.outcomeUnknown = OUTCOME_UNKNOWN[kind]
  }
}

export function isGeminiImageError(error: unknown): error is GeminiImageError {
  return error instanceof GeminiImageError
}

export type GeminiImageRequest = {
  apiKey: string
  /** Official Google model id, already resolved from the closed alias registry by the caller. */
  providerModel: string
  prompt: string
  aspectRatio: string
  imageSize: string
  timeoutMs?: number
  referenceImages?: ReadonlyArray<{ bytes: Buffer; mimeType: GeminiImageMimeType }>
}

export type GeminiImageResult = {
  bytes: Buffer
  mimeType: GeminiImageMimeType
  width: number
  height: number
  responseId: string | null
  modelVersion: string | null
  /** Normalized provider usage for Slice C. `null` = the response reported none (unknown, NOT zero). */
  usage: GeminiUsage | null
}

export type GeminiImageClientOptions = { fetchImpl?: typeof fetch }

const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_RECITATION',
])

const FORMAT_FOR_MIME: Record<GeminiImageMimeType, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }

function classifyHttp(status: number, body: unknown): GeminiImageError {
  const error = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error
  const reasons = Array.isArray(error?.details) ? (error.details as Array<Record<string, unknown>>).map((detail) => detail?.reason) : []
  const message = typeof error?.message === 'string' ? error.message : ''
  if (status === 401 || status === 403 || reasons.includes('API_KEY_INVALID') || /api key not valid/i.test(message)) {
    return new GeminiImageError('invalid_credential', 'Gemini rejected the configured API key.', status)
  }
  if (status === 429) return new GeminiImageError('rate_limited', 'Gemini rate limit or quota reached.', status)
  if (status === 404) return new GeminiImageError('unsupported_model', 'Gemini model was not found.', status)
  if (status === 408) return new GeminiImageError('timeout', 'Gemini image request timed out.', status)
  if (status >= 500) return new GeminiImageError('provider_server_error', 'Gemini is temporarily unavailable.', status)
  return new GeminiImageError('invalid_request', 'Gemini rejected the image request.', status)
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new GeminiImageError('image_too_large', 'Gemini response is larger than allowed.')
  if (!response.body) {
    const text = await response.text()
    if (text.length > maxBytes) throw new GeminiImageError('image_too_large', 'Gemini response is larger than allowed.')
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new GeminiImageError('image_too_large', 'Gemini response is larger than allowed.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function hasSignature(bytes: Buffer, mime: GeminiImageMimeType): boolean {
  if (mime === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function decodeStrictBase64(data: string): Buffer {
  if (data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) throw new GeminiImageError('invalid_image', 'Gemini image data was not valid base64.')
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const expected = (data.length / 4) * 3 - padding
  if (expected > GEMINI_IMAGE_MAX_BYTES) throw new GeminiImageError('image_too_large', 'Gemini image is larger than allowed.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length !== expected) throw new GeminiImageError('invalid_image', 'Gemini image data was not valid base64.')
  return bytes
}

type Part = { inlineData?: { mimeType?: unknown; data?: unknown }; inline_data?: { mime_type?: unknown; data?: unknown }; text?: unknown }

function firstInlineImage(parts: unknown): { mimeType: unknown; data: unknown } | null {
  if (!Array.isArray(parts)) return null
  for (const part of parts as Part[]) {
    const inline = part?.inlineData ?? null
    if (inline && typeof inline === 'object') return { mimeType: inline.mimeType, data: inline.data }
    const snake = part?.inline_data ?? null
    if (snake && typeof snake === 'object') return { mimeType: snake.mime_type, data: snake.data }
  }
  return null
}

export function buildGeminiImageUrl(providerModel: string) {
  return `${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(providerModel)}:generateContent`
}

export function buildGeminiImageRequestBody(input: Pick<GeminiImageRequest, 'prompt' | 'aspectRatio' | 'imageSize' | 'referenceImages'>) {
  return {
    contents: [{ role: 'user', parts: [
      { text: input.prompt },
      ...(input.referenceImages ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.bytes.toString('base64') } })),
    ] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.imageSize },
    },
  }
}

export async function generateGeminiImage(input: GeminiImageRequest, options: GeminiImageClientOptions = {}): Promise<GeminiImageResult> {
  // Validate references again at the adapter boundary. T2I retains its exact existing payload.
  const references = input.referenceImages ?? []
  let maxRequestBytes: number | undefined
  if (references.length) {
    const model = GEMINI_IMAGE_ALIASES.map(resolveGeminiImageModel).find((entry) => entry?.providerModel === input.providerModel)
    if (!model || references.length > model.referenceCapabilities.maxReferences || !model.imageSizes.includes(input.imageSize) || !model.aspectRatios.includes(input.aspectRatio)) {
      throw new GeminiImageError('invalid_request', 'Unsupported image reference configuration.')
    }
    maxRequestBytes = model.referenceCapabilities.maxRequestBytes
    for (const image of references) {
      if (!model.referenceCapabilities.mimeTypes.includes(image.mimeType) || !hasSignature(image.bytes, image.mimeType)) {
        throw new GeminiImageError('invalid_request', 'Unsupported image reference format.')
      }
      if (image.bytes.length > model.referenceCapabilities.maxBytes) throw new GeminiImageError('invalid_request', 'Image reference is larger than allowed.')
    }
  }
  const requestBody = JSON.stringify(buildGeminiImageRequestBody(input))
  if (maxRequestBytes !== undefined && Buffer.byteLength(requestBody, 'utf8') > maxRequestBytes) {
    throw new GeminiImageError('invalid_request', 'Inline request is larger than allowed.')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? GEMINI_IMAGE_TIMEOUT_MS)

  let raw: string
  let response: Response
  try {
    try {
      response = await fetchImpl(buildGeminiImageUrl(input.providerModel), {
        method: 'POST',
        headers: { 'x-goog-api-key': input.apiKey, 'content-type': 'application/json' },
        body: requestBody,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw new GeminiImageError('timeout', 'Gemini image request timed out.')
      throw new GeminiImageError('network', 'Gemini image request failed.')
    }
    try {
      raw = await readBounded(response, GEMINI_IMAGE_MAX_RESPONSE_BYTES)
    } catch (error) {
      if (isGeminiImageError(error)) {
        // A 2xx answer too large to read is still a response Google produced: the execution is known, its usage is not.
        if (response.ok && error.kind === 'image_too_large') error.received = { usage: null, responseId: null, modelVersion: null }
        throw error
      }
      if ((error as { name?: string })?.name === 'AbortError') throw new GeminiImageError('timeout', 'Gemini image request timed out.')
      throw new GeminiImageError('network', 'Gemini image response could not be read.')
    }
  } finally {
    clearTimeout(timer)
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    if (!response.ok) throw classifyHttp(response.status, null)
    throw new GeminiImageError('malformed_response', 'Gemini returned an unreadable response.', response.status)
  }
  if (!response.ok) throw classifyHttp(response.status, body)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GeminiImageError('malformed_response', 'Gemini returned an unexpected response.', response.status)

  const envelope = body as {
    candidates?: unknown
    promptFeedback?: { blockReason?: unknown }
    usageMetadata?: unknown
    responseId?: unknown
    modelVersion?: unknown
  }
  // From here on a response envelope was received: any failure carries what Google reported, so usage can be accounted.
  const received: GeminiImageReceived = {
    usage: extractGeminiUsage(envelope.usageMetadata),
    responseId: typeof envelope.responseId === 'string' ? envelope.responseId : null,
    modelVersion: typeof envelope.modelVersion === 'string' ? envelope.modelVersion : null,
  }
  try {
    const image = await imageFromEnvelope(envelope)
    return { ...image, responseId: received.responseId, modelVersion: received.modelVersion, usage: received.usage }
  } catch (error) {
    if (isGeminiImageError(error) && !error.received) error.received = received
    throw error
  }
}

type GeminiEnvelope = {
  candidates?: unknown
  promptFeedback?: { blockReason?: unknown }
  usageMetadata?: unknown
  responseId?: unknown
  modelVersion?: unknown
}

/** Validates the candidate and returns the decoded image, or throws a typed GeminiImageError. */
async function imageFromEnvelope(envelope: GeminiEnvelope): Promise<Pick<GeminiImageResult, 'bytes' | 'mimeType' | 'width' | 'height'>> {
  const candidates = Array.isArray(envelope.candidates) ? (envelope.candidates as Array<{ content?: { parts?: unknown }; finishReason?: unknown }>) : []
  const blockReason = envelope.promptFeedback && typeof envelope.promptFeedback.blockReason === 'string' ? envelope.promptFeedback.blockReason : null
  if (candidates.length === 0) {
    if (blockReason) throw new GeminiImageError('content_blocked', 'Gemini blocked the prompt.')
    throw new GeminiImageError('no_image', 'Gemini returned no candidates.')
  }

  const candidate = candidates[0]
  const inline = firstInlineImage(candidate?.content?.parts)
  if (!inline) {
    const finish = typeof candidate?.finishReason === 'string' ? candidate.finishReason : null
    if (blockReason || (finish && BLOCKED_FINISH_REASONS.has(finish))) throw new GeminiImageError('content_blocked', 'Gemini blocked the image.')
    throw new GeminiImageError('no_image', 'Gemini returned no image.')
  }

  if (typeof inline.data !== 'string') throw new GeminiImageError('malformed_response', 'Gemini image part was malformed.')
  const mimeType = typeof inline.mimeType === 'string' ? inline.mimeType.toLowerCase() : ''
  if (!(GEMINI_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) throw new GeminiImageError('invalid_image', 'Gemini returned an unsupported image type.')
  const mime = mimeType as GeminiImageMimeType

  const bytes = decodeStrictBase64(inline.data)
  if (bytes.length < GEMINI_IMAGE_MIN_BYTES) throw new GeminiImageError('invalid_image', 'Gemini image was too small to be valid.')
  if (!hasSignature(bytes, mime)) throw new GeminiImageError('invalid_image', 'Gemini image did not match its declared type.')

  let width = 0
  let height = 0
  try {
    const metadata = await sharp(bytes).metadata()
    width = metadata.width ?? 0
    height = metadata.height ?? 0
    if (metadata.format !== FORMAT_FOR_MIME[mime]) throw new Error('format mismatch')
  } catch {
    throw new GeminiImageError('invalid_image', 'Gemini image could not be decoded.')
  }
  if (width < 1 || height < 1 || width > GEMINI_IMAGE_MAX_DIMENSION || height > GEMINI_IMAGE_MAX_DIMENSION) {
    throw new GeminiImageError('invalid_image', 'Gemini image dimensions were out of range.')
  }

  return { bytes, mimeType: mime, width, height }
}
