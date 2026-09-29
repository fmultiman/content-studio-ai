// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// THE one completion boundary for a VideoGeneration. The REST callback, the
// manual /sync endpoint and the MCP poller all converge here, so there is a
// single implementation of "provider result -> app-owned durable media".
//
// Guarantees (safe under at-least-once delivery and concurrent callers):
//   - identity is verified: the row's task id and transport must match the
//     caller's, so a callback/poll for task A can never complete row B;
//   - a row that is already terminal is left completely untouched;
//   - the provider result is copied to app-owned storage under a DETERMINISTIC
//     key (the generation id), so a duplicate/concurrent completion overwrites
//     the same object — never a second one;
//   - the terminal transition is a compare-and-swap in the database
//     (`WHERE status IN (non-terminal)`), not an in-memory lock: exactly one
//     caller wins, the rest observe `already_terminal`;
//   - a provider result URL is temporary: success is only recorded AFTER the
//     bytes are stored; the URL itself is never persisted;
//   - it creates nothing else: no VideoDraft, no LibraryFile, no
//     ChannelPieceMedia (Generation != Composition).
//
// Callers do their own authentication BEFORE calling in (the REST callback
// verifies the webhook HMAC first; the poller runs with server credentials).

import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import type { VideoTransport } from './capabilities'

export const NON_TERMINAL_STATUSES = ['queued', 'submitted', 'processing'] as const

export type CompletionOutcome =
  | 'completed'
  | 'failed_recorded'
  | 'already_terminal'
  | 'not_found'
  | 'identity_mismatch'
  | 'unsafe_result_url'

export interface CompletionResult {
  outcome: CompletionOutcome
  generation: Record<string, any> | null
}

export class CompletionStoreError extends Error {
  constructor() {
    super('The generation store is unavailable.')
    this.name = 'CompletionStoreError'
  }
}

export interface CompletionDependencies {
  download?: typeof downloadAndStoreVideo
  now?: () => Date
}

interface Identity {
  generationId: string
  taskId: string
  transport: VideoTransport
}

/** Result URLs must be plain https to a public host (blocks SSRF-style targets). */
export function isSafeResultUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || /^\d+$/.test(host)) return false
  return true
}

async function loadIdentified(
  db: SupabaseClient,
  identity: Identity,
): Promise<{ row: Record<string, any> | null; outcome?: CompletionOutcome }> {
  const { data, error } = await db.from('video_generations').select('*').eq('id', identity.generationId).maybeSingle()
  if (error) throw new CompletionStoreError()
  if (!data) return { row: null, outcome: 'not_found' }
  if (data.status === 'succeeded' || data.status === 'failed') return { row: data, outcome: 'already_terminal' }

  // Legacy rows (transport NULL) are REST by definition.
  const rowTransport: VideoTransport = data.transport ?? 'rest'
  if (!data.task_id || data.task_id !== identity.taskId || rowTransport !== identity.transport) {
    return { row: data, outcome: 'identity_mismatch' }
  }
  return { row: data }
}

async function casTerminal(
  db: SupabaseClient,
  generationId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, any> | null> {
  const { data, error } = await db
    .from('video_generations')
    .update({ ...patch, next_poll_at: null })
    .eq('id', generationId)
    .in('status', [...NON_TERMINAL_STATUSES])
    .select()
    .maybeSingle()
  if (error) throw new CompletionStoreError()
  return data ?? null
}

export async function completeVideoGeneration(
  db: SupabaseClient,
  params: Identity & { resultUrl: string; providerState?: string | null },
  deps: CompletionDependencies = {},
): Promise<CompletionResult> {
  const loaded = await loadIdentified(db, params)
  if (loaded.outcome) return { outcome: loaded.outcome, generation: loaded.row }
  const generation = loaded.row!

  if (!isSafeResultUrl(params.resultUrl)) {
    const failed = await casTerminal(db, generation.id, {
      status: 'failed',
      error_details: { code: 'PROVIDER_RESULT_URL_UNSAFE', message: 'O resultado do provedor não pôde ser copiado com segurança.' },
    })
    return failed ? { outcome: 'unsafe_result_url', generation: failed } : { outcome: 'already_terminal', generation }
  }

  const download = deps.download ?? downloadAndStoreVideo
  const prefix = `${generation.user_id}/videos/ai/${generation.project_id}`
  // Throws on download/storage failure: the row stays non-terminal and the
  // caller (poller / callback retry) tries again while the URL is still valid.
  const { storagePath, publicUrl, mime, size } = await download(params.resultUrl, prefix, {
    objectName: `${generation.id}.mp4`,
  })

  const now = (deps.now ?? (() => new Date()))()
  const won = await casTerminal(db, generation.id, {
    status: 'succeeded',
    storage_path: storagePath,
    public_url: publicUrl,
    error_details: null,
    result_metadata: {
      mime,
      size,
      transport: params.transport,
      provider_task_id: params.taskId,
      ...(params.providerState ? { provider_state: params.providerState } : {}),
      completed_at: now.toISOString(),
    },
  })

  // Lost the race: another caller already finalized it. Nothing else to do.
  return won ? { outcome: 'completed', generation: won } : { outcome: 'already_terminal', generation }
}

export async function failVideoGeneration(
  db: SupabaseClient,
  params: Identity & { code: string; message: string; details?: Record<string, unknown> },
): Promise<CompletionResult> {
  const loaded = await loadIdentified(db, params)
  if (loaded.outcome) return { outcome: loaded.outcome, generation: loaded.row }

  const won = await casTerminal(db, loaded.row!.id, {
    status: 'failed',
    error_details: { code: params.code, message: params.message, ...(params.details ? { details: params.details } : {}) },
  })
  return won ? { outcome: 'failed_recorded', generation: won } : { outcome: 'already_terminal', generation: loaded.row }
}
