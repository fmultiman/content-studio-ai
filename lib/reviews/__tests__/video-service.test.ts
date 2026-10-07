import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// GEMINI_VIDEO_REVIEW_ADAPTER_V1 — end-to-end Video Review with MOCKED transport only.
// Real: source resolution, artifact registration + provenance, media authorization, context,
// Review persistence rules, the Gemini execution provider and its Files API client.
// Mocked: Supabase (in-memory), object storage (virtual objects), Gemini HTTP (fetch), BYOK credential.
// No network, no paid call.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn() }))

vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
// Any default whole-object or default-S3 read would be a bug on the video path: make it loud.
vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => { throw new Error('WHOLE_OBJECT_READ_FORBIDDEN') }),
  openS3ObjectStream: vi.fn(async () => { throw new Error('DEFAULT_S3_OPEN_FORBIDDEN') }),
}))

import { toReviewRecord } from '../repository'
import { REVIEW_VIDEO_MAX_BYTES, REVIEW_VIDEO_MAX_DURATION_MS } from '../media-limits'
import { GEMINI_UPLOAD_CHUNK_BYTES } from '@/lib/providers/gemini/client'
import { readS3Object, openS3ObjectStream } from '@/lib/storage/s3'
import { createReviewTestDb } from './review-test-db'
import {
  API_KEY, EXEC, GEN, GEN_PATH, GEN_SOURCE, HOST, LIB_PATH, LIB_SOURCE, LIB_UUID, MIB, OTHER, OWNER, PRODUCTION, PROJECT, REQ,
  RENDER_SOURCE, SCRATCH_PATH, UPLOAD_URL, ZEROS, bufferObject, genMp4, libMp4, seed, setup, sha, zeroObject, FILE,
} from './video-review-harness'

const reviews = (db: ReturnType<typeof createReviewTestDb>): Array<Record<string, any>> => db.tables.media_reviews ?? []

beforeEach(() => {
  mocks.resolveProvider.mockReset()
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: API_KEY })
  vi.mocked(readS3Object).mockClear()
  vi.mocked(openS3ObjectStream).mockClear()
})

describe('Video Review: each typed source family -> artifact -> Review', () => {
  it('1. Video Generation output: creates the artifact, streams to Gemini, persists an immutable Review linked to the artifact', async () => {
    const t = setup()
    const result = await t.run(GEN_SOURCE)

    const artifacts = t.db.tables.media_artifacts
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ media_type: 'video', identity_mode: 'sha256', content_hash: sha(genMp4), duration_ms: 8000, width: 1280, height: 720, project_id: PROJECT, production_id: PRODUCTION })
    expect(t.db.tables.media_artifact_provenance).toEqual([expect.objectContaining({ artifact_id: artifacts[0].id, provenance_kind: 'video_generation', video_generation_id: GEN })])

    expect(reviews(t.db)).toHaveLength(1)
    expect(result.row).toMatchObject({
      status: 'completed', subject_media_type: 'video', image_attempt_id: null, image_output_id: null, media_artifact_id: artifacts[0].id,
      project_id: PROJECT, production_id: PRODUCTION, adapter_key: 'video', adapter_version: 'video-review-v1',
      evaluator_provider: 'gemini', evaluator_model: 'gemini-3.5-flash', evaluator_prompt_version: 'video-review-prompt-v1',
      overall_score: 82, overall_assessment: 'strong', refined_prompt: 'A calm sunrise, slower pan',
    })
    expect(result.replayed).toBe(false)
    expect(result.row.result_payload).toMatchObject({ adapter: { key: 'video' }, adapterResult: { analyzed: 'visual_only', sourceKind: 'video_generation' } })
    // Public shape: discriminated video subject, no storage coordinates anywhere.
    const record = toReviewRecord(result.row)
    expect(record.subject).toEqual({ mediaType: 'video', artifactId: artifacts[0].id })
    expect(JSON.stringify(record)).not.toContain(GEN_PATH)
    expect(result.row.subject_snapshot).toMatchObject({ source: GEN_SOURCE, sourceContext: { submittedPrompt: 'A calm sunrise over the sea', provider: 'kling' } })
    expect(JSON.stringify(result.row.subject_snapshot)).not.toContain(GEN_PATH)
  })

  it('2. completed RenderExecution output: artifact on the scratch key, render provenance, Review completed', async () => {
    const t = setup()
    const result = await t.run(RENDER_SOURCE)
    expect(t.db.tables.media_artifacts[0]).toMatchObject({ storage_path: SCRATCH_PATH, production_id: PRODUCTION, duration_ms: 8000 })
    expect(t.db.tables.media_artifact_provenance[0]).toMatchObject({ provenance_kind: 'render_execution', render_execution_id: EXEC })
    expect(result.row).toMatchObject({ status: 'completed', subject_media_type: 'video', media_artifact_id: t.db.tables.media_artifacts[0].id })
    // A render is authored composition, not a prompt: no refinement is recorded.
    expect(result.row.refined_prompt).toBeNull()
  })

  it('3. Library video with NO Project/Production is reviewable (optional context), with upload provenance', async () => {
    const t = setup()
    const result = await t.run(LIB_SOURCE)
    expect(t.db.tables.media_artifacts[0]).toMatchObject({ storage_path: LIB_PATH, project_id: null, production_id: null, duration_ms: 5000 })
    expect(t.db.tables.media_artifact_provenance[0]).toMatchObject({ provenance_kind: 'upload', library_file_id: FILE })
    expect(result.row).toMatchObject({ status: 'completed', project_id: null, production_id: null })
    expect(result.row.context_snapshot).toMatchObject({ project: { id: null }, production: null })
  })

  it('21. a Library video is read only: nothing is moved, rewritten or made public', async () => {
    const t = setup()
    await t.run(LIB_SOURCE)
    expect(t.store.opens.every((o) => o.path === LIB_PATH)).toBe(true)
    expect(t.db.log.filter((entry: { table: string }) => entry.table === 'library_files')).toEqual([])
    expect(t.db.tables.library_files[0]).toMatchObject({ storage_path: LIB_PATH })
  })
})

describe('Video Review: artifact reuse, repeated Reviews, idempotency', () => {
  it('4/5/6. reuses the artifact and provenance; repeated Reviews are separate immutable executions', async () => {
    const t = setup()
    const first = await t.run(GEN_SOURCE, 1)
    const hashOpensBefore = t.store.fullStreamOpens()
    const second = await t.run(GEN_SOURCE, 2)

    expect(second.row.id).not.toBe(first.row.id)
    expect(second.row.media_artifact_id).toBe(first.row.media_artifact_id)
    expect(t.db.tables.media_artifacts).toHaveLength(1)
    expect(t.db.tables.media_artifact_provenance).toHaveLength(1)
    expect(reviews(t.db).map((r) => r.status)).toEqual(['completed', 'completed'])
    // Registration did not re-hash (provenance fast path); only the Review's own stream was opened again.
    expect(t.store.fullStreamOpens()).toBe(hashOpensBefore + 1)
  })

  it('replays the same clientRequestId without a new execution', async () => {
    const t = setup()
    const first = await t.run(GEN_SOURCE, 1)
    const modelCalls = t.gemini.modelCalls().length
    const again = await t.run(GEN_SOURCE, 1)
    expect(again.replayed).toBe(true)
    expect(again.row.id).toBe(first.row.id)
    expect(t.gemini.modelCalls()).toHaveLength(modelCalls)
    expect(reviews(t.db)).toHaveLength(1)
  })

  it('rejects a clientRequestId reused for a different source', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    await expect(t.run(LIB_SOURCE, 1)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IDEMPOTENCY_CONFLICT' })
  })

  it('allows only one in-flight Review per artifact and starts no provider call for the second', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const artifactId = t.db.tables.media_artifacts[0].id
    reviews(t.db)[0].status = 'running' // simulate the first Review still in flight
    const modelCalls = t.gemini.modelCalls().length
    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS', details: { reviewId: reviews(t.db)[0].id } })
    expect(reviews(t.db)).toHaveLength(1)
    expect(t.gemini.modelCalls()).toHaveLength(modelCalls)
    expect(artifactId).toBeTruthy()
  })

  it('converges the database in-flight guard when two requests race past the application check', async () => {
    let injected = false
    const t = setup({ db: { beforeInsert: (table, tables) => {
      if (table !== 'media_reviews' || injected) return
      injected = true
      const artifactId = tables.media_artifacts[0].id
      ;(tables.media_reviews ??= []).push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', user_id: OWNER, subject_media_type: 'video', media_artifact_id: artifactId, status: 'running', client_request_id: REQ(900), request_fingerprint: 'other' })
    } } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS' })
    expect(t.gemini.modelCalls()).toHaveLength(0)
  })
})

describe('Video Review: authorization and trusted input', () => {
  it('7. another user\'s source is not found, and storage is never opened', async () => {
    const t = setup()
    for (const source of [GEN_SOURCE, RENDER_SOURCE, LIB_SOURCE]) {
      await expect(t.run(source, 1, OTHER)).rejects.toMatchObject({ status: 404, code: 'REVIEW_SUBJECT_NOT_FOUND' })
    }
    expect(t.store.opens).toHaveLength(0)
    expect(reviews(t.db)).toHaveLength(0)
    expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
  })

  it('an unknown source id is not found', async () => {
    const t = setup()
    await expect(t.run({ kind: 'library_file', id: '12345678-1234-4234-8234-123456789012' })).rejects.toMatchObject({ status: 404, code: 'REVIEW_SUBJECT_NOT_FOUND' })
  })

  it('8. a source whose stored key is not in the owner\'s trusted namespace is refused before any read', async () => {
    for (const overrides of [
      { generation: { storage_path: `${OTHER}/videos/ai/${PROJECT}/${GEN}.mp4` } },
      { generation: { storage_path: 'https://evil.example/v.mp4' } },
      { render: { output_storage_path: `users/${OTHER}/renders/scratch/${EXEC}/output.mp4` } },
      { library: { storage_path: `users/${OTHER}/library/${LIB_UUID}/clip.mp4` } },
      { library: { storage_path: 'http://169.254.169.254/latest' } },
    ]) {
      const t = setup({ seedOverrides: overrides })
      const source = 'generation' in overrides ? GEN_SOURCE : 'render' in overrides ? RENDER_SOURCE : LIB_SOURCE
      await expect(t.run(source)).rejects.toMatchObject({ status: 422, code: 'REVIEW_OUTPUT_UNAVAILABLE' })
      expect(t.store.opens).toHaveLength(0)
      expect(reviews(t.db)).toHaveLength(0)
    }
  })

  it('9/10. rejects an incomplete RenderExecution, a still render, a non-video Library file and an unfinished generation', async () => {
    const cases: Array<[Parameters<typeof seed>[0], typeof GEN_SOURCE | typeof RENDER_SOURCE | typeof LIB_SOURCE]> = [
      [{ render: { status: 'queued' } }, RENDER_SOURCE],
      [{ render: { status: 'claimed' } }, RENDER_SOURCE],
      [{ render: { status: 'failed' } }, RENDER_SOURCE],
      [{ render: { kind: 'static_still' } }, RENDER_SOURCE],
      [{ library: { kind: 'image', mime_type: 'image/png' } }, LIB_SOURCE],
      [{ library: { deleted_at: '2026-10-01T00:00:00Z' } }, LIB_SOURCE],
      [{ generation: { status: 'processing', storage_path: null } }, GEN_SOURCE],
    ]
    for (const [overrides, source] of cases) {
      const t = setup({ seedOverrides: overrides })
      await expect(t.run(source)).rejects.toMatchObject({ status: 422, code: 'REVIEW_OUTPUT_UNAVAILABLE' })
      expect(reviews(t.db)).toHaveLength(0)
      expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
    }
  })
})

describe('Video Review: media guardrails (limits unchanged)', () => {
  it('11. an oversized video (recorded size) is rejected before the object is read or hashed', async () => {
    const t = setup({ seedOverrides: { generation: { result_metadata: { mime: 'video/mp4', size: REVIEW_VIDEO_MAX_BYTES + 1 } } } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_UNSUPPORTED' })
    expect(t.store.opens).toHaveLength(0)
    expect(reviews(t.db)).toHaveLength(0)
    expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
  })

  it('12. an over-long video (recorded duration) is rejected before the object is read', async () => {
    const t = setup({ seedOverrides: { render: { output_duration_ms: REVIEW_VIDEO_MAX_DURATION_MS + 1 } } })
    await expect(t.run(RENDER_SOURCE)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_UNSUPPORTED' })
    expect(t.store.opens).toHaveLength(0)
    expect(reviews(t.db)).toHaveLength(0)
  })

  it('13. a video whose duration cannot be proven fails closed: no Review row, no upload, no model call', async () => {
    const opaque = Buffer.alloc(4096, 3)
    const t = setup({
      seedOverrides: { generation: { result_metadata: { mime: 'video/mp4', size: opaque.length } } },
      objects: { [GEN_PATH]: bufferObject(opaque) },
    })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_UNSUPPORTED', message: expect.stringContaining('must be known') })
    expect(t.db.tables.media_artifacts[0]).toMatchObject({ duration_ms: null })
    expect(reviews(t.db)).toHaveLength(0)
    expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Video Review: the streaming path is the only path', () => {
  it('14/15/16. streams a 40 MiB video to the Files API in protocol chunks; never loads the whole object', async () => {
    const size = 40 * MIB
    const t = setup({
      seedOverrides: { render: { output_size_bytes: size } },
      objects: { [SCRATCH_PATH]: zeroObject(size) },
    })
    const concat = vi.spyOn(Buffer, 'concat')
    const result = await t.run(RENDER_SOURCE)
    expect(result.row.status).toBe('completed')

    const expected = createHash('sha256')
    for (let i = 0; i < 40; i += 1) expected.update(ZEROS)
    // The exact bytes of the stored object reached Gemini, in bounded chunks.
    expect(t.gemini.uploadedHash()).toBe(expected.digest('hex'))
    expect(t.gemini.uploadedBytes()).toBe(size)
    const chunks = t.gemini.chunkCalls()
    expect(chunks.map((c) => c.headers['X-Goog-Upload-Offset'])).toEqual(['0', String(8 * MIB), String(16 * MIB), String(24 * MIB), String(32 * MIB)])
    expect(chunks.at(-1)?.headers['X-Goog-Upload-Command']).toBe('upload, finalize')
    expect(Math.max(...chunks.map((c) => c.bodyBytes))).toBeLessThanOrEqual(GEMINI_UPLOAD_CHUNK_BYTES)
    expect(Math.max(0, ...concat.mock.results.map((r: { value: unknown }) => (r.value as Buffer).byteLength))).toBeLessThanOrEqual(GEMINI_UPLOAD_CHUNK_BYTES)
    concat.mockRestore()
    // No whole-object / default S3 reader was ever used.
    expect(readS3Object).not.toHaveBeenCalled()
    expect(openS3ObjectStream).not.toHaveBeenCalled()
  })

  it('follows the Files API lifecycle: start, chunks, finalize, ACTIVE wait, model call, DELETE', async () => {
    const t = setup({ gemini: { states: ['PROCESSING', 'ACTIVE'] } })
    await t.run(GEN_SOURCE)
    const order = t.gemini.calls.map((c) => `${c.method} ${c.url.replace(HOST, '')}`)
    expect(order[0]).toBe('POST /upload/v1beta/files')
    expect(order.slice(1, 2)).toEqual([`POST ${UPLOAD_URL.replace(HOST, '')}`])
    expect(order.slice(2)).toEqual(['GET /v1beta/files/abc', 'GET /v1beta/files/abc', 'POST /v1beta/models/gemini-3.5-flash:generateContent', 'DELETE /v1beta/files/abc'])
    // The key travels only in a header and never in a URL.
    expect(t.gemini.calls.every((c) => !c.url.includes(API_KEY))).toBe(true)
    // The model request references the uploaded file and carries no inline video.
    const model = JSON.parse(String((t.gemini.fetchImpl as any).mock.calls.find((c: any[]) => String(c[0]).includes(':generateContent'))[1].body))
    expect(model.contents[0].parts[1]).toEqual({ fileData: { mimeType: 'video/mp4', fileUri: `${HOST}/v1beta/files/abc` } })
    expect(JSON.stringify(model)).not.toContain('inlineData')
  })

  it('17/18. attempts Files API cleanup and treats a cleanup failure as a warning, not a Review failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const t = setup({ gemini: { deleteStatus: 500 } })
    const result = await t.run(GEN_SOURCE)
    expect(t.gemini.deleteCalls()).toHaveLength(1)
    expect(result.row.status).toBe('completed')
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'REMOTE_FILE_CLEANUP_FAILED' })])
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('REMOTE_FILE_CLEANUP_FAILED')
    expect(logged).not.toContain(API_KEY)
    expect(logged).not.toContain('files/abc')
    warn.mockRestore()
  })
})

describe('Video Review: failures are recorded as failed Reviews', () => {
  const failedRow = (db: ReturnType<typeof createReviewTestDb>) => reviews(db)[0]

  it('19. malformed provider output becomes a failed Review (and the remote file is still deleted)', async () => {
    for (const modelText of ['not json at all', JSON.stringify({ score: 'high' }), JSON.stringify({ score: 90, feedback: '', improvements: [] }), JSON.stringify([1, 2])]) {
      const t = setup({ gemini: { modelText } })
      await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 502, code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
      expect(failedRow(t.db)).toMatchObject({ status: 'failed', failure_code: 'invalid_evaluator_response', media_artifact_id: t.db.tables.media_artifacts[0].id })
      expect(t.gemini.deleteCalls()).toHaveLength(1)
    }
  })

  it('a Gemini upload failure is a failed Review with a normalized provider error', async () => {
    const t = setup({ gemini: { startStatus: 500 } })
    const error = await t.run(GEN_SOURCE).catch((e) => e)
    expect(error).toMatchObject({ status: 502, code: 'REVIEW_PROVIDER_ERROR' })
    expect(failedRow(t.db)).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(t.gemini.modelCalls()).toHaveLength(0)
    expect(String(error.message)).not.toContain(API_KEY)
    expect(String(error.message)).not.toContain('boom')
  })

  it('a Gemini file-processing timeout is a failed Review with provider_timeout, and cleanup is attempted', async () => {
    const t = setup({ gemini: { states: Array(60).fill('PROCESSING') } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 504, code: 'REVIEW_PROVIDER_TIMEOUT' })
    expect(failedRow(t.db)).toMatchObject({ status: 'failed', failure_code: 'provider_timeout' })
    expect(t.gemini.deleteCalls()).toHaveLength(1)
    expect(t.gemini.modelCalls()).toHaveLength(0)
  })

  it('a Gemini model failure is a failed Review', async () => {
    const t = setup({ gemini: { modelResponse: () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 }) } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 502, code: 'REVIEW_PROVIDER_ERROR' })
    expect(failedRow(t.db)).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(t.gemini.deleteCalls()).toHaveLength(1)
  })

  it('a rejected API key is reported without echoing it', async () => {
    const t = setup({ gemini: { modelResponse: () => new Response(JSON.stringify({ error: { message: `API key not valid ${API_KEY}`, details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 }) } })
    const error = await t.run(GEN_SOURCE).catch((e) => e)
    expect(error).toMatchObject({ code: 'REVIEW_PROVIDER_ERROR' })
    expect(JSON.stringify([error.message, failedRow(t.db)])).not.toContain(API_KEY)
  })

  it('a missing credential records a failed Review and calls nothing', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED', provider: 'gemini', executionMode: 'user_byok' })
    const t = setup()
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })
    expect(failedRow(t.db)).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
    expect(t.store.fullStreamOpens()).toBe(1) // only the registration hash read
  })

  it('20/22. stored bytes that no longer match the immutable hash abort BEFORE any upload is finalized or model call is made', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    const calls = t.gemini.calls.length
    // Same length, different content: the stored object changed after the artifact was registered.
    const tampered = Buffer.from(genMp4)
    tampered[tampered.length - 1] ^= 0xff
    t.store.objects[GEN_PATH] = bufferObject(tampered)
    const finalizeBefore = t.gemini.finalizeCalls().length
    const modelBefore = t.gemini.modelCalls().length

    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 422, code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(reviews(t.db)[1]).toMatchObject({ status: 'failed', failure_code: 'media_unavailable' })
    expect(t.gemini.finalizeCalls()).toHaveLength(finalizeBefore)
    expect(t.gemini.modelCalls()).toHaveLength(modelBefore)
    expect(t.gemini.calls.length).toBeGreaterThan(calls) // the upload had started...
    expect(t.gemini.deleteCalls().length).toBe(1) // ...but no remote file was ever created beyond the first Review's, which was cleaned up
  })

  it('a storage read failure while streaming is a failed Review without leaking the key', async () => {
    const t = setup({ storage: { failStreamOpensAfter: 2 } })
    await t.run(GEN_SOURCE, 1)
    const error = await t.run(GEN_SOURCE, 2).catch((e) => e)
    expect(error).toMatchObject({ status: 422, code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(JSON.stringify([error.message, reviews(t.db)[1]])).not.toContain(GEN_PATH)
    expect(reviews(t.db)[1]).toMatchObject({ status: 'failed', failure_code: 'media_unavailable' })
  })

  it('a storage failure during artifact registration creates no Review row', async () => {
    const t = setup({ storage: { failStreamOpensAfter: 0 } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 422, code: 'REVIEW_OUTPUT_UNAVAILABLE' })
    expect(reviews(t.db)).toHaveLength(0)
    expect(t.db.tables.media_artifacts ?? []).toHaveLength(0)
  })

  it('persistence failure on insert is a store error and no provider call is made', async () => {
    const t = setup({ db: { failReviewInsert: true } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })
    expect(t.gemini.fetchImpl).not.toHaveBeenCalled()
  })

  it('persistence failure on completion is recorded as a failed Review (never left running)', async () => {
    const t = setup({ db: { failUpdateToStatus: 'completed' } })
    await expect(t.run(GEN_SOURCE)).rejects.toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })
    expect(failedRow(t.db)).toMatchObject({ status: 'failed' })
    expect(t.gemini.deleteCalls()).toHaveLength(1)
  })
})

describe('Video Review: scope and context', () => {
  it('uses server relationships: Project context from the artifact scope, prompt only from the generation source', async () => {
    const t = setup()
    await t.run(GEN_SOURCE)
    const body = JSON.parse(String((t.gemini.fetchImpl as any).mock.calls.find((c: any[]) => String(c[0]).includes(':generateContent'))[1].body))
    const input = body.contents[0].parts[0].text as string
    expect(input).toContain('A calm sunrise over the sea')
    expect(input).toContain('Brand X launch')
    expect(input).toContain('"title":"Spring"')
    expect(input).not.toContain(GEN_PATH)
    expect(body.systemInstruction.parts[0].text).toMatch(/VISUALS only/)
  })

  it('a Library video with no Project sends an explicit empty context', async () => {
    const t = setup()
    await t.run(LIB_SOURCE)
    const body = JSON.parse(String((t.gemini.fetchImpl as any).mock.calls.find((c: any[]) => String(c[0]).includes(':generateContent'))[1].body))
    expect(body.contents[0].parts[0].text).toContain('PROJECT CONTEXT:\nNone')
    expect(body.contents[0].parts[0].text).toContain('SUBMITTED PROMPT:\nNone')
  })
})
