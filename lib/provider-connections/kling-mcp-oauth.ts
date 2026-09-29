// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// The OAuth authorization-code + PKCE (S256) flow against Kling's official
// MCP authorization server, and token revocation. Uses the official MCP SDK's
// OAuth helpers; no hand-rolled protocol beyond the RFC 7009 revocation POST
// (the SDK exposes no standalone revoke helper).
//
// Security properties enforced here:
//  - PKCE S256 with a server-generated verifier (never client-authoritative)
//  - single-use, short-lived, user-bound, CSPRNG `state` (see oauth-state.ts)
//  - the code exchange happens server-side; tokens are never returned to a caller
//  - the authorization request asks for READ-ONLY scopes only
//  - the redirect URI comes from explicit environment config, never the request

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OAuthError,
  OAuthErrorCode,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  startAuthorization,
  type OAuthTokens,
} from '@modelcontextprotocol/client'
import {
  KLING_MCP_PROVIDER,
  KLING_MCP_METHOD,
  KLING_MCP_SCOPE_STRING,
  KLING_MCP_URL,
  getAppBaseUrl,
  klingMcpRedirectUri,
} from './kling-mcp'
import { deleteOAuthClient, getOrRegisterOAuthClient, type RegisterDependencies } from './oauth-client-registry'
import { consumeAuthorizationAttempt, generateOAuthState, storeAuthorizationAttempt } from './oauth-state'
import { readTokensForRevocation, saveConnectionTokens } from './token-store'
import { activateConnection, upsertKlingMcpConnection } from './connections'
import type { OAuthCallbackFailure, ProviderConnectionRow } from './types'

export interface KlingOAuthDependencies extends RegisterDependencies {
  discover?: typeof discoverOAuthServerInfo
  start?: typeof startAuthorization
  exchange?: typeof exchangeAuthorization
  fetchFn?: typeof fetch
  now?: () => Date
}

export async function startKlingMcpAuthorization(
  db: SupabaseClient,
  params: { userId: string },
  deps: KlingOAuthDependencies = {},
): Promise<{ authorizationUrl: string }> {
  const discover = deps.discover ?? discoverOAuthServerInfo
  const start = deps.start ?? startAuthorization
  const now = (deps.now ?? (() => new Date()))()

  const info = await discover(KLING_MCP_URL)
  const metadata = info.authorizationServerMetadata
  if (!metadata) throw new Error('Kling authorization server metadata unavailable')

  const issuer = String(info.authorizationServerUrl)
  const redirectUri = klingMcpRedirectUri()

  const client = await getOrRegisterOAuthClient(
    db,
    {
      provider: KLING_MCP_PROVIDER,
      issuer,
      redirectUri,
      scope: KLING_MCP_SCOPE_STRING,
      appBaseUrl: getAppBaseUrl(),
      metadata,
    },
    deps,
  )

  const state = generateOAuthState()

  // The SDK generates the PKCE pair and builds the URL with code_challenge_method=S256.
  const { authorizationUrl, codeVerifier } = await start(info.authorizationServerUrl, {
    metadata,
    clientInformation: { client_id: client.clientId },
    redirectUrl: redirectUri,
    scope: KLING_MCP_SCOPE_STRING,
    state,
    resource: KLING_MCP_URL,
  })

  await storeAuthorizationAttempt(
    db,
    {
      userId: params.userId,
      provider: KLING_MCP_PROVIDER,
      connectionMethod: KLING_MCP_METHOD,
      issuer,
      clientId: client.clientId,
      redirectUri,
      scope: KLING_MCP_SCOPE_STRING,
      state,
      codeVerifier,
    },
    now,
  )

  return { authorizationUrl: authorizationUrl.toString() }
}

export type CompleteResult =
  | { ok: true; connection: ProviderConnectionRow }
  | { ok: false; failure: OAuthCallbackFailure }

export async function completeKlingMcpAuthorization(
  db: SupabaseClient,
  params: { userId: string; state: string; code: string; iss?: string },
  deps: KlingOAuthDependencies = {},
): Promise<CompleteResult> {
  const discover = deps.discover ?? discoverOAuthServerInfo
  const exchange = deps.exchange ?? exchangeAuthorization
  const now = (deps.now ?? (() => new Date()))()

  // State is consumed (single-use) before anything else happens.
  const consumed = await consumeAuthorizationAttempt(db, { state: params.state, userId: params.userId }, now)
  if (!consumed.ok) return { ok: false, failure: consumed.reason }

  const attempt = consumed.attempt
  if (attempt.provider !== KLING_MCP_PROVIDER || attempt.connectionMethod !== KLING_MCP_METHOD) {
    return { ok: false, failure: 'invalid_state' }
  }

  let tokens: OAuthTokens
  try {
    const info = await discover(KLING_MCP_URL)
    // The issuer must be the one recorded when the attempt started (mix-up defense).
    if (String(info.authorizationServerUrl) !== attempt.issuer) {
      return { ok: false, failure: 'exchange_failed' }
    }

    tokens = await exchange(info.authorizationServerUrl, {
      metadata: info.authorizationServerMetadata,
      clientInformation: { client_id: attempt.clientId },
      authorizationCode: params.code,
      iss: params.iss,
      codeVerifier: attempt.codeVerifier,
      redirectUri: attempt.redirectUri,
      resource: KLING_MCP_URL,
    })
  } catch (error) {
    // The provider no longer recognises our registration: forget it so the next
    // attempt registers a fresh client instead of retrying a dead client_id.
    if (error instanceof OAuthError && error.code === OAuthErrorCode.InvalidClient) {
      await deleteOAuthClient(db, {
        provider: KLING_MCP_PROVIDER,
        issuer: attempt.issuer,
        redirectUri: attempt.redirectUri,
      }).catch(() => undefined)
    }
    return { ok: false, failure: 'exchange_failed' }
  }

  const grantedScopes = (tokens.scope ?? attempt.scope).split(/\s+/).filter(Boolean)

  // 1) the row exists as "authorization_required", 2) tokens are stored,
  // 3) only then is it "connected". A failure in between can never leave a
  // "connected" connection without credentials.
  const pending = await upsertKlingMcpConnection(db, { userId: params.userId })
  await saveConnectionTokens(db, pending.id, tokens, { clientId: attempt.clientId, issuer: attempt.issuer }, now)
  const connection = await activateConnection(db, { connectionId: pending.id, userId: params.userId, scopes: grantedScopes })

  return { ok: true, connection }
}

export type RevocationOutcome = 'succeeded' | 'failed' | 'skipped'

/** Discovery and each revocation call are bounded so a hung provider can never block local cleanup. */
export const REVOCATION_TIMEOUT_MS = 5_000

/**
 * RFC 7009 revocation of the user's grant at Kling. Best effort and bounded:
 * it never throws and never waits longer than the timeouts, and the caller
 * deletes local secrets regardless of the outcome. Uses the client the grant
 * was issued to (stored with the tokens), not the current environment's.
 */
export async function revokeKlingMcpGrant(
  db: SupabaseClient,
  connectionId: string,
  deps: KlingOAuthDependencies = {},
): Promise<RevocationOutcome> {
  const discover = deps.discover ?? discoverOAuthServerInfo
  const doFetch = deps.fetchFn ?? fetch
  const boundedFetch = (url: string | URL, init?: RequestInit) =>
    doFetch(url, { ...init, signal: AbortSignal.timeout(REVOCATION_TIMEOUT_MS) })

  try {
    const tokens = await readTokensForRevocation(db, connectionId)
    if (!tokens?.client_id) return 'skipped'

    const info = await discover(KLING_MCP_URL, { fetchFn: boundedFetch as never })
    // RFC 8414 field; the SDK's metadata union type does not model it.
    const revocationEndpoint = (info.authorizationServerMetadata as { revocation_endpoint?: string } | undefined)
      ?.revocation_endpoint
    if (!revocationEndpoint) return 'skipped'

    const revoke = async (token: string, hint: 'refresh_token' | 'access_token') => {
      const body = new URLSearchParams({ token, token_type_hint: hint, client_id: tokens.client_id })
      const response = await boundedFetch(revocationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      return response.ok
    }

    const attempts: Array<Promise<boolean>> = []
    if (tokens.refresh_token) attempts.push(revoke(tokens.refresh_token, 'refresh_token'))
    attempts.push(revoke(tokens.access_token, 'access_token'))

    const results = await Promise.all(attempts)
    return results.every(Boolean) ? 'succeeded' : 'failed'
  } catch {
    return 'failed'
  }
}
