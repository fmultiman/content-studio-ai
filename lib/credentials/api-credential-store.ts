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
// FUTURE_059 Slice 3A: the same boundary now also fronts the ENCRYPTED credential table, selected by the operator-controlled
// PROVIDER_API_CREDENTIAL_MODE (legacy | dual | encrypted; default and fallback: legacy — see credential-storage-mode.ts).
// In `legacy` mode nothing below the "Mode-aware public API" marker changes behaviour: the encrypted table and the BYOK
// master key are never touched. The encrypted table is only named in encrypted-credential-table.ts; decryption lives in
// byok-crypto.ts.
//
// This module never logs, returns in an error, or otherwise surfaces a secret.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import type { AiProvider } from './provider-credentials'
import { CredentialAccessDeniedError, ProviderCredentialUnavailableError } from './credential-errors'
import {
  BYOK_CREDENTIAL_FORMAT_VERSION,
  ByokEncryptionNotConfiguredError,
  ByokPayloadError,
  decryptCredential,
  describeByokKey,
  encryptCredential,
} from './byok-crypto'
import { getCredentialStorageMode, type CredentialStorageMode } from './credential-storage-mode'
import { lazyBackfillLegacyCredential } from './credential-backfill'
import {
  ENCRYPTED_PROVIDERS,
  deleteEncryptedRow,
  isEncryptedProvider,
  selectEncryptedRow,
  selectEncryptedRows,
  upsertEncryptedRow,
  type EncryptedProvider,
  type EncryptedRow,
} from './encrypted-credential-table'

const SECRET_COLUMN: Record<AiProvider, string> = {
  openai: 'openai_api_key',
  nano_banana: 'nanobanana_api_key',
  kling: 'kling_api_key',
  replicate: 'replicate_api_key',
  gemini: 'gemini_api_key',
}

const PROVIDERS = Object.keys(SECRET_COLUMN) as AiProvider[]

export {
  CREDENTIAL_ACCESS_DENIED,
  CredentialAccessDeniedError,
  PROVIDER_CREDENTIAL_UNAVAILABLE,
  ProviderCredentialUnavailableError,
  isProviderCredentialUnavailableError,
  type CredentialUnavailableReason,
} from './credential-errors'

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
async function readLegacyCredential(
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
async function readLegacyStatuses(
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
async function writeLegacyCredential(caller: SupabaseClient, params: {
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
async function removeLegacyCredential(caller: SupabaseClient, params: { userId: string; provider: AiProvider }): Promise<void> {
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

// ---------------------------------------------------------------------------
// Mode-aware public API (FUTURE_059 Slice 3A)
//
// `legacy` (the default) delegates, unchanged, to the plaintext-column implementation above. `dual` and `encrypted` add the
// encrypted table (docs/productization/FUTURE_059_BYOK_CREDENTIAL_SLICE_3A_V1.md). The ownership proof, the privileged
// client and the typed errors are the SAME boundary as in legacy mode — there is no second credential path.
//
// Rules shared by the active modes:
//   * a MISSING encrypted row is "missing" (encrypted) or a bounded legacy fallback (dual);
//   * an encrypted row that exists but cannot be verified is `unavailable` — it NEVER falls back to a legacy value;
//   * configuration problems (no separate BYOK master key) and database problems are reported as `unavailable` with
//     different reasons, never as "missing";
//   * Replicate (no consumer, no configured user) stays on the legacy store in every mode.
// ---------------------------------------------------------------------------

type ActiveMode = Exclude<CredentialStorageMode, 'legacy'>

/** The effective mode for a provider (`null` = whole-user operation). Replicate is always legacy. */
function effectiveMode(provider: AiProvider | null): CredentialStorageMode {
  if (provider !== null && !isEncryptedProvider(provider)) return 'legacy'
  return getCredentialStorageMode()
}

function assertEncryptionReady(provider: AiProvider | null) {
  if (describeByokKey() !== 'configured') throw new ProviderCredentialUnavailableError('encryption_not_configured', provider)
}

function openEncrypted(row: EncryptedRow, userId: string, provider: EncryptedProvider): string {
  if (row.formatVersion !== BYOK_CREDENTIAL_FORMAT_VERSION) throw new ProviderCredentialUnavailableError('payload_invalid', provider)
  try {
    return decryptCredential({ userId, provider, token: row.ciphertext })
  } catch (error) {
    if (error instanceof ByokEncryptionNotConfiguredError) throw new ProviderCredentialUnavailableError('encryption_not_configured', provider)
    if (error instanceof ByokPayloadError) throw new ProviderCredentialUnavailableError('payload_invalid', provider)
    // Integrity failure (tampered, wrong owner/provider/format, unknown key id) or anything unexpected: no detail, no fallback.
    throw new ProviderCredentialUnavailableError('decryption_failed', provider)
  }
}

/** Every owner has a settings row once they store an encrypted credential, so the Slice 1 ownership proof keeps working. */
async function ensureSettingsRow(client: SupabaseClient, userId: string, provider: AiProvider) {
  const { error } = await client.from('user_settings').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
}

function logFallback(provider: AiProvider) {
  console.info(`[credential-store] read outcome=legacy_fallback provider=${provider}`)
}

/**
 * One provider's stored credential for `userId`. Throws `ProviderCredentialUnavailableError` when the store cannot be
 * read, an encrypted credential cannot be verified, or encryption is misconfigured; `CredentialAccessDeniedError` for an
 * unacceptable owner/provider.
 */
export async function readStoredApiCredential(
  caller: SupabaseClient,
  params: { userId: string; provider: AiProvider },
): Promise<StoredCredentialRead> {
  const { userId, provider } = params
  assertOwner(userId)
  secretColumnFor(provider) // validates the provider (own-property lookup) before anything else
  const mode = effectiveMode(provider)
  if (mode === 'legacy') return readLegacyCredential(caller, params)

  try {
    assertEncryptionReady(provider)
    const access = privilegedAccess(caller, provider)
    if (access.proveOwnership && !(await proveOwnership(caller, userId, provider))) return { status: 'missing' }

    const encryptedProvider = provider as EncryptedProvider
    const row = await selectEncryptedRow(access.client, userId, encryptedProvider)
    if (row) return { status: 'configured', secret: openEncrypted(row, userId, encryptedProvider) }

    if ((mode as ActiveMode) === 'dual') {
      logFallback(provider)
      const legacy = await readLegacyCredential(caller, params)
      // FUTURE_059 Slice 3B — lazy migrate-on-read. Best-effort and never blocking: it cannot throw, cannot change what this
      // read returns, and the database function refuses unless the legacy value is still the one just read. Only reached when
      // NO encrypted row exists; an encrypted row that exists but is invalid threw above and never gets here.
      if (legacy.status === 'configured') await lazyBackfillLegacyCredential(access.client, { userId, provider, legacySecret: legacy.secret })
      return legacy
    }
    return { status: 'missing' }
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) logUnavailable('read', error)
    throw error
  }
}

/**
 * Configured / missing / unavailable for every provider, for status display. Never returns a value. A store failure or a
 * misconfiguration makes every provider `unavailable`; an unverifiable encrypted credential makes only that provider
 * `unavailable` (the status check decrypts in memory so Settings never claims "configured" for an unreadable credential).
 */
export async function readStoredApiCredentialStatuses(
  caller: SupabaseClient,
  userId: string,
): Promise<Record<AiProvider, StoredCredentialStatus>> {
  assertOwner(userId)
  const mode = effectiveMode(null)
  if (mode === 'legacy') return readLegacyStatuses(caller, userId)

  const allWith = (status: StoredCredentialStatus) => Object.fromEntries(PROVIDERS.map((p) => [p, status])) as Record<AiProvider, StoredCredentialStatus>
  try {
    assertEncryptionReady(null)
    const access = privilegedAccess(caller, null)
    if (access.proveOwnership && !(await proveOwnership(caller, userId, null))) return allWith('missing')

    const rows = await selectEncryptedRows(access.client, userId)
    const legacy = await readLegacyStatuses(caller, userId) // replicate always; every provider in dual mode
    const statuses = {} as Record<AiProvider, StoredCredentialStatus>
    for (const provider of PROVIDERS) {
      if (!isEncryptedProvider(provider)) {
        statuses[provider] = legacy[provider]
        continue
      }
      const row = rows.find((candidate) => candidate.provider === provider)
      if (row) {
        try {
          openEncrypted(row, userId, provider)
          statuses[provider] = 'configured'
        } catch {
          statuses[provider] = 'unavailable'
        }
      } else {
        statuses[provider] = mode === 'dual' ? legacy[provider] : 'missing'
      }
    }
    return statuses
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) {
      logUnavailable('status', error)
      return allWith('unavailable')
    }
    throw error
  }
}

/**
 * Save or replace one provider credential for the already-authenticated `userId`. The optional NanoBanana base URL is a
 * non-secret preference that stays in `user_settings` in every mode.
 *
 * Active modes, in order (each step is idempotent, and the order never loses a stored credential):
 *   1. make sure the owner's settings row exists (ownership proof for later reads);
 *   2. write the encrypted credential (version = previous + 1; user writes are last-writer-wins);
 *   3. dual: also write the legacy column (rollback to `legacy` keeps the current key);
 *      encrypted: clear the legacy column so no stale plaintext remains.
 * A failure in step 3 leaves the NEW encrypted credential in place and reports `unavailable`; the user simply retries.
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
  const mode = effectiveMode(provider)
  if (mode === 'legacy') return writeLegacyCredential(caller, params)

  try {
    assertEncryptionReady(provider)
    const client = privilegedWriteClient(caller, provider)
    const encryptedProvider = provider as EncryptedProvider

    await ensureSettingsRow(client, userId, provider)
    const existing = await selectEncryptedRow(client, userId, encryptedProvider)
    const encrypted = encryptCredential({ userId, provider: encryptedProvider, secret })
    await upsertEncryptedRow(client, {
      userId,
      provider: encryptedProvider,
      ciphertext: encrypted.token,
      keyId: encrypted.keyId,
      formatVersion: encrypted.formatVersion,
      secretVersion: (existing?.secretVersion ?? 0) + 1,
    })

    const settings: Record<string, unknown> = { user_id: userId, [column]: mode === 'dual' ? secret : null }
    if (provider === 'nano_banana' && params.nanobananaBaseUrl) settings.nanobanana_base_url = params.nanobananaBaseUrl
    const { error } = await client.from('user_settings').upsert(settings, { onConflict: 'user_id' })
    if (error) throw new ProviderCredentialUnavailableError('store_failure', provider)
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) logUnavailable('write', error)
    else if (error instanceof ByokEncryptionNotConfiguredError) {
      const failure = new ProviderCredentialUnavailableError('encryption_not_configured', provider)
      logUnavailable('write', failure)
      throw failure
    }
    throw error
  }
}

/**
 * Remove one provider credential for the already-authenticated `userId`. Active modes clear the legacy column FIRST and
 * delete the encrypted row second, so a half-finished removal can never resurrect an older plaintext value through the
 * dual-mode fallback; if the second step fails the credential is still (consistently) configured and the user retries.
 */
export async function removeStoredApiCredential(caller: SupabaseClient, params: { userId: string; provider: AiProvider }): Promise<void> {
  const { userId, provider } = params
  assertOwner(userId)
  secretColumnFor(provider)
  const mode = effectiveMode(provider)
  if (mode === 'legacy') return removeLegacyCredential(caller, params)

  try {
    const client = privilegedWriteClient(caller, provider)
    await removeLegacyCredential(caller, params)
    await deleteEncryptedRow(client, userId, provider as EncryptedProvider)
  } catch (error) {
    if (error instanceof ProviderCredentialUnavailableError) logUnavailable('remove', error)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Operator surface (FUTURE_059 Slice 3B) — used ONLY by credential-backfill-sweep.ts and its internal operator route.
// ---------------------------------------------------------------------------

/**
 * The privileged client for the operator sweep: the service-role client only (never a browser-session client), through the
 * same factory and local-runtime guard as every other server credential access. There is no caller and no owner here: the sweep
 * enumerates owners itself and never accepts one from a request.
 */
export function createOperatorPrivilegedClient(): SupabaseClient {
  const override = slot[OVERRIDE_KEY] as SupabaseClient | null | undefined
  if (override) return override
  try {
    return createServiceRoleSupabase()
  } catch {
    throw new ProviderCredentialUnavailableError('store_client_unavailable')
  }
}

export interface LegacyCredentialPageRow {
  userId: string
  /** Non-blank legacy values of the providers the encrypted store supports. Memory only — never log or return it. */
  secrets: Partial<Record<EncryptedProvider, string>>
}

/**
 * One keyset page of owners (ordered by user id, strictly after `afterUserId`) with their legacy credentials. Every owner with a
 * settings row appears — including owners with no legacy credential — so the sweep covers accounts that never trigger a read.
 */
export async function readLegacyCredentialPage(
  client: SupabaseClient,
  params: { afterUserId: string | null; limit: number },
): Promise<LegacyCredentialPageRow[]> {
  const columns = ['user_id', ...ENCRYPTED_PROVIDERS.map((provider) => SECRET_COLUMN[provider])].join(', ')
  let query = client.from('user_settings').select(columns).order('user_id', { ascending: true }).limit(params.limit)
  if (params.afterUserId) query = query.gt('user_id', params.afterUserId)
  const { data, error } = await query
  if (error) throw new ProviderCredentialUnavailableError('store_failure')

  return ((data as unknown as Array<Record<string, unknown>> | null) ?? []).map((row) => {
    const secrets: Partial<Record<EncryptedProvider, string>> = {}
    for (const provider of ENCRYPTED_PROVIDERS) {
      const value = row[SECRET_COLUMN[provider]]
      if (typeof value === 'string' && value.trim().length > 0) secrets[provider] = value
    }
    return { userId: String(row.user_id), secrets }
  })
}
