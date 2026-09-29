// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Connection references — the pointer the browser sends back to the server.
// Pure and client-safe (no server imports).
//
//   "kling:api"            the user's Kling API key (REST) — NOT a ProviderConnection row
//   "kling:account:<uuid>" a provider_connections row (Kling MCP OAuth)
//
// A reference carries NO authority. The server always resolves it against the
// authenticated user's own data (ownership-scoped), so a forged or foreign
// reference resolves to "not found".

export const REST_CONNECTION_REF = 'kling:api'
const ACCOUNT_REF_PREFIX = 'kling:account:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ParsedConnectionRef = { kind: 'rest' } | { kind: 'provider_connection'; connectionId: string }

export function accountConnectionRef(connectionId: string): string {
  return `${ACCOUNT_REF_PREFIX}${connectionId}`
}

export function parseConnectionRef(value: unknown): ParsedConnectionRef | null {
  if (value === REST_CONNECTION_REF) return { kind: 'rest' }
  if (typeof value === 'string' && value.startsWith(ACCOUNT_REF_PREFIX)) {
    const connectionId = value.slice(ACCOUNT_REF_PREFIX.length)
    if (UUID.test(connectionId)) return { kind: 'provider_connection', connectionId }
  }
  return null
}
