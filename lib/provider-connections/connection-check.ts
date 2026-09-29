// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Server-side connection validation for a user's Kling MCP connection:
// obtain a valid token -> initialize MCP -> tools/list -> who_am_i ->
// query_membership_and_credits -> disconnect -> record SAFE metadata.
// Read-only: no generation tool can be reached (see kling-mcp-client.ts).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOwnedConnection, recordCheckFailure, recordCheckSuccess } from './connections'
import { ConnectionEncryptionNotConfiguredError, ConnectionSecretDecryptionError } from './crypto'
import { runKlingReadOnlyCheck, type KlingMcpClientDependencies, type KlingReadOnlyCheckResult } from './kling-mcp-client'
import { forceRefreshAccessToken, getValidAccessToken, type TokenRefreshDependencies } from './token-store'
import {
  ProviderAuthorizationRequiredError,
  ProviderConnectionError,
  toPublicConnection,
  type ProviderConnectionErrorCode,
  type PublicProviderConnection,
} from './types'

export type CheckOutcome =
  | { ok: true; connection: PublicProviderConnection; credits: KlingReadOnlyCheckResult['credits'] }
  | { ok: false; notFound: true }
  | { ok: false; notFound?: false; code: ProviderConnectionErrorCode; connectionStatus: 'authorization_required' | 'error' }

export interface CheckDependencies extends TokenRefreshDependencies, KlingMcpClientDependencies {
  runCheck?: typeof runKlingReadOnlyCheck
}

const CONNECTION_FAULT_CODES: ProviderConnectionErrorCode[] = [
  'PROVIDER_SCOPE_INSUFFICIENT',
  'PROVIDER_TOOL_ERROR',
  'PROVIDER_CONNECTION_INVALID',
]

function toConnectionError(error: unknown): ProviderConnectionError {
  if (error instanceof ProviderConnectionError) return error
  if (error instanceof ConnectionEncryptionNotConfiguredError) {
    return new ProviderConnectionError('CONNECTION_ENCRYPTION_NOT_CONFIGURED')
  }
  if (error instanceof ConnectionSecretDecryptionError) {
    return new ProviderConnectionError('PROVIDER_CONNECTION_INVALID')
  }
  return new ProviderConnectionError('PROVIDER_UNAVAILABLE')
}

export async function checkKlingMcpConnection(
  db: SupabaseClient,
  params: { connectionId: string; userId: string },
  deps: CheckDependencies = {},
): Promise<CheckOutcome> {
  // Ownership is verified first; a foreign or unknown id is indistinguishable.
  const owned = await getOwnedConnection(db, params.connectionId, params.userId)
  if (!owned) return { ok: false, notFound: true }

  const runCheck = deps.runCheck ?? runKlingReadOnlyCheck

  try {
    let accessToken = await getValidAccessToken(db, owned.id, deps)
    let result: KlingReadOnlyCheckResult

    try {
      result = await runCheck(accessToken, deps)
    } catch (error) {
      // A token can be rejected before its recorded expiry (e.g. server-side
      // revocation of the access token). Refresh once and retry once.
      if (!(error instanceof ProviderAuthorizationRequiredError)) throw error
      accessToken = await forceRefreshAccessToken(db, owned.id, deps)
      result = await runCheck(accessToken, deps)
    }

    const updated = await recordCheckSuccess(db, {
      connectionId: owned.id,
      userId: params.userId,
      externalAccountId: result.accountId,
      capabilities: result.capabilities,
    })

    return { ok: true, connection: toPublicConnection(updated ?? owned), credits: result.credits }
  } catch (error) {
    const known = toConnectionError(error)
    const needsReauth = known instanceof ProviderAuthorizationRequiredError

    // Only failures that say something about the CONNECTION are recorded.
    // Transient unavailability and infrastructure problems (missing/rotated
    // encryption key) must not flip a healthy connection to "error".
    if (needsReauth || CONNECTION_FAULT_CODES.includes(known.code)) {
      await recordCheckFailure(db, {
        connectionId: owned.id,
        userId: params.userId,
        status: needsReauth ? 'authorization_required' : 'error',
        errorCode: known.code,
      })
    }

    return {
      ok: false,
      code: known.code,
      connectionStatus: needsReauth ? 'authorization_required' : 'error',
    }
  }
}
