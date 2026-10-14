// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// The narrow Kling video transport boundary: exactly two implementations
// (REST, MCP), both speaking the same normalized submit/status vocabulary.
// This is NOT a provider-universal transport framework — it exists because the
// two real Kling connections need one place that turns a normalized Content
// Studio request into a provider call and a provider status into the
// VideoGeneration lifecycle (queued -> submitted -> processing -> succeeded |
// failed). No MCP-specific status ever reaches the product.
//
// The transport is chosen by the SERVER from the resolved connection, never
// from a client-supplied value.

import { KlingAdapter, type KlingSettings } from '@/lib/providers/kling/adapter'
import { readKlingBilling, type KlingBillingFacts } from './kling-billing'
import { assertProviderExecutionAllowed } from '@/lib/providers/execution-policy'
import { getVeoOperation, isSafeVeoResultUri, submitVeoVideo, VeoError } from '@/lib/providers/gemini/veo-client'
import type { UsageMeasurement } from '@/lib/usage/provider-usage'
import {
  buildKlingMcpVideoCall,
  KlingMcpSubmitError,
  queryKlingMcpTask,
  submitKlingMcpVideo,
} from '@/lib/provider-connections/kling-mcp-generation'
import { uploadKlingMcpSourceImage, type KlingMcpUploadDependencies, type KlingMcpUploadImage } from '@/lib/provider-connections/kling-mcp-upload'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import type { VideoModelCapability, VideoTransport } from './capabilities'
import type { NormalizedVideoRequest } from './request'

export interface VideoSubmitInput {
  /** Our VideoGeneration id (REST uses it as external_task_id). */
  generationId: string
  prompt: string
  request: NormalizedVideoRequest
  model: VideoModelCapability
  /** Kling REST only: externally fetchable, time-limited URL (image_to_video only). */
  sourceImageUrl?: string
  /** Kling REST only (VEO_KLING_FIRST_LAST_FRAME_V1): the same kind of URL for the LAST frame. */
  lastFrameImageUrl?: string
  /**
   * MCP and Veo (image_to_video): the trusted, already-validated BYTES of the source image. Kling can never fetch our private
   * storage, so the MCP transport uploads these through `file_upload` and sends the provider's own file URL instead; Veo
   * receives them inline.
   */
  sourceImage?: KlingMcpUploadImage
  /** MCP and Veo (VEO_KLING_FIRST_LAST_FRAME_V1): the trusted bytes of the LAST frame, handled exactly like `sourceImage`. */
  lastFrameImage?: KlingMcpUploadImage
  /** REST only. */
  callbackUrl?: string
}

export interface VideoSubmitResult {
  /** The provider's task id (REST task_id / MCP generation_id). */
  taskId: string
  /** Safe provider metadata to persist (never a secret or token). */
  providerMetadata: Record<string, unknown>
}

export type VideoTaskStatus =
  | {
      state: 'processing'
      rawState: string | null
      /** A result URL seen alongside a state we do not recognise (accepted only after repeated observation). */
      unconfirmedResultUrl?: string | null
    }
  | {
      state: 'succeeded'
      resultUrl: string | null
      rawState: string | null
      /**
       * Headers the result download needs (Veo: the user's key). Sent ONLY to the result URL's own host, never to a
       * redirect target, never persisted, never logged.
       */
      downloadHeaders?: Record<string, string>
      /** The billing facts the provider stated for this task (amount / charge_type / package_type), for audit. Never invented. */
      providerBilling?: KlingBillingFacts
      /**
       * Provider-native usage for THIS task — set ONLY when the provider's own response states it.
       * Kling MCP query_tasks carries no cost (unknown usage). The Kling REST task item MAY carry a `billing` object: a validated
       * `unit` charge becomes provider-reported units (KLING_REST_RECOVERY_V1); any other shape stays unknown.
       */
      usage?: UsageMeasurement | null
    }
  | { state: 'failed'; message: string; code: string; rawState: string | null }

export interface KlingVideoTransport {
  readonly transport: VideoTransport
  submit(input: VideoSubmitInput): Promise<VideoSubmitResult>
  getStatus(taskId: string): Promise<VideoTaskStatus>
}

/** Provider-neutral name for the same boundary (Kling REST, Kling MCP and Google Veo all implement it). */
export type VideoProviderTransport = KlingVideoTransport

// ---------------------------------------------------------------------------
// REST — wraps the proven adapter without changing its behavior
// ---------------------------------------------------------------------------

export class KlingRestTransport implements KlingVideoTransport {
  readonly transport = 'rest' as const
  private readonly adapter: KlingAdapter

  constructor(apiKey: string) {
    this.adapter = new KlingAdapter(apiKey)
  }

  async submit(input: VideoSubmitInput): Promise<VideoSubmitResult> {
    // FUTURE-050 outbound-boundary backstop (the route also guards earlier, before any durable state).
    assertProviderExecutionAllowed({ provider: 'kling', operation: 'video_generation' })
    const { request } = input
    // REST supports every control (rest-capabilities.ts), so each is non-null.
    // REST resolution is never 4k; the adapter's own type says the same.
    const settings: KlingSettings = {
      duration: request.duration as 5 | 10,
      resolution: request.resolution === '4k' ? '4K' : request.resolution,
      audio: request.audio ?? 'off',
      multi_shot: Boolean(request.multiShot),
      aspect_ratio: request.operation === 'text_to_video' ? (request.aspectRatio ?? undefined) : undefined,
    }

    if (request.lastFrame && !input.lastFrameImageUrl) {
      throw new Error('A last frame was requested without its image URL.')
    }
    const submitted =
      request.operation === 'image_to_video'
        ? await this.adapter.submitImageToVideo(
            input.prompt,
            input.sourceImageUrl ?? '',
            input.generationId,
            input.callbackUrl,
            settings,
            request.model,
            request.lastFrame ? input.lastFrameImageUrl : undefined,
          )
        : await this.adapter.submitTextToVideo(input.prompt, input.generationId, input.callbackUrl, settings, request.model)

    return { taskId: submitted.task_id, providerMetadata: { task_id: submitted.task_id } }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const item = await this.adapter.getTaskStatus(taskId)
    if (item.status === 'succeeded') {
      const video = item.outputs?.find((output) => output.type === 'video')
      // The REST task item MAY state what the task cost. Only a validated `unit` charge becomes a usage quantity (provider_reported);
      // anything else stays unknown. (Earlier comments said neither transport reports usage: the REST task item can.)
      const billing = readKlingBilling(item.billing)
      return {
        state: 'succeeded',
        resultUrl: video?.url ?? null,
        rawState: item.status,
        ...(billing.usage ? { usage: billing.usage } : {}),
        ...(billing.facts ? { providerBilling: billing.facts } : {}),
      }
    }
    if (item.status === 'failed') {
      return { state: 'failed', message: item.message || 'Provider failed', code: 'PROVIDER_FAILED', rawState: item.status }
    }
    return { state: 'processing', rawState: item.status }
  }
}

// ---------------------------------------------------------------------------
// MCP — official SDK, server-side OAuth grant
// ---------------------------------------------------------------------------

export interface McpAccessTokens {
  /** A valid access token (refreshed if needed). */
  get(): Promise<string>
  /** Forces a refresh (used once after a token was rejected before its recorded expiry). */
  refresh(): Promise<string>
}

export class KlingMcpTransport implements KlingVideoTransport {
  readonly transport = 'mcp' as const

  constructor(
    private readonly tokens: McpAccessTokens,
    private readonly clientDeps: KlingMcpUploadDependencies = {},
  ) {}

  /** A rejected token never reached a generation tool, so retrying once with a refreshed token cannot double-submit. */
  private async withToken<T>(run: (token: string) => Promise<T>): Promise<T> {
    try {
      return await run(await this.tokens.get())
    } catch (error) {
      if (!(error instanceof ProviderAuthorizationRequiredError)) throw error
      return run(await this.tokens.refresh())
    }
  }

  async submit(input: VideoSubmitInput): Promise<VideoSubmitResult> {
    // FUTURE-050 outbound-boundary backstop: before the source upload and the paid generation tool.
    assertProviderExecutionAllowed({ provider: 'kling', operation: 'video_generation' })
    // VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — spend order: the source is uploaded to the provider FIRST. Only a valid
    // provider file URL lets the (paid) image_to_video be built and sent; any failure here throws before it exists.
    // image_to_video never receives a Content Studio URL (presigned S3 / browser) or a data URL, and text_to_video
    // never touches this path.
    let sourceImageUrl: string | undefined
    let lastFrameImageUrl: string | undefined
    if (input.request.operation === 'image_to_video') {
      if (!input.sourceImage) throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', 'image_to_video requires the trusted source image.')
      const sourceImage = input.sourceImage
      sourceImageUrl = (await this.withToken((token) => uploadKlingMcpSourceImage(token, sourceImage, this.clientDeps))).url
      // VEO_KLING_FIRST_LAST_FRAME_V1: BOTH frames are uploaded before the paid tool exists. A failure on the second
      // upload still happens before any generation was submitted, so nothing is billed.
      if (input.request.lastFrame) {
        if (!input.lastFrameImage) throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', 'A last frame was requested without the trusted image.')
        const lastFrameImage = input.lastFrameImage
        lastFrameImageUrl = (await this.withToken((token) => uploadKlingMcpSourceImage(token, lastFrameImage, this.clientDeps))).url
      }
    }
    const call = buildKlingMcpVideoCall({
      request: input.request,
      model: input.model,
      prompt: input.prompt,
      sourceImageUrl,
      lastFrameImageUrl,
    })
    const { generationId } = await this.withToken((token) => submitKlingMcpVideo(token, call, this.clientDeps))
    return {
      taskId: generationId,
      providerMetadata: { generation_id: generationId, tool: call.tool, model: call.model },
    }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const reading = await this.withToken((token) => queryKlingMcpTask(token, taskId, this.clientDeps))
    if (reading.state === 'succeeded') return { state: 'succeeded', resultUrl: reading.resultUrl, rawState: reading.rawState }
    if (reading.state === 'failed') {
      return {
        state: 'failed',
        message: reading.message ?? 'A Kling não concluiu esta geração.',
        code: 'PROVIDER_FAILED',
        rawState: reading.rawState,
      }
    }
    return { state: 'processing', rawState: reading.rawState, unconfirmedResultUrl: reading.unconfirmedResultUrl }
  }
}

// ---------------------------------------------------------------------------
// Google Veo - Gemini API, the user's own key (BYOK), asynchronous operation
// ---------------------------------------------------------------------------

/** Typed so the route can classify a Veo submit failure without importing the client module. */
export { VeoError }

export class GeminiVeoTransport implements KlingVideoTransport {
  readonly transport = 'rest' as const

  constructor(
    private readonly apiKey: string,
    private readonly deps: { fetchImpl?: typeof fetch } = {},
  ) {}

  async submit(input: VideoSubmitInput): Promise<VideoSubmitResult> {
    // FUTURE-050 outbound-boundary backstop (the route also guards earlier, before any durable state).
    assertProviderExecutionAllowed({ provider: 'gemini', operation: 'video_generation' })
    const { request } = input
    if (request.aspectRatio === null) throw new VeoError('invalid_input', 'Veo requires an explicit aspect ratio.')
    if (request.operation === 'image_to_video' && !input.sourceImage) {
      throw new VeoError('invalid_input', 'image_to_video requires the trusted source image.')
    }
    if (request.lastFrame && !input.lastFrameImage) {
      throw new VeoError('invalid_input', 'A last frame was requested without the trusted image.')
    }
    const submitted = await submitVeoVideo(
      {
        apiKey: this.apiKey,
        model: request.model,
        prompt: input.prompt,
        duration: request.duration,
        resolution: request.resolution,
        aspectRatio: request.aspectRatio,
        ...(request.operation === 'image_to_video' && input.sourceImage ? { firstFrame: input.sourceImage } : {}),
        ...(request.operation === 'image_to_video' && request.lastFrame && input.lastFrameImage ? { lastFrame: input.lastFrameImage } : {}),
      },
      { fetchImpl: this.deps.fetchImpl },
    )
    return { taskId: submitted.operationName, providerMetadata: { operation: submitted.operationName, model: request.model } }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const reading = await getVeoOperation(this.apiKey, taskId, { fetchImpl: this.deps.fetchImpl })
    if (reading.state === 'succeeded') {
      // Defense in depth: the URI was already validated, and the key is only ever sent to Google's own host.
      if (!isSafeVeoResultUri(reading.videoUri)) {
        return { state: 'failed', message: 'O resultado do Google Veo não pôde ser copiado com segurança.', code: 'PROVIDER_FAILED', rawState: 'done' }
      }
      return { state: 'succeeded', resultUrl: reading.videoUri, rawState: 'done', downloadHeaders: { 'x-goog-api-key': this.apiKey } }
    }
    if (reading.state === 'failed') return { state: 'failed', message: reading.message, code: reading.code, rawState: 'done' }
    return { state: 'processing', rawState: 'running' }
  }
}

export { KlingMcpSubmitError }
