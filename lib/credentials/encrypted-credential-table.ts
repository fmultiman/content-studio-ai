// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3A — SERVER ONLY.
//
// The ONLY module that names the encrypted credential table (`provider_api_credentials`) and its `ciphertext` column. It
// is a thin, explicit-column data-access layer over a PRIVILEGED client that the caller (api-credential-store.ts, which
// owns client selection and the ownership proof) hands in. It never creates a client, never decrypts (see byok-crypto.ts),
// never logs, and turns every database error into a `store_failure` without the database's message.
//
// The table is created by docs/productization/sql/FUTURE_059_SLICE_3_provider_api_credentials.up.sql (reviewed, NOT
// applied by any deploy). Its privileges are service_role only; the browser roles hold nothing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ProviderCredentialUnavailableError } from './credential-errors'
import type { AiProvider } from './provider-credentials'

/** Replicate has no consumer and no configured user; it is deliberately excluded from the encrypted store. */
export const ENCRYPTED_PROVIDERS = ['openai', 'gemini', 'nano_banana', 'kling'] as const
export type EncryptedProvider = (typeof ENCRYPTED_PROVIDERS)[number]

export function isEncryptedProvider(provider: AiProvider): provider is EncryptedProvider {
  return (ENCRYPTED_PROVIDERS as readonly string[]).includes(provider)
}

const TABLE = 'provider_api_credentials'
const COLUMNS = 'provider, ciphertext, key_id, format_version, secret_version'

export interface EncryptedRow {
  provider: EncryptedProvider
  ciphertext: string
  keyId: string
  formatVersion: number
  secretVersion: number
}

function toRow(raw: unknown, provider: AiProvider | null): EncryptedRow {
  const row = raw as Record<string, unknown> | null
  if (
    !row ||
    typeof row.provider !== 'string' ||
    !isEncryptedProvider(row.provider as AiProvider) ||
    typeof row.ciphertext !== 'string' ||
    typeof row.key_id !== 'string' ||
    typeof row.format_version !== 'number' ||
    typeof row.secret_version !== 'number'
  ) {
    throw new ProviderCredentialUnavailableError('payload_invalid', provider)
  }
  return {
    provider: row.provider as EncryptedProvider,
    ciphertext: row.ciphertext,
    keyId: row.key_id,
    formatVersion: row.format_version,
    secretVersion: row.secret_version,
  }
}

/** One owner/provider row, or null when no encrypted credential exists. */
export async function selectEncryptedRow(client: SupabaseClient, userId: string, provider: EncryptedProvider): Promise<EncryptedRow | null> {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq('user_id', userId).eq('provider', provider).maybeSingle()
  if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
  return data ? toRow(data, provider) : null
}

/** Every encrypted row of ONE owner (at most one per provider). */
export async function selectEncryptedRows(client: SupabaseClient, userId: string): Promise<EncryptedRow[]> {
  const { data, error } = await client.from(TABLE).select(COLUMNS).eq('user_id', userId)
  if (error) throw new ProviderCredentialUnavailableError('store_failure')
  return ((data as unknown[] | null) ?? []).map((raw) => toRow(raw, null))
}

/**
 * Create or replace the owner's credential for a provider. `secretVersion` is the NEXT version (previous + 1); a user
 * write is last-writer-wins, which is correct for a user replacing their own key.
 */
export async function upsertEncryptedRow(
  client: SupabaseClient,
  params: { userId: string; provider: EncryptedProvider; ciphertext: string; keyId: string; formatVersion: number; secretVersion: number },
): Promise<void> {
  const { error } = await client.from(TABLE).upsert(
    {
      user_id: params.userId,
      provider: params.provider,
      ciphertext: params.ciphertext,
      key_id: params.keyId,
      format_version: params.formatVersion,
      secret_version: params.secretVersion,
      source: 'user_entry',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' },
  )
  if (error) throw new ProviderCredentialUnavailableError('store_failure', params.provider)
}

export async function deleteEncryptedRow(client: SupabaseClient, userId: string, provider: EncryptedProvider): Promise<void> {
  const { error } = await client.from(TABLE).delete().eq('user_id', userId).eq('provider', provider)
  if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
}
