// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Metadata access for provider_connections. Every function that takes a
// connection id also takes the authenticated user's id and filters by BOTH, so
// a guessed/foreign id can never resolve another user's connection — on top of
// the table's own RLS. Nothing here touches secret material.

import type { SupabaseClient } from '@supabase/supabase-js'
import { KLING_MCP_METHOD, KLING_MCP_PROVIDER } from './kling-mcp'
import type { KlingMcpCapabilitySnapshot, ProviderConnectionRow } from './types'

const TABLE = 'provider_connections'

export async function listConnectionsForUser(db: SupabaseClient, userId: string): Promise<ProviderConnectionRow[]> {
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return (data as ProviderConnectionRow[] | null) ?? []
}

export async function getOwnedConnection(
  db: SupabaseClient,
  connectionId: string,
  userId: string,
): Promise<ProviderConnectionRow | null> {
  const { data } = await db.from(TABLE).select('*').eq('id', connectionId).eq('user_id', userId).maybeSingle()
  return (data as ProviderConnectionRow | null) ?? null
}

/** Creates or re-activates the user's single Kling MCP connection (reconnect reuses the row). */
export async function upsertKlingMcpConnection(
  db: SupabaseClient,
  params: { userId: string; scopes: string[] },
): Promise<ProviderConnectionRow> {
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        user_id: params.userId,
        provider: KLING_MCP_PROVIDER,
        connection_method: KLING_MCP_METHOD,
        status: 'connected',
        scopes: params.scopes,
        last_error_code: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider,connection_method' },
    )
    .select('*')
    .single()

  if (error || !data) throw new Error('Failed to persist the provider connection')
  return data as ProviderConnectionRow
}

export async function recordCheckSuccess(
  db: SupabaseClient,
  params: {
    connectionId: string
    userId: string
    externalAccountId: string | null
    capabilities: KlingMcpCapabilitySnapshot
    now?: Date
  },
): Promise<ProviderConnectionRow | null> {
  const now = (params.now ?? new Date()).toISOString()
  const { data } = await db
    .from(TABLE)
    .update({
      status: 'connected',
      external_account_id: params.externalAccountId,
      capabilities: params.capabilities,
      last_checked_at: now,
      last_error_code: null,
      updated_at: now,
    })
    .eq('id', params.connectionId)
    .eq('user_id', params.userId)
    .select('*')
    .maybeSingle()
  return (data as ProviderConnectionRow | null) ?? null
}

export async function recordCheckFailure(
  db: SupabaseClient,
  params: {
    connectionId: string
    userId: string
    status: 'authorization_required' | 'error'
    errorCode: string
    now?: Date
  },
): Promise<void> {
  const now = (params.now ?? new Date()).toISOString()
  await db
    .from(TABLE)
    .update({
      status: params.status,
      last_error_code: params.errorCode,
      last_checked_at: now,
      updated_at: now,
    })
    .eq('id', params.connectionId)
    .eq('user_id', params.userId)
}

export async function deleteOwnedConnection(db: SupabaseClient, connectionId: string, userId: string): Promise<void> {
  // ON DELETE CASCADE removes provider_connection_secrets with it.
  await db.from(TABLE).delete().eq('id', connectionId).eq('user_id', userId)
}
