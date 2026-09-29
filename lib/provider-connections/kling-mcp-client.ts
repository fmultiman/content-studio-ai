// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// READ-ONLY verification of a Kling MCP connection using the official MCP
// TypeScript SDK (Streamable HTTP). It connects, lists tools, and calls only
// the allowlisted account/capability tools, then disconnects.
//
// It cannot generate: `callReadOnlyTool` refuses every tool that is not in
// KLING_MCP_READ_ONLY_TOOLS before any request is sent. There is deliberately
// no generic "call tool" export.
//
// Per-request, short-lived connection: nothing is kept between invocations,
// which suits serverless. The access token is passed to the transport only for
// the duration of the call and is never logged or returned.

import {
  Client,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
} from '@modelcontextprotocol/client'
import {
  KLING_MCP_DISCOVERY_OPERATIONS,
  KLING_MCP_URL,
  isKlingMcpReadOnlyTool,
  type KlingMcpReadOnlyTool,
} from './kling-mcp'
import { normalizeKlingMcpVideoCapabilities } from './kling-mcp-video-capabilities'
import {
  ProviderAuthorizationRequiredError,
  ProviderConnectionError,
  type KlingMcpCapabilitySnapshot,
} from './types'

export interface KlingReadOnlyCheckResult {
  accountId: string | null
  capabilities: KlingMcpCapabilitySnapshot
  /** Live account credit read. Returned to the caller for display only — never persisted. */
  credits: { available: number | null }
}

/** Minimal surface of the SDK client this module needs (lets tests inject a fake). */
export interface KlingMcpClientLike {
  connect(transport: unknown): Promise<unknown>
  listTools(): Promise<{ tools: Array<{ name: string }> }>
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close(): Promise<void>
}

export interface KlingMcpClientDependencies {
  createClient?: (accessToken: string) => { client: KlingMcpClientLike; transport: unknown }
}

/** Builds the SDK client + Streamable HTTP transport for one short-lived, per-call connection. */
export function createKlingMcpClient(accessToken: string) {
  const client = new Client({ name: 'content-studio', version: '1.0.0' }) as unknown as KlingMcpClientLike
  const transport = new StreamableHTTPClientTransport(new URL(KLING_MCP_URL), {
    authProvider: { token: async () => accessToken },
  })
  return { client, transport }
}

/** The single gate through which any tool is invoked. */
export async function callReadOnlyTool(
  client: KlingMcpClientLike,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!isKlingMcpReadOnlyTool(name)) {
    throw new ProviderConnectionError('PROVIDER_TOOL_ERROR', `Tool "${name}" is not permitted for a read-only connection.`)
  }

  const result = (await client.callTool({ name, arguments: args })) as CallToolResult
  if (result.isError) throw new ProviderConnectionError('PROVIDER_TOOL_ERROR')

  return parseToolJson(result)
}

export function parseToolJson(result: CallToolResult): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as Record<string, unknown>
  }
  const text = result.content?.find((block) => block.type === 'text') as { text?: string } | undefined
  if (!text?.text) throw new ProviderConnectionError('PROVIDER_TOOL_ERROR')
  try {
    const parsed = JSON.parse(text.text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new ProviderConnectionError('PROVIDER_TOOL_ERROR')
  }
}

/** Maps any transport/SDK failure to a controlled error. Never forwards headers, tokens or stack traces. */
export function mapMcpError(error: unknown): ProviderConnectionError {
  if (error instanceof ProviderConnectionError) return error
  if (error instanceof UnauthorizedError) return new ProviderAuthorizationRequiredError()
  if (error instanceof SdkHttpError) {
    // Observed shape: `code` is an SdkErrorCode string and `data.status` is the HTTP status.
    const status = (error.data as { status?: number } | undefined)?.status
    if (error.code === SdkErrorCode.ClientHttpAuthentication || status === 401) {
      return new ProviderAuthorizationRequiredError()
    }
    if (error.code === SdkErrorCode.ClientHttpForbidden || status === 403) {
      return new ProviderConnectionError('PROVIDER_SCOPE_INSUFFICIENT')
    }
  }
  return new ProviderConnectionError('PROVIDER_UNAVAILABLE')
}

export function buildCapabilitySnapshot(params: {
  toolNames: string[]
  whoAmI: Record<string, unknown>
  membership: Record<string, unknown>
}): KlingMcpCapabilitySnapshot {
  const models: Record<string, string[]> = {}
  const available = params.whoAmI.availableModels as
    | Record<string, { models?: Array<{ model?: string }> }>
    | undefined

  for (const operation of KLING_MCP_DISCOVERY_OPERATIONS) {
    const list = available?.[operation]?.models
    if (Array.isArray(list)) {
      models[operation] = list.map((entry) => entry.model).filter((id): id is string => typeof id === 'string')
    }
  }

  return {
    mcpServerVersion: typeof params.whoAmI.mcpVersion === 'string' ? params.whoAmI.mcpVersion : undefined,
    tools: [...params.toolNames].sort(),
    models,
    video: normalizeKlingMcpVideoCapabilities(params.whoAmI),
    membership: {
      type: typeof params.membership.membershipType === 'string' ? params.membership.membershipType : undefined,
      label:
        typeof params.membership.membershipTypeDescription === 'string'
          ? params.membership.membershipTypeDescription
          : undefined,
    },
  }
}

function stringifyId(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

export async function runKlingReadOnlyCheck(
  accessToken: string,
  deps: KlingMcpClientDependencies = {},
): Promise<KlingReadOnlyCheckResult> {
  const { client, transport } = (deps.createClient ?? createKlingMcpClient)(accessToken)

  try {
    await client.connect(transport)

    const { tools } = await client.listTools()
    const whoAmI = await callReadOnlyTool(client, 'who_am_i', { tools: [...KLING_MCP_DISCOVERY_OPERATIONS] })
    const membership = await callReadOnlyTool(client, 'query_membership_and_credits')

    const user = whoAmI.user as { userId?: unknown } | undefined
    const credits = membership.availableRemainCredits

    return {
      accountId: stringifyId(user?.userId ?? membership.userId),
      capabilities: buildCapabilitySnapshot({
        toolNames: tools.map((tool) => tool.name),
        whoAmI,
        membership,
      }),
      credits: { available: typeof credits === 'number' ? credits : null },
    }
  } catch (error) {
    throw mapMcpError(error)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export type { KlingMcpReadOnlyTool }
