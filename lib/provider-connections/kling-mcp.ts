// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Facts about Kling's official MCP server that this integration depends on.
// (See docs/architecture/KLING_MCP_CONNECTION_AND_TRANSPORT_DISCOVERY_V1.md.)
//
// Connection model for this case:
//   provider           kling
//   connection method  mcp_oauth  (OAuth authorization code + PKCE S256)
//   transport          MCP over Streamable HTTP
//   funding            the USER's own Kling web account/credits — never
//                      content_studio_credits, never a platform credential.

export const KLING_MCP_URL = 'https://kling.ai/mcp'

/**
 * Minimum scopes for a READ-ONLY connection. `generation.create` is
 * deliberately NOT requested by the default connect action.
 */
export const KLING_MCP_READ_ONLY_SCOPES = ['generation.read', 'account.credit.read'] as const

export const KLING_MCP_SCOPE_STRING = KLING_MCP_READ_ONLY_SCOPES.join(' ')

/**
 * Scopes for a connection that may start generations. Requested ONLY by the
 * explicit "Autorizar geração" action (connect intent `generation`) — never
 * automatically, never as a side effect of opening /videos.
 */
export const KLING_MCP_GENERATION_CREATE_SCOPE = 'generation.create'

export const KLING_MCP_GENERATION_SCOPES = [...KLING_MCP_READ_ONLY_SCOPES, KLING_MCP_GENERATION_CREATE_SCOPE] as const

export const KLING_MCP_GENERATION_SCOPE_STRING = KLING_MCP_GENERATION_SCOPES.join(' ')

export type KlingMcpConnectIntent = 'read_only' | 'generation'

export function scopeStringForIntent(intent: KlingMcpConnectIntent): string {
  return intent === 'generation' ? KLING_MCP_GENERATION_SCOPE_STRING : KLING_MCP_SCOPE_STRING
}

/**
 * The ONLY tools this integration is allowed to call. Anything that
 * generates, uploads or mutates (text_to_video, image_to_video, text_to_image,
 * image_to_image, motion_control, file_upload, element_*, logout, ...) is
 * refused before a request is sent.
 */
export const KLING_MCP_READ_ONLY_TOOLS = ['who_am_i', 'query_membership_and_credits'] as const

export type KlingMcpReadOnlyTool = (typeof KLING_MCP_READ_ONLY_TOOLS)[number]

export function isKlingMcpReadOnlyTool(name: string): name is KlingMcpReadOnlyTool {
  return (KLING_MCP_READ_ONLY_TOOLS as readonly string[]).includes(name)
}

/**
 * The ONLY tools the video transport may call: the two operations Content
 * Studio productizes and the task-status read. Everything else the server
 * exposes (motion_control, images, omni, elements, upload, logout, ...) is
 * refused before a request is sent.
 */
export const KLING_MCP_VIDEO_TOOLS = ['text_to_video', 'image_to_video', 'query_tasks'] as const

export type KlingMcpVideoTool = (typeof KLING_MCP_VIDEO_TOOLS)[number]

export function isKlingMcpVideoTool(name: string): name is KlingMcpVideoTool {
  return (KLING_MCP_VIDEO_TOOLS as readonly string[]).includes(name)
}

/**
 * VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — the ONE media-ingestion tool, used only as internal plumbing for Image -> Video.
 * It issues a one-time upload ticket (the file itself is POSTed to the returned URL by the server). It is deliberately
 * NOT part of KLING_MCP_VIDEO_TOOLS (it generates nothing), never user-selectable, and has its own single-purpose gate.
 */
export const KLING_MCP_SOURCE_UPLOAD_TOOL = 'file_upload' as const

export function isKlingMcpSourceUploadTool(name: string): name is typeof KLING_MCP_SOURCE_UPLOAD_TOOL {
  return name === KLING_MCP_SOURCE_UPLOAD_TOOL
}

/** Generation operations Content Studio cares about (asked of who_am_i as read-only discovery). */
export const KLING_MCP_DISCOVERY_OPERATIONS = ['text_to_video', 'image_to_video'] as const

export const KLING_MCP_PROVIDER = 'kling' as const
export const KLING_MCP_METHOD = 'mcp_oauth' as const

const CALLBACK_PATH = '/api/provider-connections/kling/mcp/callback'
const SETTINGS_PATH = '/configuracoes'

/**
 * Explicit, environment-driven base URL (NEXT_PUBLIC_APP_URL). Never derived
 * from the request, so a preview/deployment hostname can never become an OAuth
 * redirect URI by accident. Only https, or http on localhost for development.
 */
export function getAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) throw new Error('NEXT_PUBLIC_APP_URL is not configured')

  const url = new URL(raw)
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('NEXT_PUBLIC_APP_URL must be https (or http on localhost)')
  }
  return url.origin
}

export function klingMcpRedirectUri(): string {
  return `${getAppBaseUrl()}${CALLBACK_PATH}`
}

/**
 * Where the callback sends the browser afterwards, as a RELATIVE location, so
 * the error/redirect path has no dependency on configuration that could itself
 * be the thing that failed. Carries a result code only — never code/state/tokens.
 */
export function settingsRedirectPath(result: string): string {
  const query = new URLSearchParams({ connection: 'kling_mcp', result })
  return `${SETTINGS_PATH}?${query.toString()}`
}
