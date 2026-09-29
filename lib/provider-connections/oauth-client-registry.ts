// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Content Studio's OAuth CLIENT registration with a provider (RFC 7591
// Dynamic Client Registration). This is NOT a user connection and holds no
// user token:
//
//   Content Studio OAuth client registration   !=   user Kling OAuth connection
//
// One registration per (provider, issuer, redirect URI) serves every user of
// that environment — Kling advertises a public-client model
// (token_endpoint_auth_methods_supported: ["none"]), so there is no per-user
// client. The redirect URI keys the environment (production vs local).
//
// A public `client_id` is not secret. If the provider returns
// registration-management material (client_secret / registration_access_token)
// it is encrypted and stored server-side only.
//
// The MCP SDK's registerClient() strips fields it does not model, so a wrapped
// fetch records the NAMES (never values) of the raw response fields as
// evidence of the provider's DCR behavior.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  registerClient,
  type AuthorizationServerMetadata,
  type FetchLike,
} from '@modelcontextprotocol/client'
import { encryptConnectionSecret } from './crypto'

const TABLE = 'provider_oauth_clients'

export interface RegisteredOAuthClient {
  clientId: string
  registrationResponseFields: string[]
  newlyRegistered: boolean
}

export interface OAuthClientLookup {
  provider: string
  issuer: string
  redirectUri: string
}

const managementAad = (lookup: OAuthClientLookup) =>
  `oauth-client:${lookup.provider}:${lookup.issuer}:${lookup.redirectUri}`

export async function findOAuthClient(
  db: SupabaseClient,
  lookup: OAuthClientLookup,
): Promise<RegisteredOAuthClient | null> {
  const { data } = await db
    .from(TABLE)
    .select('client_id, registration_response_fields')
    .eq('provider', lookup.provider)
    .eq('issuer', lookup.issuer)
    .eq('redirect_uri', lookup.redirectUri)
    .maybeSingle()

  if (!data) return null
  return {
    clientId: data.client_id,
    registrationResponseFields: data.registration_response_fields ?? [],
    newlyRegistered: false,
  }
}

export interface RegisterDependencies {
  register?: typeof registerClient
}

export async function getOrRegisterOAuthClient(
  db: SupabaseClient,
  params: OAuthClientLookup & {
    scope: string
    appBaseUrl: string
    metadata: AuthorizationServerMetadata
  },
  deps: RegisterDependencies = {},
): Promise<RegisteredOAuthClient> {
  const existing = await findOAuthClient(db, params)
  if (existing) return existing

  const captured: { fields: string[]; management: Record<string, unknown> } = { fields: [], management: {} }

  const capturingFetch: FetchLike = async (url, init) => {
    const response = await fetch(url, init)
    try {
      const body = (await response.clone().json()) as Record<string, unknown>
      captured.fields = Object.keys(body).sort()
      for (const key of ['client_secret', 'registration_access_token', 'registration_client_uri']) {
        if (body[key] !== undefined) captured.management[key] = body[key]
      }
    } catch {
      // Non-JSON error body: nothing to record.
    }
    return response
  }

  const register = deps.register ?? registerClient
  const registration = await register(params.issuer, {
    metadata: params.metadata,
    scope: params.scope,
    fetchFn: capturingFetch,
    clientMetadata: {
      client_name: 'Content Studio',
      client_uri: params.appBaseUrl,
      redirect_uris: [params.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      scope: params.scope,
      logo_uri: undefined,
      tos_uri: undefined,
    },
  })

  const management =
    Object.keys(captured.management).length > 0
      ? encryptConnectionSecret(JSON.stringify(captured.management), managementAad(params))
      : null

  const { error } = await db.from(TABLE).insert({
    provider: params.provider,
    issuer: params.issuer,
    redirect_uri: params.redirectUri,
    client_id: registration.client_id,
    management_ciphertext: management,
    registration_response_fields: captured.fields,
    registered_scope: params.scope,
  })

  if (error) {
    // A concurrent first-time registration won the unique key: use the stored one.
    const winner = await findOAuthClient(db, params)
    if (winner) return winner
    throw new Error('Failed to store the OAuth client registration')
  }

  return {
    clientId: registration.client_id,
    registrationResponseFields: captured.fields,
    newlyRegistered: true,
  }
}

/**
 * Forget a registration the provider no longer accepts (invalid_client), so the
 * next connection attempt registers afresh instead of retrying a dead client_id.
 */
export async function deleteOAuthClient(db: SupabaseClient, lookup: OAuthClientLookup): Promise<void> {
  await db
    .from(TABLE)
    .delete()
    .eq('provider', lookup.provider)
    .eq('issuer', lookup.issuer)
    .eq('redirect_uri', lookup.redirectUri)
}
