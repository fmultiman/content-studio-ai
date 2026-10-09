import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-050 (Image Review) — a Review executed where paid provider execution is not allowed must be refused BEFORE anything
// durable exists: no artifact, no provenance, no Review row, no provider call, no usage event.
// Mocked transport only: 0 paid calls.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn(), resolveContext: vi.fn(), resolveArtifact: vi.fn(), resolveMedia: vi.fn() }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('../context', () => ({
  buildRequestFingerprint: (attemptId: string, outputId: string, contextFingerprint: string) => `${attemptId}:${outputId}:${contextFingerprint}`,
  resolveImageReviewContext: mocks.resolveContext,
}))
vi.mock('@/lib/media-artifacts/image', () => ({ resolveImageArtifact: mocks.resolveArtifact }))
vi.mock('../media', () => ({ resolveAuthorizedReviewMedia: mocks.resolveMedia }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => ({}) }))

import { createImageReviewExecution } from '../service'
import type { ReviewExecutionProvider } from '../execution-provider'
import { createReviewTestDb } from './review-test-db'
import { restoreEnvironment, simulateEnvironment, type SimulatedEnvironment } from '@/lib/providers/__tests__/policy-env'

const USER = '11111111-1111-4111-8111-111111111111'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REQ = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const GOOD = JSON.stringify({ score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null })

const imageProvider = (id: 'openai' | 'gemini', execute: ReturnType<typeof vi.fn>): ReviewExecutionProvider => ({
  providerId: id,
  capabilities: new Set(['image_review'] as const),
  execute: execute as unknown as ReviewExecutionProvider['execute'],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: 'AIza-test-secret-key' })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => restoreEnvironment())

const BLOCKED: SimulatedEnvironment[] = ['preview', 'test', 'unknown', 'local']

describe.each(BLOCKED)('Review execution refused in %s', (environment) => {
  beforeEach(() => simulateEnvironment(environment))

  const rows = (db: ReturnType<typeof createReviewTestDb>, table: string) => (db.tables[table] ?? []) as unknown[]

  it.each(['openai', 'gemini'] as const)('13/14. Image Review (%s): refused, 0 provider calls, 0 rows, 0 usage events', async (providerId) => {
    const db = createReviewTestDb()
    const execute = vi.fn().mockResolvedValue({ rawText: GOOD, providerId, model: 'm', providerRequestId: 'resp-1', usage: { promptTokenCount: 1 }, warnings: [] })

    await expect(
      createImageReviewExecution({ userId: USER, attemptId, clientRequestId: REQ(1), db, providerId, providers: { [providerId]: imageProvider(providerId, execute) } }),
    ).rejects.toMatchObject({ status: 403, code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', details: { environment } })

    expect(execute).not.toHaveBeenCalled()
    expect(mocks.resolveContext).not.toHaveBeenCalled() // refused before any source/context lookup
    expect(mocks.resolveArtifact).not.toHaveBeenCalled()
    expect(mocks.resolveProvider).not.toHaveBeenCalled() // the credential was never read
    expect(rows(db, 'media_reviews')).toHaveLength(0)
    expect(rows(db, 'provider_usage_events')).toHaveLength(0) // 16
  })
})
