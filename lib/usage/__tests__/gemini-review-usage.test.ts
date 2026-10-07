import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { geminiReviewUsageEvents, geminiReviewUsageKey, recordGeminiReviewUsage, type GeminiReviewUsageContext } from '../gemini-review-usage'
import { toUsageEventRow } from '../provider-usage-recorder'
import { createReviewTestDb } from '@/lib/reviews/__tests__/review-test-db'
import { STUBS, script } from '@/lib/reviews/__tests__/pglite-review-schema'

// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1 — event construction and the write policy.

const USER = '11111111-1111-4111-8111-111111111111'
const REVIEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ARTIFACT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const PRODUCTION = '33333333-3333-4333-8333-333333333333'

const context = (overrides: Partial<GeminiReviewUsageContext> = {}): GeminiReviewUsageContext => ({
  userId: USER, reviewId: REVIEW, mediaType: 'video', projectId: PROJECT, productionId: PRODUCTION, artifactId: ARTIFACT,
  model: 'gemini-3.5-flash', funding: 'user_byok', credentialSource: 'user', providerRequestId: 'resp-123', providerResponse: 'received', ...overrides,
})
const USAGE = {
  promptTokenCount: 18_432, candidatesTokenCount: 612, thoughtsTokenCount: 240, totalTokenCount: 19_284, cachedContentTokenCount: 1_024,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 432 }, { modality: 'VIDEO', tokenCount: 18_000 }], serviceTier: 'standard',
}

describe('geminiReviewUsageEvents', () => {
  it('writes one provider_reported row per provider-native category and never a combined total', () => {
    const events = geminiReviewUsageEvents(context(), USAGE)
    expect(events.map((e) => [e.measurement?.unit, e.measurement?.quantity, e.measurement?.source, e.idempotencyKey])).toEqual([
      ['input_tokens', 18_432, 'provider_reported', geminiReviewUsageKey(REVIEW, 'input_tokens')],
      ['output_tokens', 612, 'provider_reported', geminiReviewUsageKey(REVIEW, 'output_tokens')],
      ['tokens', 240, 'provider_reported', geminiReviewUsageKey(REVIEW, 'thoughts_tokens')],
    ])
    expect(events.find((e) => e.measurement?.quantity === 19_284)).toBeUndefined()
    expect(events[2].providerMetadata).toMatchObject({ usage_category: 'thoughts' })
    expect(events[0].providerMetadata).not.toHaveProperty('usage_category')
  })

  it('attributes provider, model, operation, transport, owner, scope, Review and artifact', () => {
    const [input] = geminiReviewUsageEvents(context(), USAGE)
    expect(input).toMatchObject({
      userId: USER, projectId: PROJECT, productionId: PRODUCTION, provider: 'gemini', transport: 'rest', operation: 'video_review',
      model: 'gemini-3.5-flash', resourceType: 'media_review', resourceId: REVIEW, providerTaskId: 'resp-123',
    })
    expect(geminiReviewUsageEvents(context({ mediaType: 'image' }), USAGE)[0].operation).toBe('image_review')
    expect(input.providerMetadata).toMatchObject({
      api: 'gemini_generate_content', funding: 'user_byok', credential_source: 'user', provider_response: 'received',
      review: { id: REVIEW, media_type: 'video', artifact_id: ARTIFACT },
    })
  })

  it('keeps cached tokens, modality split, total and service tier as reported descriptors', () => {
    const [input] = geminiReviewUsageEvents(context(), USAGE)
    expect(input.providerMetadata?.usage).toEqual({
      cachedContentTokenCount: 1_024, totalTokenCount: 19_284, serviceTier: 'standard',
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 432 }, { modality: 'VIDEO', tokenCount: 18_000 }],
    })
  })

  it('a reported 0 thinking tokens adds no row; absent thinking adds no row', () => {
    expect(geminiReviewUsageEvents(context(), { promptTokenCount: 5, candidatesTokenCount: 2, thoughtsTokenCount: 0 })).toHaveLength(2)
    expect(geminiReviewUsageEvents(context(), { promptTokenCount: 5, candidatesTokenCount: 2 })).toHaveLength(2)
  })

  it.each([undefined, null, {}, 'x'])('missing/unusable usage %j records ONE unknown event: null quantity, source unknown, never 0', (raw) => {
    const events = geminiReviewUsageEvents(context(), raw)
    expect(events).toHaveLength(1)
    expect(events[0].measurement).toBeNull()
    expect(toUsageEventRow(events[0])).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown', idempotency_key: geminiReviewUsageKey(REVIEW, 'unknown') })
  })

  it('persists no secret, URL or free-form provider text', () => {
    const rows = geminiReviewUsageEvents(context(), { ...USAGE, apiKey: 'AIza-SECRET', signedUrl: 'https://x/?X-Amz-Signature=abc' }).map(toUsageEventRow)
    expect(JSON.stringify(rows)).not.toMatch(/AIza|SECRET|X-Amz|http/i)
  })
})

describe('recordGeminiReviewUsage', () => {
  let error: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    error.mockClear()
  })

  it('writes the whole set in one statement and a second record of the same execution is a no-op', async () => {
    const db = createReviewTestDb()
    expect(await recordGeminiReviewUsage(db, context(), USAGE)).toBe(true)
    expect(await recordGeminiReviewUsage(db, context(), USAGE)).toBe(true)
    expect(db.tables.provider_usage_events).toHaveLength(3)
    expect(db.log.filter((e: any) => e.table === 'provider_usage_events')).toHaveLength(3)
  })

  it('a ledger failure is swallowed (never thrown), retried once, and logged by class only', async () => {
    const db = createReviewTestDb({}, { failUsageWrite: true })
    const spy = vi.spyOn(db, 'from')
    await expect(recordGeminiReviewUsage(db, context(), USAGE)).resolves.toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/AIza|api[_-]?key|usage ledger unavailable/i)
  })

  it('a thrown ledger client is also swallowed', async () => {
    const db = { from: () => { throw new Error('boom AIza-SECRET') } } as any
    await expect(recordGeminiReviewUsage(db, context(), USAGE)).resolves.toBe(false)
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/AIza|SECRET/)
  })
})

describe('against the REAL ledger schema (migration 044 in PGlite)', () => {
  let pg: PGlite
  beforeAll(async () => {
    pg = new PGlite()
    await pg.exec(STUBS)
    await pg.exec('CREATE TABLE public.provider_connections (id uuid PRIMARY KEY);')
    await pg.exec(script('044_create_provider_usage_events.sql'))
    await pg.exec(`INSERT INTO auth.users VALUES ('${USER}'); INSERT INTO public.projects VALUES ('${PROJECT}','${USER}'); INSERT INTO public.productions VALUES ('${PRODUCTION}','${USER}','${PROJECT}');`)
  }, 120_000)
  afterAll(async () => { await pg?.close() })

  async function insertAll(events: ReturnType<typeof geminiReviewUsageEvents>) {
    for (const event of events) {
      const row = toUsageEventRow(event)
      const cols = Object.keys(row)
      const isJson = (c: string) => typeof row[c] === 'object' && row[c] !== null
      await pg.query(
        `INSERT INTO public.provider_usage_events (${cols.join(',')}) VALUES (${cols.map((c, i) => (isJson(c) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(',')}) ON CONFLICT (idempotency_key) DO NOTHING`,
        cols.map((c) => (isJson(c) ? JSON.stringify(row[c]) : row[c])),
      )
    }
  }

  it('every Gemini Review row satisfies the real CHECKs (units, shape, source) without any migration', async () => {
    await insertAll(geminiReviewUsageEvents(context(), USAGE))
    const rows = await pg.query<any>(`SELECT provider, transport, operation, resource_type, unit, quantity::int AS q, measurement_source FROM public.provider_usage_events WHERE resource_id = $1 ORDER BY unit`, [REVIEW])
    expect(rows.rows.map((r: any) => [r.unit, r.q, r.measurement_source])).toEqual([['input_tokens', 18432, 'provider_reported'], ['output_tokens', 612, 'provider_reported'], ['tokens', 240, 'provider_reported']])
    expect(rows.rows.every((r: any) => r.provider === 'gemini' && r.transport === 'rest' && r.operation === 'video_review' && r.resource_type === 'media_review')).toBe(true)
  })

  it('the real UNIQUE idempotency key makes a repeated execution a no-op, and a NEW Review a new observation', async () => {
    await insertAll(geminiReviewUsageEvents(context(), USAGE))
    await insertAll(geminiReviewUsageEvents(context(), USAGE))
    expect((await pg.query<any>(`SELECT count(*)::int n FROM public.provider_usage_events WHERE resource_id = $1`, [REVIEW])).rows[0].n).toBe(3)
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    await insertAll(geminiReviewUsageEvents(context({ reviewId: other }), USAGE))
    expect((await pg.query<any>(`SELECT count(*)::int n FROM public.provider_usage_events WHERE resource_id = $1`, [other])).rows[0].n).toBe(3)
  })

  it('an unknown-usage event is accepted (null quantity + null unit + unknown)', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    await insertAll(geminiReviewUsageEvents(context({ reviewId: id }), null))
    const row = (await pg.query<any>(`SELECT quantity, unit, measurement_source FROM public.provider_usage_events WHERE resource_id = $1`, [id])).rows[0]
    expect(row).toEqual({ quantity: null, unit: null, measurement_source: 'unknown' })
  })
})
