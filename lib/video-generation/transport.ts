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
import {
  buildKlingMcpVideoCall,
  KlingMcpSubmitError,
  queryKlingMcpTask,
  submitKlingMcpVideo,
} from '@/lib/provider-connections/kling-mcp-generation'
import type { KlingMcpClientDependencies } from '@/lib/provider-connections/kling-mcp-client'
import { ProviderAuthorizationRequiredError } from '@/lib/provider-connections/types'
import type { VideoModelCapability, VideoTransport } from './capabilities'
import type { NormalizedVideoRequest } from './request'

export interface VideoSubmitInput {
  /** Our VideoGeneration id (REST uses it as external_task_id). */
  generationId: string
  prompt: string
  request: NormalizedVideoRequest
  model: VideoModelCapability
  /** Externally fetchable, time-limited URL (image_to_video only). */
  sourceImageUrl?: string
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
  | { state: 'succeeded'; resultUrl: string | null; rawState: string | null }
  | { state: 'failed'; message: string; code: string; rawState: string | null }

export interface KlingVideoTransport {
  readonly transport: VideoTransport
  submit(input: VideoSubmitInput): Promise<VideoSubmitResult>
  getStatus(taskId: string): Promise<VideoTaskStatus>
}

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

    const submitted =
      request.operation === 'image_to_video'
        ? await this.adapter.submitImageToVideo(input.prompt, input.sourceImageUrl ?? '', input.generationId, input.callbackUrl, settings)
        : await this.adapter.submitTextToVideo(input.prompt, input.generationId, input.callbackUrl, settings)

    return { taskId: submitted.task_id, providerMetadata: { task_id: submitted.task_id } }
  }

  async getStatus(taskId: string): Promise<VideoTaskStatus> {
    const item = await this.adapter.getTaskStatus(taskId)
    if (item.status === 'succeeded') {
      const video = item.outputs?.find((output) => output.type === 'video')
      return { state: 'succeeded', resultUrl: video?.url ?? null, rawState: item.status }
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
    private readonly clientDeps: KlingMcpClientDependencies = {},
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
    const call = buildKlingMcpVideoCall({
      request: input.request,
      model: input.model,
      prompt: input.prompt,
      sourceImageUrl: input.sourceImageUrl,
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

export { KlingMcpSubmitError }
