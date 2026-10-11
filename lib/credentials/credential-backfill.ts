// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — SERVER ONLY.
//
// Moves ONE legacy plaintext credential into the encrypted table. Used by:
//   * lazy migrate-on-read — the `dual`-mode fallback in api-credential-store.ts, after the owner was proven; and
//   * the explicitly invoked operator sweep (credential-backfill-sweep.ts).
// It is DORMANT: nothing calls it unless the operator has set PROVIDER_API_CREDENTIAL_MODE=dual (lazy) or invoked the sweep.
//
// Safety model (see docs/productization/FUTURE_059_BYOK_CREDENTIAL_SLICE_3B_V1.md):
//   * the encryption is done here with the dedicated BYOK key, bound to owner + provider + format (byok-crypto.ts);
//   * the write is ONE database function call that, under a row lock, refuses unless the legacy value is still the one that
//     was read, and never overwrites an existing encrypted row (encrypted-credential-table.ts / the Slice 3B SQL). A delayed
//     migration therefore cannot overwrite a newer credential or resurrect a removed one;
//   * an encrypted row that already exists is never touched, valid or not — a corrupted one is an explicit error elsewhere;
//   * the lazy wrapper never throws, never blocks the read that triggered it, coalesces simultaneous attempts in one process and
//     backs off after a failure, so a broken backfill (missing function, outage) costs one attempt per minute per credential.
//
// Nothing here returns or logs a key, a hash, a ciphertext or a database message — only outcome codes.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ByokEncryptionNotConfiguredError, encryptCredential } from './byok-crypto'
import { ProviderCredentialUnavailableError } from './credential-errors'
import { backfillEncryptedRow, isEncryptedProvider, type BackfillRpcOutcome } from './encrypted-credential-table'
import type { AiProvider } from './provider-credentials'

export type BackfillOutcome = BackfillRpcOutcome | 'blank' | 'unsupported_provider'

/** SHA-256 (hex, over the UTF-8 bytes) — the same expression the database function evaluates on the stored value. */
export function legacyValueDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Encrypt and insert one credential, atomically conditional on the legacy value being unchanged. Throws
 * ProviderCredentialUnavailableError for configuration (`encryption_not_configured`) and database (`store_failure`) problems.
 */
export async function backfillLegacyCredential(
  client: SupabaseClient,
  params: { userId: string; provider: AiProvider; legacySecret: string },
): Promise<BackfillOutcome> {
  const { userId, provider, legacySecret } = params
  if (!isEncryptedProvider(provider)) return 'unsupported_provider'
  if (typeof legacySecret !== 'string' || legacySecret.trim().length === 0) return 'blank'

  let encrypted
  try {
    encrypted = encryptCredential({ userId, provider, secret: legacySecret })
  } catch (error) {
    if (error instanceof ByokEncryptionNotConfiguredError) throw new ProviderCredentialUnavailableError('encryption_not_configured', provider)
    throw error
  }
  return backfillEncryptedRow(client, {
    userId,
    provider,
    expectedLegacySha256: legacyValueDigest(legacySecret),
    ciphertext: encrypted.token,
    keyId: encrypted.keyId,
    formatVersion: encrypted.formatVersion,
  })
}

// ---------------------------------------------------------------------------
// Lazy wrapper
// ---------------------------------------------------------------------------

export type LazyBackfillOutcome = BackfillOutcome | 'coalesced' | 'cooling_down' | 'failed'

const COOLDOWN_MS = 60_000
const MAX_TRACKED = 1_000

// Process-local only. They coalesce simultaneous reads and damp repeated failures; correctness never depends on them (the
// database function is the arbiter), so a cold instance or another instance simply performs its own safe attempt.
const inflight = new Map<string, Promise<LazyBackfillOutcome>>()
const cooldownUntil = new Map<string, number>()

export function __resetLazyBackfillStateForTests(): void {
  inflight.clear()
  cooldownUntil.clear()
}

/**
 * Best-effort migration after a `dual`-mode read fell back to the legacy value. Never throws; returns an outcome code. The
 * caller must already have proven that `userId` is the authenticated owner.
 */
export async function lazyBackfillLegacyCredential(
  client: SupabaseClient,
  params: { userId: string; provider: AiProvider; legacySecret: string },
  options: { now?: () => number } = {},
): Promise<LazyBackfillOutcome> {
  const now = options.now ?? Date.now
  const key = `${params.userId}:${params.provider}`

  const existing = inflight.get(key)
  if (existing) {
    await existing.catch(() => undefined)
    return 'coalesced'
  }
  if ((cooldownUntil.get(key) ?? 0) > now()) return 'cooling_down'

  const attempt = (async (): Promise<LazyBackfillOutcome> => {
    try {
      const outcome = await backfillLegacyCredential(client, params)
      if (outcome === 'inserted') console.info(`[credential-backfill] lazy outcome=inserted provider=${params.provider}`)
      return outcome
    } catch (error) {
      if (cooldownUntil.size >= MAX_TRACKED) cooldownUntil.clear()
      cooldownUntil.set(key, now() + COOLDOWN_MS)
      const reason = error instanceof ProviderCredentialUnavailableError ? error.reason : 'unexpected'
      console.error(`[credential-backfill] lazy outcome=failed reason=${reason} provider=${params.provider}`)
      return 'failed'
    }
  })()

  if (inflight.size >= MAX_TRACKED) inflight.clear()
  inflight.set(key, attempt)
  try {
    return await attempt
  } finally {
    inflight.delete(key)
  }
}
