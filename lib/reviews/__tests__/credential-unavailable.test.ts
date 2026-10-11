import { beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — Image Review when the credential store cannot be read: the Review is
// closed as a retryable provider_error (HTTP 503), is NOT reported as "provider not configured", and the evaluator is
// never called. Stubs only (in-memory database, fake credential resolver): 0 paid calls.

const mocks = vi.hoisted(() => ({ resolveContext: vi.fn(), resolveArtifact: vi.fn(), resolveProvider: vi.fn(), resolveMedia: vi.fn() }))

vi.mock('../context', () => ({
  buildRequestFingerprint: (attemptId: string, outputId: string, contextFingerprint: string) => `${attemptId}:${outputId}:${contextFingerprint}`,
  resolveImageReviewContext: mocks.resolveContext,
}))
vi.mock('@/lib/media-artifacts/image', () => ({ resolveImageArtifact: mocks.resolveArtifact }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('../media', () => ({ resolveAuthorizedReviewMedia: mocks.resolveMedia }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => ({}) }))

import { ProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { createImageReviewExecution } from '../service'
import type { ReviewExecutionProvider } from '../execution-provider'
import { createReviewTestDb } from './review-test-db'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const outputId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const artifactId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REQ = '00000000-0000-4000-8000-000000000001'

const resolved = {
  context: { schemaVersion: 1 as const, capturedAt: '2026-10-06T00:00:00.000Z', project: { id: PROJECT, context: null, evaluationMode: 'default', identity: null }, production: null },
  subject: {
    attemptId, outputId, projectId: PROJECT, productionId: null, submittedPrompt: 'A quiet studio portrait', provider: 'openai', model: 'gpt-image-1',
    submittedConfig: { size: '1024x1024' }, sourceSnapshot: null, outputUrl: 'https://example.test/image.png', outputStoragePath: null, outputMetadata: {},
  },
  output: { storage_provider: null, storage_path: null, mime_type: 'image/png', file_size: null, metadata: {} },
  contextFingerprint: 'context-fingerprint',
}

const evaluator = (execute: ReturnType<typeof vi.fn>): ReviewExecutionProvider => ({
  providerId: 'gemini',
  capabilities: new Set(['image_review', 'video_review'] as const),
  execute: execute as unknown as ReviewExecutionProvider['execute'],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveContext.mockResolvedValue(resolved)
  mocks.resolveArtifact.mockResolvedValue({ id: artifactId })
  mocks.resolveMedia.mockResolvedValue({ kind: 'image', artifactId, mimeType: 'image/png', byteSize: 10, durationMs: null, load: async () => new Uint8Array([1]) })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Image Review with an unreadable credential store', () => {
  it('closes the Review as provider_error, answers 503 REVIEW_STORE_UNAVAILABLE and never calls the evaluator', async () => {
    mocks.resolveProvider.mockRejectedValue(new ProviderCredentialUnavailableError('store_failure', 'gemini'))
    const db = createReviewTestDb()
    const execute = vi.fn()

    const failure = await createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ, db, providerId: 'gemini', providers: { gemini: evaluator(execute) } }).catch((e) => e)

    expect(failure).toMatchObject({ status: 503, code: 'REVIEW_STORE_UNAVAILABLE' })
    expect(failure.code).not.toBe('REVIEW_PROVIDER_NOT_CONFIGURED')
    expect(execute).not.toHaveBeenCalled()
    expect(db.tables.media_reviews).toHaveLength(1)
    expect(db.tables.media_reviews[0]).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
    expect(db.tables.provider_usage_events ?? []).toHaveLength(0)
  })

  it('a genuinely missing credential is still "provider not configured" (422)', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED', provider: 'gemini', executionMode: 'user_byok' })
    const db = createReviewTestDb()
    await expect(
      createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ, db, providerId: 'gemini', providers: { gemini: evaluator(vi.fn()) } }),
    ).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })
  })

  it('an unexpected resolver error is not swallowed as a credential problem', async () => {
    mocks.resolveProvider.mockRejectedValue(new Error('unexpected'))
    const db = createReviewTestDb()
    await expect(
      createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ, db, providerId: 'gemini', providers: { gemini: evaluator(vi.fn()) } }),
    ).rejects.toThrow('unexpected')
  })
})
