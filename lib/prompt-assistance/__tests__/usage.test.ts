import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReviewTestDb } from '@/lib/reviews/__tests__/review-test-db'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { summarizeUsage, type UsageEventView } from '@/lib/usage/provider-usage'
import type { PromptAssistanceUsage } from '../contract'
import { promptAssistanceUsageEvents, promptAssistanceUsageKey, recordPromptAssistanceUsage, type PromptAssistanceUsageContext } from '../usage'

// FUTURE-054 — event cardinality, completeness and write policy of Prompt Assistance usage. Providers are never called.

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const PRODUCTION = '33333333-3333-4333-8333-333333333333'

const context = (usage: PromptAssistanceUsage | null, overrides: Partial<PromptAssistanceUsageContext> = {}): PromptAssistanceUsageContext => ({
  userId: USER, projectId: PROJECT, productionId: PRODUCTION, provider: 'openai', model: 'gpt-4o-mini', operation: 'create', funding: 'user_byok', usage, ...overrides,
})

const OPENAI: PromptAssistanceUsage = { inputTokens: 265, outputTokens: 74, totalTokens: 339, providerRequestId: 'chatcmpl-1', serviceTier: 'default' }
const GEMINI: PromptAssistanceUsage = {
  inputTokens: 273, outputTokens: 79, totalTokens: 432, thoughtsTokens: 80, cachedInputTokens: 0, providerRequestId: 'gem-1', serviceTier: 'standard',
}

describe('promptAssistanceUsageEvents — one execution, one row per provider-native billable dimension', () => {
  it.each([OPENAI, GEMINI, null])('labels video usage including thoughts and unknowns without altering billing facts', (usage) => {
    const provider = usage === GEMINI ? 'gemini' : 'openai'
    const image = promptAssistanceUsageEvents(context(usage, { provider }), 'same-invocation')
    const video = promptAssistanceUsageEvents(context(usage, { provider, mediaType: 'video' }), 'same-invocation')
    expect(video).toEqual(image.map((event) => ({ ...event, providerMetadata: { ...event.providerMetadata, media_type: 'video' } })))
    expect(promptAssistanceUsageEvents(context(usage, { provider, mediaType: 'image' }), 'same-invocation')).toEqual(image)
  })

  it('a usual request is exactly TWO rows (input + output) sharing one provider request id — the documented model, not a duplicate', () => {
    const events = promptAssistanceUsageEvents(context(OPENAI))
    expect(events.map((e) => [e.measurement?.unit, e.measurement?.quantity, e.measurement?.source, e.idempotencyKey, e.providerTaskId])).toEqual([
      ['input_tokens', 265, 'provider_reported', promptAssistanceUsageKey('chatcmpl-1', 'input'), 'chatcmpl-1'],
      ['output_tokens', 74, 'provider_reported', promptAssistanceUsageKey('chatcmpl-1', 'output'), 'chatcmpl-1'],
    ])
    // The historical keys are unchanged, so replays of already-recorded executions stay idempotent.
    expect(events[0].idempotencyKey).toBe('prompt_assistance:chatcmpl-1:input')
    expect(events[1].idempotencyKey).toBe('prompt_assistance:chatcmpl-1:output')
  })

  it('never stores the provider total as a row, so no category is counted twice', () => {
    const events = promptAssistanceUsageEvents(context(GEMINI, { provider: 'gemini', model: 'gemini-3.5-flash-lite' }))
    const quantities = events.map((e) => e.measurement?.quantity)
    expect(quantities).toEqual([273, 79, 80])
    expect(quantities).not.toContain(432)
    expect(quantities.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(432) // rows partition the provider total exactly
  })

  it('Gemini thinking tokens are a separate `thoughts` row, never merged into output', () => {
    const events = promptAssistanceUsageEvents(context(GEMINI, { provider: 'gemini', model: 'gemini-3.5-flash-lite' }))
    expect(events).toHaveLength(3)
    expect(events[2]).toMatchObject({ measurement: { quantity: 80, unit: 'tokens', source: 'provider_reported' }, idempotencyKey: 'prompt_assistance:gem-1:thoughts' })
    expect(events[2].providerMetadata).toMatchObject({ usage_category: 'thoughts' })
    expect(events[1].measurement?.quantity).toBe(79)
    expect(events[0].providerMetadata).not.toHaveProperty('usage_category')
  })

  it('missing or zero thinking usage adds no row — absent is not invented, a reported 0 is not a billable row', () => {
    const base = { inputTokens: 10, outputTokens: 5, totalTokens: 15, providerRequestId: 'g2' }
    expect(promptAssistanceUsageEvents(context(base, { provider: 'gemini' }))).toHaveLength(2)
    expect(promptAssistanceUsageEvents(context({ ...base, thoughtsTokens: 0 }, { provider: 'gemini' }))).toHaveLength(2)
  })

  it('OpenAI never gets a thinking row (completion_tokens already includes reasoning tokens)', () => {
    expect(promptAssistanceUsageEvents(context({ ...OPENAI, thoughtsTokens: undefined }))).toHaveLength(2)
  })

  it('unusable usage records ONE unknown event with a null quantity — never 0', () => {
    for (const usage of [null, { inputTokens: null, outputTokens: null, totalTokens: null } as PromptAssistanceUsage]) {
      const events = promptAssistanceUsageEvents(context(usage), 'fallback-1')
      expect(events).toHaveLength(1)
      expect(events[0].measurement).toBeNull()
      expect(toUsageEventRow(events[0])).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown', idempotency_key: 'prompt_assistance:fallback-1:unknown' })
    }
  })

  it('a reported zero is kept as a measured zero for that dimension, not dropped or promoted', () => {
    const events = promptAssistanceUsageEvents(context({ inputTokens: 12, outputTokens: 0, totalTokens: 12, providerRequestId: 'z' }))
    expect(events.map((e) => e.measurement?.quantity)).toEqual([12, 0])
  })

  it('records the service tier ONLY when the provider reported it, exactly as reported — never inferred', () => {
    const [reported] = promptAssistanceUsageEvents(context(OPENAI))
    expect(reported.providerMetadata?.usage).toMatchObject({ serviceTier: 'default', totalTokenCount: 339 })
    const [absent] = promptAssistanceUsageEvents(context({ inputTokens: 1, outputTokens: 1, totalTokens: 2, providerRequestId: 'n' }))
    expect(JSON.stringify(absent.providerMetadata)).not.toMatch(/serviceTier/)
    const [gemini] = promptAssistanceUsageEvents(context({ ...GEMINI, serviceTier: null }, { provider: 'gemini' }))
    expect(JSON.stringify(gemini.providerMetadata)).not.toMatch(/serviceTier/)
  })

  it('keeps the cached subset and tool-use descriptors as reported, only when reported', () => {
    const [event] = promptAssistanceUsageEvents(context({ ...OPENAI, cachedInputTokens: 128, toolUsePromptTokens: 9 }))
    expect(event.providerMetadata?.usage).toMatchObject({ cachedContentTokenCount: 128, toolUsePromptTokenCount: 9 })
    expect(JSON.stringify(promptAssistanceUsageEvents(context(OPENAI))[0].providerMetadata)).not.toMatch(/cachedContentTokenCount|toolUsePromptTokenCount/)
  })

  it('stores the validated workflow label as analytics metadata only: it changes no quantity, key, unit or attribution', () => {
    const plain = promptAssistanceUsageEvents(context(OPENAI))
    const labelled = promptAssistanceUsageEvents(context(OPENAI, { workflow: 'automatic' }))
    expect(labelled[0].providerMetadata).toMatchObject({ workflow: 'automatic' })
    expect(JSON.stringify(plain[0].providerMetadata)).not.toMatch(/workflow/)
    expect(labelled.map((e) => [e.measurement, e.idempotencyKey, e.userId, e.projectId, e.productionId, e.provider, e.model])).toEqual(
      plain.map((e) => [e.measurement, e.idempotencyKey, e.userId, e.projectId, e.productionId, e.provider, e.model]),
    )
  })

  it('attributes owner, scope, provider, model, operation and the truthful funding; metadata holds no prompt/Identity/response text', () => {
    const [event] = promptAssistanceUsageEvents(context(OPENAI, { operation: 'improve' }))
    expect(event).toMatchObject({ userId: USER, projectId: PROJECT, productionId: PRODUCTION, provider: 'openai', transport: 'api', operation: 'improve', model: 'gpt-4o-mini', resourceType: 'prompt_assistance' })
    expect(event.providerMetadata).toEqual({
      media_type: 'image', operation: 'improve', api: 'openai_chat_completions', funding: 'user_byok',
      usage: { totalTokenCount: 339, serviceTier: 'default' },
    })
    const rows = promptAssistanceUsageEvents(context({ ...GEMINI, ...({ text: 'SECRET PROMPT', apiKey: 'AIza-SECRET' } as object) }, { provider: 'gemini' })).map(toUsageEventRow)
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|AIza|http/i)
    expect(promptAssistanceUsageEvents(context(GEMINI, { provider: 'gemini' }))[0].providerMetadata).toMatchObject({ api: 'gemini_generate_content' })
  })
})

describe('recordPromptAssistanceUsage — write policy', () => {
  let error: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    error.mockClear()
  })

  it('writes the whole set in ONE statement; replaying the same execution is a no-op (no duplicate billable usage)', async () => {
    const db = createReviewTestDb()
    const gemini = context(GEMINI, { provider: 'gemini' })
    expect(await recordPromptAssistanceUsage(gemini, db as any)).toBe(true)
    expect(await recordPromptAssistanceUsage(gemini, db as any)).toBe(true)
    expect(db.tables.provider_usage_events).toHaveLength(3)
    expect(new Set(db.tables.provider_usage_events.map((r: any) => r.idempotency_key)).size).toBe(3)
  })

  it('two DIFFERENT executions are two observations, even with equal token counts', async () => {
    const db = createReviewTestDb()
    await recordPromptAssistanceUsage(context(OPENAI), db as any)
    await recordPromptAssistanceUsage(context({ ...OPENAI, providerRequestId: 'chatcmpl-2' }), db as any)
    expect(db.tables.provider_usage_events).toHaveLength(4)
  })

  it('a ledger failure is swallowed, retried once and logged by class only', async () => {
    const db = createReviewTestDb({}, { failUsageWrite: true })
    const spy = vi.spyOn(db, 'from')
    await expect(recordPromptAssistanceUsage(context(OPENAI), db as any)).resolves.toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/SECRET|usage ledger unavailable|chatcmpl/i)
  })

  it('a thrown ledger client is also swallowed', async () => {
    const db = { from: () => { throw new Error('boom AIza-SECRET') } } as any
    await expect(recordPromptAssistanceUsage(context(OPENAI), db)).resolves.toBe(false)
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/AIza|SECRET/)
  })
})

describe('the Usage history summary does not double-count a Prompt Assistance execution', () => {
  // The four executions of the FUTURE-053 Production smoke (their real provider-reported counts).
  const smoke: Array<[string, string, string, PromptAssistanceUsage]> = [
    ['openai', 'gpt-4o-mini', 'create', { inputTokens: 265, outputTokens: 74, totalTokens: 339, providerRequestId: 'a' }],
    ['openai', 'gpt-4o-mini', 'improve', { inputTokens: 285, outputTokens: 26, totalTokens: 311, providerRequestId: 'b' }],
    ['gemini', 'gemini-3.5-flash-lite', 'create', { inputTokens: 273, outputTokens: 79, totalTokens: 352, providerRequestId: 'c' }],
    ['gemini', 'gemini-3.5-flash-lite', 'improve', { inputTokens: 296, outputTokens: 56, totalTokens: 352, providerRequestId: 'd' }],
  ]

  it('8 rows for 4 executions summarize to one input group and one output group per provider, each counting 2 executions', () => {
    const views: UsageEventView[] = smoke.flatMap(([provider, model, operation, usage]) =>
      promptAssistanceUsageEvents(context(usage, { provider, model, operation })).map((event, index) => ({
        id: `${usage.providerRequestId}-${index}`, occurred_at: '2026-10-10T02:23:47Z', provider, transport: 'api', operation, model,
        quantity: event.measurement?.quantity ?? null, unit: event.measurement?.unit ?? null, measurement_source: 'provider_reported' as const, project_id: null, connection_id: null,
        usage_category: (event.providerMetadata as any)?.usage_category ?? null,
      })),
    )
    expect(views).toHaveLength(8)
    const groups = summarizeUsage(views).groups.map((g) => [g.provider, g.unit, g.quantity, g.events])
    expect(groups).toEqual([
      ['gemini', 'input_tokens', 569, 2],
      ['gemini', 'output_tokens', 135, 2],
      ['openai', 'input_tokens', 550, 2],
      ['openai', 'output_tokens', 100, 2],
    ])
  })
})
