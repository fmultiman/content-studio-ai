// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Transport-aware status sync + the MCP poller.
//
// VEO_KLING_FIRST_LAST_FRAME_V1: Google Veo is polled by the SAME poller. A Veo generation is a Gemini API long-running
// operation: there is no callback, so its operation name is the task id and its rows (provider = 'gemini') are due-polled
// exactly like MCP rows, with the OWNER's Gemini key resolved server-side for status reads (they never spend).
//
// WHY POLLING: Kling MCP has no callback and no way to pass our own
// correlation id (discovery §2.6). An MCP generation returns a generation_id
// and can only be learned about by asking `query_tasks`. The product therefore
// cannot depend on the user keeping /videos open: an always-on EXTERNAL
// scheduler (the project's VPS) calls the authenticated route
// app/api/internal/video-generations/poll about once a minute, and the route
// executes one bounded pass of this module. The manual /sync endpoint calls the
// SAME function, so there is one status/completion implementation, not two.
//
// VIDEO_GENERATION_POLLING_LATENCY_V1 — two SEPARATE mechanisms:
//
//   scheduler wake   the VPS calls the poll route every ~10 s. A wake that
//                    finds no due row costs two cheap database reads and makes
//                    NO provider call.
//   per-job schedule each generation's own `next_poll_at`. Only rows whose
//                    `next_poll_at <= now` are ever queried at the provider, so
//                    the wake frequency never multiplies provider traffic.
//
// Per-job schedule (by number of checks already made, `poll_attempts`):
//   - first check 10 s after submit, then every 10 s for the first 30 checks
//     (~5 min: the window in which a short video normally finishes), every 20 s
//     up to check 60 (~15 min), every 60 s up to check 120 (~1 h), then 3 min.
//     A job therefore costs ~12 checks for a 2-minute video and is hard-bounded
//     afterwards — far under the provider's documented 5 QPS;
//   - errors (outage, refresh hiccup, storage) are NOT a verdict: they back off
//     to 3x the normal step (floor 30 s, cap 5 min) instead of hammering a
//     failing dependency, and keep being retried until 23 h;
//   - a rejected/expired authorization backs off to 5 min (still recoverable
//     once the user reconnects), and every poll is LEASED, so overlapping
//     passes never check the same row twice;
//   - a generation the provider STILL reports as running after 6 h is failed
//     with an explicit "verify your Kling account" message; errors are retried
//     until 23 h — inside the provider's 24 h result-URL lifetime, after which
//     the result could no longer be fetched anyway.
// The only scheduling state persisted is `next_poll_at` and `poll_attempts`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOwnedConnection } from '@/lib/provider-connections/connections'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import {
  forceRefreshAccessToken,
  getValidAccessToken,
  type TokenRefreshDependencies,
} from '@/lib/provider-connections/token-store'
import type { KlingMcpClientDependencies } from '@/lib/provider-connections/kling-mcp-client'
import { ProviderAuthorizationRequiredError } from '@/lib/provider-connections/types'
import {
  completeVideoGeneration,
  CompletionStoreError,
  failVideoGeneration,
  failVideoGenerationWithoutTask,
  NON_TERMINAL_STATUSES,
  type CompletionDependencies,
} from './completion'
import { QUEUED_ORPHAN_AGE_MS } from './poll-constants'
import { GeminiVeoTransport, KlingMcpTransport, type KlingVideoTransport, type VideoTaskStatus } from './transport'

/** Per-job cadence tiers: [inclusive upper bound of `poll_attempts`, delay to the next check]. */
export const POLL_SCHEDULE = [
  [30, 10_000],
  [60, 20_000],
  [120, 60_000],
] as const
/** Beyond the last tier a long-running job is checked this often. */
export const POLL_IDLE_MS = 180_000
export const POLL_FIRST_CHECK_MS = POLL_SCHEDULE[0][1]
/** Transient errors back off to this multiple of the normal step, within [floor, cap]. */
export const POLL_ERROR_FACTOR = 3
export const POLL_ERROR_MIN_MS = 30_000
export const POLL_ERROR_MAX_MS = 5 * 60_000
export const POLL_AUTH_BACKOFF_MS = 5 * 60_000
export const POLL_LEASE_MS = 3 * 60_000
export const POLL_MAX_AGE_MS = 6 * 60 * 60_000
/** Errors (not provider verdicts) stop being retried only here, inside the 24 h result-URL lifetime. */
export const POLL_HARD_MAX_AGE_MS = 23 * 60 * 60_000
/** An unrecognised provider state that carries a result URL is accepted as done after this many observations. */
export const UNCONFIRMED_RESULT_ATTEMPTS = 4
export const POLL_BATCH_LIMIT = 10
/** Each completion can buffer a whole video in memory, so keep this low. */
export const POLL_CONCURRENCY = 2
/** Stop STARTING new rows after this (the route's maxDuration is 300 s). */
export const POLL_TIME_BUDGET_MS = 240_000
export { QUEUED_ORPHAN_AGE_MS }

/** Delay to the next check for a job that has made `attempts` checks. */
export function pollDelayMs(attempts: number): number {
  const made = Math.max(attempts, 0)
  for (const [upTo, delay] of POLL_SCHEDULE) if (made <= upTo) return delay
  return POLL_IDLE_MS
}

/** Delay after a TRANSIENT failure: stepped backoff derived from the normal step. Never below the floor, never above the cap. */
export function pollErrorDelayMs(attempts: number): number {
  return Math.min(POLL_ERROR_MAX_MS, Math.max(POLL_ERROR_MIN_MS, pollDelayMs(attempts) * POLL_ERROR_FACTOR))
}

export function initialNextPollAt(now: Date = new Date()): string {
  return new Date(now.getTime() + POLL_FIRST_CHECK_MS).toISOString()
}

export type SyncOutcome =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'already_terminal'
  | 'incomplete_result'
  | 'authorization_required'
  | 'transient_error'
  | 'timed_out'
  | 'identity_mismatch'
  | 'not_found'

export interface SyncResult {
  outcome: SyncOutcome
  generation: Record<string, any> | null
}

export interface SyncOptions extends CompletionDependencies {
  /** MCP: persist next_poll_at/poll_attempts and enforce the max age. REST manual sync: false. */
  schedule: boolean
}

const isTerminal = (status: unknown) => status === 'succeeded' || status === 'failed'

async function reschedule(
  db: SupabaseClient,
  generation: Record<string, any>,
  delayMs: number,
  now: Date,
): Promise<void> {
  await db
    .from('video_generations')
    .update({ next_poll_at: new Date(now.getTime() + delayMs).toISOString() })
    .eq('id', generation.id)
    .in('status', [...NON_TERMINAL_STATUSES])
}

/**
 * One status check for one generation, through the given transport. Converges
 * on completeVideoGeneration / failVideoGeneration; never mutates a terminal row.
 */
export async function syncGenerationWithProvider(
  db: SupabaseClient,
  generation: Record<string, any>,
  transport: KlingVideoTransport,
  options: SyncOptions,
): Promise<SyncResult> {
  const now = (options.now ?? (() => new Date()))()
  if (isTerminal(generation.status)) return { outcome: 'already_terminal', generation }

  const identity = {
    generationId: generation.id as string,
    taskId: generation.task_id as string,
    transport: transport.transport,
  }

  // The max age is a LAST resort applied only AFTER a final status check: a
  // generation that finished at the provider while we were not polling (e.g.
  // between daily sweeps) must still be completed, never timed out unseen.
  const age = now.getTime() - new Date(generation.created_at).getTime()
  // Soft: the provider answered and says it is still running. Hard: we could
  // not get an answer (or could not store it) for almost the whole URL lifetime.
  const expired = options.schedule && age > POLL_MAX_AGE_MS
  const hardExpired = options.schedule && age > POLL_HARD_MAX_AGE_MS
  const timeOut = async (): Promise<SyncResult> => {
    const result = await failVideoGeneration(db, {
      ...identity,
      code: 'PROVIDER_POLL_TIMEOUT',
      message: generation.provider === 'gemini'
        ? 'A geração não foi concluída a tempo. Verifique a sua conta Google antes de tentar novamente.'
        : 'A geração não foi concluída a tempo. Verifique a sua conta Kling antes de tentar novamente.',
    })
    return { outcome: result.outcome === 'failed_recorded' ? 'timed_out' : mapOutcome(result.outcome), generation: result.generation }
  }

  let status: VideoTaskStatus
  try {
    status = await transport.getStatus(identity.taskId)
  } catch (error) {
    // An error is not a verdict: keep retrying (a revoked authorization stays
    // recoverable on reconnect) until the hard cap.
    if (hardExpired) return timeOut()
    if (options.schedule) {
      await reschedule(db, generation, error instanceof ProviderAuthorizationRequiredError ? POLL_AUTH_BACKOFF_MS : pollErrorDelayMs(generation.poll_attempts ?? 0), now)
    }
    // Only the error class is ever surfaced/logged — never a message or token.
    return { outcome: error instanceof ProviderAuthorizationRequiredError ? 'authorization_required' : 'transient_error', generation }
  }

  // The provider vocabulary is unverified: an unrecognised state that carries a
  // result URL is not trusted at first sight, but once it has been observed
  // repeatedly it is accepted rather than letting a finished paid video time out.
  if (status.state === 'processing' && status.unconfirmedResultUrl && (generation.poll_attempts ?? 0) >= UNCONFIRMED_RESULT_ATTEMPTS) {
    status = { state: 'succeeded', resultUrl: status.unconfirmedResultUrl, rawState: status.rawState }
  }

  if (status.state === 'failed') {
    const result = await failVideoGeneration(db, {
      ...identity,
      code: status.code,
      message: status.message,
      details: status.rawState ? { provider_state: status.rawState } : undefined,
    })
    return { outcome: mapOutcome(result.outcome), generation: result.generation }
  }

  if (status.state === 'succeeded') {
    if (!status.resultUrl) {
      // Reported done but no downloadable result yet: keep waiting (bounded by the max age).
      if (expired) return timeOut()
      if (options.schedule) await reschedule(db, generation, pollDelayMs(generation.poll_attempts ?? 0), now)
      return { outcome: 'incomplete_result', generation }
    }
    try {
      const result = await completeVideoGeneration(
        db,
        { ...identity, resultUrl: status.resultUrl, providerState: status.rawState, usage: status.usage, downloadHeaders: status.downloadHeaders },
        { download: options.download, now: options.now },
      )
      return { outcome: mapOutcome(result.outcome), generation: result.generation }
    } catch {
      // Download/storage/DB hiccup: the row is untouched and retried (backed off) while the URL is still valid.
      if (hardExpired) return timeOut()
      if (options.schedule) await reschedule(db, generation, pollErrorDelayMs(generation.poll_attempts ?? 0), now)
      return { outcome: 'transient_error', generation }
    }
  }

  // Still running at the final check: only now may the max age end the wait.
  if (expired) return timeOut()

  // Record `processing` once (compare-and-swap on the earlier statuses).
  let current = generation
  if (generation.status !== 'processing') {
    const { data } = await db
      .from('video_generations')
      .update({ status: 'processing' })
      .eq('id', generation.id)
      .in('status', ['queued', 'submitted'])
      .select()
      .maybeSingle()
    if (data) current = data
  }
  if (options.schedule) await reschedule(db, generation, pollDelayMs(generation.poll_attempts ?? 0), now)
  return { outcome: 'processing', generation: current }
}

function mapOutcome(outcome: string): SyncOutcome {
  switch (outcome) {
    case 'completed':
      return 'completed'
    case 'failed_recorded':
    case 'unsafe_result_url':
      return 'failed'
    case 'already_terminal':
      return 'already_terminal'
    case 'identity_mismatch':
      return 'identity_mismatch'
    default:
      return 'not_found'
  }
}

// ---------------------------------------------------------------------------
// MCP transport for a stored generation (server-side, no user session)
// ---------------------------------------------------------------------------

export interface McpPollDependencies extends TokenRefreshDependencies, KlingMcpClientDependencies {
  /** Test seam for the per-run time budget. */
  timeBudgetMs?: number
  transportFactory?: (db: SupabaseClient, generation: Record<string, any>) => Promise<KlingVideoTransport | null>
}

/**
 * Builds the MCP transport for a stored generation. The connection is looked
 * up by id AND by the generation's own user id — a `connection_id` written
 * into a row can never make the poller act with someone else's grant.
 * Returns null when the connection is gone for good.
 */
export async function createMcpTransportForGeneration(
  db: SupabaseClient,
  generation: Record<string, any>,
  deps: McpPollDependencies = {},
): Promise<KlingVideoTransport | null> {
  if (!generation.connection_id) return null
  const connection = await getOwnedConnection(db, generation.connection_id, generation.user_id)
  if (!connection) return null

  return new KlingMcpTransport(
    {
      get: () => getValidAccessToken(db, connection.id, deps),
      refresh: () => forceRefreshAccessToken(db, connection.id, deps),
    },
    deps,
  )
}

/**
 * VEO_KLING_FIRST_LAST_FRAME_V1 — the Google Veo transport for a stored generation (server-side, no user session).
 * The Gemini key is resolved for the generation's OWN user (never for the caller), with `status_read`: reading an
 * already-submitted operation spends nothing. Returns null when that user no longer has a Gemini key; a credential-store
 * outage throws (the caller treats it as transient and retries later).
 */
export async function createVeoTransportForGeneration(
  db: SupabaseClient,
  generation: Record<string, any>,
): Promise<KlingVideoTransport | null> {
  const execution = await resolveProviderExecution(db, { userId: generation.user_id, provider: 'gemini', purpose: 'status_read' })
  if (execution.status !== 'ready') return null
  return new GeminiVeoTransport(execution.secret)
}

/** The transport that can read this stored generation. MCP and Google Veo rows are polled; REST Kling rows use the callback. */
async function transportForPolledGeneration(
  db: SupabaseClient,
  generation: Record<string, any>,
  deps: McpPollDependencies,
): Promise<KlingVideoTransport | null> {
  return generation.provider === 'gemini'
    ? createVeoTransportForGeneration(db, generation)
    : createMcpTransportForGeneration(db, generation, deps)
}

export interface PollSummary {
  due: number
  claimed: number
  outcomes: Partial<Record<SyncOutcome | 'connection_unavailable' | 'interrupted', number>>
}

async function claim(db: SupabaseClient, generation: Record<string, any>, now: Date): Promise<Record<string, any> | null> {
  // Lease + attempt counter in ONE compare-and-swap on the exact next_poll_at
  // we read: if another poller got there first, no row matches.
  const { data, error } = await db
    .from('video_generations')
    .update({
      next_poll_at: new Date(now.getTime() + POLL_LEASE_MS).toISOString(),
      poll_attempts: (generation.poll_attempts ?? 0) + 1,
    })
    .eq('id', generation.id)
    .eq('next_poll_at', generation.next_poll_at)
    .in('status', ['submitted', 'processing'])
    .select()
    .maybeSingle()
  if (error) return null
  return data ?? null
}

async function mapWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++]
      await run(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Polls every non-terminal MCP generation that is due. Runs with server
 * credentials only (no user session); every row is handled independently, so
 * one failure never blocks the rest.
 */
export async function pollDueMcpGenerations(
  db: SupabaseClient,
  deps: McpPollDependencies & CompletionDependencies = {},
): Promise<PollSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const startedAt = Date.now()
  const summary: PollSummary = { due: 0, claimed: 0, outcomes: {} }
  const count = (key: keyof PollSummary['outcomes']) => {
    summary.outcomes[key] = (summary.outcomes[key] ?? 0) + 1
  }

  // Interrupted submissions (never reached the provider) must not stay "queued" forever.
  const orphanCutoff = new Date(now.getTime() - QUEUED_ORPHAN_AGE_MS).toISOString()
  const { data: orphans } = await db
    .from('video_generations')
    .update({
      status: 'failed',
      error_details: { code: 'SUBMISSION_INTERRUPTED', message: 'O envio ao provedor foi interrompido antes de ser confirmado.' },
    })
    .or('transport.eq.mcp,provider.eq.gemini')
    .eq('status', 'queued')
    .is('task_id', null)
    .lt('created_at', orphanCutoff)
    .select('id')
  for (const _orphan of orphans ?? []) count('interrupted')

  const { data: dueRows, error } = await db
    .from('video_generations')
    .select('*')
    .or('transport.eq.mcp,provider.eq.gemini')
    .in('status', ['submitted', 'processing'])
    .lte('next_poll_at', now.toISOString())
    .order('next_poll_at', { ascending: true })
    .limit(POLL_BATCH_LIMIT)

  if (error) throw new CompletionStoreError()
  const due = (dueRows as Array<Record<string, any>> | null) ?? []
  summary.due = due.length

  await mapWithConcurrency(due, POLL_CONCURRENCY, async (row) => {
    // Out of time: leave the row unclaimed (still due) for the next run.
    if (Date.now() - startedAt > (deps.timeBudgetMs ?? POLL_TIME_BUDGET_MS)) return
    const claimed = await claim(db, row, now)
    if (!claimed) return
    summary.claimed += 1

    try {
      const factory = deps.transportFactory ?? ((client, generation) => transportForPolledGeneration(client, generation, deps))
      const transport = await factory(db, claimed)

      if (!claimed.task_id) {
        // A "submitted" row with no provider task id can never be polled: end it explicitly.
        await failVideoGenerationWithoutTask(db, claimed.id).catch(() => undefined)
        count('interrupted')
        return
      }
      if (!transport) {
        // The grant this paid job depends on no longer exists: it cannot be retrieved here.
        const veo = claimed.provider === 'gemini'
        await failVideoGeneration(db, {
          generationId: claimed.id,
          taskId: claimed.task_id,
          transport: veo ? 'rest' : 'mcp',
          code: 'CONNECTION_UNAVAILABLE',
          message: veo
            ? 'A chave Gemini não está mais disponível. O vídeo fica no Google por 2 dias: verifique-o diretamente na sua conta Google.'
            : 'A conexão com a conta Kling não está mais disponível. Verifique o resultado diretamente na sua conta Kling.',
        }).catch(() => undefined)
        count('connection_unavailable')
        return
      }

      const result = await syncGenerationWithProvider(db, claimed, transport, { schedule: true, download: deps.download, now: deps.now })
      count(result.outcome)
    } catch {
      // Lease expires by itself; the row is retried on a later run.
      count('transient_error')
    }
  })

  return summary
}
