import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  findByClient: vi.fn(),
  findActive: vi.fn(),
  insertPending: vi.fn(),
  markRunning: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  resolveProvider: vi.fn(),
  resolveArtifact: vi.fn(),
  resolveMedia: vi.fn(),
}))

vi.mock('../context', () => ({
  buildRequestFingerprint: (attemptId: string, outputId: string, contextFingerprint: string) => `${attemptId}:${outputId}:${contextFingerprint}`,
  resolveImageReviewContext: mocks.resolveContext,
}))

vi.mock('../repository', () => ({
  findReviewByClientRequest: mocks.findByClient,
  findActiveReviewByAttempt: mocks.findActive,
  insertPendingReview: mocks.insertPending,
  markReviewRunning: mocks.markRunning,
  markReviewCompleted: mocks.markCompleted,
  markReviewFailed: mocks.markFailed,
}))

vi.mock('@/lib/credentials/provider-execution', () => ({
  resolveProviderExecution: mocks.resolveProvider,
}))

vi.mock('@/lib/media-artifacts/image', () => ({
  resolveImageArtifact: mocks.resolveArtifact,
}))

vi.mock('../media', () => ({
  resolveAuthorizedReviewMedia: mocks.resolveMedia,
}))

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleSupabase: () => ({}),
}))

import { createImageReviewExecution } from '../service'
import { ReviewProviderError, type ReviewExecutionProvider } from '../execution-provider'

const attemptId = '11111111-1111-4111-8111-111111111111'
const outputId = '22222222-2222-4222-8222-222222222222'
const clientRequestId = '33333333-3333-4333-8333-333333333333'

const resolved = {
  context: {
    schemaVersion: 1 as const,
    capturedAt: '2026-10-06T00:00:00.000Z',
    project: { id: '44444444-4444-4444-8444-444444444444', context: null, evaluationMode: 'default', identity: null },
    production: null,
  },
  subject: {
    attemptId,
    outputId,
    projectId: '44444444-4444-4444-8444-444444444444',
    productionId: null,
    submittedPrompt: 'A quiet studio portrait',
    provider: 'openai',
    model: 'gpt-image-1',
    submittedConfig: { size: '1024x1024' },
    sourceSnapshot: null,
    outputUrl: 'https://example.test/image.png',
    outputStoragePath: null,
    outputMetadata: {},
  },
  output: {
    storage_provider: null,
    storage_path: null,
    mime_type: 'image/png',
    file_size: null,
    metadata: {},
  },
  contextFingerprint: 'context-fingerprint',
}

function row(status: 'pending' | 'running' | 'completed' | 'failed') {
  return { id: '55555555-5555-4555-8555-555555555555', status, request_fingerprint: `${attemptId}:${outputId}:context-fingerprint`, media_artifact_id: '66666666-6666-4666-8666-666666666666' }
}

function validEvaluatorResult() {
  return { score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null }
}

describe('createImageReviewExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(resolved)
    mocks.resolveArtifact.mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' })
    mocks.findByClient.mockResolvedValue({ data: null, error: null })
    mocks.findActive.mockResolvedValue({ data: null, error: null })
    mocks.insertPending.mockResolvedValue({ data: row('pending'), error: null })
    mocks.markRunning.mockResolvedValue({ data: row('running'), error: null })
    mocks.markCompleted.mockResolvedValue({ data: row('completed'), error: null })
    mocks.markFailed.mockResolvedValue({ data: row('failed'), error: null })
    mocks.resolveProvider.mockResolvedValue({ status: 'ready', secret: 'test-key' })
  })

  it('creates one pending execution, runs the evaluator, and completes without approval semantics', async () => {
    const evaluator = vi.fn().mockResolvedValue(validEvaluatorResult())
    const result = await createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, evaluator })

    expect(evaluator).toHaveBeenCalledOnce()
    expect(mocks.insertPending).toHaveBeenCalledOnce()
    expect(mocks.markRunning).toHaveBeenCalledOnce()
    expect(mocks.markCompleted).toHaveBeenCalledOnce()
    expect(mocks.markCompleted.mock.calls[0][2].result_payload).not.toHaveProperty('approved')
    expect(result.replayed).toBe(false)
  })

  it('marks malformed evaluator output failed and never reports completion', async () => {
    const evaluator = vi.fn().mockResolvedValue({ score: 101, feedback: 'invalid', improvements: [] })

    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, evaluator }))
      .rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })

    expect(mocks.markFailed).toHaveBeenCalledOnce()
    expect(mocks.markCompleted).not.toHaveBeenCalled()
  })

  it('fails before evaluator dispatch when the provider is not configured', async () => {
    const evaluator = vi.fn()
    mocks.resolveProvider.mockResolvedValue({ status: 'missing' })

    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, evaluator }))
      .rejects.toMatchObject({ code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })

    expect(evaluator).not.toHaveBeenCalled()
    expect(mocks.markFailed).toHaveBeenCalledOnce()
  })

  it('replays the same client request without another evaluator call', async () => {
    mocks.findByClient.mockResolvedValue({ data: row('completed'), error: null })
    const evaluator = vi.fn()

    const result = await createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, evaluator })

    expect(result.replayed).toBe(true)
    expect(evaluator).not.toHaveBeenCalled()
    expect(mocks.insertPending).not.toHaveBeenCalled()
  })
})

describe('createImageReviewExecution provider boundary', () => {
  const geminiMedia = { kind: 'image' as const, artifactId: '66666666-6666-4666-8666-666666666666', mimeType: 'image/png', byteSize: 10, durationMs: null, load: async () => new Uint8Array([1]) }
  function geminiProvider(execute: ReturnType<typeof vi.fn>): ReviewExecutionProvider {
    return { providerId: 'gemini', capabilities: new Set(['image_review', 'video_review'] as const), execute: execute as unknown as ReviewExecutionProvider['execute'] }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(resolved)
    mocks.resolveArtifact.mockResolvedValue({ id: '66666666-6666-4666-8666-666666666666' })
    mocks.findByClient.mockResolvedValue({ data: null, error: null })
    mocks.findActive.mockResolvedValue({ data: null, error: null })
    mocks.insertPending.mockResolvedValue({ data: row('pending'), error: null })
    mocks.markRunning.mockResolvedValue({ data: row('running'), error: null })
    mocks.markCompleted.mockResolvedValue({ data: row('completed'), error: null })
    mocks.markFailed.mockResolvedValue({ data: row('failed'), error: null })
    mocks.resolveProvider.mockResolvedValue({ status: 'ready', secret: 'gemini-key' })
    mocks.resolveMedia.mockResolvedValue(geminiMedia)
  })

  it('keeps OpenAI as the default provider and records it distinctly', async () => {
    const evaluator = vi.fn().mockResolvedValue(validEvaluatorResult())
    await createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, evaluator })
    expect(mocks.resolveProvider.mock.calls[0][1]).toMatchObject({ provider: 'openai' })
    expect(mocks.markRunning.mock.calls[0][2]).toMatchObject({ evaluator_provider: 'openai' })
    expect(mocks.resolveMedia).not.toHaveBeenCalled()
  })

  it('executes Gemini through server-authorized artifact media with the Gemini credential and strict parsing', async () => {
    const execute = vi.fn().mockResolvedValue({ rawText: JSON.stringify(validEvaluatorResult()), providerId: 'gemini', model: 'gemini-3.5-flash', warnings: [] })
    const result = await createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(execute) } })

    expect(mocks.resolveProvider.mock.calls[0][1]).toMatchObject({ provider: 'gemini' })
    expect(mocks.resolveMedia.mock.calls[0][1]).toMatchObject({ userId: 'user-1', artifactId: '66666666-6666-4666-8666-666666666666', expectedKind: 'image' })
    expect(mocks.markRunning.mock.calls[0][2]).toMatchObject({ evaluator_provider: 'gemini', evaluator_model: 'gemini-3.5-flash' })
    const request = execute.mock.calls[0][0]
    expect(request.apiKey).toBe('gemini-key')
    expect(request.media).toEqual([geminiMedia])
    expect(request.responseSchema).toMatchObject({ type: 'object' })
    expect(request.input).not.toContain('example.test')
    expect(mocks.markCompleted).toHaveBeenCalledOnce()
    expect(result.replayed).toBe(false)
  })

  it('fails the Review when Gemini returns malformed or invalid-JSON output', async () => {
    const bad = vi.fn().mockResolvedValue({ rawText: JSON.stringify({ score: 150, feedback: 'x', improvements: [] }), providerId: 'gemini', model: 'm', warnings: [] })
    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(bad) } }))
      .rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    const notJson = vi.fn().mockResolvedValue({ rawText: 'not json', providerId: 'gemini', model: 'm', warnings: [] })
    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(notJson) } }))
      .rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(mocks.markCompleted).not.toHaveBeenCalled()
    expect(mocks.markFailed).toHaveBeenCalledTimes(2)
  })

  it('fails the Review with a normalized error when the Gemini provider fails', async () => {
    const execute = vi.fn().mockRejectedValue(new ReviewProviderError('timeout', 'Gemini model request timed out.'))
    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(execute) } }))
      .rejects.toMatchObject({ code: 'REVIEW_PROVIDER_TIMEOUT' })
    expect(mocks.markFailed.mock.calls[0][2]).toBe('provider_timeout')
    expect(mocks.markCompleted).not.toHaveBeenCalled()
  })

  it('rejects an unregistered Gemini model before any provider call', async () => {
    const prior = process.env.GEMINI_REVIEW_MODEL
    process.env.GEMINI_REVIEW_MODEL = 'gemini-not-registered'
    try {
      const execute = vi.fn()
      await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(execute) } }))
        .rejects.toMatchObject({ code: 'REVIEW_PROVIDER_UNSUPPORTED' })
      expect(execute).not.toHaveBeenCalled()
      expect(mocks.resolveMedia).not.toHaveBeenCalled()
    } finally {
      if (prior === undefined) delete process.env.GEMINI_REVIEW_MODEL
      else process.env.GEMINI_REVIEW_MODEL = prior
    }
  })

  it('fails closed without a Gemini credential and never falls back to the OpenAI key', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'provider_not_configured' })
    const execute = vi.fn()
    await expect(createImageReviewExecution({ userId: 'user-1', attemptId, clientRequestId, providerId: 'gemini', providers: { gemini: geminiProvider(execute) } }))
      .rejects.toMatchObject({ code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })
    expect(mocks.resolveProvider).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })
})
