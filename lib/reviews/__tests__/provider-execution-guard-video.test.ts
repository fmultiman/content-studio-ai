import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FUTURE-050 (Video Review) — refused BEFORE the artifact, provenance and Review row exist; no Gemini call, no usage.
// Mocked transport only (virtual storage + mocked Gemini HTTP): 0 paid calls.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn() }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => { throw new Error('WHOLE_OBJECT_READ_FORBIDDEN') }),
  openS3ObjectStream: vi.fn(async () => { throw new Error('DEFAULT_S3_OPEN_FORBIDDEN') }),
}))

import { restoreEnvironment, simulateEnvironment, type SimulatedEnvironment } from '@/lib/providers/__tests__/policy-env'
import { API_KEY, GEN_SOURCE, setup } from './video-review-harness'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: API_KEY })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => restoreEnvironment())

const BLOCKED: SimulatedEnvironment[] = ['preview', 'test', 'unknown', 'local']

describe.each(BLOCKED)('Video Review refused in %s', (environment) => {
  beforeEach(() => simulateEnvironment(environment))

  it('15/16. refused before artifact, provenance and Review exist; 0 Gemini calls; 0 usage events', async () => {
    const t = setup()
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ status: 403, code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', details: { environment } })

    expect(t.gemini.calls).toHaveLength(0) // no Files upload, no generateContent
    expect(mocks.resolveProvider).not.toHaveBeenCalled() // the credential was never read
    for (const table of ['media_reviews', 'media_artifacts', 'media_artifact_provenance', 'provider_usage_events']) {
      expect(t.db.tables[table] ?? []).toHaveLength(0)
    }
  })
})

describe('Video Review still runs where the policy allows it', () => {
  it('21. Production runs end to end under mocks (1 model call, completed, usage recorded)', async () => {
    simulateEnvironment('production')
    const t = setup({ gemini: { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } } })
    const result = await t.run(GEN_SOURCE, 1)
    expect(result.row.status).toBe('completed')
    expect(t.gemini.modelCalls()).toHaveLength(1)
    expect((t.db.tables.provider_usage_events ?? []).length).toBeGreaterThan(0)
  })

  it('10. local with the explicit acknowledgement runs under mocks', async () => {
    simulateEnvironment('local', { CONTENT_STUDIO_ALLOW_LOCAL_PAID_PROVIDER_CALLS: 'i-accept-real-provider-costs' })
    const t = setup()
    const result = await t.run(GEN_SOURCE, 1)
    expect(result.row.status).toBe('completed')
    expect(t.gemini.modelCalls()).toHaveLength(1)
  })
})
