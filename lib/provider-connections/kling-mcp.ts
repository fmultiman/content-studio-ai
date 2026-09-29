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
 * deliberately NOT requested: this spike never generates. A future
 * "enable generation" step would require an explicit re-authorization with
 * the additional scope.
 */
export const KLING_MCP_READ_ONLY_SCOPES = ['generation.read', 'account.credit.read'] as const

export const KLING_MCP_SCOPE_STRING = KLING_MCP_READ_ONLY_SCOPES.join(' ')

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
