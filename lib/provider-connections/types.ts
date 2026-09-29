// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Provider connection domain types. A CONNECTION is the user's configured way
// of reaching a provider; it is separate from the provider, the model, the
// transport, the execution mode and the credential source.
//
// Only the one factual non-API method exists today: an OAuth grant to Kling's
// MCP server. The existing Kling REST API key is NOT a ProviderConnection; it
// remains in user_settings.kling_api_key.

export type ProviderConnectionProvider = 'kling'

export type ProviderConnectionMethod = 'mcp_oauth'

/** "not_configured" is the absence of a row, never a stored value. */
export type ProviderConnectionStatus = 'connected' | 'authorization_required' | 'error'

export interface ProviderConnectionRow {
  id: string
  user_id: string
  provider: ProviderConnectionProvider
  connection_method: ProviderConnectionMethod
  status: ProviderConnectionStatus
  scopes: string[]
  external_account_id: string | null
  capabilities: KlingMcpCapabilitySnapshot | Record<string, never>
  last_checked_at: string | null
  last_error_code: string | null
  created_at: string
  updated_at: string
}

/** Safe capability metadata only — never tokens, raw OAuth bodies or credit balances. */
export interface KlingMcpCapabilitySnapshot {
  mcpServerVersion?: string
  tools?: string[]
  models?: Record<string, string[]>
  membership?: { type?: string; label?: string }
}

/** The only shape ever sent to the browser. */
export interface PublicProviderConnection {
  id: string
  provider: ProviderConnectionProvider
  connectionMethod: ProviderConnectionMethod
  status: ProviderConnectionStatus
  scopes: string[]
  /** Last 4 characters of the provider account id, for recognition only. */
  accountHint: string | null
  capabilities: KlingMcpCapabilitySnapshot
  lastCheckedAt: string | null
  lastErrorCode: string | null
}

export function toPublicConnection(row: ProviderConnectionRow): PublicProviderConnection {
  const account = row.external_account_id
  return {
    id: row.id,
    provider: row.provider,
    connectionMethod: row.connection_method,
    status: row.status,
    scopes: row.scopes,
    accountHint: account ? account.slice(-4) : null,
    capabilities: row.capabilities as KlingMcpCapabilitySnapshot,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
  }
}

/** Controlled, client-safe error codes. Messages never carry provider detail. */
export type ProviderConnectionErrorCode =
  | 'PROVIDER_AUTHORIZATION_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_SCOPE_INSUFFICIENT'
  | 'PROVIDER_TOOL_ERROR'
  | 'PROVIDER_CONNECTION_INVALID'
  | 'CONNECTION_ENCRYPTION_NOT_CONFIGURED'

export class ProviderConnectionError extends Error {
  readonly code: ProviderConnectionErrorCode
  constructor(code: ProviderConnectionErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ProviderConnectionError'
    this.code = code
  }
}

export class ProviderAuthorizationRequiredError extends ProviderConnectionError {
  constructor() {
    super('PROVIDER_AUTHORIZATION_REQUIRED', 'The provider authorization is no longer valid.')
    this.name = 'ProviderAuthorizationRequiredError'
  }
}

/** Reasons an OAuth callback is rejected. Mapped to a short result code in the redirect. */
export type OAuthCallbackFailure =
  | 'missing_parameters'
  | 'invalid_state'
  | 'expired_state'
  | 'state_mismatch'
  | 'provider_denied'
  | 'provider_error'
  | 'exchange_failed'
  | 'encryption_unavailable'
