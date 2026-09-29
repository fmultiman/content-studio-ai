// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Server-only persistence and refresh of a user's OAuth token material.
//
// - Tokens are encrypted (AES-256-GCM, AAD-bound to the connection id) before
//   they reach the database; provider_connection_secrets holds ciphertext only.
// - The grant's own `client_id` and issuer are stored (encrypted) WITH the
//   tokens. A refresh token is only valid for the client it was issued to, so
//   refresh never depends on the current environment's redirect URI or on the
//   client-registration table.
// - `getValidAccessToken` is the ONLY way other server code obtains an access
//   token. It refreshes when the token is expired or near expiry, persists a
//   rotated refresh token, and maps a revoked/invalid grant to
//   PROVIDER_AUTHORIZATION_REQUIRED (never a generic 500).
// - Refresh writes use optimistic concurrency on a MONOTONIC `secret_version`:
//   parallel serverless invocations — and a reconnect that lands mid-refresh —
//   cannot overwrite newer credentials with a stale result.
// - Database failures are never confused with "no secret": they throw
//   CONNECTION_STORE_UNAVAILABLE and change nothing.
// - Nothing here logs, returns or throws a token.

import type { SupabaseClient } from '@supabase/supabase-js'
import { OAuthError, OAuthErrorCode, discoverOAuthServerInfo, refreshAuthorization, type OAuthTokens } from '@modelcontextprotocol/client'
import { decryptConnectionSecret, encryptConnectionSecret } from './crypto'
import { KLING_MCP_URL } from './kling-mcp'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from './types'

const SECRETS = 'provider_connection_secrets'
const CONNECTIONS = 'provider_connections'

/** Refresh when the access token has less than this left. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

/** Provider says the GRANT is unusable → the user must re-authorize. */
const REAUTHORIZATION_ERROR_CODES: readonly string[] = [OAuthErrorCode.InvalidGrant, OAuthErrorCode.UnauthorizedClient]

/** The OAuth client that a grant was issued to (needed to refresh or revoke it). */
export interface GrantContext {
  clientId: string
  issuer: string
}

export interface StoredTokenPayload {
  access_token: string
  refresh_token?: string
  token_type: string
  scope?: string
  client_id: string
  issuer: string
}

const secretAad = (connectionId: string) => `connection-secret:${connectionId}`
const storeUnavailable = () => new ProviderConnectionError('CONNECTION_STORE_UNAVAILABLE')

function expiryFrom(tokens: OAuthTokens, now: Date): string | null {
  return typeof tokens.expires_in === 'number' ? new Date(now.getTime() + tokens.expires_in * 1000).toISOString() : null
}

function toPayload(tokens: OAuthTokens, grant: GrantContext, previous?: StoredTokenPayload): StoredTokenPayload {
  return {
    access_token: tokens.access_token,
    // Keep the old refresh token when the provider does not rotate it.
    refresh_token: tokens.refresh_token ?? previous?.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope ?? previous?.scope,
    client_id: grant.clientId,
    issuer: grant.issuer,
  }
}

interface SecretRow {
  ciphertext: string
  access_token_expires_at: string | null
  secret_version: number
}

async function readSecretRow(db: SupabaseClient, connectionId: string): Promise<SecretRow | null> {
  const { data, error } = await db
    .from(SECRETS)
    .select('ciphertext, access_token_expires_at, secret_version')
    .eq('connection_id', connectionId)
    .maybeSingle()
  if (error) throw storeUnavailable()
  return (data as SecretRow | null) ?? null
}

function readPayload(row: SecretRow, connectionId: string): StoredTokenPayload {
  return JSON.parse(decryptConnectionSecret(row.ciphertext, secretAad(connectionId))) as StoredTokenPayload
}

/**
 * Stores the tokens for a connection (first authorization or a reconnect).
 * `secret_version` only ever increases, so a refresh that began before a
 * reconnect can never win its compare-and-swap afterwards.
 */
export async function saveConnectionTokens(
  db: SupabaseClient,
  connectionId: string,
  tokens: OAuthTokens,
  grant: GrantContext,
  now: Date = new Date(),
): Promise<void> {
  const existing = await readSecretRow(db, connectionId)
  const ciphertext = encryptConnectionSecret(JSON.stringify(toPayload(tokens, grant)), secretAad(connectionId))

  const { error } = await db.from(SECRETS).upsert(
    {
      connection_id: connectionId,
      ciphertext,
      access_token_expires_at: expiryFrom(tokens, now),
      secret_version: (existing?.secret_version ?? 0) + 1,
      updated_at: now.toISOString(),
    },
    { onConflict: 'connection_id' },
  )
  if (error) throw storeUnavailable()
}

/** Throws when the delete fails, so a failed delete is never reported as success. */
export async function deleteConnectionTokens(db: SupabaseClient, connectionId: string): Promise<void> {
  const { error } = await db.from(SECRETS).delete().eq('connection_id', connectionId)
  if (error) throw storeUnavailable()
}

/**
 * Best effort: flag the connection and drop credentials that can no longer work.
 * The caller throws PROVIDER_AUTHORIZATION_REQUIRED regardless of the outcome.
 */
async function markAuthorizationRequired(db: SupabaseClient, connectionId: string): Promise<void> {
  try {
    await db
      .from(CONNECTIONS)
      .update({
        status: 'authorization_required',
        last_error_code: 'PROVIDER_AUTHORIZATION_REQUIRED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId)
    await deleteConnectionTokens(db, connectionId)
  } catch {
    // Nothing more can be done here; the caller still reports re-authorization.
  }
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

  const tokens = readPayload(row, connectionId)

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
  return refreshAccessToken(db, connectionId, row, readPayload(row, connectionId), deps, now)
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
  // Grants written by this module always carry their client; without it the
  // credentials cannot be refreshed. Nothing is deleted: this is not a
  // provider verdict, so it is surfaced as an invalid connection.
  if (!tokens.client_id || !tokens.issuer) throw new ProviderConnectionError('PROVIDER_CONNECTION_INVALID')

  const discover = deps.discover ?? discoverOAuthServerInfo
  const refresh = deps.refresh ?? refreshAuthorization

  let refreshed: OAuthTokens
  try {
    const info = await discover(KLING_MCP_URL)
    // A different issuer than the one that issued this grant is not a verdict on the grant.
    if (String(info.authorizationServerUrl) !== tokens.issuer) {
      throw new ProviderConnectionError('PROVIDER_CONNECTION_INVALID')
    }

    refreshed = await refresh(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      // The client THIS grant was issued to — not the current environment's.
      clientInformation: { client_id: tokens.client_id },
      refreshToken: tokens.refresh_token,
      resource: KLING_MCP_URL,
    })
  } catch (error) {
    if (error instanceof ProviderConnectionError) throw error

    if (error instanceof OAuthError) {
      // The client registration itself was rejected: possibly a server-side or
      // registration fault, so the (possibly still valid) tokens are KEPT.
      if (error.code === OAuthErrorCode.InvalidClient) throw new ProviderConnectionError('PROVIDER_CLIENT_REJECTED')

      if (REAUTHORIZATION_ERROR_CODES.includes(error.code)) {
        // Another invocation may have already rotated the token; if the stored
        // version moved on, that newer token is the one to use.
        const latest = await readSecretRow(db, connectionId)
        if (latest && latest.secret_version !== row.secret_version) {
          return readPayload(latest, connectionId).access_token
        }
        await markAuthorizationRequired(db, connectionId)
        throw new ProviderAuthorizationRequiredError()
      }
    }

    // Network/5xx/etc.: the grant may still be valid. Do not change status.
    throw new ProviderConnectionError('PROVIDER_UNAVAILABLE')
  }

  const payload = toPayload(refreshed, { clientId: tokens.client_id, issuer: tokens.issuer }, tokens)
  const ciphertext = encryptConnectionSecret(JSON.stringify(payload), secretAad(connectionId))

  // Compare-and-swap on secret_version; persists a rotated refresh token.
  const { data: updated, error } = await db
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

  if (error) throw storeUnavailable()

  if (!updated || updated.length === 0) {
    // Lost the race: another invocation (or a reconnect) stored newer credentials. Use them.
    const latest = await readSecretRow(db, connectionId)
    if (!latest) throw new ProviderAuthorizationRequiredError()
    return readPayload(latest, connectionId).access_token
  }

  return payload.access_token
}

/** Decrypted token set, for revocation only. Never return this from an API route. */
export async function readTokensForRevocation(
  db: SupabaseClient,
  connectionId: string,
): Promise<StoredTokenPayload | null> {
  const row = await readSecretRow(db, connectionId)
  return row ? readPayload(row, connectionId) : null
}
