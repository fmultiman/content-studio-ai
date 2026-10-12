import { describe, expect, it, vi } from 'vitest'
import { extractGeminiUsage, type GeminiUsage } from '@/lib/providers/gemini/usage'
import {
  GEMINI_IMAGE_USAGE_OPERATION,
  GEMINI_IMAGE_USAGE_RESOURCE_TYPE,
  describeGeminiImageUsage,
  geminiImageUsageEvents,
  geminiImageUsageKey,
  markGeminiImageAttemptAccounting,
  recordGeminiImageUsage,
  type GeminiImageUsageContext,
} from '@/lib/usage/gemini-image-usage'
import { toUsageEventRow } from '@/lib/usage/provider-usage-recorder'
import { USAGE_CATEGORIES, formatUsageQuantity, operationLabel, summarizeUsage, type UsageEventView } from '@/lib/usage/provider-usage'
import { costInputFromRow, deriveProviderUsageCost } from '@/lib/usage/pricing/derive'
import { toPricingVersion, type PricingVersion } from '@/lib/usage/pricing/registry'

// FUTURE-064 Slice C — pure unit tests for Gemini image usage accounting. No network, no database, no provider.

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const context = (overrides: Partial<GeminiImageUsageContext> = {}): GeminiImageUsageContext => ({
  userId: 'user-1', attemptId: ATTEMPT, projectId: 'project-1', productionId: null,
  modelAlias: 'gemini-nb-2.1', providerModel: 'gemini-nano-banana-2.1', aspectRatio: '1:1', imageSize: '1K',
  funding: 'user_byok', credentialSource: 'user', providerResponse: 'received', responseId: 'resp-1', modelVersion: 'v-1', ...overrides,
})
const usageOf = (raw: Record<string, unknown> | null): GeminiUsage | null => extractGeminiUsage(raw)

// What Nano Banana 2.1 reports for a text prompt that produced one 1K image (image tokens are IMAGE-modality output).
const IMAGE_ONLY = {
  promptTokenCount: 14, candidatesTokenCount: 1290, totalTokenCount: 1304, serviceTier: 'standard',
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 14 }],
  candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }],
}
const byKey = (events: ReturnType<typeof geminiImageUsageEvents>) => Object.fromEntries(events.map((event) => [event.idempotencyKey.split(':')[2], event]))

describe('geminiImageUsageEvents — what is recorded', () => {
  it('Nano Banana 2.1 with IMAGE output: one input row and one IMAGE-output row linked to the Attempt, and nothing else', () => {
    const events = geminiImageUsageEvents(context(), usageOf(IMAGE_ONLY))
    expect(events.map((event) => event.idempotencyKey)).toEqual([`gemini_image:${ATTEMPT}:input_tokens`, `gemini_image:${ATTEMPT}:image_output_tokens`])
    const rows = byKey(events)
    expect(rows.input_tokens.measurement).toEqual({ quantity: 14, unit: 'input_tokens', source: 'provider_reported' })
    expect(rows.image_output_tokens.measurement).toEqual({ quantity: 1290, unit: 'tokens', source: 'provider_reported' })
    expect(rows.image_output_tokens.providerMetadata?.usage_category).toBe('image_output')
    for (const event of events) {
      expect(event).toMatchObject({
        userId: 'user-1', projectId: 'project-1', provider: 'gemini', transport: 'rest', operation: GEMINI_IMAGE_USAGE_OPERATION,
        resourceType: GEMINI_IMAGE_USAGE_RESOURCE_TYPE, resourceId: ATTEMPT, providerTaskId: 'resp-1', model: 'gemini-nano-banana-2.1',
      })
    }
    // total is a reading of the other rows: it is never a row (nothing counted twice)
    expect(events.some((event) => event.measurement?.quantity === 1304)).toBe(false)
  })

  it('Nano Banana 2 Lite: the official Lite id is the ledger model, the alias travels in metadata', () => {
    const events = geminiImageUsageEvents(context({ modelAlias: 'gemini-nb-lite', providerModel: 'gemini-3.1-flash-lite-image' }), usageOf(IMAGE_ONLY))
    expect(events.every((event) => event.model === 'gemini-3.1-flash-lite-image')).toBe(true)
    const metadata = events[0].providerMetadata as any
    expect(metadata.image_generation).toMatchObject({ attempt_id: ATTEMPT, model_alias: 'gemini-nb-lite', provider_model: 'gemini-3.1-flash-lite-image', aspect_ratio: '1:1', image_size: '1K', response_modalities: ['IMAGE'] })
    expect(metadata).toMatchObject({ api: 'gemini_generate_content', funding: 'user_byok', credential_source: 'user', provider_response: 'received' })
  })

  it('mixed modalities stay separate: TEXT output is plain output_tokens, IMAGE output its own dimension, thinking its own row', () => {
    const events = geminiImageUsageEvents(context(), usageOf({
      promptTokenCount: 20, candidatesTokenCount: 1330, thoughtsTokenCount: 215, totalTokenCount: 1565,
      candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 40 }, { modality: 'IMAGE', tokenCount: 1290 }],
    }))
    const rows = byKey(events)
    expect(Object.keys(rows).sort()).toEqual(['image_output_tokens', 'input_tokens', 'text_output_tokens', 'thoughts_tokens'])
    expect(rows.text_output_tokens.measurement).toEqual({ quantity: 40, unit: 'output_tokens', source: 'provider_reported' })
    expect(rows.image_output_tokens.measurement).toEqual({ quantity: 1290, unit: 'tokens', source: 'provider_reported' })
    expect(rows.thoughts_tokens.measurement).toEqual({ quantity: 215, unit: 'tokens', source: 'provider_reported' })
    expect(rows.thoughts_tokens.providerMetadata?.usage_category).toBe('thoughts')
    expect(rows.text_output_tokens.providerMetadata?.usage_category).toBeUndefined()
    // IMAGE tokens are never the output_tokens unit (that unit is priced as text output)
    expect(events.filter((event) => event.measurement?.unit === 'output_tokens').map((event) => event.measurement?.quantity)).toEqual([40])
  })

  it('splits repeated modality entries by modality and sums them per modality', () => {
    const events = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 5, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1000 }, { modality: 'IMAGE', tokenCount: 290 }] }))
    expect(byKey(events).image_output_tokens.measurement?.quantity).toBe(1290)
  })

  it('output tokens WITHOUT a modality breakdown are recorded as unattributed — never assumed image, never plain output_tokens', () => {
    const events = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 14, candidatesTokenCount: 1290 }))
    const rows = byKey(events)
    expect(Object.keys(rows).sort()).toEqual(['input_tokens', 'output_unattributed_tokens'])
    expect(rows.output_unattributed_tokens.measurement).toEqual({ quantity: 1290, unit: 'tokens', source: 'provider_reported' })
    expect(rows.output_unattributed_tokens.providerMetadata?.usage_category).toBe('output_unattributed')
    expect(events.some((event) => event.measurement?.unit === 'output_tokens')).toBe(false)
  })

  it('missing usageMetadata records ONE unknown event: null quantity, no unit, never a zero', () => {
    for (const raw of [null, {}, { promptTokensDetails: [] }, { serviceTier: 'standard' }] as const) {
      const events = geminiImageUsageEvents(context(), usageOf(raw as Record<string, unknown> | null))
      expect(events).toHaveLength(1)
      expect(events[0].measurement).toBeNull()
      expect(events[0].idempotencyKey).toBe(`gemini_image:${ATTEMPT}:unknown`)
      expect(toUsageEventRow(events[0])).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown' })
    }
  })

  it('partial usage records only what was reported: no invented output, no zero', () => {
    const onlyInput = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 14 }))
    expect(onlyInput.map((event) => event.idempotencyKey)).toEqual([`gemini_image:${ATTEMPT}:input_tokens`])
    const onlyOutput = geminiImageUsageEvents(context(), usageOf({ candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] }))
    expect(onlyOutput.map((event) => event.idempotencyKey)).toEqual([`gemini_image:${ATTEMPT}:image_output_tokens`])
    expect(describeGeminiImageUsage(usageOf({ promptTokenCount: 14 })).completeness).toBe('partial')
    expect(describeGeminiImageUsage(usageOf(IMAGE_ONLY)).completeness).toBe('reported')
    expect(describeGeminiImageUsage(null).completeness).toBe('unknown')
  })

  it('reported zeros add no row (a zero thinking or IMAGE count is not a measurement worth a row) and are never turned into rows from absent fields', () => {
    const events = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 9, thoughtsTokenCount: 0, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 0 }] }))
    expect(events.map((event) => event.idempotencyKey)).toEqual([`gemini_image:${ATTEMPT}:input_tokens`])
    // a reported zero PROMPT count is a real measurement and is kept
    const zeroPrompt = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 0, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] }))
    expect(byKey(zeroPrompt).input_tokens.measurement?.quantity).toBe(0)
  })

  it('never estimates image tokens from image size, dimensions or count', () => {
    const events = geminiImageUsageEvents(context({ aspectRatio: '16:9', imageSize: '4K' }), usageOf({ promptTokenCount: 14 }))
    expect(events.some((event) => event.idempotencyKey.includes('image_output'))).toBe(false)
    expect(events.every((event) => event.measurement?.source === 'provider_reported')).toBe(true)
  })

  it('modalities other than IMAGE and TEXT are preserved in metadata only, not turned into a row', () => {
    const events = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 5, candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: 80 }] }))
    expect(events.map((event) => event.idempotencyKey)).toEqual([`gemini_image:${ATTEMPT}:input_tokens`])
    expect((events[0].providerMetadata as any).usage.candidatesTokensDetails).toEqual([{ modality: 'AUDIO', tokenCount: 80 }])
  })

  it('carries the service tier and descriptors exactly as reported, and only when reported', () => {
    const withTier = geminiImageUsageEvents(context(), usageOf({ ...IMAGE_ONLY, cachedContentTokenCount: 4, toolUsePromptTokenCount: 2 }))
    expect((withTier[0].providerMetadata as any).usage).toMatchObject({ serviceTier: 'standard', cachedContentTokenCount: 4, toolUsePromptTokenCount: 2, totalTokenCount: 1304, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 14 }] })
    const withoutTier = geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 14, candidatesTokenCount: 1290 }))
    expect((withoutTier[0].providerMetadata as any).usage.serviceTier).toBeUndefined()
    expect(JSON.stringify(withoutTier)).not.toMatch(/standard|flex|priority/)
  })

  it('classifies a rejected-but-received response and keeps the reason', () => {
    const events = geminiImageUsageEvents(context({ providerResponse: 'received_rejected', rejectedAs: 'content_blocked' }), usageOf({ promptTokenCount: 9 }))
    expect(events[0].providerMetadata).toMatchObject({ provider_response: 'received_rejected', rejected_as: 'content_blocked' })
  })

  it('reports how complete the modality attribution is', () => {
    expect(describeGeminiImageUsage(usageOf(IMAGE_ONLY)).attribution).toBe('by_modality')
    expect(describeGeminiImageUsage(usageOf({ promptTokenCount: 1, candidatesTokenCount: 1330, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] })).attribution).toBe('by_modality_incomplete')
    expect(describeGeminiImageUsage(usageOf({ promptTokenCount: 1, candidatesTokenCount: 5 })).attribution).toBe('unattributed')
    expect(describeGeminiImageUsage(usageOf({ promptTokenCount: 1 })).attribution).toBe('none')
  })

  it('keys are deterministic per Attempt and distinct across Attempts and dimensions', () => {
    const a = geminiImageUsageEvents(context(), usageOf(IMAGE_ONLY)).map((event) => event.idempotencyKey)
    const again = geminiImageUsageEvents(context(), usageOf(IMAGE_ONLY)).map((event) => event.idempotencyKey)
    const other = geminiImageUsageEvents(context({ attemptId: '22222222-2222-4222-8222-222222222222' }), usageOf(IMAGE_ONLY)).map((event) => event.idempotencyKey)
    expect(again).toEqual(a)
    expect(new Set([...a, ...other]).size).toBe(a.length + other.length)
    expect(geminiImageUsageKey(ATTEMPT, 'unknown')).toBe(`gemini_image:${ATTEMPT}:unknown`)
  })

  it('every event is a valid ledger row (no throw) and carries no prompt, key or response text', () => {
    for (const raw of [IMAGE_ONLY, { promptTokenCount: 3 }, null]) {
      for (const event of geminiImageUsageEvents(context(), usageOf(raw))) {
        const row = toUsageEventRow(event)
        expect(JSON.stringify(row)).not.toMatch(/prompt text|AIza|sk-|a red fox/)
        expect(row.provider_metadata).not.toHaveProperty('prompt')
      }
    }
  })
})

describe('the price boundary — image output is never priced at a text rate, and unknown cost is never zero', () => {
  const versions: PricingVersion[] = ['input', 'output', 'cached_input'].map((category, index) => toPricingVersion({
    id: `v-${index}`, provider: 'gemini', model: 'gemini-nano-banana-2.1', usage_category: category, service_tier: 'standard', currency: 'USD',
    unit_name: 'tokens', unit_quantity: '1000000', price_amount: category === 'input' ? '1.50' : '7.50', effective_from: '2026-01-01T00:00:00Z', effective_to: null,
    effective_from_basis: 'official_effective_date', source_url: 'https://example.test/pricing', source_label: 'test', retrieved_at: '2026-10-01T00:00:00Z', notes: null,
  })!)
  const costFor = (event: ReturnType<typeof geminiImageUsageEvents>[number], registry: PricingVersion[]) =>
    deriveProviderUsageCost(costInputFromRow({ ...toUsageEventRow(event), occurred_at: '2026-10-11T12:00:00Z' }), registry)

  it('with NO pricing for the image models (today) every row is unavailable — never an amount, never 0', () => {
    const events = geminiImageUsageEvents(context(), usageOf({ ...IMAGE_ONLY, thoughtsTokenCount: 10, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }, { modality: 'IMAGE', tokenCount: 1290 }] }))
    for (const event of events) {
      const cost = costFor(event, [])
      expect(cost.status).toBe('unavailable')
      expect(cost).not.toHaveProperty('amount')
    }
    expect(costFor(geminiImageUsageEvents(context(), null)[0], [])).toEqual({ status: 'unavailable', reason: 'usage_unknown' })
  })

  it('even if only TEXT rates exist for the model, IMAGE-output rows are NOT priced as text and unattributed rows stay unpriced', () => {
    const rows = byKey(geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 14, serviceTier: 'standard', candidatesTokenCount: 1295, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }, { modality: 'IMAGE', tokenCount: 1290 }] })))
    // FUTURE-064 Slice D: IMAGE output resolves to its own `image_output` dimension, which this text-only registry lacks
    expect(costFor(rows.image_output_tokens, versions)).toEqual({ status: 'unavailable', reason: 'no_pricing_for_category' })
    expect(costFor(rows.input_tokens, versions).status).toBe('estimated') // ordinary text input has a (hypothetical) rate
    expect(costFor(rows.text_output_tokens, versions).status).toBe('estimated') // genuine TEXT output, priced as text output
    const unattributed = byKey(geminiImageUsageEvents(context(), usageOf({ promptTokenCount: 14, candidatesTokenCount: 1290, serviceTier: 'standard' })))
    expect(costFor(unattributed.output_unattributed_tokens, versions)).toEqual({ status: 'unavailable', reason: 'output_modality_unattributed' })
  })
})

describe('presentation vocabulary', () => {
  it('knows the new categories and labels them without merging them with text output or thinking', () => {
    expect([...USAGE_CATEGORIES]).toEqual(['thoughts', 'image_output', 'output_unattributed'])
    expect(formatUsageQuantity({ quantity: 1290, unit: 'tokens', usage_category: 'image_output' })).toBe('1.290 tokens de saída de imagem')
    expect(formatUsageQuantity({ quantity: 1, unit: 'tokens', usage_category: 'image_output' })).toBe('1 token de saída de imagem')
    expect(formatUsageQuantity({ quantity: 5, unit: 'tokens', usage_category: 'output_unattributed' })).toMatch(/modalidade não informada/)
    expect(formatUsageQuantity({ quantity: null, unit: null, usage_category: 'image_output' })).toBe('Uso não informado')
    expect(operationLabel('image_generation')).toBe('Geração de imagem')
    const view = (unit: UsageEventView['unit'], quantity: number, usage_category: UsageEventView['usage_category']): UsageEventView => ({
      id: `${unit}-${usage_category}`, occurred_at: '2026-10-11T00:00:00Z', provider: 'gemini', transport: 'rest', operation: 'image_generation', model: 'gemini-nano-banana-2.1',
      quantity, unit, measurement_source: 'provider_reported', project_id: null, connection_id: null, usage_category,
    })
    const summary = summarizeUsage([view('output_tokens', 40, null), view('tokens', 1290, 'image_output'), view('tokens', 215, 'thoughts'), view('tokens', 1290, 'image_output')])
    expect(summary.groups.map((g) => [g.unit, g.usageCategory, g.quantity]).sort()).toEqual([['output_tokens', null, 40], ['tokens', 'image_output', 2580], ['tokens', 'thoughts', 215]])
  })
})

describe('recordGeminiImageUsage — ledger outcome classification (no database)', () => {
  const dbReturning = (error: unknown, calls: unknown[] = []) => ({
    from: (table: string) => ({ upsert: (rows: unknown, options: unknown) => { calls.push({ table, rows, options }); return Promise.resolve({ error }) } }),
  }) as any

  it('writes all rows in ONE upsert with ignoreDuplicates on the idempotency key', async () => {
    const calls: any[] = []
    const accounting = await recordGeminiImageUsage(context(), usageOf(IMAGE_ONLY), dbReturning(null, calls))
    expect(accounting).toMatchObject({ ledger: 'recorded', rows: 2, usageUnknown: false, completeness: 'reported' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'provider_usage_events', options: { onConflict: 'idempotency_key', ignoreDuplicates: true } })
    expect(calls[0].rows).toHaveLength(2)
  })

  it('retries the ledger write ONCE, then classifies it as ledger_failed (never "recorded") and logs by class only', async () => {
    const calls: any[] = []
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const accounting = await recordGeminiImageUsage(context(), usageOf(IMAGE_ONLY), dbReturning({ message: 'secret store detail' }, calls))
    expect(accounting.ledger).toBe('ledger_failed')
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret store detail/)
    log.mockRestore()
  })

  it('classifies a malformed event as ledger_rejected without writing', async () => {
    const calls: any[] = []
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bad = { ...usageOf(IMAGE_ONLY)!, promptTokens: -1 }
    expect((await recordGeminiImageUsage(context(), bad, dbReturning(null, calls))).ledger).toBe('ledger_rejected')
    expect(calls).toHaveLength(0)
    log.mockRestore()
  })

  it('marks a unknown-usage execution as such', async () => {
    const accounting = await recordGeminiImageUsage(context(), null, dbReturning(null))
    expect(accounting).toMatchObject({ ledger: 'recorded', rows: 1, usageUnknown: true, completeness: 'unknown' })
  })
})

describe('markGeminiImageAttemptAccounting', () => {
  const attemptDb = (error: unknown, updates: any[] = []) => ({
    from: (table: string) => ({ update: (patch: unknown) => ({ eq: () => ({ eq: () => { updates.push({ table, patch }); return Promise.resolve({ error }) } }) }) }),
  }) as any

  it('stores the classification on the Attempt; the reported numbers are kept only when the ledger did not take the rows', async () => {
    const recorded: any[] = []
    await markGeminiImageAttemptAccounting(context(), { ledger: 'recorded', rows: 2, usageUnknown: false, completeness: 'reported' }, usageOf(IMAGE_ONLY), attemptDb(null, recorded))
    expect(recorded[0].table).toBe('image_generation_attempts')
    expect(recorded[0].patch.result_metadata.usage_accounting).toMatchObject({ ledger: 'recorded', rows: 2, usage: 'reported' })
    expect(recorded[0].patch.result_metadata.usage_accounting.reported_usage).toBeUndefined()

    const failed: any[] = []
    await markGeminiImageAttemptAccounting(context(), { ledger: 'ledger_failed', rows: 2, usageUnknown: false, completeness: 'reported' }, usageOf(IMAGE_ONLY), attemptDb(null, failed))
    expect(failed[0].patch.result_metadata.usage_accounting.reported_usage).toMatchObject({ promptTokens: 14, candidatesTokens: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] })
    expect(failed[0].patch.result_metadata.provider_response).toMatchObject({ state: 'received', provider_model: 'gemini-nano-banana-2.1', model_alias: 'gemini-nb-2.1' })
  })

  it('never throws when the mark itself fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(markGeminiImageAttemptAccounting(context(), { ledger: 'recorded', rows: 1, usageUnknown: true, completeness: 'unknown' }, null, attemptDb({ message: 'x' }))).resolves.toBe(false)
    log.mockRestore()
  })
})
