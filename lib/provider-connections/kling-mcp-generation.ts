// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// The Kling MCP VIDEO client: submit ONE generation and read task status,
// using the official MCP TypeScript SDK. It is the second (and only other)
// place a tool is invoked besides the read-only connection check, and it has
// its own allow-list gate: only text_to_video, image_to_video and query_tasks
// can ever be sent. Every other tool the server exposes is refused locally.
//
// NOTHING in the codebase calls submitKlingMcpVideo against the real provider
// during this task's implementation/smoke: tests inject a fake client.
//
// Argument mapping is EXPLICIT. Content Studio never forwards arbitrary UI
// JSON: each supported control is mapped by name, every control the model
// offers is sent with its selected value (never a silent provider default),
// and the output count is pinned to 1.

import { ProtocolError, SdkHttpError, type CallToolResult } from '@modelcontextprotocol/client'
import {
  createKlingMcpClient,
  mapMcpError,
  parseToolJson,
  type KlingMcpClientDependencies,
  type KlingMcpClientLike,
} from './kling-mcp-client'
import { isKlingMcpVideoTool, type KlingMcpVideoTool } from './kling-mcp'
import {
  classifyProviderRejection,
  isTaskFailureText,
  parseGenerationId,
  parseTaskReading,
  type KlingMcpTaskReading,
  type SubmitFailureClass,
} from './kling-mcp-task'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from './types'
import type { NormalizedVideoRequest } from '@/lib/video-generation/request'
import type { VideoModelCapability } from '@/lib/video-generation/capabilities'

export interface KlingMcpVideoCall {
  tool: Exclude<KlingMcpVideoTool, 'query_tasks'>
  model: string
  arguments: Array<{ name: string; value: string }>
  inputs: Array<{ name: string; inputType: 'URL'; url: string }>
}

/**
 * Maps a validated, explicit Content Studio request to the MCP tool + arguments.
 * Ignores every provider argument that is not a productized control.
 */
export function buildKlingMcpVideoCall(params: {
  request: NormalizedVideoRequest
  model: VideoModelCapability
  prompt: string
  sourceImageUrl?: string
}): KlingMcpVideoCall {
  const { request, model, prompt } = params

  const args: Array<{ name: string; value: string }> = [
    { name: 'prompt', value: prompt },
    { name: 'duration', value: String(request.duration) },
    { name: 'resolution', value: request.resolution },
  ]
  if (request.operation === 'text_to_video' && request.aspectRatio !== null) {
    args.push({ name: 'aspect_ratio', value: request.aspectRatio })
  }
  if (request.audio !== null) args.push({ name: 'enable_audio', value: request.audio === 'on' ? 'true' : 'false' })
  if (request.multiShot !== null) args.push({ name: 'prefer_multi_shots', value: request.multiShot ? 'true' : 'false' })
  // One action -> one VideoGeneration -> one video. Never more than one output.
  if (model.outputCountArg) args.push({ name: 'imageCount', value: '1' })

  if (request.operation === 'image_to_video') {
    if (!params.sourceImageUrl) throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', 'image_to_video requires a source image URL.')
    return {
      tool: 'image_to_video',
      model: request.model,
      arguments: args,
      inputs: [{ name: 'first_image', inputType: 'URL', url: params.sourceImageUrl }],
    }
  }

  return { tool: 'text_to_video', model: request.model, arguments: args, inputs: [] }
}

/** The single gate through which a video tool is invoked. */
async function callVideoTool(
  client: KlingMcpClientLike,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!isKlingMcpVideoTool(name)) {
    throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', `Tool "${name}" is not permitted for video generation.`)
  }
  return (await client.callTool({ name, arguments: args })) as CallToolResult
}

function firstText(result: CallToolResult): string | null {
  const block = result.content?.find((entry) => entry.type === 'text') as { text?: string } | undefined
  return block?.text ? block.text.trim().slice(0, 300) : null
}

/** A rejected or unconfirmed submission. Messages are safe, bounded and never carry tokens. */
export class KlingMcpSubmitError extends Error {
  readonly failureClass: SubmitFailureClass | 'PROVIDER_UNAVAILABLE' | 'SUBMIT_RESPONSE_UNREADABLE'
  /**
   * True when the request may have reached the provider (and be billed) but
   * we cannot confirm it. The row is failed with an explicit warning; it is
   * NEVER retried automatically.
   */
  readonly outcomeUnknown: boolean
  /** Bounded, non-secret provider text kept for reconciliation. */
  readonly providerText: string | null

  constructor(
    failureClass: KlingMcpSubmitError['failureClass'],
    message: string,
    options: { outcomeUnknown?: boolean; providerText?: string | null } = {},
  ) {
    super(message)
    this.name = 'KlingMcpSubmitError'
    this.failureClass = failureClass
    this.outcomeUnknown = options.outcomeUnknown ?? false
    this.providerText = options.providerText ?? null
  }
}

const REJECTION_MESSAGES: Record<SubmitFailureClass, string> = {
  PROVIDER_QUOTA_EXCEEDED: 'Os créditos da sua conta Kling são insuficientes para esta geração.',
  PROVIDER_CONTENT_REJECTED: 'A Kling recusou o conteúdo desta geração.',
  PROVIDER_REJECTED: 'A Kling recusou esta geração.',
}

/**
 * Submits EXACTLY ONE generation. No retry, ever: a second call would be a
 * second charge. Returns the provider's generation id.
 */
export async function submitKlingMcpVideo(
  accessToken: string,
  call: KlingMcpVideoCall,
  deps: KlingMcpClientDependencies = {},
): Promise<{ generationId: string }> {
  const { client, transport } = (deps.createClient ?? createKlingMcpClient)(accessToken)

  let connected = false
  try {
    try {
      await client.connect(transport)
      connected = true
    } catch (error) {
      // Not connected => nothing was submitted.
      throw mapMcpError(error)
    }

    let result: CallToolResult
    try {
      result = await callVideoTool(client, call.tool, {
        model: call.model,
        arguments: call.arguments,
        ...(call.inputs.length > 0 ? { inputs: call.inputs } : {}),
      })
    } catch (error) {
      const mapped = mapMcpError(error)
      // A rejected token never reached the tool: certainly not submitted.
      if (mapped instanceof ProviderAuthorizationRequiredError) throw mapped
      // The server ANSWERED with a refusal (a JSON-RPC error, or an HTTP 4xx such
      // as 403 for a missing permission): the tool did not run, nothing was billed.
      const httpStatus = error instanceof SdkHttpError ? (error.data as { status?: number } | undefined)?.status : undefined
      if (error instanceof ProtocolError || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500)) {
        throw new KlingMcpSubmitError(
          'PROVIDER_REJECTED',
          httpStatus === 403
            ? 'A Kling recusou esta geração: a autorização da conta não permite gerar. Autorize a geração em Configurações.'
            : REJECTION_MESSAGES.PROVIDER_REJECTED,
        )
      }
      // Anything else (timeout, dropped connection, 5xx) may have reached the tool.
      throw new KlingMcpSubmitError(
        'PROVIDER_UNAVAILABLE',
        'Não foi possível confirmar o envio à Kling. Verifique a sua conta Kling antes de tentar novamente.',
        { outcomeUnknown: true },
      )
    }

    if (result.isError) {
      const text = firstText(result)
      const failureClass = classifyProviderRejection(text)
      throw new KlingMcpSubmitError(failureClass, REJECTION_MESSAGES[failureClass], { providerText: text })
    }

    let parsed: unknown
    try {
      parsed = parseToolJson(result)
    } catch {
      parsed = null
    }
    const generationId = parseGenerationId(parsed)
    if (!generationId || !/^[A-Za-z0-9_.:-]{1,128}$/.test(generationId)) {
      // The provider accepted the call but we cannot find the id: possibly billed.
      throw new KlingMcpSubmitError(
        'SUBMIT_RESPONSE_UNREADABLE',
        'A Kling aceitou o envio, mas a resposta não pôde ser lida. Verifique a sua conta Kling antes de tentar novamente.',
        { outcomeUnknown: true, providerText: firstText(result) },
      )
    }

    return { generationId }
  } finally {
    if (connected) await client.close().catch(() => undefined)
  }
}

/** Reads one task's status. Throws a ProviderConnectionError for authorization/transient problems. */
export async function queryKlingMcpTask(
  accessToken: string,
  generationId: string,
  deps: KlingMcpClientDependencies = {},
): Promise<KlingMcpTaskReading> {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(generationId)) {
    throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', 'Invalid generation id.')
  }

  const { client, transport } = (deps.createClient ?? createKlingMcpClient)(accessToken)
  try {
    await client.connect(transport)
    const result = await callVideoTool(client, 'query_tasks', { generationId })

    if (result.isError) {
      const text = firstText(result)
      // Documented task-level failures mean the GENERATION failed.
      if (isTaskFailureText(text)) return { state: 'failed', rawState: null, resultUrl: null, message: text, unconfirmedResultUrl: null }
      throw new ProviderConnectionError('PROVIDER_TOOL_ERROR')
    }

    let payload: unknown
    try {
      payload = parseToolJson(result)
    } catch {
      throw new ProviderConnectionError('PROVIDER_TOOL_ERROR')
    }
    return parseTaskReading(payload)
  } catch (error) {
    throw mapMcpError(error)
  } finally {
    await client.close().catch(() => undefined)
  }
}
