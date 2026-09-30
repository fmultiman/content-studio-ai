import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// GENERATED_IMAGE_LIBRARY_PROMOTION_V1 — explicit generated image -> LibraryFile promotion.
// In-memory DB and S3 only. No provider, storage or paid call exists in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ copyS3ObjectToLibrary: vi.fn(), deleteS3Object: vi.fn() }))

const providerCalls: string[] = []
vi.mock('@/lib/providers/kling/adapter', () => ({ KlingAdapter: class { constructor() { providerCalls.push('KlingAdapter') } } }))

import * as server from '@/lib/supabase/server'
import { copyS3ObjectToLibrary, deleteS3Object } from '@/lib/storage/s3'
import { GET, POST } from '@/app/api/images/[id]/save-to-library/route'
import {
  generatedImageLibraryFilename,
  isSchemaNotReadyError,
  isTenantImageStoragePath,
  validateGeneratedImageForLibrary,
} from '@/lib/images/library-promotion'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const IMAGE = '55555555-5555-4555-8555-555555555555'
const BLOB = '66666666-6666-4666-8666-666666666666'
const SIZE = 812_345

const keyFor = (user = USER, blob = BLOB, file = 'original.png') => `users/${user}/images/${blob}/${file}`

function imageRow(overrides: Record<string, unknown> = {}) {
  return { id: IMAGE, user_id: USER, project_id: PROJECT, storage_path: keyFor(), mime_type: 'image/png', file_size: SIZE, status: 'approved', ...overrides }
}

let db: FakeDb
let authedUser: { id: string } | null
let copyCount: number
let copyDelay = 0
let copiedMime = 'image/png'

function seed(image: Record<string, unknown> | null = imageRow(), extra: Record<string, any[]> = {}) {
  db = createFakeDb({
    seed: {
      images: image ? [image] : [],
      projects: [{ id: PROJECT, user_id: USER }],
      library_folders: [{ project_id: PROJECT, user_id: USER, is_project_root: true, path: '/Projetos/Maitê' }],
      library_files: [],
      ...extra,
    },
    generatedId: ['library_files'],
    // migration 045: UNIQUE (user_id, source_image_id) WHERE source_image_id IS NOT NULL AND deleted_at IS NULL
    uniquePartial: {
      library_files: [{ columns: ['user_id', 'source_image_id'], where: (row) => row.source_image_id != null && row.deleted_at == null }],
    },
  })
  vi.mocked(server.createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: authedUser }, error: authedUser ? null : { message: 'no' } }) },
    from: db.from,
  } as any)
}

const call = (id = IMAGE) => POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) })
const state = (id = IMAGE) => GET(new Request('http://localhost/x'), { params: Promise.resolve({ id }) })
const files = () => db.tables.library_files ?? []
const active = () => files().filter((file) => file.deleted_at == null)

beforeEach(() => {
  vi.clearAllMocks()
  providerCalls.length = 0
  authedUser = { id: USER }
  copyCount = 0
  copyDelay = 0
  copiedMime = 'image/png'
  vi.mocked(copyS3ObjectToLibrary).mockImplementation(async (input: any) => {
    copyCount += 1
    if (copyDelay) await new Promise((resolve) => setTimeout(resolve, copyDelay))
    const storagePath = `users/${input.userId}/library/${randomUUID()}/imagem-ia.png`
    return { storagePath, publicUrl: `https://cdn.example.test/${storagePath}`, fileSize: SIZE, mimeType: copiedMime }
  })
  vi.mocked(deleteS3Object).mockResolvedValue(undefined as never)
  seed()
})

describe('migration 045', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts/045_library_files_source_image.sql'), 'utf8').replace(/--.*$/gm, '').replace(/\s+/g, ' ')

  it('is additive: a nullable FK to images (ON DELETE SET NULL) and nothing destructive', () => {
    expect(sql).toMatch(/ALTER TABLE library_files ADD COLUMN IF NOT EXISTS source_image_id UUID REFERENCES images\(id\) ON DELETE SET NULL/)
    expect(sql.split(';')[0]).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|UPDATE|TRUNCATE)\b/i)
    expect(sql).not.toMatch(/ALTER TABLE (?!library_files)/i)
  })

  it('enforces one ACTIVE LibraryFile per (user, source image) with a unique partial index', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_library_files_active_source_image ON library_files \(user_id, source_image_id\) WHERE source_image_id IS NOT NULL AND deleted_at IS NULL/)
  })

  it('does not touch origin, policies or grants', () => {
    expect(sql).not.toMatch(/origin|POLICY|GRANT|REVOKE/i)
  })

  it('the migration number is unique in scripts/', () => {
    const numbers = readdirSync(join(process.cwd(), 'scripts')).filter((name) => name.startsWith('045_'))
    expect(numbers).toEqual(['045_library_files_source_image.sql'])
  })
})

describe('image path / eligibility policy (pure)', () => {
  it('accepts exactly the shape uploadImageToS3 writes, in the owner’s namespace', () => {
    for (const file of ['original.png', 'original.jpg', 'original.webp']) expect(isTenantImageStoragePath(keyFor(USER, BLOB, file), USER)).toBe(true)
    expect(validateGeneratedImageForLibrary(imageRow() as any, USER)).toEqual({ ok: true, storagePath: keyFor(), extension: 'png', mimeType: 'image/png' })
    expect(validateGeneratedImageForLibrary(imageRow({ storage_path: keyFor(USER, BLOB, 'original.jpg') }) as any, USER)).toMatchObject({ ok: true, mimeType: 'image/jpeg' })
  })

  it.each([
    ['a foreign tenant', keyFor(OTHER_USER)],
    ['traversal', `users/${USER}/images/${BLOB}/../../${OTHER_USER}/images/${BLOB}/original.png`],
    ['a thumbnail', keyFor(USER, BLOB, 'thumb.webp')],
    ['the posts namespace', `users/${USER}/posts/${BLOB}/original.png`],
    ['the library namespace', `users/${USER}/library/${BLOB}/original.png`],
    ['a video namespace key', `${USER}/videos/ai/${PROJECT}/${IMAGE}.mp4`],
    ['a nested folder', `users/${USER}/images/${BLOB}/x/original.png`],
    ['a non-uuid folder', `users/${USER}/images/abc/original.png`],
    ['an unsupported extension', keyFor(USER, BLOB, 'original.gif')],
    ['a public URL', `https://cdn.example.test/${keyFor()}`],
  ])('rejects %s', (_label, storage_path) => {
    expect(validateGeneratedImageForLibrary(imageRow({ storage_path }) as any, USER)).toEqual({ ok: false, code: 'INVALID_STORAGE_PATH' })
  })

  it('needs a Project and an object; a row owned by someone else is never eligible', () => {
    expect(validateGeneratedImageForLibrary(imageRow({ project_id: null }) as any, USER)).toEqual({ ok: false, code: 'MISSING_PROJECT' })
    expect(validateGeneratedImageForLibrary(imageRow({ storage_path: null }) as any, USER)).toEqual({ ok: false, code: 'MISSING_STORAGE_PATH' })
    expect(validateGeneratedImageForLibrary(imageRow({ user_id: OTHER_USER }) as any, USER)).toMatchObject({ ok: false })
  })

  it('readable default name, and recognises a missing-column error', () => {
    expect(generatedImageLibraryFilename(IMAGE, 'webp')).toBe('imagem-ia-55555555.webp')
    expect(isSchemaNotReadyError({ code: '42703' })).toBe(true)
    expect(isSchemaNotReadyError({ code: 'PGRST204', message: "Could not find the 'source_image_id' column" })).toBe(true)
    expect(isSchemaNotReadyError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_library_files_active_source_image"' })).toBe(false)
  })
})

describe('POST /api/images/:id/save-to-library — security', () => {
  it('rejects an unauthenticated request before any data or storage access', async () => {
    authedUser = null
    expect((await call()).status).toBe(401)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(files()).toHaveLength(0)
  })

  it('rejects a malformed id', async () => {
    expect((await call('nope')).status).toBe(400)
  })

  it("does not let a user promote another user's image (and reveals nothing)", async () => {
    authedUser = { id: OTHER_USER }
    const response = await call()
    expect(response.status).toBe(404)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(files()).toHaveLength(0)
  })

  it('rejects a Project the caller does not own, even though the row names it', async () => {
    seed(imageRow(), {})
    db.tables.projects = [{ id: PROJECT, user_id: OTHER_USER }]
    const response = await call()
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PROJECT_NOT_FOUND')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('rejects an image without a Project', async () => {
    seed(imageRow({ project_id: null }))
    const response = await call()
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('MISSING_PROJECT')
  })

  it('rejects a forged / foreign storage_path on the row: nothing is copied', async () => {
    seed(imageRow({ storage_path: keyFor(OTHER_USER) }))
    const response = await call()
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('INVALID_STORAGE_PATH')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('ignores anything the client sends: the route reads no body and no query', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/images/[id]/save-to-library/route.ts'), 'utf8')
    expect(source).not.toMatch(/request\.json\(|formData\(|searchParams/)
    expect(source).toMatch(/_request: Request/)
  })

  it('derives ownership and context from the session and the row, never the request', async () => {
    const response = await call()
    expect(response.status).toBe(201)
    expect(files()[0]).toMatchObject({ user_id: USER, project_id: PROJECT, folder: '/Projetos/Maitê' })
  })
})

describe('POST — promotion', () => {
  it('creates exactly one image LibraryFile in the canonical Library namespace with durable provenance', async () => {
    const response = await call()
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.result).toBe('created')

    expect(vi.mocked(copyS3ObjectToLibrary).mock.calls[0][0]).toMatchObject({ userId: USER, sourcePath: keyFor(), mimeType: 'image/png' })
    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatchObject({
      kind: 'image',
      mime_type: 'image/png',
      file_size: SIZE,
      name: 'imagem-ia-55555555.png',
      storage_provider: 's3',
      thumbnail_url: null,
      source_image_id: IMAGE,
    })
    expect(files()[0].storage_path).toMatch(new RegExp(`^users/${USER}/library/`))
    expect(files()[0].storage_path).not.toBe(keyFor())
    expect(body.libraryFile.id).toBe(files()[0].id)
  })

  it('origin is left to the default classification (Arquivos); provenance is source_image_id', async () => {
    await call()
    expect(files()[0]).not.toHaveProperty('origin')
    expect(files()[0]).not.toHaveProperty('source_render_execution_id')
  })

  it('copies (independent objects), never deletes the source, and does not mutate the image row', async () => {
    const before = JSON.stringify(db.tables.images[0])
    await call()
    expect(vi.mocked(deleteS3Object).mock.calls.map(([path]) => path)).not.toContain(keyFor())
    expect(JSON.stringify(db.tables.images[0])).toBe(before)
    // History removal leaves the LibraryFile row and its own bytes.
    db.tables.images = []
    expect(files()).toHaveLength(1)
    expect(files()[0].storage_path).not.toBe(keyFor())
  })

  it('a repeated request returns already_saved with the same file and copies nothing', async () => {
    const first = await (await call()).json()
    vi.mocked(copyS3ObjectToLibrary).mockClear()
    const second = await call()
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.result).toBe('already_saved')
    expect(body.libraryFile.id).toBe(first.libraryFile.id)
    expect(files()).toHaveLength(1)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('a stored object that is not the image its key claims is removed, not registered', async () => {
    copiedMime = 'application/octet-stream'
    const response = await call()
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('INVALID_IMAGE_OBJECT')
    expect(files()).toHaveLength(0)
    expect(deleteS3Object).toHaveBeenCalledTimes(1)
  })

  it('a missing source object leaves no row', async () => {
    vi.mocked(copyS3ObjectToLibrary).mockRejectedValueOnce(new Error('NoSuchKey'))
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('OUTPUT_UNAVAILABLE')
    expect(files()).toHaveLength(0)
  })

  it('unconfigured storage is unavailable, without a row', async () => {
    vi.mocked(copyS3ObjectToLibrary).mockResolvedValueOnce(null)
    expect((await call()).status).toBe(503)
    expect(files()).toHaveLength(0)
  })

  it('a non-idempotency insert failure compensates by deleting the copied object', async () => {
    const realFrom = db.from
    vi.mocked(server.createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: authedUser }, error: null }) },
      from: (table: string) => {
        const real = realFrom(table)
        if (table !== 'library_files') return real
        return { ...real, insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '50000', message: 'boom' } }) }) }) }
      },
    } as any)
    const response = await call()
    expect(response.status).toBe(500)
    expect(deleteS3Object).toHaveBeenCalledTimes(1)
    expect(files()).toHaveLength(0)
  })
})

describe('POST — concurrency and Trash (unique partial index is the authority)', () => {
  it('two simultaneous requests can never leave two ACTIVE rows: the loser cleans its copy and returns the winner’s file', async () => {
    copyDelay = 5
    const [a, b] = await Promise.all([call(), call()])
    const bodies = [await a.json(), await b.json()]

    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(copyCount).toBe(2)
    expect(active()).toHaveLength(1)
    expect(bodies[0].libraryFile.id).toBe(bodies[1].libraryFile.id)
    expect(bodies.map((body) => body.result).sort()).toEqual(['already_saved', 'created'])

    const deleted = vi.mocked(deleteS3Object).mock.calls.map(([path]) => path)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).not.toBe(active()[0].storage_path)
  })

  it('a burst of simultaneous requests still yields one active file', async () => {
    copyDelay = 3
    const responses = await Promise.all(Array.from({ length: 6 }, () => call()))
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1)
    expect(active()).toHaveLength(1)
  })

  it('a soft-deleted (Trash) LibraryFile does not count as saved: the image can be saved again', async () => {
    const first = await (await call()).json()
    files()[0].deleted_at = '2026-09-30T00:00:00.000Z'

    const again = await call()
    expect(again.status).toBe(201)
    const second = await again.json()
    expect(second.libraryFile.id).not.toBe(first.libraryFile.id)
    expect(active()).toHaveLength(1)
    expect(files()).toHaveLength(2)
  })

  it('the index itself refuses a second active row for the same user + image (restore cannot duplicate)', () => {
    const insert = (row: Record<string, unknown>) => db.from('library_files').insert(row).select('id').single()
    return (async () => {
      expect((await insert({ user_id: USER, source_image_id: IMAGE, deleted_at: null })).error).toBeNull()
      expect((await insert({ user_id: USER, source_image_id: IMAGE, deleted_at: null })).error).toMatchObject({ code: '23505' })
      // another user, a trashed row, and files without a source are all unaffected
      expect((await insert({ user_id: OTHER_USER, source_image_id: IMAGE, deleted_at: null })).error).toBeNull()
      expect((await insert({ user_id: USER, source_image_id: IMAGE, deleted_at: '2026-09-30T00:00:00Z' })).error).toBeNull()
      expect((await insert({ user_id: USER, source_image_id: null, deleted_at: null })).error).toBeNull()
      expect((await insert({ user_id: USER, source_image_id: null, deleted_at: null })).error).toBeNull()
    })()
  })
})

describe('schema not yet applied (code deployed before migration 045)', () => {
  const withMissingColumn = () => {
    const realFrom = db.from
    const failure = { data: null, error: { code: '42703', message: 'column library_files.source_image_id does not exist' } }
    const failing: any = {}
    for (const method of ['select', 'insert', 'eq', 'is', 'in', 'order', 'limit']) failing[method] = () => failing
    failing.maybeSingle = async () => failure
    failing.single = async () => failure
    vi.mocked(server.createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: authedUser }, error: null }) },
      from: (table: string) => (table === 'library_files' ? failing : realFrom(table)),
    } as any)
  }

  it('POST fails closed with a stable 503 and copies nothing', async () => {
    withMissingColumn()
    const response = await call()
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('SCHEMA_NOT_READY')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('GET reports the feature unavailable instead of failing, so /imagens keeps working', async () => {
    withMissingColumn()
    const response = await state()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: false, saved: null, promotable: false })
  })
})

describe('GET /api/images/:id/save-to-library — durable saved state', () => {
  it('reports an unsaved, promotable image', async () => {
    expect(await (await state()).json()).toEqual({ available: true, saved: null, promotable: true })
  })

  it('reports saved once an active LibraryFile references the image (reload-safe)', async () => {
    await call()
    const body = await (await state()).json()
    expect(body).toMatchObject({ available: true, promotable: true, saved: { id: files()[0].id } })
  })

  it('a Trash LibraryFile reads as not saved', async () => {
    await call()
    files()[0].deleted_at = '2026-09-30T00:00:00.000Z'
    expect((await (await state()).json()).saved).toBeNull()
  })

  it('an image with an untrusted path is not promotable, so the action is not offered', async () => {
    seed(imageRow({ storage_path: keyFor(OTHER_USER) }))
    expect((await (await state()).json()).promotable).toBe(false)
  })

  it('is scoped to the caller', async () => {
    authedUser = { id: OTHER_USER }
    expect((await state()).status).toBe(404)
    authedUser = null
    expect((await state()).status).toBe(401)
  })
})

describe('promotion stays storage-only', () => {
  it('contacts no provider and creates no ChannelPieceMedia / VideoDraft / VideoScene / usage event / render', async () => {
    await call()
    await call()
    expect(providerCalls).toEqual([])
    for (const table of ['channel_piece_media', 'video_drafts', 'video_scenes', 'provider_usage_events', 'render_executions', 'channel_piece_static_authoring_states', 'channel_pieces']) {
      expect(db.tables[table] ?? []).toHaveLength(0)
      expect(db.log.filter((entry) => entry.endsWith(`:${table}`))).toEqual([])
    }
    expect(db.log.filter((entry) => entry.startsWith('update:') || entry.startsWith('delete:'))).toEqual([])
  })

  it('the route and policy import nothing provider-, authoring- or ledger-related', () => {
    for (const path of ['app/api/images/[id]/save-to-library/route.ts', 'lib/images/library-promotion.ts', 'components/images/save-image-to-library.tsx']) {
      const imports = readFileSync(join(process.cwd(), path), 'utf8').match(/from '[^']+'/g) ?? []
      for (const specifier of imports) expect(specifier).not.toMatch(/providers|provider-connections|openai|nanobanana|transport|polling|provider-usage|creative|video-drafts|channel-piece/)
    }
  })

  it('adds no "Usar no Creative Editor" action (a later task)', () => {
    expect(readFileSync(join(process.cwd(), 'components/images/save-image-to-library.tsx'), 'utf8')).not.toMatch(/Usar no Creative Editor|creative-editor|editar-visual/)
  })
})
