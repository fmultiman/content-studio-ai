import { beforeEach, describe, expect, it, vi } from 'vitest'

// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046) — Video Review service: request-time recovery of an abandoned
// in-flight Review. Mocked transport only (virtual storage, mocked Gemini HTTP, in-memory tables); no paid call.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn() }))

vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => { throw new Error('WHOLE_OBJECT_READ_FORBIDDEN') }),
  openS3ObjectStream: vi.fn(async () => { throw new Error('DEFAULT_S3_OPEN_FORBIDDEN') }),
}))

import { REVIEW_STALE_AFTER_MS, REVIEW_STALE_FAILURE_CODE, REVIEW_STALE_FAILURE_MESSAGE } from '../stale-policy'
import { getVideoReviewHistory } from '../video-history'
import { createReviewTestDb } from './review-test-db'
import { API_KEY, GEN, GEN_SOURCE, OWNER, REQ, setup } from './video-review-harness'

const MIN = 60_000
const reviews = (db: ReturnType<typeof createReviewTestDb>): Array<Record<string, any>> => db.tables.media_reviews ?? []
const active = (db: ReturnType<typeof createReviewTestDb>) => reviews(db).filter((r) => ['pending', 'running'].includes(r.status))

/** Makes the (only) existing Review look abandoned: in flight with a lifecycle clock `idleMs` old. */
function abandon(db: ReturnType<typeof createReviewTestDb>, status: 'pending' | 'running', idleMs: number) {
  const row = reviews(db)[0]
  const at = new Date(Date.now() - idleMs).toISOString()
  Object.assign(row, { status, updated_at: at, completed_at: null, overall_score: null, overall_assessment: null, summary: null, result_payload: {}, refined_prompt: null })
  return row
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  mocks.resolveProvider.mockReset()
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: API_KEY })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  warn.mockClear()
})

describe('Video Review: stale in-flight recovery on a new request', () => {
  it.each(['pending', 'running'] as const)('a stale %s Review is recovered, then the new request creates and completes a fresh Review', async (status) => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, status, REVIEW_STALE_AFTER_MS + 10 * MIN)
    const modelCallsBefore = t.gemini.modelCalls().length

    const result = await t.run(GEN_SOURCE, 2)

    expect(result.replayed).toBe(false)
    expect(result.row).toMatchObject({ status: 'completed', client_request_id: REQ(2) })
    expect(stale).toMatchObject({ status: 'failed', failure_code: REVIEW_STALE_FAILURE_CODE })
    expect(stale.failure_details.message).toBe(REVIEW_STALE_FAILURE_MESSAGE)
    expect(stale.failed_at).toBeTruthy()
    expect(reviews(t.db)).toHaveLength(2)
    expect(active(t.db)).toHaveLength(0)
    // Recovery is not a provider call: the only new paid-path call is the NEW Review's own model request.
    expect(t.gemini.modelCalls()).toHaveLength(modelCallsBefore + 1)
    expect(warn).toHaveBeenCalledWith('[reviews] stale in-flight Review recovered', expect.objectContaining({ reviewId: stale.id, mediaType: 'video', previousStatus: status, outcome: 'recovered' }))
  })

  it.each(['pending', 'running'] as const)('a fresh %s Review (inside the provider envelope) is NOT reaped: 409 and no provider call', async (status) => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const fresh = abandon(t.db, status, 25 * MIN)
    const snapshot = JSON.stringify(fresh)
    const calls = t.gemini.calls.length

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS', details: { reviewId: fresh.id } })

    expect(JSON.stringify(reviews(t.db)[0])).toBe(snapshot)
    expect(reviews(t.db)).toHaveLength(1)
    expect(t.gemini.calls).toHaveLength(calls)
    expect(warn).not.toHaveBeenCalled()
  })

  it('the same clientRequestId replays the in-flight row and NEVER reaps it, even when it is old', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 30 * MIN)
    const snapshot = JSON.stringify(stale)
    const calls = t.gemini.calls.length

    const replay = await t.run(GEN_SOURCE, 1) // ambiguous-network retry with the SAME id

    expect(replay.replayed).toBe(true)
    expect(replay.row.id).toBe(stale.id)
    expect(JSON.stringify(reviews(t.db)[0])).toBe(snapshot)
    expect(t.gemini.calls).toHaveLength(calls)
  })

  it('replay of a terminal Review is unchanged', async () => {
    const t = setup()
    const first = await t.run(GEN_SOURCE, 1)
    const again = await t.run(GEN_SOURCE, 1)
    expect(again.replayed).toBe(true)
    expect(again.row.id).toBe(first.row.id)
    expect(reviews(t.db)).toHaveLength(1)
  })

  it('old completed and failed Reviews are never rewritten while a new Review runs', async () => {
    const t = setup({ gemini: { modelText: 'not json' } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    const failed = reviews(t.db)[0]
    failed.updated_at = new Date(Date.now() - 400 * 24 * 60 * MIN).toISOString()
    const snapshot = JSON.stringify(failed)
    const logged = t.db.log.length

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })

    expect(JSON.stringify(reviews(t.db).find((r) => r.id === failed.id))).toBe(snapshot)
    expect(t.db.log.slice(logged).some((e: any) => e.op === 'update' && e.id === failed.id)).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('if recovery itself fails, the new request fails closed BEFORE any insert or provider call', async () => {
    const t = setup({ db: { failUpdateToStatus: 'failed' } })
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)
    const calls = t.gemini.calls.length
    const inserts = t.db.log.filter((e: any) => e.op === 'insert' && e.table === 'media_reviews').length

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })

    expect(stale.status).toBe('running')
    expect(t.gemini.calls).toHaveLength(calls)
    expect(t.db.log.filter((e: any) => e.op === 'insert' && e.table === 'media_reviews')).toHaveLength(inserts)
  })

  it('stale recovery + missing Gemini credential: recovered, then the unchanged recorded not-configured failure (no provider call)', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)
    mocks.resolveProvider.mockResolvedValue({ status: 'missing' })
    const calls = t.gemini.calls.length

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })

    expect(stale).toMatchObject({ status: 'failed', failure_code: REVIEW_STALE_FAILURE_CODE })
    expect(reviews(t.db).find((r) => r.client_request_id === REQ(2))).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(t.gemini.calls).toHaveLength(calls)
  })

  it('stale recovery + a provider error on the new Review: provider errors keep their normalization and the recovery stays truthful', async () => {
    const t = setup({ gemini: { modelText: 'not json' } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)
    Object.assign(stale, { failure_code: null, failure_details: null, failed_at: null })

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 502, code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })

    expect(stale).toMatchObject({ status: 'failed', failure_code: REVIEW_STALE_FAILURE_CODE })
    expect(reviews(t.db).find((r) => r.client_request_id === REQ(2))).toMatchObject({ status: 'failed', failure_code: 'invalid_evaluator_response' })
  })

  it('two concurrent NEW requests after a stale Review never produce more than one in-flight Review at any moment, and recover exactly once', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)

    const settled = await Promise.allSettled([t.run(GEN_SOURCE, 3), t.run(GEN_SOURCE, 4)])

    // Replay the write log: the in-flight set is never larger than one (the unique index stays authoritative).
    const inFlight = new Set<string>()
    for (const entry of t.db.log.filter((e: any) => e.table === 'media_reviews')) {
      const id = (entry.id ?? entry.values?.id) as string
      const status = entry.values?.status as string | undefined
      if (status === 'pending' || status === 'running') inFlight.add(id)
      else if (status === 'completed' || status === 'failed') inFlight.delete(id)
      expect(inFlight.size).toBeLessThanOrEqual(1)
    }
    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    for (const s of settled) if (s.status === 'rejected') expect(s.reason).toMatchObject({ code: 'REVIEW_IN_PROGRESS', status: 409 })
    expect(reviews(t.db).filter((r) => r.failure_code === REVIEW_STALE_FAILURE_CODE)).toEqual([stale])
    expect(active(t.db)).toHaveLength(0)
    expect(warn.mock.calls.filter((c: any[]) => c[0] === '[reviews] stale in-flight Review recovered')).toHaveLength(1)
  })

  it('a competitor that inserts its replacement first wins: our request recovers once, then the unique index answers 409', async () => {
    let armed = false
    const t = setup({ db: { beforeInsert: (table, tables) => {
      if (table !== 'media_reviews' || !armed) return
      armed = false
      const artifactId = tables.media_artifacts[0].id
      ;(tables.media_reviews ??= []).push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', user_id: OWNER, subject_media_type: 'video', media_artifact_id: artifactId, status: 'pending', client_request_id: REQ(900), request_fingerprint: 'other', updated_at: new Date().toISOString() })
    } } })
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)
    armed = true

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS', details: { reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } })

    expect(stale.status).toBe('failed') // recovered once...
    expect(active(t.db)).toHaveLength(1) // ...and the competitor's Review is the single in-flight one
    expect(active(t.db)[0].client_request_id).toBe(REQ(900))
  })
})

describe('Video Review history stays strictly read-only, even with a stale in-flight Review', () => {
  it('GET history never reaps: it issues no write and leaves the stale row in flight', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const stale = abandon(t.db, 'running', REVIEW_STALE_AFTER_MS + 10 * MIN)
    const logged = t.db.log.length
    const guarded = {
      from(table: string) {
        const builder = t.db.from(table)
        for (const method of ['insert', 'update', 'upsert', 'delete']) builder[method] = () => { throw new Error(`WRITE_FORBIDDEN:${method}`) }
        return builder
      },
    } as any

    const history = await getVideoReviewHistory({ db: guarded, userId: OWNER, source: { kind: 'video_generation', id: GEN } })

    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({ id: stale.id, status: 'running', failure: null })
    expect(t.db.log).toHaveLength(logged)
    expect(stale.status).toBe('running')
  })
})
