// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Provider-neutral Review execution boundary. A Review ADAPTER owns criteria,
// prompt construction, context compilation and strict result validation. An
// EXECUTION PROVIDER owns authentication, media transport, model invocation,
// structured-output invocation and raw response metadata. A provider never
// validates or interprets Review results: it returns raw text and the adapter's
// strict parser decides whether the Review completes.
//
// Provider structured-output modes are a request hint only. They are never
// proof of validity.

import { ReviewServiceError } from './errors'

export type ReviewProviderId = 'openai' | 'gemini'
export type ReviewMediaKind = 'image' | 'video'
export type ReviewExecutionCapability = 'image_review' | 'video_review'

export const REVIEW_PROVIDER_IDS: readonly ReviewProviderId[] = ['openai', 'gemini']

export function isReviewProviderId(value: unknown): value is ReviewProviderId {
  return typeof value === 'string' && (REVIEW_PROVIDER_IDS as readonly string[]).includes(value)
}

export function capabilityForMedia(kind: ReviewMediaKind): ReviewExecutionCapability {
  return kind === 'image' ? 'image_review' : 'video_review'
}

/**
 * Media that the SERVER has already authorized and resolved from a
 * `media_artifacts` row. There is deliberately no field for an arbitrary
 * client URL: a provider can only read bytes through `load`, which is bound to
 * an owner-checked, trusted-storage-path artifact.
 */
export type AuthorizedReviewMedia = {
  kind: ReviewMediaKind
  artifactId: string
  mimeType: string
  byteSize: number | null
  durationMs: number | null
  /** Server-resolved delivery URL (never client supplied). Optional; providers may use `load` instead. */
  url?: string
  /** Reads the authorized bytes from Content Studio storage. Whole-object: images only. */
  load(): Promise<Uint8Array>
  /**
   * Streams the authorized bytes (video). Bounded-memory: the object is never held whole.
   * The returned chunks verify length and SHA-256 against the immutable artifact when they
   * end; consumers must drain them BEFORE committing the data to a provider.
   */
  openStream?(): Promise<AuthorizedMediaStream>
}

export type AuthorizedMediaStream = {
  /** Exact byte length of the artifact (declared; enforced while streaming). */
  byteLength: number
  chunks: AsyncIterable<Uint8Array>
  /** Releases the storage connection. Idempotent; call on any failure before the chunks are drained. */
  abort(): void
}

export type ReviewExecutionRequest = {
  model: string
  /** User BYOK secret, resolved server-side. Never logged or returned. */
  apiKey: string
  instructions: string
  input: string
  media: readonly AuthorizedReviewMedia[]
  /** JSON schema hint for provider structured output. Server validation still runs afterwards. */
  responseSchema: Record<string, unknown> | null
  /** Overall request deadline (ms) enforced by the provider. */
  timeoutMs?: number
}

export type ReviewExecutionCleanupWarning = {
  code: 'REMOTE_FILE_CLEANUP_FAILED'
  message: string
  remoteFileId: string
}

export type ReviewExecutionResponse = {
  rawText: string
  providerId: ReviewProviderId
  model: string
  providerRequestId?: string
  usage?: Record<string, unknown>
  /** Remote transport file (execution-only; never canonical media identity). */
  remoteFile?: { id: string; expiresAt?: string; deleted: boolean }
  /** Cleanup problems are reported separately; they never change Review success/failure. */
  warnings: ReviewExecutionCleanupWarning[]
}

export interface ReviewExecutionProvider {
  readonly providerId: ReviewProviderId
  readonly capabilities: ReadonlySet<ReviewExecutionCapability>
  execute(request: ReviewExecutionRequest): Promise<ReviewExecutionResponse>
}

export type ReviewProviderErrorKind =
  | 'missing_credential'
  | 'invalid_credential'
  | 'unsupported_model'
  | 'unsupported_capability'
  | 'media_limit_exceeded'
  | 'provider_client_error'
  | 'provider_server_error'
  | 'timeout'
  | 'upload_failed'
  | 'file_processing_failed'
  | 'invalid_response'

/** Normalized provider failure. Messages never contain credentials or provider bodies. */
export class ReviewProviderError extends Error {
  readonly kind: ReviewProviderErrorKind
  readonly providerStatus?: number
  /** Non-fatal transport warnings (e.g. failed remote cleanup) gathered before the failure. */
  warnings: ReviewExecutionCleanupWarning[] = []

  constructor(kind: ReviewProviderErrorKind, message: string, providerStatus?: number) {
    super(message)
    this.name = 'ReviewProviderError'
    this.kind = kind
    this.providerStatus = providerStatus
  }
}

/** Maps a normalized provider error onto the existing Review service error semantics. */
export function toReviewServiceError(error: unknown): ReviewServiceError {
  if (error instanceof ReviewServiceError) return error
  if (error instanceof ReviewProviderError) {
    switch (error.kind) {
      case 'timeout':
        return new ReviewServiceError(504, 'REVIEW_PROVIDER_TIMEOUT', 'Review provider timed out.')
      case 'invalid_response':
        return new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Review provider returned an unusable response.')
      case 'missing_credential':
        return new ReviewServiceError(422, 'REVIEW_PROVIDER_NOT_CONFIGURED', 'Review provider is not configured.')
      case 'unsupported_model':
      case 'unsupported_capability':
      case 'media_limit_exceeded':
        return new ReviewServiceError(422, 'REVIEW_PROVIDER_UNSUPPORTED', error.message)
      default:
        return new ReviewServiceError(502, 'REVIEW_PROVIDER_ERROR', error.message)
    }
  }
  return new ReviewServiceError(502, 'REVIEW_PROVIDER_ERROR', 'Review provider failed.')
}

/**
 * Capability guard evaluated BEFORE any upload or model call, so an
 * unsupported modality never reaches paid execution.
 */
export function assertMediaSupported(
  provider: Pick<ReviewExecutionProvider, 'capabilities' | 'providerId'>,
  media: readonly Pick<AuthorizedReviewMedia, 'kind'>[],
) {
  if (media.length === 0) throw new ReviewProviderError('unsupported_capability', 'Review execution requires at least one media input.')
  for (const item of media) {
    if (!provider.capabilities.has(capabilityForMedia(item.kind))) {
      throw new ReviewProviderError('unsupported_capability', `Provider ${provider.providerId} does not support ${item.kind} review.`)
    }
  }
}

/**
 * Parses provider raw text into JSON for the adapter's strict parser. Anything
 * that is not a JSON value is an invalid evaluator response, never a success.
 */
export function parseProviderJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown
  } catch {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Review provider returned invalid JSON.')
  }
}
