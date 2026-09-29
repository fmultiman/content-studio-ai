// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Short-lived, single-use OAuth authorization attempts (state + PKCE).
//
// - `state` is 256 bits of CSPRNG output; only its SHA-256 is stored.
// - The PKCE code_verifier is stored ENCRYPTED and never leaves the server
//   until the code exchange.
// - An attempt is bound to the initiating authenticated user.
// - Consumption is an atomic DELETE ... RETURNING, so a state can be used at
//   most once. It is consumed even when the presenting user does not match,
//   so a leaked state cannot be retried by anyone.
// - Attempts expire after 10 minutes; expired rows are swept opportunistically.

import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptConnectionSecret, encryptConnectionSecret } from './crypto'

export const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000

const TABLE = 'provider_oauth_authorizations'

export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function hashOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex')
}

const verifierAad = (stateHash: string) => `oauth-authorization:${stateHash}`

export interface NewAuthorizationAttempt {
  userId: string
  provider: string
  connectionMethod: string
  issuer: string
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeVerifier: string
}

export async function storeAuthorizationAttempt(
  db: SupabaseClient,
  attempt: NewAuthorizationAttempt,
  now: Date = new Date(),
): Promise<void> {
  const stateHash = hashOAuthState(attempt.state)

  // Opportunistic sweep of expired attempts (best effort; failure is harmless).
  await db.from(TABLE).delete().lt('expires_at', now.toISOString())

  const { error } = await db.from(TABLE).insert({
    state_hash: stateHash,
    user_id: attempt.userId,
    provider: attempt.provider,
    connection_method: attempt.connectionMethod,
    issuer: attempt.issuer,
    client_id: attempt.clientId,
    redirect_uri: attempt.redirectUri,
    scope: attempt.scope,
    code_verifier_ciphertext: encryptConnectionSecret(attempt.codeVerifier, verifierAad(stateHash)),
    expires_at: new Date(now.getTime() + OAUTH_ATTEMPT_TTL_MS).toISOString(),
  })

  if (error) throw new Error('Failed to store the authorization attempt')
}

export interface ConsumedAuthorizationAttempt {
  userId: string
  provider: string
  connectionMethod: string
  issuer: string
  clientId: string
  redirectUri: string
  scope: string
  codeVerifier: string
}

export type ConsumeResult =
  | { ok: true; attempt: ConsumedAuthorizationAttempt }
  | { ok: false; reason: 'invalid_state' | 'expired_state' | 'state_mismatch' }

export async function consumeAuthorizationAttempt(
  db: SupabaseClient,
  params: { state: string; userId: string },
  now: Date = new Date(),
): Promise<ConsumeResult> {
  const stateHash = hashOAuthState(params.state)

  // Atomic single-use: the row is deleted and returned in one statement.
  const { data, error } = await db.from(TABLE).delete().eq('state_hash', stateHash).select().maybeSingle()

  if (error || !data) return { ok: false, reason: 'invalid_state' }

  if (new Date(data.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired_state' }
  }
  if (data.user_id !== params.userId) {
    return { ok: false, reason: 'state_mismatch' }
  }

  return {
    ok: true,
    attempt: {
      userId: data.user_id,
      provider: data.provider,
      connectionMethod: data.connection_method,
      issuer: data.issuer,
      clientId: data.client_id,
      redirectUri: data.redirect_uri,
      scope: data.scope,
      codeVerifier: decryptConnectionSecret(data.code_verifier_ciphertext, verifierAad(stateHash)),
    },
  }
}

/** Drops an attempt without decrypting it (e.g. the provider returned an OAuth error). */
export async function discardAuthorizationAttempt(db: SupabaseClient, state: string): Promise<void> {
  await db.from(TABLE).delete().eq('state_hash', hashOAuthState(state))
}
