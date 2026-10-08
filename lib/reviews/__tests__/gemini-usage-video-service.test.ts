import { beforeEach, describe, expect, it, vi } from 'vitest'

// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1 — Video Review -> usage ledger. Mocked transport only
// (virtual storage, mocked Gemini HTTP with realistic usageMetadata, in-memory tables): 0 paid calls.

const mocks = vi.hoisted(() => ({ resolveProvider: vi.fn() }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/storage/s3', () => ({
  readS3Object: vi.fn(async () => { throw new Error('WHOLE_OBJECT_READ_FORBIDDEN') }),
  openS3ObjectStream: vi.fn(async () => { throw new Error('DEFAULT_S3_OPEN_FORBIDDEN') }),
}))

import { REVIEW_STALE_AFTER_MS } from '../stale-policy'
import { geminiReviewUsageKey } from '@/lib/usage/gemini-review-usage'
import { API_KEY, GEN_SOURCE, OWNER, PRODUCTION, PROJECT, setup } from './video-review-harness'

const USAGE_METADATA = {
  promptTokenCount: 24_800, candidatesTokenCount: 640, thoughtsTokenCount: 310, totalTokenCount: 25_750, cachedContentTokenCount: 0,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 800 }, { modality: 'VIDEO', tokenCount: 24_000 }], serviceTier: 'standard',
}
const MIN = 60_000
const ledger = (t: ReturnType<typeof setup>) => (t.db.tables.provider_usage_events ?? []) as Array<Record<string, any>>
const byUnit = (rows: Array<Record<string, any>>) => Object.fromEntries(rows.map((r) => [r.unit === 'tokens' ? 'thoughts' : r.unit, r.quantity]))

beforeEach(() => {
  mocks.resolveProvider.mockReset()
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: API_KEY })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Video Review usage events', () => {
  it('a completed Review records provider_reported token usage with full attribution and Review linkage', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    const result = await t.run(GEN_SOURCE, 1)

    const rows = ledger(t)
    expect(byUnit(rows)).toEqual({ input_tokens: 24_800, output_tokens: 640, thoughts: 310 })
    for (const row of rows) {
      expect(row).toMatchObject({
        user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, provider: 'gemini', transport: 'rest', operation: 'video_review',
        model: 'gemini-3.5-flash', resource_type: 'media_review', resource_id: result.row.id, provider_task_id: 'resp-1', measurement_source: 'provider_reported',
      })
      expect(row.provider_metadata).toMatchObject({ funding: 'user_byok', credential_source: 'user', review: { id: result.row.id, media_type: 'video', artifact_id: result.row.media_artifact_id } })
    }
    expect(rows[0].provider_metadata.usage).toMatchObject({ totalTokenCount: 25_750, serviceTier: 'standard', promptTokensDetails: [{ modality: 'TEXT', tokenCount: 800 }, { modality: 'VIDEO', tokenCount: 24_000 }] })
    // No combined total row, no money.
    expect(rows.some((r) => r.quantity === 25_750)).toBe(false)
    expect(JSON.stringify(rows)).not.toMatch(/cost|price|usd|brl|credits"/i)
  })

  it('exactly one Gemini model call yields exactly one usage set', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await t.run(GEN_SOURCE, 1)
    expect(t.gemini.modelCalls()).toHaveLength(1)
    expect(ledger(t)).toHaveLength(3)
  })

  it('a response without usageMetadata records ONE unknown event, never zero', async () => {
    const t = setup()
    await t.run(GEN_SOURCE, 1)
    expect(ledger(t)).toHaveLength(1)
    expect(ledger(t)[0]).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown', operation: 'video_review' })
  })

  it('same clientRequestId replay: no provider call and NO new usage event', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await t.run(GEN_SOURCE, 1)
    const calls = t.gemini.calls.length
    const replay = await t.run(GEN_SOURCE, 1)
    expect(replay.replayed).toBe(true)
    expect(t.gemini.calls).toHaveLength(calls)
    expect(ledger(t)).toHaveLength(3)
  })

  it('an intentional new Review is a new provider execution and a new usage observation (same artifact, different Review id)', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    const first = await t.run(GEN_SOURCE, 1)
    const second = await t.run(GEN_SOURCE, 2)
    expect(t.gemini.modelCalls()).toHaveLength(2)
    expect(ledger(t)).toHaveLength(6)
    expect(new Set(ledger(t).map((r) => r.resource_id))).toEqual(new Set([first.row.id, second.row.id]))
    expect(new Set(ledger(t).map((r) => r.idempotency_key)).size).toBe(6)
  })

  it('a stale Review that is recovered consumed nothing now: recovery adds no usage, the replacement adds its own', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await t.run(GEN_SOURCE, 1)
    const stale = t.db.tables.media_reviews[0]
    Object.assign(stale, { status: 'running', updated_at: new Date(Date.now() - REVIEW_STALE_AFTER_MS - 10 * MIN).toISOString() })
    const before = ledger(t).length
    await t.run(GEN_SOURCE, 2)
    expect(stale.failure_code).toBe('execution_stale')
    expect(ledger(t).length).toBe(before + 3)
    expect(ledger(t).filter((r) => r.resource_id === stale.id)).toHaveLength(3) // only the original execution's rows
  })
})

describe('when usage is (not) recorded', () => {
  it('provider response received, then strict Review parsing fails: the factual usage is preserved and the Review is failed', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA, modelText: 'not json' } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(byUnit(ledger(t))).toEqual({ input_tokens: 24_800, output_tokens: 640, thoughts: 310 })
    expect(t.db.tables.media_reviews[0]).toMatchObject({ status: 'failed', failure_code: 'invalid_evaluator_response' })
    expect(ledger(t)[0].provider_metadata.provider_response).toBe('received')
  })

  it('response received but rejected by the provider layer (truncated at MAX_TOKENS) with usage: usage preserved, marked as rejected', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA, finishReason: 'MAX_TOKENS' } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(byUnit(ledger(t))).toEqual({ input_tokens: 24_800, output_tokens: 640, thoughts: 310 })
    expect(ledger(t)[0].provider_metadata.provider_response).toBe('received_rejected')
    expect(ledger(t)[0].provider_task_id).toBe('resp-1')
  })

  it('a provider HTTP error carries no usage: no usage event', async () => {
    const t = setup({ gemini: { modelResponse: () => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }) } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_PROVIDER_ERROR' })
    expect(ledger(t)).toHaveLength(0)
  })

  it('missing Gemini credential: no provider call and no usage event; the recorded failure is unchanged', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'missing' })
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ status: 422, code: 'REVIEW_PROVIDER_NOT_CONFIGURED' })
    expect(t.gemini.calls).toHaveLength(0)
    expect(ledger(t)).toHaveLength(0)
    expect(t.db.tables.media_reviews[0]).toMatchObject({ status: 'failed', failure_code: 'provider_error' })
  })

  it('a failure before generateContent (Files API upload rejected) records no usage', async () => {
    const t = setup({ gemini: { startStatus: 500, usageMetadata: USAGE_METADATA } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_PROVIDER_ERROR' })
    expect(t.gemini.modelCalls()).toHaveLength(0)
    expect(ledger(t)).toHaveLength(0)
  })

  it('an in-flight conflict (409) makes no provider call and no usage event', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await t.run(GEN_SOURCE, 1)
    Object.assign(t.db.tables.media_reviews[0], { status: 'running', updated_at: new Date().toISOString() })
    const before = ledger(t).length
    await expect(t.run(GEN_SOURCE, 2)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IN_PROGRESS' })
    expect(ledger(t)).toHaveLength(before)
  })
})

describe('ledger failure semantics', () => {
  it('a ledger write failure never changes the Review result and never triggers another provider call', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA }, db: { failUsageWrite: true } })
    const result = await t.run(GEN_SOURCE, 1)
    expect(result.row.status).toBe('completed')
    expect(t.gemini.modelCalls()).toHaveLength(1) // not retried to repair accounting
    expect(ledger(t)).toHaveLength(0)
  })

  it('a ledger failure after a parse failure still surfaces the original Review error', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA, modelText: 'not json' }, db: { failUsageWrite: true } })
    await expect(t.run(GEN_SOURCE, 1)).rejects.toMatchObject({ code: 'REVIEW_INVALID_EVALUATOR_RESPONSE' })
    expect(t.gemini.modelCalls()).toHaveLength(1)
  })
})

describe('secrets and history', () => {
  it('persists no API key, signed URL or provider secret', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA } })
    await t.run(GEN_SOURCE, 1)
    const text = JSON.stringify(ledger(t))
    expect(text).not.toContain(API_KEY)
    expect(text).not.toMatch(/AIza|X-Amz|https?:\/\/|x-goog/i)
  })

  it('historical Reviews are not backfilled: an existing completed Review with no recorded usage stays unknown (no rows)', async () => {
    const t = setup({ gemini: { usageMetadata: USAGE_METADATA }, db: { failUsageWrite: true } })
    const historical = await t.run(GEN_SOURCE, 1) // completed while no usage could be stored
    expect(ledger(t)).toHaveLength(0)
    await t.run(GEN_SOURCE, 1) // replay of the historical Review
    expect(ledger(t)).toHaveLength(0)
    expect(ledger(t).filter((r) => r.resource_id === historical.row.id)).toHaveLength(0)
  })

  it('the idempotency key is derived from the Review id only', () => {
    expect(geminiReviewUsageKey('r1', 'input_tokens')).toBe('gemini_review:r1:input_tokens')
  })
})
