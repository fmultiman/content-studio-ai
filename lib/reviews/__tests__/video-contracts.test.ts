import { describe, expect, it } from 'vitest'
import { ReviewRecordSchema, ReviewRequestSchema, VideoReviewRequestSchema } from '../contracts'
import { toReviewRecord, findActiveReviewByArtifact, type MediaReviewRow } from '../repository'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('VideoReviewRequestSchema (typed source only)', () => {
  const source = { kind: 'video_generation', id: ID(1) }
  const request = { source, clientRequestId: ID(2) }

  it('accepts exactly the three real source families with a UUID id', () => {
    for (const kind of ['video_generation', 'render_execution', 'library_file']) {
      expect(VideoReviewRequestSchema.parse({ source: { kind, id: ID(1) }, clientRequestId: ID(2) }).source.kind).toBe(kind)
    }
  })

  it('rejects every client-supplied media fact, locator or credential', () => {
    const forbidden: Array<Record<string, unknown>> = [
      { url: 'https://evil.example/v.mp4' }, { videoUrl: 'https://evil.example/v.mp4' }, { storagePath: 'users/x/library/y/z.mp4' },
      { storage_path: 'x' }, { key: 'x' }, { s3Key: 'x' }, { bucket: 'b' }, { mimeType: 'video/mp4' }, { mime: 'video/mp4' },
      { size: 1 }, { byteSize: 1 }, { durationMs: 1 }, { duration: 1 }, { width: 1 }, { apiKey: 'AIza' }, { credentialId: 'c' },
      { provider: 'gemini' }, { model: 'gemini-3.5-flash' }, { projectId: ID(3) }, { productionId: ID(4) }, { artifactId: ID(5) },
    ]
    for (const extra of forbidden) {
      expect(VideoReviewRequestSchema.safeParse({ ...request, ...extra }).success, JSON.stringify(extra)).toBe(false)
      expect(VideoReviewRequestSchema.safeParse({ ...request, source: { ...source, ...extra } }).success, `source+${JSON.stringify(extra)}`).toBe(false)
    }
  })

  it('rejects unknown kinds, non-UUID ids, URL ids and missing fields', () => {
    for (const bad of [
      { source: { kind: 'url', id: ID(1) }, clientRequestId: ID(2) },
      { source: { kind: 'library', id: ID(1) }, clientRequestId: ID(2) },
      { source: { kind: 'video_generation_output', id: ID(1) }, clientRequestId: ID(2) },
      { source: { kind: 'library_file', id: 'https://evil.example/v.mp4' }, clientRequestId: ID(2) },
      { source: { kind: 'library_file', id: 'users/u/library/x/y.mp4' }, clientRequestId: ID(2) },
      { source: { kind: 'library_file' }, clientRequestId: ID(2) },
      { source: { kind: 'library_file', id: ID(1) } },
      { clientRequestId: ID(2) },
      { source: 'library_file', clientRequestId: ID(2) },
    ]) {
      expect(VideoReviewRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('does not widen the existing Image request', () => {
    expect(ReviewRequestSchema.safeParse({ attemptId: ID(1), clientRequestId: ID(2), source }).success).toBe(false)
    expect(ReviewRequestSchema.safeParse({ source, clientRequestId: ID(2) }).success).toBe(false)
  })
})

function row(overrides: Partial<MediaReviewRow> = {}): MediaReviewRow {
  return {
    id: ID(10), user_id: ID(20), subject_media_type: 'video', image_attempt_id: null, image_output_id: null, media_artifact_id: ID(30),
    project_id: null, production_id: null, adapter_key: 'video', adapter_version: 'video-review-v1', review_schema_version: 1, origin: 'live',
    status: 'pending', client_request_id: ID(40), request_fingerprint: 'fp', subject_snapshot: {}, context_snapshot: { fingerprint: 'cf' },
    evaluator_provider: null, evaluator_model: null, evaluator_prompt_version: null, overall_score: null, overall_assessment: null, summary: null,
    result_payload: {}, refined_prompt: null, failure_code: null, failure_details: null, legacy_source_key: null,
    created_at: '2026-10-07T00:00:00Z', started_at: null, completed_at: null, failed_at: null, updated_at: '2026-10-07T00:00:00Z',
    ...overrides,
  }
}

describe('Review record: discriminated image / video subject', () => {
  it('maps a Video Review to a subject that carries only its artifact', () => {
    const record = toReviewRecord(row())
    expect(record.subject).toEqual({ mediaType: 'video', artifactId: ID(30) })
    expect(ReviewRecordSchema.parse(record)).toEqual(record)
  })

  it('maps an Image Review exactly as before (Attempt, output, artifact)', () => {
    const record = toReviewRecord(row({ subject_media_type: 'image', image_attempt_id: ID(50), image_output_id: ID(51), adapter_key: 'image' }))
    expect(record.subject).toEqual({ mediaType: 'image', attemptId: ID(50), outputId: ID(51), artifactId: ID(30) })
  })

  it('refuses a corrupt Image row instead of coercing it, and forbids image links on a video subject', () => {
    expect(() => toReviewRecord(row({ subject_media_type: 'image', image_attempt_id: null, image_output_id: null }))).toThrow(/missing its Attempt or output/)
    expect(ReviewRecordSchema.safeParse({ ...toReviewRecord(row()), subject: { mediaType: 'video', artifactId: ID(30), attemptId: ID(50) } }).success).toBe(false)
    expect(ReviewRecordSchema.safeParse({ ...toReviewRecord(row()), subject: { mediaType: 'video' } }).success).toBe(false)
    expect(ReviewRecordSchema.safeParse({ ...toReviewRecord(row()), subject: { mediaType: 'audio', artifactId: ID(30) } }).success).toBe(false)
  })

  it('carries no approval-shaped field on the record', () => {
    const keys = Object.keys(toReviewRecord(row()))
    expect(keys.filter((key) => /approv|publish|accepted/i.test(key))).toEqual([])
  })
})

describe('findActiveReviewByArtifact', () => {
  it('queries only in-flight VIDEO Reviews of the owner for that artifact', async () => {
    const seen: Array<[string, unknown]> = []
    let inValues: unknown[] = []
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: unknown) => { seen.push([column, value]); return builder },
      in: (_column: string, values: unknown[]) => { inValues = values; return builder },
      maybeSingle: async () => ({ data: null, error: null }),
    }
    await findActiveReviewByArtifact({ from: () => builder } as never, ID(20), ID(30))
    expect(seen).toEqual([['user_id', ID(20)], ['subject_media_type', 'video'], ['media_artifact_id', ID(30)]])
    expect(inValues).toEqual(['pending', 'running'])
  })
})
