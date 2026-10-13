import { describe, expect, it, vi } from 'vitest'
import { buildOpenAIImageUsageEvents, extractOpenAIImageUsage, accountOpenAIImageEditUsage, type OpenAIImageUsageContext } from '../openai-image-usage'
import { createFakeDb } from '@/lib/__tests__/helpers/fake-image-db'
import { deriveProviderUsageCost, costInputFromRow } from '../pricing/derive'
import { toPricingVersion } from '../pricing/registry'

const mocks = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => mocks.db }))
const context: OpenAIImageUsageContext = {
  userId: 'owner', attemptId: '11111111-1111-4111-8111-111111111111', projectId: null, productionId: null,
  model: 'gpt-image-2', size: '1536x1024', quality: 'high', funding: 'user_byok', credentialSource: 'user',
  providerResponse: 'received', inputReferences: [{ id: 'reference', sha256: 'verified' }], responseId: 'req-test',
}
const reported = { input_tokens: 105, input_tokens_details: { text_tokens: 5, image_tokens: 100 }, output_tokens: 42, total_tokens: 147 }

describe('OpenAI Images edits accounting', () => {
  it('records aggregate input once, preserving text/image token details as evidence', () => {
    const events = buildOpenAIImageUsageEvents(context, reported)
    expect(events.map((event) => event.measurement)).toEqual([
      { quantity: 105, unit: 'input_tokens', source: 'provider_reported' }, { quantity: 42, unit: 'output_tokens', source: 'provider_reported' },
    ])
    expect(events[0].providerMetadata).toMatchObject({ funding: 'user_byok', usage: { inputTokens: 105, inputTextTokens: 5, inputImageTokens: 100, totalTokens: 147 } })
  })
  it('keeps unsupported or missing quantities unknown without inventing totals or zeros', () => {
    expect(extractOpenAIImageUsage({ input_tokens: -1, output_tokens: '10' })).toBeNull()
    expect(buildOpenAIImageUsageEvents(context, null)[0].measurement).toBeNull()
    expect(buildOpenAIImageUsageEvents(context, { input_tokens_details: { image_tokens: 100 } })[0].measurement).toBeNull()
    expect(buildOpenAIImageUsageEvents(context, { input_tokens: 0 })[0].measurement?.quantity).toBe(0)
  })
  it('captures output modality details without adding duplicate output rows', () => {
    const usage = { ...reported, output_tokens_details: { image_tokens: 40, text_tokens: 2 } }
    expect(extractOpenAIImageUsage(usage)).toMatchObject({ outputTokens: 42, outputImageTokens: 40, outputTextTokens: 2 })
    expect(buildOpenAIImageUsageEvents(context, usage)).toHaveLength(2)
  })
  it('records once across accounting retries and preserves input provenance', async () => {
    const db = createFakeDb({ image_generation_attempts: [{ id: context.attemptId, user_id: context.userId }] })
    mocks.db = db
    await accountOpenAIImageEditUsage(context, reported)
    await accountOpenAIImageEditUsage(context, reported)
    expect(db.tables.provider_usage_events).toHaveLength(2)
    expect(db.tables.image_generation_attempts[0].result_metadata).toMatchObject({ operation: 'image_to_image', inputReferences: context.inputReferences,
      usage_accounting: { ledger: 'recorded', usage: 'reported', rows: 2 } })
  })
  it('retains partial facts and provenance when both ledger writes fail', async () => {
    const db = createFakeDb({ image_generation_attempts: [{ id: context.attemptId, user_id: context.userId }] }, (table) => table === 'provider_usage_events' ? { message: 'mock failure' } : undefined)
    mocks.db = db
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await accountOpenAIImageEditUsage(context, { input_tokens: 105, input_tokens_details: { image_tokens: 100, text_tokens: 5 } })
    expect(db.tables.provider_usage_events).toHaveLength(0)
    expect(db.tables.image_generation_attempts[0].result_metadata).toMatchObject({ inputReferences: context.inputReferences,
      usage_accounting: { ledger: 'ledger_failed', usage: 'partial', reported_usage: { inputTokens: 105, inputImageTokens: 100 } } })
    log.mockRestore()
  })
  it('never prices image tokens using Chat rates even if generic OpenAI text rates exist', () => {
    const rate = toPricingVersion({ id: 'rate', provider: 'openai', model: 'gpt-image-2', usage_category: 'input', service_tier: 'standard', currency: 'USD', unit_name: 'tokens', unit_quantity: '1000000', price_amount: '99', effective_from: '2026-01-01T00:00:00Z', effective_to: null, effective_from_basis: 'observed_at_source', source_url: 'https://developers.openai.com/', source_label: 'mock', retrieved_at: '2026-01-01T00:00:00Z' })!
    const event = buildOpenAIImageUsageEvents(context, reported)[0]
    const input = costInputFromRow({ provider: event.provider, operation: event.operation, model: event.model, quantity: 105, unit: 'input_tokens', measurement_source: 'provider_reported', occurred_at: '2026-10-13T00:00:00Z', provider_metadata: { ...event.providerMetadata, usage: { serviceTier: 'default' } } })
    expect(deriveProviderUsageCost(input, [rate]).status).toBe('unavailable')
    expect(deriveProviderUsageCost(input, []).status).toBe('unavailable')
  })
})
