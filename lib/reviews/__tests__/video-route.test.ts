import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}))
vi.mock('@/lib/reviews/video-service', () => ({ createVideoReviewExecution: mocks.create }))

import { POST, maxDuration, runtime } from '@/app/api/reviews/video/route'
import { ReviewServiceError } from '../errors'
import type { MediaReviewRow } from '../repository'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const USER = ID(99)

function request(body: unknown, raw = false) {
  return new Request('http://localhost/api/reviews/video', { method: 'POST', body: raw ? String(body) : JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as never
}

function completedRow(): MediaReviewRow {
  return {
    id: ID(10), user_id: USER, subject_media_type: 'video', image_attempt_id: null, image_output_id: null, media_artifact_id: ID(30),
    project_id: null, production_id: null, adapter_key: 'video', adapter_version: 'video-review-v1', review_schema_version: 1, origin: 'live',
    status: 'completed', client_request_id: ID(40), request_fingerprint: 'fp', subject_snapshot: {}, context_snapshot: { fingerprint: 'cf' },
    evaluator_provider: 'gemini', evaluator_model: 'gemini-3.5-flash', evaluator_prompt_version: 'video-review-prompt-v1',
    overall_score: 80, overall_assessment: 'strong', summary: 's', result_payload: {}, refined_prompt: null, failure_code: null,
    failure_details: null, legacy_source_key: null, created_at: '2026-10-07T00:00:00Z', started_at: null, completed_at: '2026-10-07T00:01:00Z',
    failed_at: null, updated_at: '2026-10-07T00:01:00Z',
  }
}

const valid = { source: { kind: 'library_file', id: ID(1) }, clientRequestId: ID(2) }

beforeEach(() => {
  mocks.getUser.mockReset()
  mocks.create.mockReset()
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
})

describe('POST /api/reviews/video', () => {
  it('is a Node route with an extended duration budget', () => {
    expect(runtime).toBe('nodejs')
    expect(maxDuration).toBe(300)
  })

  it('rejects an unauthenticated caller before touching the service', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await POST(request(valid))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: { message: 'jwt' } })
    expect((await POST(request(valid))).status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON, oversized bodies and bad shapes', async () => {
    expect((await POST(request('{nope', true))).status).toBe(400)
    expect((await POST(request('[]', true))).status).toBe(400)
    expect((await POST(request('x'.repeat(20_000), true))).status).toBe(413)
    expect((await POST(request({ source: { kind: 'unknown', id: ID(1) }, clientRequestId: ID(2) }))).status).toBe(400)
    expect((await POST(request({ source: { kind: 'library_file', id: 'not-a-uuid' }, clientRequestId: ID(2) }))).status).toBe(400)
    expect((await POST(request({ source: valid.source }))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses any URL, key, bucket, MIME, size, duration, credential, provider or model field', async () => {
    for (const extra of [{ url: 'https://x' }, { storagePath: 'k' }, { bucket: 'b' }, { mimeType: 'video/mp4' }, { size: 1 }, { durationMs: 1 }, { apiKey: 'AIza' }, { provider: 'openai' }, { model: 'm' }]) {
      const response = await POST(request({ ...valid, ...extra }))
      expect(response.status, JSON.stringify(extra)).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid Review body.', code: 'INVALID_BODY' })
      const nested = await POST(request({ ...valid, source: { ...valid.source, ...extra } }))
      expect(nested.status).toBe(400)
    }
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('passes ONLY the authenticated user, the typed source and the clientRequestId to the service', async () => {
    mocks.create.mockResolvedValue({ row: completedRow(), replayed: false })
    const response = await POST(request(valid))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0]).toEqual({ userId: USER, source: valid.source, clientRequestId: ID(2) })
    const body = await response.json()
    expect(body.replayed).toBe(false)
    expect(body.review).toMatchObject({ id: ID(10), status: 'completed', subject: { mediaType: 'video', artifactId: ID(30) }, evaluator: { provider: 'gemini' } })
    // No storage coordinates, credentials or approval fields in the public payload.
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/storage_path|storagePath|bucket|AIza|approv/i)
  })

  it('answers a replay with 200', async () => {
    mocks.create.mockResolvedValue({ row: completedRow(), replayed: true })
    const response = await POST(request(valid))
    expect(response.status).toBe(200)
    expect((await response.json()).replayed).toBe(true)
  })

  it('maps service errors to stable codes and statuses', async () => {
    const cases: Array<[ReviewServiceError, number]> = [
      [new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.'), 404],
      [new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this video.', { reviewId: ID(10) }), 409],
      [new ReviewServiceError(409, 'REVIEW_IDEMPOTENCY_CONFLICT', 'clientRequestId was used for another Review.'), 409],
      [new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'The source is not a completed video.'), 422],
      [new ReviewServiceError(422, 'REVIEW_PROVIDER_UNSUPPORTED', 'Video exceeds the Review size limit (500 MB).'), 422],
      [new ReviewServiceError(422, 'REVIEW_PROVIDER_NOT_CONFIGURED', 'Video evaluator provider is not configured.', { reviewId: ID(10) }), 422],
      [new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Review provider returned an unusable response.', { reviewId: ID(10) }), 502],
      [new ReviewServiceError(504, 'REVIEW_PROVIDER_TIMEOUT', 'Review provider timed out.', { reviewId: ID(10) }), 504],
      [new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.'), 503],
    ]
    for (const [error, status] of cases) {
      mocks.create.mockRejectedValueOnce(error)
      const response = await POST(request(valid))
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code: error.code, error: error.message, ...(error.details ?? {}) })
    }
  })

  it('never echoes an unexpected error (it may carry keys or provider detail)', async () => {
    mocks.create.mockRejectedValue(new Error('boom users/abc/library/x/clip.mp4 AIza-secret'))
    const response = await POST(request(valid))
    expect(response.status).toBe(500)
    const text = JSON.stringify(await response.json())
    expect(text).toContain('REVIEW_INTERNAL_ERROR')
    expect(text).not.toMatch(/users\/abc|AIza|boom/)
  })
})
