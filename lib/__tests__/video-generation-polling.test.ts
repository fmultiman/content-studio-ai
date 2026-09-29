import { describe, expect, it, vi } from 'vitest'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import {
  createMcpTransportForGeneration,
  initialNextPollAt,
  pollDelayMs,
  pollDueMcpGenerations,
  POLL_AUTH_BACKOFF_MS,
  POLL_BATCH_LIMIT,
  POLL_CONCURRENCY,
  POLL_DELAYS_MS,
  POLL_HARD_MAX_AGE_MS,
  POLL_LEASE_MS,
  POLL_MAX_AGE_MS,
  QUEUED_ORPHAN_AGE_MS,
  syncGenerationWithProvider,
  UNCONFIRMED_RESULT_ATTEMPTS,
} from '@/lib/video-generation/polling'
import type { KlingVideoTransport, VideoTaskStatus } from '@/lib/video-generation/transport'
import { createFakeDb } from './helpers/fake-db'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const RESULT_URL = 'https://cdn.example.test/temp/result.mp4'
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const stored = () => ({ storagePath: 'u/videos/ai/p/gen.mp4', publicUrl: 'https://s3.example.test/gen.mp4', mime: 'video/mp4', size: 10 })

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    user_id: 'user-a',
    project_id: 'proj-1',
    status: 'submitted',
    task_id: 'task-1',
    transport: 'mcp',
    connection_id: 'conn-1',
    created_at: iso(-60_000),
    next_poll_at: iso(-1_000),
    poll_attempts: 0,
    ...overrides,
  }
}

function dbWith(rows: Array<Record<string, unknown>>, extra: Record<string, any[]> = {}) {
  return createFakeDb({ seed: { video_generations: rows, ...extra } }) as any
}

function transportReturning(...statuses: Array<VideoTaskStatus | Error>): KlingVideoTransport & { getStatus: ReturnType<typeof vi.fn> } {
  const queue = [...statuses]
  return {
    transport: 'mcp',
    submit: vi.fn(),
    getStatus: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0]
      if (next instanceof Error) throw next
      return next
    }),
  } as any
}

const options = (overrides: Record<string, unknown> = {}) => ({ schedule: true, now: () => NOW, download: vi.fn(async () => stored()), ...overrides })

describe('poll schedule (bounded, evidence-based)', () => {
  it('sized for a ~1-minute external tick: first check after 60 s, then 60/60/120 s, capped at 3 min — never aggressive', () => {
    expect(POLL_DELAYS_MS).toEqual([60_000, 60_000, 60_000, 120_000, 180_000])
    expect([0, 1, 2, 3, 4, 5, 50].map(pollDelayMs)).toEqual([60_000, 60_000, 60_000, 120_000, 180_000, 180_000, 180_000])
    // No delay is shorter than the scheduler tick, so the tick — not the backoff — bounds provider QPS (<< 5 QPS).
    expect(Math.min(...POLL_DELAYS_MS)).toBeGreaterThanOrEqual(60_000)
    expect(new Date(initialNextPollAt(NOW)).getTime() - NOW.getTime()).toBe(60_000)
    // Fits inside the 24 h result-URL lifetime with a wide margin.
    expect(POLL_MAX_AGE_MS).toBeLessThan(24 * 60 * 60_000)
  })
})

describe('syncGenerationWithProvider — status transitions', () => {
  it('submitted → processing: records "processing" once and schedules the next check', async () => {
    const db = dbWith([generation({ poll_attempts: 1 })])
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'processing', rawState: 'submitted' }), options())

    expect(result.outcome).toBe('processing')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(pollDelayMs(1)) })
  })

  it('processing → processing: no status write, only the next check is scheduled', async () => {
    const db = dbWith([generation({ status: 'processing', poll_attempts: 3 })])
    await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'processing', rawState: 'processing' }), options())

    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(pollDelayMs(3)) })
    // Only the scheduling update happened (no status transition update).
    expect(db.log.filter((entry: string) => entry === 'update:video_generations')).toHaveLength(1)
  })

  it('processing → succeeded: shared completion stores app-owned media and stops polling', async () => {
    const db = dbWith([generation({ status: 'processing' })])
    const opts = options()
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' }), opts)

    expect(result.outcome).toBe('completed')
    expect(opts.download).toHaveBeenCalledTimes(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'succeeded', storage_path: 'u/videos/ai/p/gen.mp4', next_poll_at: null })
    expect(JSON.stringify(db.tables.video_generations[0])).not.toContain('cdn.example.test')
  })

  it('processing → failed: records a safe normalized error and stops polling', async () => {
    const db = dbWith([generation({ status: 'processing' })])
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'failed', message: 'Account inspiration credits are insufficient', code: 'PROVIDER_FAILED', rawState: 'failed' }), options())

    expect(result.outcome).toBe('failed')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', next_poll_at: null, error_details: { code: 'PROVIDER_FAILED', message: 'Account inspiration credits are insufficient', details: { provider_state: 'failed' } } })
  })

  it('"succeeded" with NO result URL keeps waiting (never durable-complete on a missing URL)', async () => {
    const db = dbWith([generation({ status: 'processing', poll_attempts: 2 })])
    const opts = options()
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'succeeded', resultUrl: null, rawState: 'succeed' }), opts)

    expect(result.outcome).toBe('incomplete_result')
    expect(opts.download).not.toHaveBeenCalled()
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(pollDelayMs(2)) })
    expect(db.tables.video_generations[0].storage_path).toBeUndefined()
  })

  it('a failed download/storage step is retried later (row stays non-terminal, rescheduled), not failed', async () => {
    const db = dbWith([generation({ status: 'processing' })])
    const result = await syncGenerationWithProvider(
      db,
      db.tables.video_generations[0],
      transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' }),
      options({ download: async () => { throw new Error('S3 unavailable') } }),
    )
    expect(result.outcome).toBe('transient_error')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(pollDelayMs(0)) })
  })

  it('expired/revoked authorization: reported, backed off to 5 min, the paid job is NOT failed (recoverable on reconnect)', async () => {
    const db = dbWith([generation({ status: 'processing' })])
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(new ProviderAuthorizationRequiredError()), options())

    expect(result.outcome).toBe('authorization_required')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(POLL_AUTH_BACKOFF_MS) })
  })

  it.each([
    ['provider temporarily unavailable', new ProviderConnectionError('PROVIDER_UNAVAILABLE')],
    ['connection store unavailable', new ProviderConnectionError('CONNECTION_STORE_UNAVAILABLE')],
    ['encryption key missing', new ProviderConnectionError('CONNECTION_ENCRYPTION_NOT_CONFIGURED')],
    ['unexpected error', new Error('boom')],
  ])('%s: transient — backoff, row untouched, never failed and never treated as authorization loss', async (_name, error) => {
    const db = dbWith([generation({ status: 'processing', poll_attempts: 4 })])
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(error), options())

    expect(result.outcome).toBe('transient_error')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: iso(pollDelayMs(4)) })
  })

  it('terminal rows are never re-polled or mutated', async () => {
    for (const status of ['succeeded', 'failed']) {
      const db = dbWith([generation({ status, next_poll_at: null })])
      const transport = transportReturning({ state: 'processing', rawState: 'x' })
      const before = JSON.stringify(db.tables.video_generations)
      const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transport, options())
      expect(result.outcome).toBe('already_terminal')
      expect(transport.getStatus).not.toHaveBeenCalled()
      expect(JSON.stringify(db.tables.video_generations)).toBe(before)
    }
  })

  it('duplicate polls of a finished generation are idempotent (one durable copy, one terminal write)', async () => {
    const db = dbWith([generation({ status: 'processing' })])
    const opts = options()
    const transport = transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' })

    const results = await Promise.all([
      syncGenerationWithProvider(db, { ...db.tables.video_generations[0] }, transport, opts),
      syncGenerationWithProvider(db, { ...db.tables.video_generations[0] }, transport, opts),
    ])

    expect(results.map((entry) => entry.outcome).sort()).toEqual(['already_terminal', 'completed'])
    expect(db.tables.video_generations[0].status).toBe('succeeded')
    expect(db.tables.video_generations).toHaveLength(1)
  })

  describe('max age (a LAST resort, applied only after a final status check)', () => {
    const old = () => generation({ status: 'processing', created_at: iso(-(POLL_MAX_AGE_MS + 1)) })

    it('a generation still processing at the final check is failed with an explicit "check your Kling account" message', async () => {
      const db = dbWith([old()])
      const transport = transportReturning({ state: 'processing', rawState: 'processing' })
      const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transport, options())

      expect(result.outcome).toBe('timed_out')
      expect(transport.getStatus).toHaveBeenCalledTimes(1)
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_POLL_TIMEOUT' } })
    })

    it('a generation that FINISHED at the provider while nobody was polling is completed, never timed out unseen', async () => {
      const db = dbWith([old()])
      const opts = options()
      const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' }), opts)

      expect(result.outcome).toBe('completed')
      expect(opts.download).toHaveBeenCalledTimes(1)
      expect(db.tables.video_generations[0].status).toBe('succeeded')
    })

    it('a provider-reported failure is recorded as the provider failure, not as a timeout', async () => {
      const db = dbWith([old()])
      await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'failed', message: 'blocked', code: 'PROVIDER_FAILED', rawState: 'failed' }), options())
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_FAILED' } })
    })

    it.each([
      ['an unreachable provider', new ProviderConnectionError('PROVIDER_UNAVAILABLE')],
      ['a revoked authorization', new ProviderAuthorizationRequiredError()],
      ['a connection store outage', new ProviderConnectionError('CONNECTION_STORE_UNAVAILABLE')],
    ])('%s past the SOFT max age is NOT a verdict: the paid job keeps being retried (a daily sweep may hit one blip)', async (_name, error) => {
      const db = dbWith([old()])
      const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(error), options())
      expect(['transient_error', 'authorization_required']).toContain(result.outcome)
      expect(db.tables.video_generations[0].status).toBe('processing')
      expect(new Date(db.tables.video_generations[0].next_poll_at).getTime()).toBeGreaterThan(NOW.getTime())
    })

    it('a download/storage failure past the soft max age is retried too (the result URL is still valid)', async () => {
      const db = dbWith([old()])
      const result = await syncGenerationWithProvider(
        db,
        db.tables.video_generations[0],
        transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' }),
        options({ download: async () => { throw new Error('S3 blip') } }),
      )
      expect(result.outcome).toBe('transient_error')
      expect(db.tables.video_generations[0].status).toBe('processing')
    })

    it.each([
      ['an unreachable provider', new ProviderConnectionError('PROVIDER_UNAVAILABLE')],
      ['a revoked authorization', new ProviderAuthorizationRequiredError()],
    ])('%s past the HARD cap (inside the 24 h URL lifetime) finally ends the wait', async (_name, error) => {
      const db = dbWith([generation({ status: 'processing', created_at: iso(-(POLL_HARD_MAX_AGE_MS + 1)) })])
      const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(error), options())
      expect(result.outcome).toBe('timed_out')
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_POLL_TIMEOUT' } })
    })

    it('the hard cap sits inside the provider 24 h result-URL lifetime (afterwards the result could not be fetched anyway)', () => {
      expect(POLL_HARD_MAX_AGE_MS).toBeGreaterThan(POLL_MAX_AGE_MS)
      expect(POLL_HARD_MAX_AGE_MS).toBeLessThan(24 * 60 * 60_000)
    })

    it('with minute-level scheduling an error is retried within minutes for hours (an outage is ridden out, not turned into a failure)', async () => {
      const db = dbWith([generation({ status: 'processing', created_at: iso(-(12 * 60 * 60_000)), poll_attempts: 200 })])
      await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(new ProviderConnectionError('PROVIDER_UNAVAILABLE')), options())
      expect(db.tables.video_generations[0].status).toBe('processing')
      expect(new Date(db.tables.video_generations[0].next_poll_at).getTime() - NOW.getTime()).toBeLessThanOrEqual(5 * 60_000)
    })

    it('within the soft max age the same errors never fail the job', async () => {
      const db = dbWith([generation({ status: 'processing', created_at: iso(-(POLL_MAX_AGE_MS - 60_000)) })])
      await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning(new ProviderConnectionError('PROVIDER_UNAVAILABLE')), options())
      expect(db.tables.video_generations[0].status).toBe('processing')
    })
  })

  it('manual REST sync (schedule:false) never touches scheduling columns or enforces the MCP max age', async () => {
    const db = dbWith([generation({ transport: 'rest', status: 'submitted', next_poll_at: null, created_at: iso(-(POLL_MAX_AGE_MS + 1)) })])
    const restTransport = { ...transportReturning({ state: 'processing', rawState: 'processing' }), transport: 'rest' as const }
    await syncGenerationWithProvider(db, db.tables.video_generations[0], restTransport as any, { schedule: false, now: () => NOW })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: null })
  })

  it('a row whose task id does not match the transport identity completes nothing', async () => {
    const db = dbWith([generation({ status: 'processing', transport: 'rest' })])
    const result = await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 's' }), options())
    expect(result.outcome).toBe('identity_mismatch')
    expect(db.tables.video_generations[0].status).toBe('processing')
  })
})

describe('pollDueMcpGenerations — the scheduled poller (no user session)', () => {
  it('polls only MCP rows that are in flight AND due; terminal, not-yet-due, REST and unscheduled rows are skipped', async () => {
    const db = dbWith([
      generation({ id: 'due', task_id: 't-due' }),
      generation({ id: 'not-due', task_id: 't-nd', next_poll_at: iso(60_000) }),
      generation({ id: 'done', task_id: 't-done', status: 'succeeded', next_poll_at: null }),
      generation({ id: 'failed', task_id: 't-f', status: 'failed', next_poll_at: null }),
      generation({ id: 'rest', task_id: 't-rest', transport: 'rest', next_poll_at: iso(-1000) }),
      generation({ id: 'legacy', task_id: 't-legacy', transport: null, next_poll_at: null }),
    ])
    const transport = transportReturning({ state: 'processing', rawState: 'processing' })
    const factory = vi.fn(async () => transport)

    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: factory })

    expect(summary).toMatchObject({ due: 1, claimed: 1, outcomes: { processing: 1 } })
    expect(transport.getStatus).toHaveBeenCalledTimes(1)
    expect(transport.getStatus).toHaveBeenCalledWith('t-due')
  })

  it('leases each row: an immediate second run (or a concurrent one) does not poll it again', async () => {
    const db = dbWith([generation()])
    const transport = transportReturning({ state: 'processing', rawState: 'processing' })
    const deps = { now: () => NOW, transportFactory: async () => transport }

    const [a, b] = await Promise.all([pollDueMcpGenerations(db, deps), pollDueMcpGenerations(db, deps)])
    expect(a.claimed + b.claimed).toBe(1)
    expect(transport.getStatus).toHaveBeenCalledTimes(1)

    const third = await pollDueMcpGenerations(db, deps)
    expect(third.due).toBe(0)
    expect(transport.getStatus).toHaveBeenCalledTimes(1)
  })

  it('the claim increments the attempt counter (drives backoff) and leases the row', async () => {
    const db = dbWith([generation({ poll_attempts: 2 })])
    const transport = transportReturning(new Error('boom'))
    await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => transport })
    // claimed → attempts 3 → transient error reschedules with the backoff for 3 attempts
    expect(db.tables.video_generations[0]).toMatchObject({ poll_attempts: 3, next_poll_at: iso(pollDelayMs(3)) })
  })

  it('one failing row never blocks the others (independent handling)', async () => {
    const db = dbWith([generation({ id: 'a', task_id: 't-a' }), generation({ id: 'b', task_id: 't-b' })])
    const factory = vi.fn(async (_db: unknown, row: Record<string, any>) => {
      if (row.id === 'a') throw new ProviderConnectionError('CONNECTION_STORE_UNAVAILABLE')
      return transportReturning({ state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeed' })
    })
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: factory as any, download: async () => stored() })

    expect(summary.claimed).toBe(2)
    expect(db.tables.video_generations.find((row: any) => row.id === 'b').status).toBe('succeeded')
    expect(db.tables.video_generations.find((row: any) => row.id === 'a').status).toBe('submitted')
  })

  it('an UNRECOGNISED provider state carrying a result URL is not trusted at first sight, but accepted once observed repeatedly', async () => {
    const unconfirmed: VideoTaskStatus = { state: 'processing', rawState: 'mystery_ok', unconfirmedResultUrl: RESULT_URL }

    const early = dbWith([generation({ status: 'processing', poll_attempts: UNCONFIRMED_RESULT_ATTEMPTS - 1 })])
    const earlyOpts = options()
    expect((await syncGenerationWithProvider(early, early.tables.video_generations[0], transportReturning(unconfirmed), earlyOpts)).outcome).toBe('processing')
    expect(earlyOpts.download).not.toHaveBeenCalled()

    const late = dbWith([generation({ status: 'processing', poll_attempts: UNCONFIRMED_RESULT_ATTEMPTS })])
    const lateOpts = options()
    expect((await syncGenerationWithProvider(late, late.tables.video_generations[0], transportReturning(unconfirmed), lateOpts)).outcome).toBe('completed')
    expect(lateOpts.download).toHaveBeenCalledTimes(1)
    expect(late.tables.video_generations[0]).toMatchObject({ status: 'succeeded', result_metadata: { provider_state: 'mystery_ok' } })
  })

  it('a "submitted" row that never got a provider task id is failed explicitly instead of being re-leased forever', async () => {
    const db = dbWith([generation({ task_id: null })])
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => transportReturning({ state: 'processing', rawState: 'x' }) })
    expect(summary.outcomes.interrupted).toBe(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', next_poll_at: null, error_details: { code: 'SUBMISSION_INTERRUPTED' } })
  })

  it('bounds concurrency (each completion can buffer a whole video) and stops starting rows when out of time', async () => {
    expect(POLL_CONCURRENCY).toBeLessThanOrEqual(2)

    const rows = [generation({ id: 'a', task_id: 't-a' }), generation({ id: 'b', task_id: 't-b' })]
    const db = dbWith(rows)
    const transport = transportReturning({ state: 'processing', rawState: 'x' })
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => transport, timeBudgetMs: -1 })

    // Out of time: nothing was claimed, so every row stays due for the next run.
    expect(summary).toMatchObject({ due: 2, claimed: 0 })
    expect(transport.getStatus).not.toHaveBeenCalled()
    expect(db.tables.video_generations.map((row: any) => row.poll_attempts)).toEqual([0, 0])
  })

  it('bounds the batch size (no thundering herd)', async () => {
    const rows = Array.from({ length: POLL_BATCH_LIMIT + 10 }, (_, index) => generation({ id: `g${index}`, task_id: `t${index}` }))
    const db = dbWith(rows)
    const limits: number[] = []
    const originalFrom = db.from
    db.from = (table: string) => {
      const builder = originalFrom.call(db, table)
      const original = builder.limit
      builder.limit = (n: number) => { limits.push(n); return original.call(builder, n) }
      return builder
    }
    await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => transportReturning({ state: 'processing', rawState: 'x' }) })
    expect(limits).toContain(POLL_BATCH_LIMIT)
  })

  it('a generation whose connection is gone is failed explicitly (the paid job cannot be retrieved here)', async () => {
    const db = dbWith([generation()])
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => null })
    expect(summary.outcomes.connection_unavailable).toBe(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'CONNECTION_UNAVAILABLE' } })
  })

  it('interrupted submissions (queued, no provider task, older than the cutoff) are failed, fresh ones are left alone', async () => {
    const db = dbWith([
      generation({ id: 'stale-queued', status: 'queued', task_id: null, next_poll_at: null, created_at: iso(-(QUEUED_ORPHAN_AGE_MS + 1000)) }),
      generation({ id: 'fresh-queued', status: 'queued', task_id: null, next_poll_at: null, created_at: iso(-1000) }),
      generation({ id: 'rest-queued', transport: 'rest', status: 'queued', task_id: null, next_poll_at: null, created_at: iso(-(QUEUED_ORPHAN_AGE_MS + 1000)) }),
    ])
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, transportFactory: async () => null })
    expect(summary.outcomes.interrupted).toBe(1)
    const byId = (id: string) => db.tables.video_generations.find((row: any) => row.id === id)
    expect(byId('stale-queued')).toMatchObject({ status: 'failed', error_details: { code: 'SUBMISSION_INTERRUPTED' } })
    expect(byId('fresh-queued').status).toBe('queued')
    expect(byId('rest-queued').status).toBe('queued')
  })

  it('a store failure while listing due rows is surfaced (the route reports it), not swallowed', async () => {
    const failing: any = { from: () => { const chain: any = { update: () => chain, select: () => chain, eq: () => chain, in: () => chain, is: () => chain, lt: () => chain, lte: () => chain, order: () => chain, limit: () => chain, then: (r: any) => r({ data: null, error: { message: 'down' } }) }; return chain } }
    await expect(pollDueMcpGenerations(failing, { now: () => NOW })).rejects.toMatchObject({ name: 'CompletionStoreError' })
  })
})

describe('createMcpTransportForGeneration — the poller acts only with the generation owner’s grant', () => {
  const connection = (overrides: Record<string, unknown> = {}) => ({ id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', ...overrides })

  it('builds a transport for the generation’s own user and connection', async () => {
    const db = dbWith([], { provider_connections: [connection()] })
    expect(await createMcpTransportForGeneration(db, generation())).toMatchObject({ transport: 'mcp' })
  })

  it('a connection_id pointing at ANOTHER user’s connection yields no transport (cannot borrow a foreign grant)', async () => {
    const db = dbWith([], { provider_connections: [connection({ user_id: 'user-b' })] })
    expect(await createMcpTransportForGeneration(db, generation())).toBeNull()
  })

  it('no connection_id (deleted) or unknown connection yields no transport', async () => {
    const db = dbWith([], { provider_connections: [connection()] })
    expect(await createMcpTransportForGeneration(db, generation({ connection_id: null }))).toBeNull()
    expect(await createMcpTransportForGeneration(db, generation({ connection_id: 'nope' }))).toBeNull()
  })

  it('a store failure is thrown (retryable), not treated as "connection gone"', async () => {
    const failing: any = { from: () => { const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }) }; return chain } }
    await expect(createMcpTransportForGeneration(failing, generation())).rejects.toMatchObject({ code: 'CONNECTION_STORE_UNAVAILABLE' })
  })
})

describe('lease sizing', () => {
  it('the lease outlives a normal poll but is short enough to retry a crashed one soon', () => {
    expect(POLL_LEASE_MS).toBeGreaterThan(60_000)
    expect(POLL_LEASE_MS).toBeLessThanOrEqual(5 * 60_000)
  })
})
