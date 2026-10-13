import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real source authorization, decoder, frozen Attempt, multipart client and usage accounting;
// fake external boundaries only. The default fetch mock cannot contact any live provider/URL.
const mocks = vi.hoisted(() => ({ db: { current: null as unknown }, getUser: vi.fn(), credential: vi.fn(),
  head: vi.fn(), open: vi.fn(), upload: vi.fn(), presign: vi.fn(), presignImage: vi.fn(), presignLibrary: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser },
  from: (table: string) => (mocks.db.current as { from: (table: string) => unknown }).from(table),
}) }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: () => mocks.db.current }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.credential }))
vi.mock('@/lib/storage/s3', () => ({ headS3Object: mocks.head, openS3ObjectStream: mocks.open,
  uploadImageToS3: mocks.upload, createPresignedReadUrl: mocks.presign }))
vi.mock('@/lib/storage/image-storage', () => ({ presignImageObject: mocks.presignImage }))
vi.mock('@/lib/storage/library-storage', () => ({ presignLibraryRead: mocks.presignLibrary }))

import { POST } from '@/app/api/openai/generate-image/route'
import { __setMockedProvidersHarnessForTests } from '@/lib/providers/execution-policy'
import type { ImageReference } from '@/lib/image-generation/session'
import { createFakeDb, type FakeDb, type Row } from './helpers/fake-image-db'
import { OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES, OPENAI_IMAGE_EDIT_TIMEOUT_MS } from '@/lib/providers/openai/image-edit-client'

const USER = 'user-1'
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SESSION = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const SOURCE = '33333333-3333-4333-8333-333333333333'
const OTHER_SOURCE = '44444444-4444-4444-8444-444444444444'
const LIBRARY_KEY = `users/${USER}/library/${SOURCE}/source.webp`
const IMAGE_KEY = `users/${USER}/images/${SOURCE}/original.png`
const REF: ImageReference = { type: 'library_file', id: SOURCE }
const IMAGE_REF: ImageReference = { type: 'image', id: SOURCE }
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const DUMMY_KEY = 'openai-dummy-never-live'
let png: Buffer
let jpeg: Buffer
let webp: Buffer
let db: FakeDb
let sourceBytes: Buffer
let fetchSpy: ReturnType<typeof vi.spyOn>
beforeAll(async () => {
  const image = sharp({ create: { width: 32, height: 24, channels: 3, background: '#406080' } })
  ;[png, jpeg, webp] = await Promise.all([image.clone().png({ compressionLevel: 0 }).toBuffer(), image.clone().jpeg().toBuffer(), image.clone().webp().toBuffer()])
})
const session = (references: ImageReference[] = [REF], extra: Row = {}): Row => ({ id: SESSION, user_id: USER,
  project_id: PROJECT, production_id: null, working_prompt: 'Original description', revision: 1, current_image_id: null,
  working_state: { schemaVersion: 1, autoMode: false, sourceReferences: references }, ...extra })
const library = (extra: Row = {}): Row => ({ id: SOURCE, user_id: USER, project_id: PROJECT, kind: 'image', deleted_at: null,
  storage_path: LIBRARY_KEY, public_url: 'http://127.0.0.1/never-fetch', origin: 'upload',
  mime_type: 'image/jpeg', name: 'wrong-declared-format.jpg', ...extra })
const imageRow = (extra: Row = {}): Row => ({ id: SOURCE, user_id: USER, project_id: PROJECT,
  storage_path: IMAGE_KEY, image_url: 'http://169.254.169.254/never-fetch', ...extra })
function seedDb(seed: Record<string, Row[]> = {}, failOn?: Parameters<typeof createFakeDb>[1]) {
  db = createFakeDb({ image_generation_sessions: [session()], projects: [{ id: PROJECT, user_id: USER }], library_files: [library()], ...seed }, failOn)
  mocks.db.current = db
}
const post = (extra: Record<string, unknown> = {}) => POST(new Request('http://localhost/api/openai/generate-image', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Paint this scene at sunset',
    model: 'gpt-image-2', size: '1024x1024', quality: 'medium', sessionId: SESSION, clientRequestId: REQUEST, sourceReferences: [REF], ...extra }),
}))
const envelope = (extra: Record<string, unknown> = {}, status = 200) => new Response(JSON.stringify({
  data: [{ b64_json: png.toString('base64') }],
  usage: { input_tokens: 105, input_tokens_details: { text_tokens: 5, image_tokens: 100 }, output_tokens: 1290, total_tokens: 1395 }, ...extra,
}), { status, headers: { 'x-request-id': 'req-test-edit' } })
const attempt = () => db.tables.image_generation_attempts[0]
const metadata = () => attempt().result_metadata as Row
const usage = () => db.tables.provider_usage_events
const provenance = (ref = REF, bytes = sourceBytes, mimeType = 'image/webp') => ({ ...ref,
  sha256: createHash('sha256').update(bytes).digest('hex'), mimeType, byteLength: bytes.length, width: 32, height: 24 })
const noSubmit = () => { expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(usage()).toHaveLength(0) }
beforeEach(() => {
  vi.clearAllMocks()
  sourceBytes = webp
  seedDb()
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  mocks.credential.mockResolvedValue({ status: 'ready', provider: 'openai', executionMode: 'user_byok', credentialSource: 'user', secret: DUMMY_KEY })
  mocks.head.mockImplementation(async () => ({ size: sourceBytes.length }))
  mocks.open.mockImplementation(async () => ({ stream: Readable.from([sourceBytes]) }))
  mocks.upload.mockResolvedValue({ imageUrl: 'https://cdn.test/output.png', storageProvider: 's3',
    storagePath: `users/${USER}/images/${OTHER_SOURCE}/original.png`, mimeType: 'image/png', fileSize: png.length })
  mocks.presign.mockResolvedValue('https://signed.test/output.png')
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => envelope())
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { __setMockedProvidersHarnessForTests(true); vi.useRealTimers(); vi.restoreAllMocks() })

async function expectUnknownReceiptAndReplay(response: Response, responseId: string, status = 502) {
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ outcome_unknown: true })
  expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
  expect(usage()).toHaveLength(1)
  expect(usage()[0]).toMatchObject({ resource_id: attempt().id, provider_task_id: responseId,
    quantity: null, unit: null, measurement_source: 'unknown', idempotency_key: `openai_image_edit:${attempt().id}:unknown` })
  expect(metadata()).toMatchObject({ inputReferences: [provenance()], provider_response: { state: 'received_rejected', response_id: responseId },
    usage_accounting: { ledger: 'recorded', rows: 1, usage: 'unknown' } })
  const recordedUsage = structuredClone(usage())
  const replay = await post()
  expect(replay.status).toBe(200)
  expect(await replay.json()).toMatchObject({ attemptId: attempt().id, status: 'failed', replayed: true, outcome_unknown: true })
  expect(usage()).toEqual(recordedUsage)
  expect(db.tables.image_generation_attempts).toHaveLength(1)
  expect(db.tables.images).toHaveLength(0)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(mocks.open).toHaveBeenCalledTimes(1)
  expect(mocks.upload).not.toHaveBeenCalled()
}

describe('GPT Image 2 durable source transport', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('forwards verified %s bytes and MIME through image[]', async (format) => {
    sourceBytes = { png, jpeg, webp }[format]
    const response = await post()
    expect(response.status).toBe(200)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    const multipart = init.body as FormData
    const file = multipart.get('image[]') as File
    expect(file.type).toBe(`image/${format}`)
    expect(Buffer.from(await file.arrayBuffer())).toEqual(sourceBytes)
    expect([...multipart.keys()].sort()).toEqual(['background', 'image[]', 'model', 'moderation', 'n', 'output_format', 'prompt', 'quality', 'size'])
    expect(multipart.get('model')).toBe('gpt-image-2')
    expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: `Bearer ${DUMMY_KEY}` } })
    expect(attempt()).toMatchObject({ status: 'succeeded', source_snapshot: { references: [REF], metadata: { userInput: 'Original description' } } })
    expect(metadata()).toMatchObject({ operation: 'image_to_image', inputReferences: [provenance(REF, sourceBytes, `image/${format}`)] })
    expect(mocks.upload).toHaveBeenCalledWith({ userId: USER, folder: 'images', buffer: png, mimeType: 'image/png' })
    expect(mocks.presignLibrary).not.toHaveBeenCalled()
    expect(mocks.presignImage).not.toHaveBeenCalled()
    expect(JSON.stringify(attempt())).not.toContain(sourceBytes.toString('base64'))
    expect(JSON.stringify(await response.json())).not.toContain(DUMMY_KEY)
  })

  it.each(['upload', 'studio_render', 'generated_image'])('uses one durable Library identity for origin %s', async (origin) => {
    seedDb({ library_files: [library({ origin })] })
    expect((await post()).status).toBe(200)
    expect(mocks.open).toHaveBeenCalledWith(LIBRARY_KEY)
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(db.tables.library_files).toHaveLength(1)
  })

  it('accepts a generated image directly, without a promotion or source URL fetch', async () => {
    sourceBytes = png
    seedDb({ image_generation_sessions: [session([IMAGE_REF])], images: [imageRow()], library_files: [] })
    expect((await post({ sourceReferences: [IMAGE_REF] })).status).toBe(200)
    expect(mocks.open).toHaveBeenCalledWith(IMAGE_KEY)
    expect(metadata().inputReferences).toEqual([provenance(IMAGE_REF, png, 'image/png')])
    expect(db.tables.images).toHaveLength(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('resolves omitted references from the frozen Session snapshot', async () => {
    expect((await post({ sourceReferences: undefined })).status).toBe(200)
    expect(metadata().inputReferences).toEqual([provenance()])
  })

  it('allows an input larger than Gemini 10 MiB while enforcing OpenAI 20 MiB', async () => {
    sourceBytes = Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024 - png.length)])
    expect((await post()).status).toBe(200)
    expect((metadata().inputReferences as Row[])[0].byteLength).toBe(11 * 1024 * 1024)
  })

  it('accepts an OpenAI input edge at 16384 and rejects a longer edge before spending', async () => {
    sourceBytes = await sharp({ create: { width: 16384, height: 1, channels: 3, background: '#406080' } }).png().toBuffer()
    expect((await post()).status).toBe(200)
    expect((metadata().inputReferences as Row[])[0]).toMatchObject({ width: 16384, height: 1 })
    seedDb()
    fetchSpy.mockClear()
    mocks.upload.mockClear()
    sourceBytes = await sharp({ create: { width: 16385, height: 1, channels: 3, background: '#406080' } }).png().toBuffer()
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
    noSubmit()
  })
})

describe('unchanged text-to-image transports', () => {
  it.each(['image_generation_sessions', 'projects', 'productions', 'image_generation_attempts'])('keeps paid recovery identity uncertain during a %s read outage', async (tableName) => {
    let outage = false
    seedDb({ image_generation_sessions: [session([REF], { production_id: OTHER_SOURCE })],
      productions: [{ id: OTHER_SOURCE, project_id: PROJECT, user_id: USER }] },
    (table, op) => outage && table === tableName && op === 'select' ? { message: 'fake recovery read outage' } : undefined)
    mocks.upload.mockRejectedValue(new Error('fake storage unavailable'))
    expect(await (await post()).json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE', outcome_unknown: true })
    outage = true
    const recovery = await post()
    expect(recovery.status).toBe(503)
    expect(await recovery.json()).toMatchObject({ code: 'STORE_UNAVAILABLE', outcome_unknown: true })
    outage = false
    expect(await (await post()).json()).toMatchObject({ replayed: true, status: 'failed', outcome_unknown: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(usage()).toHaveLength(2)
  })

  it.each(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'])('canonical %s still uses the exact generations JSON request', async (model) => {
    seedDb({ image_generation_sessions: [session([])] })
    expect((await post({ model, sourceReferences: undefined })).status).toBe(200)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/generations')
    expect(init).toEqual({ method: 'POST', headers: { Authorization: `Bearer ${DUMMY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'Paint this scene at sunset', size: '1024x1024', quality: 'medium', n: 1 }) })
    expect(mocks.upload.mock.calls[0][0]).toMatchObject({ dataUrl: `data:image/png;base64,${png.toString('base64')}` })
    expect(mocks.open).not.toHaveBeenCalled()
    expect(usage()).toHaveLength(0)
  })

  it.each(['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'])('legacy %s still permits its provider URL output', async (model) => {
    fetchSpy.mockResolvedValue(envelope({ data: [{ url: 'https://openai.test/legacy.png' }] }))
    const response = await post({ model, sessionId: undefined, clientRequestId: undefined, sourceReferences: undefined })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ imageUrl: 'https://openai.test/legacy.png' })
    expect(fetchSpy.mock.calls[0][1].body).toBe(JSON.stringify({ model, prompt: 'Paint this scene at sunset', size: '1024x1024', quality: 'medium', n: 1 }))
    expect(db.tables.image_generation_attempts).toHaveLength(0)
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('fix-review: paid T2I output-save failure must retain uncertainty', async () => {
    seedDb({ image_generation_sessions: [session([])] }, (table, op) =>
      table === 'images' && op === 'upsert' ? { message: 'mock output-save failure' } : undefined)
    const response = await post({ sourceReferences: [] })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'OUTPUT_SAVE_FAILED', outcome_unknown: true })
    expect(attempt()).toMatchObject({ status: 'failed', source_snapshot: { references: [] }, failure_details: { outcome_unknown: true } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.open).not.toHaveBeenCalled()
    expect(db.tables.images).toHaveLength(0)
    const replay = await post({ sourceReferences: [] })
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: true })
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })

  it('paid T2I lifecycle-write failure retains uncertainty through recovery and replay', async () => {
    let failedLifecycleWrite = false
    seedDb({ image_generation_sessions: [session([])] }, (table, op) => {
      // Inject a transient finalization outage only after the provider has been called;
      // allow the route's recovery write so its persisted flag can also be replayed.
      if (table === 'image_generation_attempts' && op === 'update' && fetchSpy.mock.calls.length && !failedLifecycleWrite) {
        failedLifecycleWrite = true
        return { message: 'mock lifecycle outage after provider execution' }
      }
      return undefined
    })
    fetchSpy.mockResolvedValue(envelope({ data: [] }))
    const response = await post({ sourceReferences: [] })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'LIFECYCLE_SAVE_FAILED', outcome_unknown: true })
    expect(failedLifecycleWrite).toBe(true)
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/generations')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(await (await post({ sourceReferences: [] })).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: true })
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('authorization, controls and source isolation before spending', () => {
  it('requires authentication before any Attempt or source access', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await post()).status).toBe(401)
    expect(db.writes).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
    noSubmit()
  })

  it.each(['Session', 'Project'])('rejects a foreign %s before resolving its source', async (scope) => {
    seedDb(scope === 'Session' ? { image_generation_sessions: [session([REF], { user_id: 'user-2' })] }
      : { projects: [{ id: PROJECT, user_id: 'user-2' }] })
    expect((await post()).status).toBe(scope === 'Session' ? 404 : 403)
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    noSubmit()
  })

  it('honors the runtime policy before source/credential access', async () => {
    __setMockedProvidersHarnessForTests(false)
    expect((await post()).status).toBe(403)
    expect(db.writes).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    noSubmit()
  })

  it.each(['anonymous', 'runtime blocked'])('does not parse malformed JSON for an %s request', async (reason) => {
    if (reason === 'anonymous') mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    else __setMockedProvidersHarnessForTests(false)
    const response = await POST(new Request('http://localhost/api/openai/generate-image', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{invalid json',
    }))
    expect(response.status).toBe(reason === 'anonymous' ? 401 : 403)
    expect(db.writes).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    noSubmit()
  })

  it.each(['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'])('does not expand I2I to %s', async (model) => {
    expect(await (await post({ model })).json()).toMatchObject({ code: 'SOURCE_NOT_SUPPORTED' })
    expect(db.writes).toEqual([])
    noSubmit()
  })

  it.each([null, {}, [{ type: 'image', id: 'invalid' }], [{ type: 'url', id: SOURCE }],
    [{ ...REF, url: 'https://attacker.test/image.png' }], [{ ...REF, storagePath: LIBRARY_KEY }]])('rejects malformed/extended references %j', async (sourceReferences) => {
    expect(await (await post({ sourceReferences })).json()).toMatchObject({ code: 'INVALID_SOURCE_REFERENCE' })
    expect(db.writes).toEqual([])
    noSubmit()
  })

  it.each([{ image: 'data:image/png;base64,AAAA' }, { imageUrl: 'http://127.0.0.1/private' }, { mask: 'x' }, { fileData: {} }, { url: 'https://x.test' }])('rejects raw media fields %j even outside canonical requests', async (extra) => {
    expect(await (await post({ sessionId: undefined, clientRequestId: undefined, sourceReferences: undefined, ...extra })).json()).toMatchObject({ code: 'SOURCE_NOT_SUPPORTED' })
    noSubmit()
  })

  it('requires both canonical IDs when references are explicit', async () => {
    expect(await (await post({ sessionId: undefined, clientRequestId: undefined })).json()).toMatchObject({ code: 'SESSION_REQUEST_ID_REQUIRED' })
    noSubmit()
  })

  it('rejects multiple references before inserting an Attempt', async () => {
    expect(await (await post({ sourceReferences: [REF, IMAGE_REF] })).json()).toMatchObject({ code: 'SOURCE_REFERENCE_LIMIT' })
    expect(db.writes).toEqual([])
    noSubmit()
  })

  it.each([{ size: 'auto' }, { size: '3840x2160' }, { quality: 'auto' }, { quality: 'max' }])('rejects edit controls %j before reading sources or credentials', async (extra) => {
    expect((await post(extra)).status).toBe(400)
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.credential).not.toHaveBeenCalled()
    noSubmit()
  })

  it('requires a Project and a saved source selection', async () => {
    expect(await (await post({ sourceReferences: [{ type: 'library_file', id: OTHER_SOURCE }] })).json()).toMatchObject({ code: 'SOURCE_STATE_CONFLICT' })
    seedDb({ image_generation_sessions: [session([REF], { project_id: null })] })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_PROJECT_REQUIRED' })
    expect(db.writes).toEqual([])
    noSubmit()
  })

  it.each(['image', 'library_file'] as const)('rejects foreign owner/Project/key or URL-only for %s', async (type) => {
    const ref = { type, id: SOURCE }
    for (const [extra, status] of [[{ user_id: 'user-2' }, 403], [{ project_id: OTHER_SOURCE }, 403],
      [{ storage_path: (type === 'image' ? IMAGE_KEY : LIBRARY_KEY).replace(USER, 'user-2') }, 422], [{ storage_path: null }, 422]] as const) {
      seedDb({ image_generation_sessions: [session([ref])], ...(type === 'image' ? { images: [imageRow(extra)] } : { library_files: [library(extra)] }) })
      expect((await post({ sourceReferences: [ref] })).status).toBe(status)
      expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
      expect(mocks.head).not.toHaveBeenCalled()
      noSubmit()
    }
  })

  it.each([{ deleted_at: '2026-10-13T00:00:00Z' }, { kind: 'video' }])('rejects unavailable source rows %j before object reads', async (extra) => {
    seedDb({ library_files: [library(extra)] })
    expect((await post()).status).toBe(422)
    expect(mocks.head).not.toHaveBeenCalled()
    noSubmit()
  })

  it('rejects oversized source HEAD and does not stream or submit', async () => {
    mocks.head.mockResolvedValue({ size: MAX_INPUT_BYTES + 1 })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(mocks.open).not.toHaveBeenCalled()
    noSubmit()
  })

  it('bounds the source stream when HEAD understates bytes and destroys it before spending', async () => {
    const stream = Readable.from([Buffer.alloc(MAX_INPUT_BYTES), Buffer.from([1])])
    mocks.head.mockResolvedValue({ size: 1 })
    mocks.open.mockResolvedValue({ stream })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(stream.destroyed).toBe(true)
    expect(mocks.credential).not.toHaveBeenCalled()
    noSubmit()
  })

  it('fully validates source pixels before submitting readable-header truncated PNG', async () => {
    sourceBytes = png.subarray(0, Math.floor(png.length / 2))
    expect(await sharp(sourceBytes).metadata()).toMatchObject({ width: 32, height: 24 })
    expect(await (await post()).json()).toMatchObject({ code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED', outcome_unknown: false })
    expect(attempt()).toMatchObject({ failure_details: { outcome_unknown: false } })
    noSubmit()
    expect(await (await post()).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: false })
    noSubmit()
  })

  it('requires provenance persistence before the provider call', async () => {
    let updates = 0
    seedDb({}, (table, op) => {
      if (table === 'image_generation_attempts' && op === 'update' && ++updates === 2) return { message: 'fake provenance failure' }
      return undefined
    })
    expect(await (await post()).json()).toMatchObject({ code: 'PROVENANCE_SAVE_FAILED' })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
    noSubmit()
  })

  it('does not spend when the OpenAI BYOK credential is missing', async () => {
    mocks.credential.mockResolvedValue({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED' })
    expect(await (await post()).json()).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', outcome_unknown: false })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: false } })
    expect(metadata().inputReferences).toEqual([provenance()])
    noSubmit()
    expect(await (await post()).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: false })
    noSubmit()
  })
})

describe('idempotent edit lifecycle and separate usage', () => {
  it('replays one output without source rereads, resubmits, duplicate storage or ledger rows', async () => {
    const first = await (await post()).json()
    expect(await (await post()).json()).toMatchObject({ attemptId: first.attemptId, status: 'succeeded', replayed: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(db.tables.image_generation_attempts).toHaveLength(1)
    expect(db.tables.images).toHaveLength(1)
    expect(usage()).toHaveLength(2)
  })

  it('rejects changed reference identity under the same request key', async () => {
    await post()
    expect(await (await post({ sourceReferences: [{ type: 'library_file', id: OTHER_SOURCE }] })).json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
  })

  it('replays original explicit references after Session state and prompt change', async () => {
    await post()
    Object.assign(db.tables.image_generation_sessions[0], { working_prompt: 'Changed description',
      working_state: { schemaVersion: 1, autoMode: false, sourceReferences: [IMAGE_REF] } })
    expect(await (await post()).json()).toMatchObject({ replayed: true, status: 'succeeded' })
    expect(attempt().source_snapshot).toMatchObject({ references: [REF], metadata: { userInput: 'Original description' } })
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(usage()).toHaveLength(2)
  })

  it('claims concurrent identical submissions once', async () => {
    const responses = await Promise.all([post(), post()])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(db.tables.images).toHaveLength(1)
    expect(usage()).toHaveLength(2)
  })

  it('records input IMAGE detail as part of input total, never an extra charge', async () => {
    await post()
    expect(usage()).toHaveLength(2)
    expect(usage().find((row) => row.unit === 'input_tokens')).toMatchObject({ quantity: 105,
      provider_metadata: { funding: 'user_byok', credential_source: 'user', usage: { inputTokens: 105, inputTextTokens: 5, inputImageTokens: 100 } } })
    expect(usage().every((row) => row.resource_id === attempt().id && row.provider === 'openai')).toBe(true)
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { ledger: 'recorded' } })
  })

  it('records partial/unknown usage honestly and retains I2I provenance', async () => {
    fetchSpy.mockResolvedValue(envelope({ usage: { input_tokens: 100, input_tokens_details: { image_tokens: 100 } } }))
    await post()
    expect(usage()).toHaveLength(1)
    expect(usage()[0]).toMatchObject({ quantity: 100, unit: 'input_tokens' })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { usage: 'partial' } })
    seedDb()
    fetchSpy.mockResolvedValue(envelope({ usage: undefined }))
    await post()
    expect(usage()).toHaveLength(1)
    expect(usage()[0]).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown' })
    expect(metadata().inputReferences).toEqual([provenance()])
  })

  it('preserves usage facts and provenance when ledger writes fail, without regenerating', async () => {
    seedDb({}, (table, op) => table === 'provider_usage_events' && op === 'upsert' ? { message: 'fake ledger unavailable' } : undefined)
    expect((await post()).status).toBe(200)
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { ledger: 'ledger_failed', reported_usage: { inputTokens: 105, outputTokens: 1290 } } })
    expect(usage()).toHaveLength(0)
    await post()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('secure failures with output storage required', () => {
  it.each([[401, 400, 'PROVIDER_CREDENTIAL_REJECTED', false], [403, 400, 'PROVIDER_CREDENTIAL_REJECTED', false],
    [429, 429, 'PROVIDER_RATE_LIMITED', false], [500, 502, 'PROVIDER_UNAVAILABLE', true]] as const)('maps HTTP %s safely and replay never retries', async (http, status, code, unknown) => {
    fetchSpy.mockResolvedValue(envelope({ error: { message: 'private prompt and secret key' } }, http))
    const response = await post()
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code, outcome_unknown: unknown })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: unknown } })
    expect(JSON.stringify(attempt())).not.toContain('private prompt and secret key')
    expect(usage()).toHaveLength(0)
    expect(await (await post()).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: unknown })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('maps moderation blocked as a content error without recording unreported usage', async () => {
    fetchSpy.mockResolvedValue(envelope({ error: { code: 'moderation_blocked' } }, 400))
    expect(await (await post()).json()).toMatchObject({ code: 'PROVIDER_CONTENT_BLOCKED', outcome_unknown: false })
    expect(attempt()).toMatchObject({ failure_details: { outcome_unknown: false } })
    expect(usage()).toHaveLength(0)
  })

  it.each(['network', 'timeout'])('%s preserves source provenance and uncertain outcome, with no automatic retry', async (failure) => {
    fetchSpy.mockRejectedValue(Object.assign(new Error('private transport details'), { name: failure === 'timeout' ? 'AbortError' : 'TypeError' }))
    const response = await post()
    expect(response.status).toBe(failure === 'timeout' ? 504 : 502)
    expect(await response.json()).toMatchObject({ outcome_unknown: true })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(metadata().inputReferences).toEqual([provenance()])
    expect(JSON.stringify(attempt())).not.toContain('private transport details')
    expect(usage()).toHaveLength(0)
    expect(await (await post()).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects edit output URLs while accounting received usage and preserving input provenance', async () => {
    fetchSpy.mockResolvedValue(envelope({ data: [{ url: 'http://127.0.0.1/private.png' }] }))
    expect(await (await post()).json()).toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], provider_response: { state: 'received_rejected' }, usage_accounting: { ledger: 'recorded' } })
    expect(usage()).toHaveLength(2)
    expect(mocks.upload).not.toHaveBeenCalled()
    await post()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each(['null', 'throw'])('storage %s fails closed after accounting paid usage; replay does not spend again', async (failure) => {
    if (failure === 'null') mocks.upload.mockResolvedValue(null)
    else mocks.upload.mockRejectedValue(new Error('private storage details'))
    expect(await (await post()).json()).toMatchObject({ code: 'STORAGE_UNAVAILABLE', outcome_unknown: true })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(metadata()).toMatchObject({ inputReferences: [provenance()], usage_accounting: { ledger: 'recorded' } })
    expect(usage()).toHaveLength(2)
    expect(db.tables.images).toHaveLength(0)
    expect(await (await post()).json()).toMatchObject({ status: 'failed', replayed: true, outcome_unknown: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })

  it('records paid usage when output DB linking fails', async () => {
    seedDb({}, (table, op) => table === 'images' && op === 'upsert' ? { message: 'fake output link failed' } : undefined)
    expect(await (await post()).json()).toMatchObject({ code: 'OUTPUT_SAVE_FAILED', outcome_unknown: true })
    expect(attempt()).toMatchObject({ status: 'failed', failure_details: { outcome_unknown: true } })
    expect(usage()).toHaveLength(2)
    expect(metadata().inputReferences).toEqual([provenance()])
  })

  it('cold-review: malformed 2xx retains an unknown usage event', async () => {
    fetchSpy.mockResolvedValue(new Response('{', { status: 200, headers: { 'x-request-id': 'req-malformed' } }))
    const response = await post()
    expect(response.status).toBe(502)
    expect(await response.clone().json()).toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
    await expectUnknownReceiptAndReplay(response, 'req-malformed')
  })

  it.each([
    ['truncated JSON', '{"data":[{"b64_json":"unfinished'], ['null envelope', 'null'],
    ['array envelope', '[]'], ['primitive envelope', '42'], ['empty body', ''],
  ])('records one unknown event for successful HTTP with %s and preserves its ID on replay', async (_name, body) => {
    fetchSpy.mockResolvedValue(new Response(body, { status: 200, headers: { 'x-request-id': 'req-unreadable-edit' } }))
    await expectUnknownReceiptAndReplay(await post(), 'req-unreadable-edit')
  })

  it('records a successful receipt with unknown usage when declared response size is excessive', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200, headers: {
      'content-length': String(OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES + 1), 'x-request-id': 'req-oversized-edit',
    } }))
    await expectUnknownReceiptAndReplay(await post(), 'req-oversized-edit')
  })

  it('records a successful receipt with unknown usage after response streaming fails', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('private response stream details')) } })
    fetchSpy.mockResolvedValue(new Response(stream, { status: 200, headers: { 'x-request-id': 'req-broken-stream' } }))
    await expectUnknownReceiptAndReplay(await post(), 'req-broken-stream')
    expect(JSON.stringify(attempt())).not.toContain('private response stream details')
  })

  it('accounts for a stalled HTTP 200 body at timeout, then replays without resubmission', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel })
    fetchSpy.mockResolvedValue(new Response(stream, { status: 200, headers: { 'x-request-id': 'req-body-timeout' } }))
    const pending = post()
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_EDIT_TIMEOUT_MS)
    await expectUnknownReceiptAndReplay(await pending, 'req-body-timeout', 504)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
