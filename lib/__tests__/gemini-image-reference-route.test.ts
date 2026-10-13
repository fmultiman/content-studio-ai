import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the real route, source authorization, Attempt lifecycle, Gemini request builder and
// usage recorder. All external boundaries are fakes; no provider, storage or database is contacted.
const mocks = vi.hoisted(() => ({
  db: { current: null as unknown }, getUser: vi.fn(), credential: vi.fn(),
  head: vi.fn(), open: vi.fn(), upload: vi.fn(), presign: vi.fn(),
  presignImage: vi.fn(), presignLibrary: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: mocks.getUser },
  from: (table: string) => (mocks.db.current as { from: (table: string) => unknown }).from(table),
}) }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => mocks.db.current }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.credential }))
vi.mock('@/lib/storage/s3', () => ({
  headS3Object: mocks.head, openS3ObjectStream: mocks.open,
  uploadImageToS3: mocks.upload, createPresignedReadUrl: mocks.presign,
}))
vi.mock('@/lib/storage/image-storage', () => ({ presignImageObject: mocks.presignImage }))
vi.mock('@/lib/storage/library-storage', () => ({ presignLibraryRead: mocks.presignLibrary }))

import { POST } from '@/app/api/gemini/generate-image/route'
import { GEMINI_IMAGE_GENERATION_FLAG } from '@/lib/providers/gemini/image-feature'
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import type { ImageReference } from '@/lib/image-generation/session'
import { createFakeDb, type FakeDb, type Row } from './helpers/fake-image-db'

const USER = 'user-1'
const OTHER = 'user-2'
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SESSION = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const SOURCE_2 = '44444444-4444-4444-8444-444444444444'
const KEY = `users/${USER}/library/${SOURCE}/source.webp`
const GENERATED_KEY = `users/${USER}/images/${SOURCE}/original.png`
const LIBRARY_REFERENCE: ImageReference = { type: 'library_file', id: SOURCE }
const IMAGE_REFERENCE: ImageReference = { type: 'image', id: SOURCE }
const MAX_BYTES = 10 * 1024 * 1024
const DUMMY_KEY = 'gemini-test-key-no-network'
let png: Buffer
let jpeg: Buffer
let webp: Buffer
let db: FakeDb
let sourceBytes: Buffer
let fetchSpy: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  const image = sharp({ create: { width: 32, height: 24, channels: 3, background: '#4070b0' } })
  ;[png, jpeg, webp] = await Promise.all([image.clone().png({ compressionLevel: 0 }).toBuffer(), image.clone().jpeg().toBuffer(), image.clone().webp().toBuffer()])
})
const session = (refs: ImageReference[] = [LIBRARY_REFERENCE], overrides: Row = {}): Row => ({
  id: SESSION, user_id: USER, project_id: PROJECT, production_id: null,
  working_prompt: 'Original description', revision: 1, current_image_id: null,
  working_state: { schemaVersion: 1, autoMode: false, sourceReferences: refs }, ...overrides,
})
const library = (overrides: Row = {}): Row => ({
  id: SOURCE, user_id: USER, project_id: PROJECT, kind: 'image', deleted_at: null,
  origin: 'upload', storage_path: KEY, public_url: 'http://127.0.0.1/never-fetch',
  mime_type: 'image/jpeg', name: 'deliberately-wrong-extension.jpg', ...overrides,
})
const generated = (overrides: Row = {}): Row => ({
  id: SOURCE, user_id: USER, project_id: PROJECT, storage_path: GENERATED_KEY,
  image_url: 'https://provider.invalid/never-fetch', ...overrides,
})
function seedDb(seed: Record<string, Row[]> = {}, failOn?: Parameters<typeof createFakeDb>[1]) {
  db = createFakeDb({
    image_generation_sessions: [session()], projects: [{ id: PROJECT, user_id: USER }],
    library_files: [library()], ...seed,
  }, failOn)
  mocks.db.current = db
}
const body = (overrides: Record<string, unknown> = {}) => ({
  prompt: 'Paint this scene at sunset', model: 'gemini-nb-2.1', sessionId: SESSION,
  clientRequestId: REQUEST, sourceReferences: [LIBRARY_REFERENCE], ...overrides,
})
const post = (overrides: Record<string, unknown> = {}) => POST(new Request('http://localhost/api/gemini/generate-image', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(overrides)),
}))
const envelope = (overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  responseId: 'response-test',
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }, finishReason: 'STOP' }],
  usageMetadata: {
    promptTokenCount: 105, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 5 }, { modality: 'IMAGE', tokenCount: 100 }],
    candidatesTokenCount: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }],
  }, ...overrides,
}), { status: 200 })
const attempt = () => db.tables.image_generation_attempts[0]
const metadata = () => attempt().result_metadata as Row
const usage = () => db.tables.provider_usage_events
const provenance = (ref = LIBRARY_REFERENCE, bytes = sourceBytes, mimeType = 'image/webp') => ({
  ...ref, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType,
  byteLength: bytes.length, width: 32, height: 24,
})
const noExecution = () => {
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(usage()).toHaveLength(0)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
  sourceBytes = webp
  seedDb()
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  mocks.credential.mockResolvedValue({ status: 'ready', provider: 'gemini', executionMode: 'user_byok', credentialSource: 'user', secret: DUMMY_KEY })
  mocks.head.mockImplementation(async () => ({ size: sourceBytes.length }))
  mocks.open.mockImplementation(async () => ({ stream: Readable.from([sourceBytes]) }))
  mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/output.png', storageProvider: 's3',
    storagePath: `users/${USER}/images/${SOURCE_2}/original.png`, mimeType: 'image/png', fileSize: png.length })
  mocks.presign.mockResolvedValue('https://signed.test/output.png')
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => envelope())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('durable references become verified Gemini inline image parts', () => {
  it.each([
    ['gemini-nb-2.1', 'png'], ['gemini-nb-lite', 'png'],
    ['gemini-nb-2.1', 'jpeg'], ['gemini-nb-lite', 'jpeg'],
    ['gemini-nb-2.1', 'webp'], ['gemini-nb-lite', 'webp'],
  ])('%s forwards real %s bytes and signature MIME, regardless of row MIME/name', async (alias, format) => {
    sourceBytes = { png, jpeg, webp }[format as 'png' | 'jpeg' | 'webp']
    const response = await post({ model: alias })
    expect(response.status).toBe(200)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${resolveGeminiImageModel(alias)!.providerModel}:generateContent`)
    const request = JSON.parse(String(init!.body))
    expect(request.contents).toEqual([{ role: 'user', parts: [
      { text: 'Paint this scene at sunset' },
      { inlineData: { mimeType: `image/${format}`, data: sourceBytes.toString('base64') } },
    ] }])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.head).toHaveBeenCalledWith(KEY)
    expect(mocks.open).toHaveBeenCalledWith(KEY)
    expect(mocks.presignImage).not.toHaveBeenCalled()
    expect(mocks.presignLibrary).not.toHaveBeenCalled()
    expect(attempt()).toMatchObject({ status: 'succeeded', source_snapshot: { references: [LIBRARY_REFERENCE], metadata: { userInput: 'Original description' } } })
    expect(metadata()).toMatchObject({ operation: 'image_to_image', inputReferences: [provenance(LIBRARY_REFERENCE, sourceBytes, `image/${format}`)] })
    expect(JSON.stringify(attempt())).not.toContain(sourceBytes.toString('base64'))
    expect(JSON.stringify(attempt())).not.toContain(DUMMY_KEY)
  })

  it.each(['upload', 'studio_render', 'generated_image'])('Library origin %s uses the same durable file identity', async (origin) => {
    seedDb({ library_files: [library({ origin })] })
    expect((await post()).status).toBe(200)
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(db.tables.library_files).toHaveLength(1)
  })

  it('accepts an owner/project generated image without converting it into a LibraryFile', async () => {
    sourceBytes = png
    seedDb({ image_generation_sessions: [session([IMAGE_REFERENCE])], images: [generated()], library_files: [] })
    const response = await post({ sourceReferences: [IMAGE_REFERENCE] })
    expect(response.status).toBe(200)
    expect(mocks.open).toHaveBeenCalledWith(GENERATED_KEY)
    expect(attempt().source_snapshot).toMatchObject({ references: [IMAGE_REFERENCE] })
    expect(metadata().inputReferences).toEqual([provenance(IMAGE_REFERENCE, png, 'image/png')])
    expect(db.tables.images).toHaveLength(2)
    expect(db.tables.library_files).toHaveLength(0)
  })

  it('uses saved Session references when the optional request field is omitted', async () => {
    expect((await post({ sourceReferences: undefined })).status).toBe(200)
    expect(metadata().inputReferences).toEqual([provenance()])
  })
})

describe('reference authorization and untrusted source claims', () => {
  it('authenticates before reading reference objects or claiming an Attempt', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await post()).status).toBe(401)
    expect(db.writes).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
    noExecution()
  })

  it.each(['image', 'library_file'] as const)('rejects another user or Project for %s before any object read', async (type) => {
    const ref: ImageReference = { type, id: SOURCE }
    for (const invalidScope of [{ user_id: OTHER }, { project_id: SOURCE_2 }]) {
      seedDb({ image_generation_sessions: [session([ref])],
        ...(type === 'image' ? { images: [generated(invalidScope)] } : { library_files: [library(invalidScope)] }),
      })
      expect((await post({ sourceReferences: [ref] })).status).toBe(403)
      expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
      expect(mocks.head).not.toHaveBeenCalled()
      noExecution()
    }
  })

  it.each(['image', 'library_file'] as const)('rejects a forged %s storage key without using its public URL fallback', async (type) => {
    const ref: ImageReference = { type, id: SOURCE }
    seedDb({ image_generation_sessions: [session([ref])],
      ...(type === 'image' ? { images: [generated({ storage_path: GENERATED_KEY.replace(USER, OTHER) })] }
        : { library_files: [library({ storage_path: KEY.replace(USER, OTHER) })] }),
    })
    const response = await post({ sourceReferences: [ref] })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'SOURCE_MEDIA_UNAVAILABLE' })
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    noExecution()
  })

  it.each(['image', 'library_file'] as const)('rejects %s with only a remote URL and no durable object', async (type) => {
    const ref: ImageReference = { type, id: SOURCE }
    seedDb({ image_generation_sessions: [session([ref])],
      ...(type === 'image' ? { images: [generated({ storage_path: null })] } : { library_files: [library({ storage_path: null })] }),
    })
    expect((await post({ sourceReferences: [ref] })).status).toBe(422)
    expect(mocks.open).not.toHaveBeenCalled()
    noExecution()
  })

  it.each([
    [{ deleted_at: '2026-10-13T00:00:00Z' }, 'SOURCE_LIBRARY_FILE_DELETED'],
    [{ kind: 'video' }, 'SOURCE_LIBRARY_FILE_NOT_IMAGE'],
  ])('rejects unavailable Library rows %j', async (fields, code) => {
    seedDb({ library_files: [library(fields)] })
    expect(await (await post()).json()).toMatchObject({ code })
    expect(mocks.head).not.toHaveBeenCalled()
    noExecution()
  })

  it('requires a Project for image references before inserting an Attempt', async () => {
    seedDb({ image_generation_sessions: [session([LIBRARY_REFERENCE], { project_id: null })] })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_PROJECT_REQUIRED' })
    expect(db.tables.image_generation_attempts).toHaveLength(0)
    noExecution()
  })
})

describe('closed reference contract and pre-provider media failures', () => {
  it.each([
    null, {}, [{ type: 'url', id: SOURCE }], [{ type: 'image', id: 'not-a-uuid' }],
    [{ type: 'image', id: SOURCE, storagePath: GENERATED_KEY }],
    [{ type: 'library_file', id: SOURCE, url: 'https://attacker.test/image.png' }],
  ])('rejects malformed or extended reference %j before persistence', async (sourceReferences) => {
    expect(await (await post({ sourceReferences })).json()).toMatchObject({ code: 'INVALID_SOURCE_REFERENCE' })
    expect(db.writes).toEqual([])
    noExecution()
  })

  it('rejects multiple references before object reads or durable submission', async () => {
    expect(await (await post({ sourceReferences: [LIBRARY_REFERENCE, IMAGE_REFERENCE] })).json()).toMatchObject({ code: 'SOURCE_REFERENCE_LIMIT' })
    expect(db.writes).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
    noExecution()
  })

  it('requires explicit references to agree with saved state on a new request', async () => {
    expect(await (await post({ sourceReferences: [{ type: 'library_file', id: SOURCE_2 }] })).json()).toMatchObject({ code: 'SOURCE_STATE_CONFLICT' })
    expect(db.writes).toEqual([])
    noExecution()
  })

  it('rejects an oversized object at HEAD without streaming it or resolving credentials', async () => {
    mocks.head.mockResolvedValue({ size: MAX_BYTES + 1 })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    noExecution()
  })

  it('rejects truncated PNG pixels with readable headers without calling Gemini', async () => {
    sourceBytes = png.subarray(0, Math.floor(png.length / 2))
    expect(await sharp(sourceBytes).metadata()).toMatchObject({ format: 'png', width: 32, height: 24 })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
    expect(mocks.credential).not.toHaveBeenCalled()
    noExecution()
  })
})

describe('immutable source identity and one provider execution per request', () => {
  it('replays without rereading bytes, calling Gemini, inserting outputs or duplicating usage', async () => {
    const first = await (await post()).json()
    const second = await (await post()).json()
    expect(second).toMatchObject({ attemptId: first.attemptId, replayed: true, status: 'succeeded' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.images).toHaveLength(1)
    expect(usage()).toHaveLength(2)
  })

  it('rejects a changed reference under the same clientRequestId', async () => {
    await post()
    expect(await (await post({ sourceReferences: [{ type: 'library_file', id: SOURCE_2 }] })).json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(usage()).toHaveLength(2)
  })

  it('explicit original references replay after Session prompt and references change', async () => {
    await post()
    Object.assign(db.tables.image_generation_sessions[0], {
      working_prompt: 'Edited after submission',
      working_state: { schemaVersion: 1, autoMode: false, sourceReferences: [{ type: 'image', id: SOURCE_2 }] },
    })
    expect(await (await post()).json()).toMatchObject({ replayed: true, status: 'succeeded' })
    expect(attempt().source_snapshot).toMatchObject({ references: [LIBRARY_REFERENCE], metadata: { userInput: 'Original description' } })
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(usage()).toHaveLength(2)
  })

  it('concurrent identical requests share one Attempt, output and usage set', async () => {
    const responses = await Promise.all([post(), post()])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.images).toHaveLength(1)
    expect(usage()).toHaveLength(2)
  })
})

describe('I2I failure and input image usage accounting', () => {
  it('includes IMAGE prompt tokens once in total input usage, preserving modality evidence', async () => {
    expect((await post()).status).toBe(200)
    expect(usage()).toHaveLength(2)
    expect(usage().find((row) => row.unit === 'input_tokens')).toMatchObject({ quantity: 105,
      provider_metadata: { funding: 'user_byok', usage: { promptTokensDetails: [
        { modality: 'TEXT', tokenCount: 5 }, { modality: 'IMAGE', tokenCount: 100 },
      ] } },
    })
    expect(usage().find((row) => row.unit === 'tokens')).toMatchObject({ quantity: 1290, provider_metadata: { usage_category: 'image_output' } })
    expect(metadata().inputReferences).toEqual([provenance()])
  })

  it('partial usage reports only prompt tokens, retaining IMAGE detail and provenance', async () => {
    fetchSpy.mockImplementation(async () => envelope({ usageMetadata: { promptTokenCount: 100, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 100 }] } }))
    await post()
    expect(usage()).toHaveLength(1)
    expect(usage()[0]).toMatchObject({ unit: 'input_tokens', quantity: 100 })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { usage: 'partial', ledger: 'recorded' } })
    await post()
    expect(usage()).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each(['network', 'timeout'])('%s retains input provenance, records uncertain outcome and never retries Gemini', async (failure) => {
    fetchSpy.mockImplementation(async () => { throw Object.assign(new Error('fake provider unavailable'), { name: failure === 'timeout' ? 'AbortError' : 'TypeError' }) })
    const response = await post()
    expect(response.status).toBe(failure === 'timeout' ? 504 : 502)
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(usage()).toHaveLength(0)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(await (await post()).json()).toMatchObject({ replayed: true, status: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('accounts for a received response with no image while keeping I2I provenance', async () => {
    fetchSpy.mockImplementation(async () => envelope({ candidates: [{ content: { parts: [{ text: 'No image' }] }, finishReason: 'STOP' }] }))
    expect(await (await post()).json()).toMatchObject({ code: 'EMPTY_PROVIDER_RESULT' })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], provider_response: { state: 'received_rejected', rejected_as: 'no_image' }, usage_accounting: { ledger: 'recorded' } })
    expect(usage()).toHaveLength(2)
    expect(mocks.upload).not.toHaveBeenCalled()
    await post()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(usage()).toHaveLength(2)
  })

  it('preserves paid usage and input provenance after output storage fails', async () => {
    mocks.upload.mockRejectedValue(new Error('fake storage unavailable'))
    expect(await (await post()).json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { ledger: 'recorded' } })
    expect(db.tables.images).toHaveLength(0)
    expect(usage()).toHaveLength(2)
    await post()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(usage()).toHaveLength(2)
  })

  it('keeps partial usage evidence and provenance if ledger writes fail, without regenerating', async () => {
    seedDb({}, (table, op) => table === 'provider_usage_events' && op === 'upsert' ? { message: 'fake ledger unavailable' } : undefined)
    fetchSpy.mockImplementation(async () => envelope({ usageMetadata: { promptTokenCount: 100, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 100 }] } }))
    expect((await post()).status).toBe(200)
    expect(usage()).toHaveLength(0)
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: {
      ledger: 'ledger_failed', usage: 'partial', reported_usage: { promptTokens: 100, promptTokensDetails: [{ modality: 'IMAGE', tokenCount: 100 }] },
    } })
    expect(db.writes.filter((write) => write.table === 'provider_usage_events')).toHaveLength(2)
    await post()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
