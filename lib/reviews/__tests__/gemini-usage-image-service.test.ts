import { beforeEach, describe, expect, it, vi } from 'vitest'

// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1 — Image Review -> usage ledger. The REAL repository, services and
// usage recorder run over the in-memory test database; Attempt/context/artifact resolution, the credential and the
// Gemini execution provider are stubs. 0 paid calls.

const mocks = vi.hoisted(() => ({ resolveContext: vi.fn(), resolveArtifact: vi.fn(), resolveProvider: vi.fn(), resolveMedia: vi.fn() }))

vi.mock('../context', () => ({
  buildRequestFingerprint: (attemptId: string, outputId: string, contextFingerprint: string) => `${attemptId}:${outputId}:${contextFingerprint}`,
  resolveImageReviewContext: mocks.resolveContext,
}))
vi.mock('@/lib/media-artifacts/image', () => ({ resolveImageArtifact: mocks.resolveArtifact }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('../media', () => ({ resolveAuthorizedReviewMedia: mocks.resolveMedia }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => ({}) }))

import { createImageReviewExecution } from '../service'
import { ReviewProviderError, type ReviewExecutionProvider } from '../execution-provider'
import { createReviewTestDb } from './review-test-db'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const outputId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const artifactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REQ = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const KEY = 'AIza-image-secret-key'

const resolved = {
  context: { schemaVersion: 1 as const, capturedAt: '2026-10-06T00:00:00.000Z', project: { id: PROJECT, context: null, evaluationMode: 'default', identity: null }, production: null },
  subject: {
    attemptId, outputId, projectId: PROJECT, productionId: null, submittedPrompt: 'A quiet studio portrait', provider: 'openai', model: 'gpt-image-1',
    submittedConfig: { size: '1024x1024' }, sourceSnapshot: null, outputUrl: 'https://example.test/image.png', outputStoragePath: null, outputMetadata: {},
  },
  output: { storage_provider: null, storage_path: null, mime_type: 'image/png', file_size: null, metadata: {} },
  contextFingerprint: 'context-fingerprint',
}
const USAGE = { promptTokenCount: 1_290, candidatesTokenCount: 233, thoughtsTokenCount: 96, totalTokenCount: 1_619, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 300 }, { modality: 'IMAGE', tokenCount: 990 }] }
const GOOD = JSON.stringify({ score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null })

function provider(execute: ReturnType<typeof vi.fn>): ReviewExecutionProvider {
  return { providerId: 'gemini', capabilities: new Set(['image_review', 'video_review'] as const), execute: execute as unknown as ReviewExecutionProvider['execute'] }
}
const ledger = (db: ReturnType<typeof createReviewTestDb>) => (db.tables.provider_usage_events ?? []) as Array<Record<string, any>>
const run = (db: ReturnType<typeof createReviewTestDb>, execute: ReturnType<typeof vi.fn>, n = 1) =>
  createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(n), db, providerId: 'gemini', providers: { gemini: provider(execute) } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveContext.mockResolvedValue(resolved)
  mocks.resolveArtifact.mockResolvedValue({ id: artifactId })
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: KEY })
  mocks.resolveMedia.mockResolvedValue({ kind: 'image', artifactId, mimeType: 'image/png', byteSize: 10, durationMs: null, load: async () => new Uint8Array([1]) })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Gemini Image Review usage events', () => {
  it('records provider_reported usage as image_review with attribution, funding and Review linkage', async () => {
    const db = createReviewTestDb()
    const execute = vi.fn().mockResolvedValue({ rawText: GOOD, providerId: 'gemini', model: 'gemini-3.5-flash', providerRequestId: 'resp-img-1', usage: USAGE, warnings: [] })
    const result = await run(db, execute)

    const rows = ledger(db)
    expect(Object.fromEntries(rows.map((r) => [r.unit, r.quantity]))).toEqual({ input_tokens: 1_290, output_tokens: 233, tokens: 96 })
    for (const row of rows) {
      expect(row).toMatchObject({
        user_id: USER, project_id: PROJECT, production_id: null, provider: 'gemini', transport: 'rest', operation: 'image_review', model: 'gemini-3.5-flash',
        resource_type: 'media_review', resource_id: result.row.id, provider_task_id: 'resp-img-1', measurement_source: 'provider_reported',
      })
      expect(row.provider_metadata).toMatchObject({ funding: 'user_byok', review: { id: result.row.id, media_type: 'image', artifact_id: artifactId } })
    }
    expect(rows.find((r) => r.unit === 'input_tokens')!.provider_metadata.usage.promptTokensDetails).toEqual([{ modality: 'TEXT', tokenCount: 300 }, { modality: 'IMAGE', tokenCount: 990 }])
    expect(JSON.stringify(rows)).not.toContain(KEY)
  })

  it('replay of the same clientRequestId: no provider call and no new usage event; a new Review adds a new observation', async () => {
    const db = createReviewTestDb()
    const execute = vi.fn().mockResolvedValue({ rawText: GOOD, providerId: 'gemini', model: 'm', usage: USAGE, warnings: [] })
    await run(db, execute, 1)
    const replay = await run(db, execute, 1)
    expect(replay.replayed).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(ledger(db)).toHaveLength(3)
    await run(db, execute, 2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(ledger(db)).toHaveLength(6)
  })

  it('response received, then strict parsing fails: usage preserved, Review failed', async () => {
    const db = createReviewTestDb()
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify({ score: 150, feedback: 'x', improvements: [] }), providerId: 'gemini', model: 'm', usage: USAGE, warnings: [] })
    await expect(run(db, execute)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(ledger(db)).toHaveLength(3)
    expect(db.tables.media_reviews[0]).toMatchObject({ status: 'failed', failure_code: 'invalid_evaluator_response' })
  })

  it('response received but rejected by the provider with usage: usage preserved and marked rejected', async () => {
    const db = createReviewTestDb()
    const error = Object.assign(new ReviewProviderError('invalid_response', 'Gemini did not complete the Review response.'), { usage: USAGE, providerRequestId: 'resp-blocked' })
    await expect(run(db, vi.fn().mockRejectedValue(error))).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(ledger(db)).toHaveLength(3)
    expect(ledger(db)[0].provider_metadata.provider_response).toBe('received_rejected')
    expect(ledger(db)[0].provider_task_id).toBe('resp-blocked')
  })

  it('a provider error without usage (timeout / HTTP error) records nothing', async () => {
    const db = createReviewTestDb()
    await expect(run(db, vi.fn().mockRejectedValue(new ReviewProviderError('timeout', 'Gemini model request timed out.')))).rejects.toMatchObject({ code: 'REVIEW_PROVIDER_TIMEOUT' })
    expect(ledger(db)).toHaveLength(0)
  })

  it('missing credential: provider never called, no usage event', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'missing' })
    const db = createReviewTestDb()
    const execute = vi.fn()
    await expect(run(db, execute)).rejects.toMatchObject({ code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })
    expect(execute).not.toHaveBeenCalled()
    expect(ledger(db)).toHaveLength(0)
  })

  it('a ledger failure does not change the Review and does not call the provider again', async () => {
    const db = createReviewTestDb({}, { failUsageWrite: true })
    const execute = vi.fn().mockResolvedValue({ rawText: GOOD, providerId: 'gemini', model: 'm', usage: USAGE, warnings: [] })
    const result = await run(db, execute)
    expect(result.row.status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAI Image Review is untouched', () => {
  it('the default OpenAI path and the legacy evaluator seam write no Gemini usage', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'openai', executionMode: 'user_byok', credentialSource: 'user', secret: 'sk-test' })
    const db = createReviewTestDb()
    const evaluator = vi.fn().mockResolvedValue({ score: 88, feedback: 'ok', improvements: [], refinedPrompt: null })
    await createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(1), db, evaluator })
    expect(evaluator).toHaveBeenCalledTimes(1)
    expect(ledger(db)).toHaveLength(0)
  })
})
