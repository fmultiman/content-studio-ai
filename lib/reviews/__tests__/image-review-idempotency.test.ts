import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// IMAGE_REVIEW_IDEMPOTENCY_FINGERPRINT_CAPTUREDAT_V1 (FUTURE-040)
//
// The REAL context resolution, fingerprint, repository and services run over the in-memory test database.
// Only the artifact registration, the signed-URL helper, the credential and the providers are stubbed.
// Time is faked so `capturedAt` differs between two resolutions of the SAME semantic request.
// 0 paid calls: providers are counters.

const mocks = vi.hoisted(() => ({ resolveArtifact: vi.fn(), resolveProvider: vi.fn(), resolveMedia: vi.fn() }))

vi.mock('@/lib/media-artifacts/image', () => ({ resolveImageArtifact: mocks.resolveArtifact }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/storage/image-storage', () => ({ presignImageObject: vi.fn(async () => 'https://signed.example/never-stored') }))
vi.mock('../media', () => ({ resolveAuthorizedReviewMedia: mocks.resolveMedia }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => ({}) }))

import { createImageReviewExecution } from '../service'
import { ReviewProviderError, type ReviewExecutionProvider, type ReviewProviderId } from '../execution-provider'
import { REVIEW_STALE_AFTER_MS } from '../stale-policy'
import { createReviewTestDb, type Row } from './review-test-db'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '44444444-4444-4444-8444-444444444444'
const PRODUCTION = '55555555-5555-4555-8555-555555555555'
const ATTEMPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OUTPUT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ARTIFACT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const REQ = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const GOOD = JSON.stringify({ score: 88, feedback: 'Clear and coherent.', improvements: [], refinedPrompt: null })
const USAGE = { promptTokenCount: 1_290, candidatesTokenCount: 233 }

function seed(overrides: { project?: Row; production?: Row | null; attempt?: Row; output?: Row } = {}): Record<string, Row[]> {
  return {
    image_generation_attempts: [{
      id: ATTEMPT, user_id: USER, project_id: PROJECT, production_id: PRODUCTION, sequence: 1, submitted_prompt: 'A quiet studio portrait', provider: 'openai',
      model: 'gpt-image-1', submitted_config: { size: '1024x1024' }, source_snapshot: null, status: 'succeeded', result_image_id: OUTPUT, ...overrides.attempt,
    }],
    images: [{
      id: OUTPUT, user_id: USER, project_id: PROJECT, image_url: 'https://example.test/image.png', storage_path: null, storage_provider: null, thumbnail_path: null,
      file_size: 1000, mime_type: 'image/png', updated_at: '2026-10-01T00:00:00.000Z', metadata: {}, ...overrides.output,
    }],
    projects: [{ id: PROJECT, user_id: USER, context: 'Brand X launch', evaluation_mode: 'default', identity: null, ...overrides.project }],
    productions: overrides.production === null ? [] : [{ id: PRODUCTION, user_id: USER, project_id: PROJECT, title: 'Spring', intention: 'Promote', type: 'image', ...overrides.production }],
  }
}

function provider(id: ReviewProviderId, execute: ReturnType<typeof vi.fn>): ReviewExecutionProvider {
  return { providerId: id, capabilities: new Set(['image_review', 'video_review'] as const), execute: execute as unknown as ReviewExecutionProvider['execute'] }
}
const okExecute = () => vi.fn().mockResolvedValue({ rawText: GOOD, providerId: 'gemini', model: 'm', usage: USAGE, providerRequestId: 'resp-1', warnings: [] })

type Db = ReturnType<typeof createReviewTestDb>
const reviews = (db: Db): Row[] => db.tables.media_reviews ?? []
const ledger = (db: Db): Row[] => db.tables.provider_usage_events ?? []
const T0 = Date.parse('2026-10-08T12:00:00.000Z')

function request(db: Db, execute: ReturnType<typeof vi.fn>, n: number, providerId: ReviewProviderId = 'gemini') {
  return createImageReviewExecution({ userId: USER, attemptId: ATTEMPT, clientRequestId: REQ(n), db, providerId, providers: { [providerId]: provider(providerId, execute) } })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.clearAllMocks()
  mocks.resolveArtifact.mockResolvedValue({ id: ARTIFACT })
  mocks.resolveProvider.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: 'key' })
  mocks.resolveMedia.mockResolvedValue({ kind: 'image', artifactId: ARTIFACT, mimeType: 'image/png', byteSize: 10, durationMs: null, load: async () => new Uint8Array([1]) })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.useRealTimers() })

describe.each(['gemini', 'openai'] as const)('%s Image Review: same clientRequestId', (providerId) => {
  it('REPLAYS when only the volatile capture time changed (the FUTURE-040 bug)', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    const first = await request(db, execute, 1, providerId)
    vi.setSystemTime(T0 + 90_000) // a retry 90 s later: resolveImageReviewContext stamps a NEW capturedAt

    const again = await request(db, execute, 1, providerId)

    expect(again.replayed).toBe(true)
    expect(again.row.id).toBe(first.row.id)
    expect(execute).toHaveBeenCalledTimes(1) // no second provider execution
    expect(reviews(db)).toHaveLength(1)
  })

  it('still replays with an identical capture time', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    const first = await request(db, execute, 1, providerId)
    const again = await request(db, execute, 1, providerId)
    expect(again).toMatchObject({ replayed: true, row: { id: first.row.id } })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('replays a still-in-flight Review of the same request too (stale recovery semantics untouched: never reaped by a same-id retry)', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    const first = await request(db, execute, 1, providerId)
    Object.assign(reviews(db)[0], { status: 'running', completed_at: null, updated_at: new Date(T0 - REVIEW_STALE_AFTER_MS - 60_000).toISOString() })
    vi.setSystemTime(T0 + 3 * 60 * 60_000)

    const again = await request(db, execute, 1, providerId)

    expect(again).toMatchObject({ replayed: true, row: { id: first.row.id, status: 'running' } })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('Review context is still recorded with its capture time', () => {
  it('the stored context_snapshot keeps capturedAt (history/provenance) next to the fingerprint', async () => {
    const db = createReviewTestDb(seed())
    await request(db, okExecute(), 1)
    expect(reviews(db)[0].context_snapshot).toMatchObject({ capturedAt: new Date(T0).toISOString(), fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('two Reviews of the same Attempt record their own, different capturedAt but the SAME stable context fingerprint', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1)
    vi.setSystemTime(T0 + 5 * 60_000)
    await request(db, execute, 2)
    const [a, b] = reviews(db)
    expect(a.context_snapshot.capturedAt).not.toBe(b.context_snapshot.capturedAt)
    expect(a.context_snapshot.fingerprint).toBe(b.context_snapshot.fingerprint)
    expect(a.request_fingerprint).toBe(b.request_fingerprint)
  })
})

describe('genuine semantic changes still CONFLICT (no provider call, no usage, nothing written)', () => {
  type Change = { name: string; apply: (db: Db) => void }
  const changes: Change[] = [
    { name: 'a different media artifact for the same Attempt', apply: () => mocks.resolveArtifact.mockResolvedValue({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }) },
    { name: 'a different Attempt output', apply: (db) => { db.tables.image_generation_attempts[0].result_image_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; db.tables.images[0].id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } },
    { name: 'a changed Project context', apply: (db) => { db.tables.projects[0].context = 'Brand Y rebrand' } },
    { name: 'a changed evaluation mode', apply: (db) => { db.tables.projects[0].evaluation_mode = 'strict' } },
    { name: 'a changed Project Identity', apply: (db) => { db.tables.projects[0].identity = { schema_version: 1, foundation: { purpose: 'Arte para marcas premium' } } } },
    { name: 'a changed Production title', apply: (db) => { db.tables.productions[0].title = 'Autumn' } },
    { name: 'a changed Production intention', apply: (db) => { db.tables.productions[0].intention = 'Retain' } },
    { name: 'a changed Production type', apply: (db) => { db.tables.productions[0].type = 'video' } },
  ]

  it.each(changes)('$name', async ({ apply }) => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1)
    const before = JSON.stringify(reviews(db))
    const ledgerBefore = ledger(db).length
    apply(db)
    vi.setSystemTime(T0 + 60_000)

    await expect(request(db, execute, 1)).rejects.toMatchObject({ status: 409, code: 'REVIEW_IDEMPOTENCY_CONFLICT' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(ledger(db)).toHaveLength(ledgerBefore)
    expect(JSON.stringify(reviews(db))).toBe(before)
  })

  it('the same clientRequestId reused for a DIFFERENT Attempt conflicts', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1)
    const other = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    db.tables.image_generation_attempts.push({ ...db.tables.image_generation_attempts[0], id: other })
    await expect(createImageReviewExecution({ userId: USER, attemptId: other, clientRequestId: REQ(1), db, providerId: 'gemini', providers: { gemini: provider('gemini', execute) } }))
      .rejects.toMatchObject({ status: 409, code: 'REVIEW_IDEMPOTENCY_CONFLICT' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('a conflict makes no OpenAI call either', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1, 'openai')
    db.tables.projects[0].context = 'changed'
    await expect(request(db, execute, 1, 'openai')).rejects.toMatchObject({ code: 'REVIEW_IDEMPOTENCY_CONFLICT' })
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('Gemini usage ledger (FUTURE-043) stays exactly-once', () => {
  it('a replay creates no new usage event; a conflict creates none; a new clientRequestId creates a new observation', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1)
    const afterFirst = ledger(db).length
    expect(afterFirst).toBeGreaterThan(0)

    vi.setSystemTime(T0 + 120_000)
    await request(db, execute, 1) // replay
    expect(ledger(db)).toHaveLength(afterFirst)

    db.tables.projects[0].context = 'changed'
    await expect(request(db, execute, 1)).rejects.toMatchObject({ code: 'REVIEW_IDEMPOTENCY_CONFLICT' })
    expect(ledger(db)).toHaveLength(afterFirst)

    await request(db, execute, 2) // intentional new Review, new execution
    expect(execute).toHaveBeenCalledTimes(2)
    expect(ledger(db)).toHaveLength(afterFirst * 2)
    expect(new Set(ledger(db).map((r) => r.resource_id)).size).toBe(2)
  })
})

describe('lifecycle rules are unchanged', () => {
  it('a new clientRequestId still runs the normal path (and a terminal Review does not block it)', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    const first = await request(db, execute, 1)
    const second = await request(db, execute, 2)
    expect(second.replayed).toBe(false)
    expect(second.row.id).not.toBe(first.row.id)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('a completed Review row is not rewritten by a replay', async () => {
    const db = createReviewTestDb(seed())
    const execute = okExecute()
    await request(db, execute, 1)
    const snapshot = JSON.stringify(reviews(db)[0])
    const updates = db.log.filter((e: any) => e.op === 'update').length
    vi.setSystemTime(T0 + 600_000)
    await request(db, execute, 1)
    expect(JSON.stringify(reviews(db)[0])).toBe(snapshot)
    expect(db.log.filter((e: any) => e.op === 'update')).toHaveLength(updates)
  })

  it('a failed (terminal) Review replays too, without a second provider call', async () => {
    const db = createReviewTestDb(seed())
    const execute = vi.fn().mockRejectedValue(new ReviewProviderError('timeout', 'Gemini model request timed out.'))
    await expect(request(db, execute, 1)).rejects.toMatchObject({ code: 'REVIEW_PROVIDER_TIMEOUT' })
    vi.setSystemTime(T0 + 60_000)
    const again = await request(db, execute, 1)
    expect(again.replayed).toBe(true)
    expect(again.row.status).toBe('failed')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
