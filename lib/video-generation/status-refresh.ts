// VIDEO_GENERATION_POLLING_LATENCY_V1
//
// Browser-side rules for /videos. Two things are deliberately separate:
//
//   status refresh   the page re-reads its generations from OUR database every
//                    STATUS_REFRESH_MS while any generation is in flight. This is
//                    a database read only — it never calls the provider — so it
//                    can be frequent and the UI learns about a completion made
//                    by the background poller within seconds.
//   provider sync    POST /api/video-generations/{id}/sync asks Kling directly and
//                    bypasses the poller's lease and schedule. The browser is NOT
//                    the reliability mechanism (the scheduler is), so it is only a
//                    RECOVERY path: used for a row whose scheduled check is long
//                    overdue, i.e. the scheduler evidently is not serving it.
//
// A healthy scheduler keeps `next_poll_at` in the future (the lease pushes it 3
// minutes ahead while a row is being checked, the next check ~10-20 s ahead
// otherwise), so under normal operation the page never triggers a provider call.

import { videoProviderPhrases } from './connection-presentation'

/** How often the page re-reads generation status from the database (no provider call). */
export const STATUS_REFRESH_MS = 10_000

/** A due check this overdue means the scheduler is not serving the row (a normal lag is seconds; a lease is 3 min ahead). */
export const SCHEDULER_STALL_MS = 2 * 60_000

/** Recovery syncs for one row are at most this frequent. */
export const RECOVERY_SYNC_MIN_INTERVAL_MS = 60_000

const IN_FLIGHT = new Set(['queued', 'submitted', 'processing'])

export interface RefreshableGeneration {
  id: string
  status?: string | null
  transport?: string | null
  task_id?: string | null
  next_poll_at?: string | null
}

/** Any non-terminal generation keeps the status refresh running. */
export function isInFlightGeneration(generation: Pick<RefreshableGeneration, 'status'>): boolean {
  return typeof generation.status === 'string' && IN_FLIGHT.has(generation.status)
}

/**
 * True only for a SCHEDULED row (MCP, or REST with a next_poll_at: Kling REST and Google Veo) with a provider task whose scheduled
 * check is long overdue. Legacy REST rows carry no schedule, so they are never selected.
 */
export function isSchedulerStalled(generation: RefreshableGeneration, nowMs: number): boolean {
  if ((generation.transport !== 'mcp' && generation.transport !== 'rest') || !generation.task_id) return false
  if (generation.status !== 'submitted' && generation.status !== 'processing') return false
  if (!generation.next_poll_at) return false
  const due = Date.parse(generation.next_poll_at)
  return Number.isFinite(due) && nowMs - due > SCHEDULER_STALL_MS
}

/**
 * The generations for which the page may ask the server to sync with the
 * provider right now (recovery only). `lastSyncedAt` is the caller's per-row
 * memory and is updated for every id returned.
 */
export function selectRecoverySyncs(
  generations: RefreshableGeneration[],
  nowMs: number,
  lastSyncedAt: Map<string, number>,
): RefreshableGeneration[] {
  const selected: RefreshableGeneration[] = []
  for (const generation of generations) {
    if (!isSchedulerStalled(generation, nowMs)) continue
    const last = lastSyncedAt.get(generation.id)
    if (last !== undefined && nowMs - last < RECOVERY_SYNC_MIN_INTERVAL_MS) continue
    lastSyncedAt.set(generation.id, nowMs)
    selected.push(generation)
  }
  return selected
}

export interface NotReadyNotice {
  title: string
  description: string
  variant?: 'destructive'
}

/**
 * What the card says when "Assistir" is pressed on a generation without a playable result. A failed generation is
 * terminal: it is reported as failed (with the recorded reason) — never as "not ready yet".
 */
export function describeGenerationNotReady(generation: { status?: string | null; provider?: string | null; error_details?: { message?: unknown } | null }): NotReadyNotice {
  if (generation.status === 'failed') {
    const message = generation.error_details?.message
    return {
      title: 'A geração falhou',
      // STRUCTURAL_WAVE_0 (D22): the fallback names the provider the generation really used. A row without a provider predates
      // Google Veo, so it is Kling (the same reading describeGenerationProvenance uses).
      description: typeof message === 'string' && message.trim()
        ? message
        : `${videoProviderPhrases(generation.provider === 'gemini' ? 'gemini' : 'kling').subject} não concluiu esta geração.`,
      variant: 'destructive',
    }
  }
  return { title: 'Aguardando', description: 'O vídeo ainda não está pronto.' }
}
