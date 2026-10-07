import { beforeEach, describe, expect, it, vi } from 'vitest'

// REVIEW_STALE_RUNNING_RECOVERY_V1 (FUTURE-046) — Image Review shares the same lifecycle table, the same
// guarded recovery and the same stale policy as Video. Here the REAL repository and recovery run over the
// in-memory test database; only the Attempt/context/artifact resolution and the credential are stubbed.
// No network, no paid call (the evaluator seam is a counter).

const mocks = vi.hoisted(() => ({ resolveContext: vi.fn(), resolveArtifact: vi.fn(), resolveProvider: vi.fn() }))

vi.mock('../context', () => ({
  buildRequestFingerprint: (attemptId: string, outputId: string, contextFingerprint: string) => `${attemptId}:${outputId}:${contextFingerprint}`,
  resolveImageReviewContext: mocks.resolveContext,
}))
vi.mock('@/lib/media-artifacts/image', () => ({ resolveImageArtifact: mocks.resolveArtifact }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => ({}) }))

import { createImageReviewExecution, getImageReviewHistory } from '../service'
import { REVIEW_STALE_AFTER_MS, REVIEW_STALE_FAILURE_CODE, REVIEW_STALE_FAILURE_MESSAGE } from '../stale-policy'
import { createReviewTestDb } from './review-test-db'

const MIN = 60_000
const USER = '11111111-1111-4111-8111-111111111111'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const outputId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const artifactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REQ = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const FINGERPRINT = `${attemptId}:${outputId}:context-fingerprint`

const resolved = {
  context: { schemaVersion: 1 as const, capturedAt: '2026-10-06T00:00:00.000Z', project: { id: '44444444-4444-4444-8444-444444444444', context: null, evaluationMode: 'default', identity: null }, production: null },
  subject: {
    attemptId, outputId, projectId: '44444444-4444-4444-8444-444444444444', productionId: null, submittedPrompt: 'A quiet studio portrait',
    provider: 'openai', model: 'gpt-image-1', submittedConfig: { size: '1024x1024' }, sourceSnapshot: null, outputUrl: 'https://example.test/image.png',
    outputStoragePath: null, outputMetadata: {},
  },
  output: { storage_provider: null, storage_path: null, mime_type: 'image/png', file_size: null, metadata: {} },
  contextFingerprint: 'context-fingerprint',
}

function imageRow(status: 'pending' | 'running' | 'completed' | 'failed', idleMs: number, n: number) {
  const at = new Date(Date.now() - idleMs).toISOString()
  return {
    id: `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, user_id: USER, subject_media_type: 'image', image_attempt_id: attemptId, image_output_id: outputId,
    media_artifact_id: artifactId, project_id: resolved.subject.projectId, production_id: null, adapter_key: 'image', adapter_version: 'image-review-v1',
    review_schema_version: 1, origin: 'live', status, client_request_id: REQ(n), request_fingerprint: FINGERPRINT, subject_snapshot: {}, context_snapshot: { fingerprint: 'context-fingerprint' },
    evaluator_provider: null, evaluator_model: null, evaluator_prompt_version: null, overall_score: null, overall_assessment: null, summary: null, result_payload: {},
    refined_prompt: null, failure_code: status === 'failed' ? 'provider_error' : null, failure_details: null, legacy_source_key: null,
    created_at: at, started_at: status === 'pending' ? null : at, completed_at: null, failed_at: null, updated_at: at,
  }
}

const reviewsOf = (db: ReturnType<typeof createReviewTestDb>): Array<Record<string, any>> => db.tables.media_reviews ?? []
const evaluatorResult = { score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null }
const MODEL = () => vi.fn().mockResolvedValue(evaluatorResult)

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveContext.mockResolvedValue(resolved)
  mocks.resolveArtifact.mockResolvedValue({ id: artifactId })
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', secret: 'test-key' })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  warn.mockClear()
})

describe('Image Review: stale in-flight recovery on a new request', () => {
  it.each(['pending', 'running'] as const)('a stale %s Review is recovered, then a fresh Review completes (exactly one paid evaluator call)', async (status) => {
    const db = createReviewTestDb({ media_reviews: [imageRow(status, REVIEW_STALE_AFTER_MS + 10 * MIN, 1)] })
    const evaluator = MODEL()

    const result = await createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator })

    expect(result).toMatchObject({ replayed: false, row: { status: 'completed', client_request_id: REQ(2) } })
    const stale = reviewsOf(db).find((r) => r.client_request_id === REQ(1))!
    expect(stale).toMatchObject({ status: 'failed', failure_code: REVIEW_STALE_FAILURE_CODE })
    expect(stale.failure_details.message).toBe(REVIEW_STALE_FAILURE_MESSAGE)
    expect(stale.failure_details.recovery).toMatchObject({ reason: 'execution_stale', previousStatus: status })
    expect(evaluator).toHaveBeenCalledTimes(1)
    expect(reviewsOf(db).filter((r) => ['pending', 'running'].includes(r.status))).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('[reviews] stale in-flight Review recovered', expect.objectContaining({ reviewId: stale.id, mediaType: 'image', previousStatus: status, outcome: 'recovered' }))
  })

  it.each(['pending', 'running'] as const)('a fresh %s Review is NOT reaped: 409, untouched, no evaluator call', async (status) => {
    const row = imageRow(status, 25 * MIN, 1)
    const snapshot = JSON.stringify(row)
    const db = createReviewTestDb({ media_reviews: [row] })
    const evaluator = vi.fn()

    await expect(createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator }))
      .rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS', details: { reviewId: row.id } })

    expect(JSON.stringify(reviewsOf(db)[0])).toBe(snapshot)
    expect(reviewsOf(db)).toHaveLength(1)
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('the same clientRequestId replays an in-flight row without reaping it, however old', async () => {
    const row = imageRow('running', REVIEW_STALE_AFTER_MS + 60 * MIN, 1)
    const snapshot = JSON.stringify(row)
    const db = createReviewTestDb({ media_reviews: [row] })
    const evaluator = vi.fn()

    const result = await createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(1), db, evaluator })

    expect(result.replayed).toBe(true)
    expect(JSON.stringify(reviewsOf(db)[0])).toBe(snapshot)
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('old completed and failed Reviews are never rewritten', async () => {
    const old = 400 * 24 * 60 * MIN
    const done = { ...imageRow('completed', old, 1), completed_at: new Date(Date.now() - old).toISOString() }
    const failed = imageRow('failed', old, 2)
    const snapshots = JSON.stringify([done, failed])
    const db = createReviewTestDb({ media_reviews: [done, failed] })

    await createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(3), db, evaluator: MODEL() })

    expect(JSON.stringify([reviewsOf(db)[0], reviewsOf(db)[1]])).toBe(snapshots)
    expect(db.log.filter((e: any) => e.op === 'update' && (e.id === done.id || e.id === failed.id))).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('if recovery fails the request fails closed before any insert or evaluator call', async () => {
    const row = imageRow('running', REVIEW_STALE_AFTER_MS + 10 * MIN, 1)
    const db = createReviewTestDb({ media_reviews: [row] }, { failUpdateToStatus: 'failed' })
    const evaluator = vi.fn()

    await expect(createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator }))
      .rejects.toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })

    expect(reviewsOf(db)).toHaveLength(1)
    expect(reviewsOf(db)[0].status).toBe('running')
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('missing credential after recovery keeps the unchanged recorded not-configured failure', async () => {
    const db = createReviewTestDb({ media_reviews: [imageRow('running', REVIEW_STALE_AFTER_MS + 10 * MIN, 1)] })
    mocks.resolveProvider.mockResolvedValue({ status: 'missing' })
    const evaluator = vi.fn()

    await expect(createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator }))
      .rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })

    expect(reviewsOf(db).find((r) => r.client_request_id === REQ(1))).toMatchObject({ status: 'failed', failure_code: REVIEW_STALE_FAILURE_CODE })
    expect(reviewsOf(db).find((r) => r.client_request_id === REQ(2))).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('a provider error on the new Review keeps its normalization', async () => {
    const db = createReviewTestDb({ media_reviews: [imageRow('pending', REVIEW_STALE_AFTER_MS + 10 * MIN, 1)] })
    const evaluator = vi.fn().mockResolvedValue({ score: 101, feedback: 'invalid', improvements: [] })

    await expect(createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator }))
      .rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })

    expect(reviewsOf(db).find((r) => r.client_request_id === REQ(2))).toMatchObject({ status: 'failed', failure_code: 'invalid_evaluator_response' })
  })

  it('two concurrent NEW requests after a stale Review: one recovery, at most one in flight, the loser gets 409 (not 503)', async () => {
    const db = createReviewTestDb({ media_reviews: [imageRow('running', REVIEW_STALE_AFTER_MS + 10 * MIN, 1)] })
    const evaluator = MODEL()

    const settled = await Promise.allSettled([
      createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(3), db, evaluator }),
      createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(4), db, evaluator }),
    ])

    expect(settled.filter((s) => s.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    for (const s of settled) if (s.status === 'rejected') expect(s.reason).toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS' })
    const inFlight = new Set<string>()
    for (const entry of db.log.filter((e: any) => e.table === 'media_reviews')) {
      const id = (entry.id ?? entry.values?.id) as string
      const status = entry.values?.status as string | undefined
      if (status === 'pending' || status === 'running') inFlight.add(id)
      else if (status === 'completed' || status === 'failed') inFlight.delete(id)
      expect(inFlight.size).toBeLessThanOrEqual(1)
    }
    expect(reviewsOf(db).filter((r) => r.failure_code === REVIEW_STALE_FAILURE_CODE)).toHaveLength(1)
    expect(warn.mock.calls.filter((c: any[]) => c[0] === '[reviews] stale in-flight Review recovered')).toHaveLength(1)
    expect(evaluator.mock.calls.length).toBe(settled.filter((s) => s.status === 'fulfilled').length)
  })

  it('the database active-attempt index is the final authority: a competitor inserting first yields 409, never a 503', async () => {
    let armed = true
    const db = createReviewTestDb({ media_reviews: [] }, { beforeInsert: (table, tables) => {
      if (table !== 'media_reviews' || !armed) return
      armed = false
      ;(tables.media_reviews ??= []).push(imageRow('pending', 0, 900))
    } })
    const evaluator = vi.fn()

    await expect(createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(2), db, evaluator }))
      .rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS', details: { reviewId: imageRow('pending', 0, 900).id } })
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('Image history GET stays a pure read (no recovery is attempted from history)', async () => {
    const row = imageRow('running', REVIEW_STALE_AFTER_MS + 10 * MIN, 1)
    const db = createReviewTestDb({ media_reviews: [row] })

    const history = await getImageReviewHistory({ userId: USER, attemptId, db })

    expect(history.items).toHaveLength(1)
    expect(history.items[0].status).toBe('running')
    expect(db.log).toHaveLength(0)
    expect(reviewsOf(db)[0].status).toBe('running')
  })
})
