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

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleSupabase: () => ({}),
}))

import { createImageReviewExecution } from '../service'

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
  contextFingerprint: 'context-fingerprint',
}

function row(status: 'pending' | 'running' | 'completed' | 'failed') {
  return { id: '55555555-5555-4555-8555-555555555555', status, request_fingerprint: `${attemptId}:${outputId}:context-fingerprint` }
}

function validEvaluatorResult() {
  return { score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null }
}

describe('createImageReviewExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveContext.mockResolvedValue(resolved)
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
