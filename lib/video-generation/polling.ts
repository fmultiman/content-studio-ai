// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Transport-aware status sync + the MCP poller.
//
// WHY POLLING: Kling MCP has no callback and no way to pass our own
// correlation id (discovery §2.6). An MCP generation returns a generation_id
// and can only be learned about by asking `query_tasks`. The product therefore
// cannot depend on the user keeping /videos open: a scheduled server route
// (Vercel Cron -> app/api/internal/video-generations/poll) drives this
// module. The manual /sync endpoint calls the SAME function, so there is one
// status/completion implementation, not two.
//
// Schedule (evidence-based, deliberately gentle):
//   - the first check is 45 s after submit (a video takes minutes, never seconds);
//   - then 60 s, 60 s, 90 s, and 120 s thereafter (cap) — well under the
//     provider's documented 5 QPS, and far inside the 24 h result-URL lifetime;
//   - a rejected/expired authorization backs off to 5 min (the job is still
//     recoverable once the user reconnects), and every poll is leased, so
//     concurrent cron runs never check the same row twice;
//   - a generation still unresolved after 6 h is failed with an explicit
//     "verify your Kling account" message (the provider reports its own
//     timeouts long before that).
// The only scheduling state persisted is `next_poll_at` and `poll_attempts`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOwnedConnection } from '@/lib/provider-connections/connections'
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
  NON_TERMINAL_STATUSES,
  type CompletionDependencies,
} from './completion'
import { KlingMcpTransport, type KlingVideoTransport } from './transport'

export const POLL_DELAYS_MS = [45_000, 60_000, 60_000, 90_000, 120_000] as const
export const POLL_AUTH_BACKOFF_MS = 5 * 60_000
export const POLL_LEASE_MS = 3 * 60_000
export const POLL_MAX_AGE_MS = 6 * 60 * 60_000
export const POLL_BATCH_LIMIT = 20
export const POLL_CONCURRENCY = 4
/** A generation stuck in `queued` with no provider task this long was interrupted mid-submit. */
export const QUEUED_ORPHAN_AGE_MS = 15 * 60_000

export function pollDelayMs(attempts: number): number {
  return POLL_DELAYS_MS[Math.min(Math.max(attempts, 0), POLL_DELAYS_MS.length - 1)]
}

export function initialNextPollAt(now: Date = new Date()): string {
  return new Date(now.getTime() + POLL_DELAYS_MS[0]).toISOString()
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

  if (options.schedule && now.getTime() - new Date(generation.created_at).getTime() > POLL_MAX_AGE_MS) {
    const result = await failVideoGeneration(db, {
      ...identity,
      code: 'PROVIDER_POLL_TIMEOUT',
      message: 'A geração não foi concluída a tempo. Verifique a sua conta Kling antes de tentar novamente.',
    })
    return { outcome: result.outcome === 'failed_recorded' ? 'timed_out' : mapOutcome(result.outcome), generation: result.generation }
  }

  let status
  try {
    status = await transport.getStatus(identity.taskId)
  } catch (error) {
    if (options.schedule) {
      await reschedule(db, generation, error instanceof ProviderAuthorizationRequiredError ? POLL_AUTH_BACKOFF_MS : pollDelayMs(generation.poll_attempts ?? 0), now)
    }
    // Only the error class is ever surfaced/logged — never a message or token.
    return { outcome: error instanceof ProviderAuthorizationRequiredError ? 'authorization_required' : 'transient_error', generation }
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
      if (options.schedule) await reschedule(db, generation, pollDelayMs(generation.poll_attempts ?? 0), now)
      return { outcome: 'incomplete_result', generation }
    }
    try {
      const result = await completeVideoGeneration(
        db,
        { ...identity, resultUrl: status.resultUrl, providerState: status.rawState },
        { download: options.download, now: options.now },
      )
      return { outcome: mapOutcome(result.outcome), generation: result.generation }
    } catch (error) {
      // Download/storage/DB hiccup: the row is untouched and retried while the URL is still valid.
      if (options.schedule) await reschedule(db, generation, pollDelayMs(generation.poll_attempts ?? 0), now)
      if (error instanceof CompletionStoreError) return { outcome: 'transient_error', generation }
      return { outcome: 'transient_error', generation }
    }
  }

  // Still running. Record `processing` once (compare-and-swap on the earlier statuses).
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
      error_details: { code: 'SUBMISSION_INTERRUPTED', message: 'O envio à Kling foi interrompido antes de ser confirmado.' },
    })
    .eq('transport', 'mcp')
    .eq('status', 'queued')
    .is('task_id', null)
    .lt('created_at', orphanCutoff)
    .select('id')
  for (const _orphan of orphans ?? []) count('interrupted')

  const { data: dueRows, error } = await db
    .from('video_generations')
    .select('*')
    .eq('transport', 'mcp')
    .in('status', ['submitted', 'processing'])
    .lte('next_poll_at', now.toISOString())
    .order('next_poll_at', { ascending: true })
    .limit(POLL_BATCH_LIMIT)

  if (error) throw new CompletionStoreError()
  const due = (dueRows as Array<Record<string, any>> | null) ?? []
  summary.due = due.length

  await mapWithConcurrency(due, POLL_CONCURRENCY, async (row) => {
    const claimed = await claim(db, row, now)
    if (!claimed) return
    summary.claimed += 1

    try {
      const factory = deps.transportFactory ?? ((client, generation) => createMcpTransportForGeneration(client, generation, deps))
      const transport = await factory(db, claimed)

      if (!transport || !claimed.task_id) {
        // The grant this paid job depends on no longer exists: it cannot be retrieved here.
        await failVideoGeneration(db, {
          generationId: claimed.id,
          taskId: claimed.task_id ?? '',
          transport: 'mcp',
          code: 'CONNECTION_UNAVAILABLE',
          message: 'A conexão com a conta Kling não está mais disponível. Verifique o resultado diretamente na sua conta Kling.',
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
