// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Server-only persistence and refresh of a user's OAuth token material.
//
// - Tokens are encrypted (AES-256-GCM, AAD-bound to the connection id) before
//   they reach the database; provider_connection_secrets holds ciphertext only.
// - `getValidAccessToken` is the ONLY way other server code obtains an access
//   token. It refreshes when the token is expired or near expiry, persists a
//   rotated refresh token, and maps a revoked/invalid grant to
//   PROVIDER_AUTHORIZATION_REQUIRED (never a generic 500).
// - Refresh writes use optimistic concurrency (`secret_version`): parallel
//   serverless invocations cannot overwrite a newer, possibly rotated,
//   refresh token with a stale one.
// - Nothing here logs, returns or throws a token.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OAuthError,
  OAuthErrorCode,
  discoverOAuthServerInfo,
  refreshAuthorization,
  type OAuthTokens,
} from '@modelcontextprotocol/client'
import { decryptConnectionSecret, encryptConnectionSecret } from './crypto'
import { findOAuthClient } from './oauth-client-registry'
import { KLING_MCP_PROVIDER, KLING_MCP_URL, klingMcpRedirectUri } from './kling-mcp'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from './types'

const SECRETS = 'provider_connection_secrets'
const CONNECTIONS = 'provider_connections'

/** Refresh when the access token has less than this left. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

/** A grant the provider says is no longer usable → the user must re-authorize. */
const REAUTHORIZATION_ERROR_CODES: readonly string[] = [
  OAuthErrorCode.InvalidGrant,
  OAuthErrorCode.InvalidClient,
  OAuthErrorCode.UnauthorizedClient,
]

interface StoredTokenPayload {
  access_token: string
  refresh_token?: string
  token_type: string
  scope?: string
}

const secretAad = (connectionId: string) => `connection-secret:${connectionId}`

function expiryFrom(tokens: OAuthTokens, now: Date): string | null {
  return typeof tokens.expires_in === 'number'
    ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString()
    : null
}

function toPayload(tokens: OAuthTokens, previous?: StoredTokenPayload): StoredTokenPayload {
  return {
    access_token: tokens.access_token,
    // Keep the old refresh token when the provider does not rotate it.
    refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope ?? previous?.scope,
  }
}

/** First save after the authorization-code exchange (or a full re-authorization). */
export async function saveConnectionTokens(
  db: SupabaseClient,
  connectionId: string,
  tokens: OAuthTokens,
  now: Date = new Date(),
): Promise<void> {
  const ciphertext = encryptConnectionSecret(JSON.stringify(toPayload(tokens)), secretAad(connectionId))

  const { error } = await db.from(SECRETS).upsert(
    {
      connection_id: connectionId,
      ciphertext,
      access_token_expires_at: expiryFrom(tokens, now),
      secret_version: 1,
      updated_at: now.toISOString(),
    },
    { onConflict: 'connection_id' },
  )
  if (error) throw new Error('Failed to persist connection secrets')
}

export async function deleteConnectionTokens(db: SupabaseClient, connectionId: string): Promise<void> {
  await db.from(SECRETS).delete().eq('connection_id', connectionId)
}

interface SecretRow {
  ciphertext: string
  access_token_expires_at: string | null
  secret_version: number
}

async function readSecretRow(db: SupabaseClient, connectionId: string): Promise<SecretRow | null> {
  const { data } = await db
    .from(SECRETS)
    .select('ciphertext, access_token_expires_at, secret_version')
    .eq('connection_id', connectionId)
    .maybeSingle()
  return (data as SecretRow | null) ?? null
}

async function markAuthorizationRequired(db: SupabaseClient, connectionId: string): Promise<void> {
  await db
    .from(CONNECTIONS)
    .update({
      status: 'authorization_required',
      last_error_code: 'PROVIDER_AUTHORIZATION_REQUIRED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
  // Dead credentials are not kept around.
  await deleteConnectionTokens(db, connectionId)
}

export interface TokenRefreshDependencies {
  discover?: typeof discoverOAuthServerInfo
  refresh?: typeof refreshAuthorization
  now?: () => Date
}

/**
 * Returns a usable access token for a connection, refreshing (and persisting
 * any rotated refresh token) if needed. The caller must already have verified
 * that `connectionId` belongs to the authenticated user.
 */
export async function getValidAccessToken(
  db: SupabaseClient,
  connectionId: string,
  deps: TokenRefreshDependencies = {},
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const row = await readSecretRow(db, connectionId)
  if (!row) throw new ProviderAuthorizationRequiredError()

  const tokens = JSON.parse(decryptConnectionSecret(row.ciphertext, secretAad(connectionId))) as StoredTokenPayload

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : null
  const stillFresh = expiresAt === null || expiresAt - now.getTime() > ACCESS_TOKEN_REFRESH_SKEW_MS
  if (stillFresh) return tokens.access_token

  return refreshAccessToken(db, connectionId, row, tokens, deps, now)
}

/** Forces a refresh (e.g. after the provider rejected a not-yet-expired token). */
export async function forceRefreshAccessToken(
  db: SupabaseClient,
  connectionId: string,
  deps: TokenRefreshDependencies = {},
): Promise<string> {
  const now = (deps.now ?? (() => new Date()))()
  const row = await readSecretRow(db, connectionId)
  if (!row) throw new ProviderAuthorizationRequiredError()
  const tokens = JSON.parse(decryptConnectionSecret(row.ciphertext, secretAad(connectionId))) as StoredTokenPayload
  return refreshAccessToken(db, connectionId, row, tokens, deps, now)
}

async function refreshAccessToken(
  db: SupabaseClient,
  connectionId: string,
  row: SecretRow,
  tokens: StoredTokenPayload,
  deps: TokenRefreshDependencies,
  now: Date,
): Promise<string> {
  if (!tokens.refresh_token) {
    await markAuthorizationRequired(db, connectionId)
    throw new ProviderAuthorizationRequiredError()
  }

  const discover = deps.discover ?? discoverOAuthServerInfo
  const refresh = deps.refresh ?? refreshAuthorization

  let refreshed: OAuthTokens
  try {
    const info = await discover(KLING_MCP_URL)
    const issuer = String(info.authorizationServerUrl)
    const client = await findOAuthClient(db, {
      provider: KLING_MCP_PROVIDER,
      issuer,
      redirectUri: klingMcpRedirectUri(),
    })
    if (!client) {
      await markAuthorizationRequired(db, connectionId)
      throw new ProviderAuthorizationRequiredError()
    }

    refreshed = await refresh(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientInformation: { client_id: client.clientId },
      refreshToken: tokens.refresh_token,
      resource: KLING_MCP_URL,
    })
  } catch (error) {
    if (error instanceof ProviderAuthorizationRequiredError) throw error

    if (error instanceof OAuthError && REAUTHORIZATION_ERROR_CODES.includes(error.code)) {
      // Another invocation may have already rotated the token; if the stored
      // version moved on, that newer token is the one to use.
      const latest = await readSecretRow(db, connectionId)
      if (latest && latest.secret_version !== row.secret_version) {
        const newer = JSON.parse(decryptConnectionSecret(latest.ciphertext, secretAad(connectionId))) as StoredTokenPayload
        return newer.access_token
      }
      await markAuthorizationRequired(db, connectionId)
      throw new ProviderAuthorizationRequiredError()
    }

    // Network/5xx/etc.: the grant may still be valid. Do not change status.
    throw new ProviderConnectionError('PROVIDER_UNAVAILABLE')
  }

  const payload = toPayload(refreshed, tokens)
  const ciphertext = encryptConnectionSecret(JSON.stringify(payload), secretAad(connectionId))

  // Compare-and-swap on secret_version; persists a rotated refresh token.
  const { data: updated } = await db
    .from(SECRETS)
    .update({
      ciphertext,
      access_token_expires_at: expiryFrom(refreshed, now),
      secret_version: row.secret_version + 1,
      updated_at: now.toISOString(),
    })
    .eq('connection_id', connectionId)
    .eq('secret_version', row.secret_version)
    .select('secret_version')

  if (!updated || updated.length === 0) {
    // Lost the race: another invocation stored a newer token set. Use it.
    const latest = await readSecretRow(db, connectionId)
    if (!latest) throw new ProviderAuthorizationRequiredError()
    const newer = JSON.parse(decryptConnectionSecret(latest.ciphertext, secretAad(connectionId))) as StoredTokenPayload
    return newer.access_token
  }

  return payload.access_token
}

/** Decrypted token set, for revocation only. Never return this from an API route. */
export async function readTokensForRevocation(
  db: SupabaseClient,
  connectionId: string,
): Promise<StoredTokenPayload | null> {
  const row = await readSecretRow(db, connectionId)
  if (!row) return null
  return JSON.parse(decryptConnectionSecret(row.ciphertext, secretAad(connectionId))) as StoredTokenPayload
}
