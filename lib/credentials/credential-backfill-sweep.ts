// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — SERVER ONLY, OPERATOR-INVOKED.
//
// The sweep covers the accounts that never trigger a lazy migration (inactive users) and is also the migration-completeness
// DIAGNOSTIC: a dry run classifies every (owner, provider) pair and reports counts only.
//
// It is NOT scheduled, NOT run at deploy or startup, and NOT reachable from a normal request or any client. The only caller is the
// secret-guarded internal operator route (app/api/internal/credential-backfill/route.ts, disabled until its secret is set) and
// tests. It accepts no owner id: it enumerates owners itself with a keyset cursor, in bounded pages.
//
// Guarantees:
//   * DRY RUN is the default and performs no write of any kind;
//   * execution requires the credential store to be in `dual` mode — in `legacy` mode user writes do not keep the encrypted copy
//     current, so pre-populating it would let a stale value win once the mode is flipped;
//   * writes go through the same atomic, race-safe database function as the lazy path, so a sweep can never overwrite a newer
//     credential or resurrect a removed one, and an existing encrypted row (valid or not) is never touched;
//   * idempotent and resumable: a run returns `nextCursor`; re-running the same page is harmless;
//   * stops on a configuration problem before reading anything, and after `failureThreshold` consecutive write failures;
//   * the report holds counts only — no key, hash, ciphertext or database message — plus ONE identifier, the resume cursor (the last
//     processed owner id, a UUID, needed to resume); nothing is logged here.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readLegacyCredentialPage } from './api-credential-store'
import { decryptCredential, describeByokKey } from './byok-crypto'
import { backfillLegacyCredential } from './credential-backfill'
import { isProviderCredentialUnavailableError } from './credential-errors'
import { getCredentialStorageMode, type CredentialStorageMode } from './credential-storage-mode'
import { ENCRYPTED_PROVIDERS, selectEncryptedRowsForUsers, type EncryptedProvider, type OwnedEncryptedRow } from './encrypted-credential-table'

export const MAX_SWEEP_BATCH_SIZE = 25
export const MAX_SWEEP_BATCHES = 20
export const DEFAULT_SWEEP_BATCH_SIZE = 10
export const DEFAULT_FAILURE_THRESHOLD = 3
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ProviderMigrationCounts {
  /** A non-blank legacy plaintext credential exists. */
  legacyConfigured: number
  /** An encrypted row exists (valid or not). */
  encryptedPresent: number
  /** Legacy credential with no encrypted row: what a migration would move (dry run) or tried to move (execution). */
  legacyOnly: number
  /** Both exist, the encrypted one verifies and equals the legacy value. */
  verified: number
  /** Both exist, the encrypted one verifies, the values DIFFER (stale or conflicting write). Never auto-resolved. */
  divergent: number
  /** An encrypted row exists but cannot be verified (tampered, wrong binding, unknown key id, unsupported format). */
  integrityErrors: number
  /** Encrypted row verifies and there is no legacy value (normal after encrypted-mode writes). */
  encryptedOnly: number
  // execution only (always 0 in a dry run)
  migrated: number
  /** An encrypted row appeared first (user write or another migration): left untouched. */
  raced: number
  /** The legacy value changed or was removed after it was read: nothing written. */
  legacyChanged: number
  failed: number
}

export type SweepStopReason =
  | 'encryption_not_configured'
  | 'mode_must_be_dual'
  | 'store_client_unavailable'
  | 'store_failure'
  | 'payload_invalid'
  | 'failure_threshold'

export interface SweepOptions {
  /** Default TRUE. Execution needs an explicit `false`. */
  dryRun?: boolean
  batchSize?: number
  maxBatches?: number
  /** Resume after this owner id (the previous report's `nextCursor`). */
  cursor?: string | null
  failureThreshold?: number
}

export interface SweepReport {
  dryRun: boolean
  mode: CredentialStorageMode
  startedAfter: string | null
  /** Owner id to resume from, or null when the scan is complete. */
  nextCursor: string | null
  done: boolean
  pages: number
  usersScanned: number
  stopped: SweepStopReason | null
  providers: Record<EncryptedProvider, ProviderMigrationCounts>
  totals: ProviderMigrationCounts
  /**
   * Measurable cut-over gate. Non-null ONLY for a dry run that started from the beginning and scanned everything:
   * true iff there is no legacy-only credential, no integrity error, no divergence and no stop. A sweep that executed
   * migrations never claims readiness itself; re-run a complete dry run afterwards.
   */
  cutoverReady: boolean | null
}

const zeroCounts = (): ProviderMigrationCounts => ({
  legacyConfigured: 0, encryptedPresent: 0, legacyOnly: 0, verified: 0, divergent: 0, integrityErrors: 0, encryptedOnly: 0,
  migrated: 0, raced: 0, legacyChanged: 0, failed: 0,
})

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value as number) : fallback))

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
const sameSecret = (a: string, b: string) => timingSafeEqual(digest(a), digest(b))

type Verification = { state: 'ok'; secret: string } | { state: 'invalid' }

function verify(row: OwnedEncryptedRow, userId: string, provider: EncryptedProvider): Verification {
  if (row.formatVersion !== 1) return { state: 'invalid' }
  try {
    return { state: 'ok', secret: decryptCredential({ userId, provider, token: row.ciphertext }) }
  } catch {
    return { state: 'invalid' }
  }
}

function stopReasonOf(error: unknown): SweepStopReason {
  if (isProviderCredentialUnavailableError(error)) {
    if (error.reason === 'store_client_unavailable' || error.reason === 'payload_invalid' || error.reason === 'encryption_not_configured') return error.reason
  }
  return 'store_failure'
}

export async function runCredentialSweep(client: SupabaseClient, options: SweepOptions = {}): Promise<SweepReport> {
  const dryRun = options.dryRun !== false
  const batchSize = clamp(options.batchSize, DEFAULT_SWEEP_BATCH_SIZE, 1, MAX_SWEEP_BATCH_SIZE)
  const maxBatches = clamp(options.maxBatches, 1, 1, MAX_SWEEP_BATCHES)
  const failureThreshold = clamp(options.failureThreshold, DEFAULT_FAILURE_THRESHOLD, 1, 10)
  const startedAfter = options.cursor ?? null
  if (startedAfter !== null && !UUID_PATTERN.test(startedAfter)) throw new RangeError('The sweep cursor must be an owner id returned by a previous run.')

  const mode = getCredentialStorageMode()
  const providers = Object.fromEntries(ENCRYPTED_PROVIDERS.map((provider) => [provider, zeroCounts()])) as Record<EncryptedProvider, ProviderMigrationCounts>
  const report: SweepReport = { dryRun, mode, startedAfter, nextCursor: startedAfter, done: false, pages: 0, usersScanned: 0, stopped: null, providers, totals: zeroCounts(), cutoverReady: null }

  // Pre-flight: nothing is read or written unless the operator's preconditions hold.
  if (describeByokKey() !== 'configured') return finish(report, 'encryption_not_configured')
  if (!dryRun && mode !== 'dual') return finish(report, 'mode_must_be_dual')

  let cursor = startedAfter
  let lastCompleted = startedAfter
  let consecutiveFailures = 0
  // The resume point must never skip an owner whose migration FAILED: it is the last owner completed before the first failure.
  let resumeBeforeFirstFailure: string | null | undefined

  scan: for (let page = 0; page < maxBatches; page++) {
    let owners
    let encryptedRows: OwnedEncryptedRow[]
    try {
      owners = await readLegacyCredentialPage(client, { afterUserId: cursor, limit: batchSize })
      encryptedRows = await selectEncryptedRowsForUsers(client, owners.map((owner) => owner.userId))
    } catch (error) {
      return finish(report, stopReasonOf(error), resumeBeforeFirstFailure === undefined ? lastCompleted : resumeBeforeFirstFailure)
    }
    report.pages += 1

    if (owners.length === 0) {
      report.done = true
      report.nextCursor = null
      return finish(report, null)
    }

    for (const owner of owners) {
      for (const provider of ENCRYPTED_PROVIDERS) {
        const counts = providers[provider]
        const legacy = owner.secrets[provider]
        const row = encryptedRows.find((candidate) => candidate.userId === owner.userId && candidate.provider === provider)
        if (legacy !== undefined) counts.legacyConfigured += 1
        if (row) counts.encryptedPresent += 1

        if (row) {
          const verification = verify(row, owner.userId, provider)
          if (verification.state === 'invalid') counts.integrityErrors += 1 // never migrated over, never a fallback: an explicit error
          else if (legacy === undefined) counts.encryptedOnly += 1
          else if (sameSecret(legacy, verification.secret)) counts.verified += 1
          else counts.divergent += 1
          continue
        }

        if (legacy === undefined) continue
        counts.legacyOnly += 1
        if (dryRun) continue

        try {
          const outcome = await backfillLegacyCredential(client, { userId: owner.userId, provider, legacySecret: legacy })
          consecutiveFailures = 0
          if (outcome === 'inserted') counts.migrated += 1
          else if (outcome === 'exists') counts.raced += 1
          else counts.legacyChanged += 1 // legacy_changed | no_settings_row | blank
        } catch (error) {
          counts.failed += 1
          consecutiveFailures += 1
          if (resumeBeforeFirstFailure === undefined) resumeBeforeFirstFailure = lastCompleted
          if (isProviderCredentialUnavailableError(error) && error.reason === 'encryption_not_configured') return finish(report, 'encryption_not_configured', resumeBeforeFirstFailure)
          if (consecutiveFailures >= failureThreshold) return finish(report, 'failure_threshold', resumeBeforeFirstFailure)
        }
      }
      report.usersScanned += 1
      lastCompleted = owner.userId
    }

    cursor = owners[owners.length - 1].userId
    report.nextCursor = resumeBeforeFirstFailure === undefined ? cursor : resumeBeforeFirstFailure
    if (owners.length < batchSize) {
      report.done = true
      report.nextCursor = null
      break scan
    }
  }

  return finish(report, null, resumeBeforeFirstFailure !== undefined && !report.done ? resumeBeforeFirstFailure : undefined)
}

function finish(report: SweepReport, stopped: SweepStopReason | null, resumeFrom?: string | null): SweepReport {
  report.stopped = stopped
  if (resumeFrom !== undefined) report.nextCursor = resumeFrom
  const totals = zeroCounts()
  for (const counts of Object.values(report.providers)) {
    for (const key of Object.keys(totals) as Array<keyof ProviderMigrationCounts>) totals[key] += counts[key]
  }
  report.totals = totals
  report.cutoverReady =
    report.dryRun && report.done && report.startedAfter === null && stopped === null && report.usersScanned > 0
      ? totals.legacyOnly === 0 && totals.integrityErrors === 0 && totals.divergent === 0
      : null
  return report
}
