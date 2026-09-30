// USAGE_SETTINGS_POLISH_AND_HISTORICAL_PROOFS_V1 — SERVER / ADMIN ONLY.
//
// A bounded, one-shot import of exactly THREE historical usage facts that were
// observed during controlled real-provider proofs, before the usage ledger
// (migration 044) existed. It is deliberately NOT a general backfill:
//
//   - the allowlist below is the whole scope; no other generation is scanned,
//     priced or inferred (a failed request, or any unlisted generation, is never
//     imported);
//   - every candidate is verified against the trusted database row first (exists,
//     succeeded, transport, operation, known provider task, model/settings where
//     known, storage in the owner's namespace). ANY mismatch blocks the whole run;
//   - the owner / project / production / connection come from that row — nothing
//     tenant-specific is hard-coded;
//   - the event uses the SAME idempotency key the normal completion recorder uses
//     (`video_generation:{id}:completed`), so exactly one event can ever exist per
//     generation completion, whichever path writes it first;
//   - the measurement source is the truthful one: provider-billed units for the two
//     REST proofs (`provider_reported`), an account balance difference for the MCP
//     proof (`balance_delta` — Kling did NOT state a task cost);
//   - `occurred_at` is the historical completion time, never the import time;
//   - provider_metadata marks the row as a historical import. Insertion mechanism
//     is not measurement method.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isTenantVideoStoragePath } from '@/lib/video-generation/storage-path'
import {
  recordProviderUsageEvent,
  toUsageEventRow,
  videoGenerationUsageEvent,
  videoGenerationUsageKey,
  type ProviderUsageEventInput,
} from './provider-usage-recorder'
import type { UsageMeasurement } from './provider-usage'

export interface HistoricalProof {
  generationId: string
  label: string
  /** Effective transport (a NULL transport column is REST by definition). */
  transport: 'rest' | 'mcp'
  operation: 'text_to_video' | 'image_to_video'
  /** The provider task id, when it is a known fact of the proof. */
  providerTaskId?: string
  /** Model / non-secret settings, when they are known facts of the proof. */
  expectedModel?: string
  expectedRequest?: { duration?: number; resolution?: string; audio?: string; multi_shot?: boolean }
  usage: UsageMeasurement
  evidence: 'verified_real_provider_proof' | 'verified_single_generation_balance_delta'
  /** Extra non-secret, provider-native descriptors that were part of the proof. */
  extraMetadata?: Record<string, unknown>
}

export const HISTORICAL_PROOFS: readonly HistoricalProof[] = [
  {
    generationId: '1edf783d-f1de-4867-b67e-a121baa7a37e',
    label: 'Kling REST image-to-video',
    transport: 'rest',
    operation: 'image_to_video',
    providerTaskId: '933451061661802530',
    usage: { quantity: 3, unit: 'units', source: 'provider_reported' },
    evidence: 'verified_real_provider_proof',
    extraMetadata: { provider_billing: { charge_type: 'unit', package_type: 'video' } },
  },
  {
    generationId: '8d4a6247-a503-4b1c-a045-0f605e0e876e',
    label: 'Kling REST text-to-video',
    transport: 'rest',
    operation: 'text_to_video',
    providerTaskId: '933654153530834975',
    usage: { quantity: 3, unit: 'units', source: 'provider_reported' },
    evidence: 'verified_real_provider_proof',
  },
  {
    generationId: '19d664dd-7c26-4f27-8c42-e0352a51abc8',
    label: 'Kling MCP text-to-video',
    transport: 'mcp',
    operation: 'text_to_video',
    expectedModel: 'kling-video-v3_0',
    expectedRequest: { duration: 3, resolution: '720p', audio: 'off', multi_shot: false },
    // Measured as (account balance before) - (account balance after) around exactly one paid
    // submission. Kling did NOT report a per-task cost, so this is `balance_delta`, not
    // `provider_reported`. Raw balances are intentionally not stored: only the delta is the fact.
    usage: { quantity: 18, unit: 'credits', source: 'balance_delta' },
    evidence: 'verified_single_generation_balance_delta',
    extraMetadata: { measurement: 'balance_before_minus_balance_after', attribution: 'single_paid_submission_in_window' },
  },
]

/** Historical (pre-ledger) completions were stored as `{user}/videos/ai/{project}/{13-digit ms}-{random}.mp4`. */
const OBJECT_TIMESTAMP = /\/(\d{13})-[a-z0-9]+\.mp4$/
const MAX_COMPLETION_LAG_MS = 24 * 60 * 60_000

export interface OccurredAt {
  at: Date
  source: 'result_metadata.completed_at' | 'storage_object_timestamp'
}

/**
 * The historical completion time, from stored application data only:
 *   1. result_metadata.completed_at (written by the shared completion), else
 *   2. the millisecond timestamp the pre-completion code embedded in the app-owned object
 *      name at the moment it stored the result — accepted only if it is a plausible
 *      completion (after the row was created, within 24 h of it).
 * Returns null otherwise: the import refuses rather than fall back to the import time.
 */
export function deriveOccurredAt(row: Record<string, any>): OccurredAt | null {
  const completed = new Date(row.result_metadata?.completed_at ?? '')
  if (row.result_metadata?.completed_at && !Number.isNaN(completed.getTime())) return { at: completed, source: 'result_metadata.completed_at' }

  const match = typeof row.storage_path === 'string' ? OBJECT_TIMESTAMP.exec(row.storage_path) : null
  const created = new Date(row.created_at ?? '').getTime()
  if (match && Number.isFinite(created)) {
    const ms = Number(match[1])
    if (ms >= created && ms - created <= MAX_COMPLETION_LAG_MS) return { at: new Date(ms), source: 'storage_object_timestamp' }
  }
  return null
}

/** Every reason this row does NOT match what the proof says it is. Empty = verified. */
export function verifyProofRow(row: Record<string, any> | null | undefined, proof: HistoricalProof): string[] {
  if (!row) return ['generation not found']
  const problems: string[] = []
  if (row.id !== proof.generationId) problems.push('row id does not match')
  if (row.status !== 'succeeded') problems.push(`status is "${row.status}", expected "succeeded"`)
  const transport = row.transport ?? 'rest'
  if (transport !== proof.transport) problems.push(`transport is "${transport}", expected "${proof.transport}"`)
  if (row.mode !== proof.operation) problems.push(`operation is "${row.mode}", expected "${proof.operation}"`)
  if (row.provider !== 'kling') problems.push(`provider is "${row.provider}", expected "kling"`)
  if (proof.providerTaskId !== undefined && row.task_id !== proof.providerTaskId) problems.push('provider task id does not match the proof')
  if (proof.expectedModel !== undefined && row.model !== proof.expectedModel) problems.push(`model is "${row.model}", expected "${proof.expectedModel}"`)
  for (const [key, expected] of Object.entries(proof.expectedRequest ?? {})) {
    if (row.request_config?.[key] !== expected) problems.push(`request ${key} does not match the proof`)
  }
  if (!row.user_id) problems.push('row has no owner')
  if (!row.project_id) problems.push('row has no project')
  if (proof.transport === 'mcp' && !row.connection_id) problems.push('MCP row has no connection')
  if (proof.transport === 'rest' && row.connection_id) problems.push('REST row unexpectedly has a connection')
  if (!row.storage_path) problems.push('row has no app-owned result (storage_path)')
  else if (!isTenantVideoStoragePath(row.storage_path, row)) problems.push('storage_path is outside the owner namespace')
  if (!deriveOccurredAt(row)) problems.push('no reliable historical completion time in stored data')
  return problems
}

export interface PlannedEvent {
  proof: HistoricalProof
  input: ProviderUsageEventInput
  occurredAtSource: OccurredAt['source']
  idempotencyKey: string
}

export interface ProofStatus {
  generationId: string
  label: string
  state: 'missing' | 'present' | 'invalid'
  problems: string[]
}

export interface BackfillPlan {
  /** True only when EVERY proof is verified (all-or-nothing). */
  ok: boolean
  statuses: ProofStatus[]
  /** Verified events whose canonical key is not in the ledger yet. */
  toInsert: PlannedEvent[]
  alreadyPresent: number
}

/** Builds the exact event for a verified row, with historical-import metadata. */
export function buildHistoricalEvent(row: Record<string, any>, proof: HistoricalProof): PlannedEvent {
  const occurred = deriveOccurredAt(row)!
  const base = videoGenerationUsageEvent(row, proof.usage, occurred.at)
  const input: ProviderUsageEventInput = {
    ...base,
    providerMetadata: {
      ...(base.providerMetadata ?? {}),
      historical_import: true,
      historical_evidence: proof.evidence,
      occurred_at_source: occurred.source,
      ...(proof.extraMetadata ?? {}),
    },
  }
  return { proof, input, occurredAtSource: occurred.source, idempotencyKey: videoGenerationUsageKey(row.id) }
}

/** Pure planning step: rows (by generation id) + keys already in the ledger -> what would be inserted. */
export function planBackfill(
  rows: ReadonlyArray<Record<string, any>>,
  existingKeys: ReadonlySet<string>,
  proofs: readonly HistoricalProof[] = HISTORICAL_PROOFS,
): BackfillPlan {
  const byId = new Map(rows.map((row) => [row.id as string, row]))
  const statuses: ProofStatus[] = []
  const toInsert: PlannedEvent[] = []
  let alreadyPresent = 0

  for (const proof of proofs) {
    const row = byId.get(proof.generationId)
    const problems = verifyProofRow(row, proof)
    if (problems.length > 0) {
      statuses.push({ generationId: proof.generationId, label: proof.label, state: 'invalid', problems })
      continue
    }
    if (existingKeys.has(videoGenerationUsageKey(proof.generationId))) {
      alreadyPresent += 1
      statuses.push({ generationId: proof.generationId, label: proof.label, state: 'present', problems: [] })
      continue
    }
    statuses.push({ generationId: proof.generationId, label: proof.label, state: 'missing', problems: [] })
    toInsert.push(buildHistoricalEvent(row!, proof))
  }

  return { ok: statuses.every((status) => status.state !== 'invalid'), statuses, toInsert, alreadyPresent }
}

/** Reads ONLY the allowlisted generations and their canonical ledger keys, then plans. Writes nothing. */
export async function loadAndPlanBackfill(db: SupabaseClient, proofs: readonly HistoricalProof[] = HISTORICAL_PROOFS): Promise<BackfillPlan> {
  const ids = proofs.map((proof) => proof.generationId)
  const { data: rows, error } = await db.from('video_generations').select('*').in('id', ids)
  if (error) throw new Error('could not read generations')
  const keys = ids.map(videoGenerationUsageKey)
  const { data: existing, error: existingError } = await db.from('provider_usage_events').select('idempotency_key').in('idempotency_key', keys)
  if (existingError) throw new Error('could not read the usage ledger')
  return planBackfill(rows ?? [], new Set((existing ?? []).map((row: { idempotency_key: string }) => row.idempotency_key)), proofs)
}

/** Inserts the planned events (idempotent: ON CONFLICT DO NOTHING on the canonical key). Refuses an unverified plan. */
export async function applyBackfill(db: SupabaseClient, plan: BackfillPlan): Promise<number> {
  if (!plan.ok) throw new Error('refusing to apply: at least one proof did not verify')
  let attempted = 0
  for (const event of plan.toInsert) {
    await recordProviderUsageEvent(db, event.input)
    attempted += 1
  }
  return attempted
}

// ---------------------------------------------------------------------------
// Offline SQL emitter (for operators who can only run SQL, e.g. the Supabase MCP)
// ---------------------------------------------------------------------------

const sqlLiteral = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`
  return `'${String(value).replace(/'/g, "''")}'`
}

const SQL_COLUMNS = [
  'user_id', 'project_id', 'production_id', 'provider', 'connection_id', 'transport', 'operation', 'model',
  'resource_type', 'resource_id', 'provider_task_id', 'quantity', 'unit', 'measurement_source', 'provider_metadata',
  'idempotency_key', 'occurred_at',
] as const

/** One idempotent INSERT for the planned events, identical in content to what `applyBackfill` writes. Null when nothing is missing. */
export function toInsertSql(plan: BackfillPlan): string | null {
  if (!plan.ok) throw new Error('refusing to emit SQL: at least one proof did not verify')
  if (plan.toInsert.length === 0) return null
  const values = plan.toInsert.map((event) => {
    const row = toUsageEventRow(event.input)
    return `  (${SQL_COLUMNS.map((column) => sqlLiteral(row[column])).join(', ')})`
  })
  return `INSERT INTO provider_usage_events (${SQL_COLUMNS.join(', ')})\nVALUES\n${values.join(',\n')}\nON CONFLICT (idempotency_key) DO NOTHING;`
}

const short = (id: unknown) => (typeof id === 'string' ? `${id.slice(0, 8)}…` : '—')

/** Human report with owner/project ids redacted. */
export function formatPlan(plan: BackfillPlan, mode: 'dry-run' | 'apply'): string {
  const lines = [`Verified historical usage proofs — ${mode.toUpperCase()}`]
  for (const status of plan.statuses) {
    lines.push(`- ${status.label} [${short(status.generationId)}]: ${status.state}${status.problems.length ? ` — ${status.problems.join('; ')}` : ''}`)
  }
  for (const event of plan.toInsert) {
    const row = toUsageEventRow(event.input)
    lines.push(
      `  + ${short(event.proof.generationId)} ${row.provider}/${row.transport} ${row.operation} ${row.model ?? '—'}: ${row.quantity} ${row.unit} (${row.measurement_source}) occurred_at=${row.occurred_at} [${event.occurredAtSource}] key=${event.idempotencyKey}`,
    )
  }
  lines.push(`candidates=${plan.statuses.length} missing=${plan.toInsert.length} already_present=${plan.alreadyPresent} ok=${plan.ok}`)
  return lines.join('\n')
}
