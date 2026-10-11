// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — SERVER ONLY.
//
// The ONE module that touches the BYOK API-key columns of `user_settings`
// (openai_api_key, gemini_api_key, nanobanana_api_key, kling_api_key,
// replicate_api_key). Everything else goes through `provider-credentials.ts`
// (resolve / status) or the Settings routes (write / remove).
//
// What this slice establishes (and what it does NOT):
//   - Secret columns are read and written ONLY here, with the server-side
//     service-role client, never with the caller's browser-session client.
//     Slice 2 can therefore revoke browser column grants without breaking the
//     server.
//   - The data is still the LEGACY plaintext store. Nothing is encrypted,
//     moved or backfilled here, and no database grant or RLS policy changes.
//     This module is the seam where an encrypted-first / legacy-fallback read
//     is added later (the `readColumns` / `writeColumns` bodies).
//
// Authorization. The service role bypasses RLS, so ownership is enforced here
// before any privileged read:
//   1. `userId` must be a plain, non-empty identifier. It always comes from a
//      server-verified context (`supabase.auth.getUser()` in a route, or the
//      owner id read from our own database row) — never from a request body.
//   2. OWNERSHIP PROOF: the caller's own client reads the non-secret `user_id`
//      of that row. A browser-session client only sees its own row (RLS), so a
//      foreign `userId` yields no row and no privileged read happens. A
//      service-role caller (webhook/background code that took the owner from a
//      database record) passes trivially, exactly as before.
//   3. Only then does the privileged client run a single-row, explicit-column
//      query. There is no wildcard select and no multi-user query.
//
// Failure semantics. "Not configured" and "could not be read" are different
// facts: a store/database failure throws `ProviderCredentialUnavailableError`
// and is never reported as a missing credential. Errors carry a static message
// and a coarse reason — never a column value, a query string or the database
// error text.
//
// This module never logs, returns in an error, or otherwise surfaces a secret.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import type { AiProvider } from './provider-credentials'

const SECRET_COLUMN: Record<AiProvider, string> = {
  openai: 'openai_api_key',
  nano_banana: 'nanobanana_api_key',
  kling: 'kling_api_key',
  replicate: 'replicate_api_key',
  gemini: 'gemini_api_key',
}

const PROVIDERS = Object.keys(SECRET_COLUMN) as AiProvider[]

export const PROVIDER_CREDENTIAL_UNAVAILABLE = 'PROVIDER_CREDENTIAL_UNAVAILABLE'
export const CREDENTIAL_ACCESS_DENIED = 'CREDENTIAL_ACCESS_DENIED'

export type CredentialUnavailableReason =
  /** The privileged server client could not be created (not configured / not permitted in this runtime). */
  | 'store_client_unavailable'
  /** A database read or write failed. */
  | 'store_failure'
  /** A stored value exists but is not a string. */
  | 'malformed'

/** The credential store could not be read or written. NOT "credential missing". */
export class ProviderCredentialUnavailableError extends Error {
  readonly code = PROVIDER_CREDENTIAL_UNAVAILABLE
  readonly status = 503
  readonly reason: CredentialUnavailableReason
  readonly provider: AiProvider | null

  constructor(reason: CredentialUnavailableReason, provider: AiProvider | null = null) {
    // Browser-safe: no column, value, query or database message.
    super('As credenciais do provedor estão temporariamente indisponíveis. Tente novamente.')
    this.name = 'ProviderCredentialUnavailableError'
    this.reason = reason
    this.provider = provider
  }
}

export function isProviderCredentialUnavailableError(error: unknown): error is ProviderCredentialUnavailableError {
  return error instanceof ProviderCredentialUnavailableError
}

/** The requested owner/provider is not acceptable for a credential access. */
export class CredentialAccessDeniedError extends Error {
  readonly code = CREDENTIAL_ACCESS_DENIED
  readonly status = 403

  constructor() {
    super('Acesso à credencial negado.')
    this.name = 'CredentialAccessDeniedError'
  }
}

export type StoredCredentialRead = { status: 'configured'; secret: string } | { status: 'missing' }

export type StoredCredentialStatus = 'configured' | 'missing' | 'unavailable'

// ---------------------------------------------------------------------------
// Privileged client selection (with the one documented test seam)
// ---------------------------------------------------------------------------

// Held on globalThis (not module state) because suites call vi.resetModules().
const HARNESS_KEY = Symbol.for('content-studio.credentialStore.callerClientHarness')
const OVERRIDE_KEY = Symbol.for('content-studio.credentialStore.privilegedClientOverride')

const slot = globalThis as Record<symbol, unknown>

/**
 * Test-only seam, in the spirit of the provider-execution mocked harness. When ON (the shared vitest setup turns
 * it on) suites that exercise provider flows against a single fake database keep working: the caller's fake client
 * is used as the "privileged" client and the ownership proof is skipped. Security tests turn it OFF and install a
 * separate privileged fake with `__setPrivilegedCredentialClientForTests`. It refuses to run outside vitest, so it
 * cannot weaken a deployed runtime.
 */
export function __setCredentialStoreCallerClientHarnessForTests(enabled: boolean): void {
  if (!process.env.VITEST) throw new Error('The credential-store harness exists for vitest only.')
  slot[HARNESS_KEY] = enabled
}

/** Test-only: the privileged client the store should use instead of creating a service-role client. */
export function __setPrivilegedCredentialClientForTests(client: SupabaseClient | null): void {
  if (!process.env.VITEST) throw new Error('The credential-store override exists for vitest only.')
  slot[OVERRIDE_KEY] = client
}

type PrivilegedAccess = { client: SupabaseClient; proveOwnership: boolean }

function privilegedAccess(caller: SupabaseClient, provider: AiProvider | null): PrivilegedAccess {
  const override = slot[OVERRIDE_KEY] as SupabaseClient | null | undefined
  if (override) return { client: override, proveOwnership: true }
  // The flag can only be set by the vitest setup file or the guarded setter above; nothing in a deployed runtime sets it.
  // (Environment-simulating suites clear VITEST on purpose, so the flag itself — not the env var — is what is read.)
  if (slot[HARNESS_KEY] === true) return { client: caller, proveOwnership: false }
  try {
    return { client: createServiceRoleSupabase(), proveOwnership: true }
  } catch {
    // ServiceRoleNotConfigured / NotPermittedLocally / AdminCredentialMalformed: fail closed, say nothing about why.
    throw new ProviderCredentialUnavailableError('store_client_unavailable', provider)
  }
}

function privilegedWriteClient(caller: SupabaseClient, provider: AiProvider): SupabaseClient {
  return privilegedAccess(caller, provider).client
}

// ---------------------------------------------------------------------------
// Validation and ownership
// ---------------------------------------------------------------------------

function assertOwner(userId: unknown): asserts userId is string {
  if (typeof userId !== 'string' || userId.trim().length === 0 || userId !== userId.trim() || userId.length > 128) {
    throw new CredentialAccessDeniedError()
  }
}

function secretColumnFor(provider: AiProvider): string {
  const column = Object.prototype.hasOwnProperty.call(SECRET_COLUMN, provider) ? SECRET_COLUMN[provider] : undefined
  if (!column) throw new CredentialAccessDeniedError()
  return column
}

/** Ownership proof through the CALLER's client: only the non-secret `user_id` column is read. */
async function proveOwnership(caller: SupabaseClient, userId: string, provider: AiProvider | null): Promise<boolean> {
  const { data, error } = await caller.from('user_settings').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
  if (!data) return false
  // A row that is not the requested owner's must never authorize a privileged read.
  if ((data as { user_id?: unknown }).user_id !== userId) throw new CredentialAccessDeniedError()
  return true
}

function interpret(value: unknown, provider: AiProvider): StoredCredentialRead {
  if (value === null || value === undefined) return { status: 'missing' }
  if (typeof value !== 'string') throw new ProviderCredentialUnavailableError('malformed', provider)
  return value.trim().length > 0 ? { status: 'configured', secret: value } : { status: 'missing' }
}

/** Codes only, no value, no database text. */
function logUnavailable(operation: string, error: ProviderCredentialUnavailableError) {
  console.error(`[credential-store] ${operation} unavailable reason=${error.reason} provider=${error.provider ?? 'all'}`)
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One provider's stored credential for `userId`. Throws `ProviderCredentialUnavailableError` when the store cannot
 * be read or the stored value is malformed, and `CredentialAccessDeniedError` for an unacceptable owner/provider.
 */
export async function readStoredApiCredential(
  caller: SupabaseClient,
  params: { userId: string; provider: AiProvider },
): Promise<StoredCredentialRead> {
  const { userId, provider } = params
  assertOwner(userId)
  const column = secretColumnFor(provider)
  try {
    const access = privilegedAccess(caller, provider)
    if (access.proveOwnership && !(await proveOwnership(caller, userId, provider))) return { status: 'missing' }

    const { data, error } = await access.client.from('user_settings').select(column).eq('user_id', userId).maybeSingle()
    if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
    return interpret((data as Record<string, unknown> | null)?.[column], provider)
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) logUnavailable('read', error)
    throw error
  }
}

/**
 * Configured / missing / unavailable for every provider, for status display. Never returns a value. A store failure
 * makes every provider `unavailable` (not `missing`); a malformed value makes only that provider `unavailable`.
 */
export async function readStoredApiCredentialStatuses(
  caller: SupabaseClient,
  userId: string,
): Promise<Record<AiProvider, StoredCredentialStatus>> {
  assertOwner(userId)
  const allUnavailable = () => Object.fromEntries(PROVIDERS.map((p) => [p, 'unavailable'])) as Record<AiProvider, StoredCredentialStatus>
  try {
    const access = privilegedAccess(caller, null)
    if (access.proveOwnership && !(await proveOwnership(caller, userId, null))) {
      return Object.fromEntries(PROVIDERS.map((p) => [p, 'missing'])) as Record<AiProvider, StoredCredentialStatus>
    }

    const columns = PROVIDERS.map((p) => SECRET_COLUMN[p]).join(', ')
    const { data, error } = await access.client.from('user_settings').select(columns).eq('user_id', userId).maybeSingle()
    if (error) throw new ProviderCredentialUnavailableError('store_failure')

    const row = data as Record<string, unknown> | null
    const statuses = {} as Record<AiProvider, StoredCredentialStatus>
    for (const provider of PROVIDERS) {
      try {
        statuses[provider] = interpret(row?.[SECRET_COLUMN[provider]], provider).status
      } catch {
        statuses[provider] = 'unavailable'
      }
    }
    return statuses
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) {
      logUnavailable('status', error)
      return allUnavailable()
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Writes (Settings routes only)
// ---------------------------------------------------------------------------

/**
 * Save or replace one provider credential for the already-authenticated `userId`. The optional NanoBanana base URL
 * is a non-secret preference stored in the same row so the write stays a single atomic upsert.
 */
export async function writeStoredApiCredential(caller: SupabaseClient, params: {
  userId: string
  provider: AiProvider
  secret: string
  nanobananaBaseUrl?: string
}): Promise<void> {
  const { userId, provider, secret } = params
  assertOwner(userId)
  const column = secretColumnFor(provider)
  if (typeof secret !== 'string' || secret.trim().length === 0) throw new CredentialAccessDeniedError()

  const row: Record<string, unknown> = { user_id: userId, [column]: secret }
  if (provider === 'nano_banana' && params.nanobananaBaseUrl) row.nanobanana_base_url = params.nanobananaBaseUrl

  const { error } = await privilegedWriteClient(caller, provider).from('user_settings').upsert(row, { onConflict: 'user_id' })
  if (error) {
    const failure = new ProviderCredentialUnavailableError('store_failure', provider)
    logUnavailable('write', failure)
    throw failure
  }
}

/** Remove one provider credential for the already-authenticated `userId`. */
export async function removeStoredApiCredential(caller: SupabaseClient, params: { userId: string; provider: AiProvider }): Promise<void> {
  const { userId, provider } = params
  assertOwner(userId)
  const column = secretColumnFor(provider)

  const { error } = await privilegedWriteClient(caller, provider).from('user_settings').update({ [column]: null }).eq('user_id', userId)
  if (error) {
    const failure = new ProviderCredentialUnavailableError('store_failure', provider)
    logUnavailable('remove', failure)
    throw failure
  }
}
