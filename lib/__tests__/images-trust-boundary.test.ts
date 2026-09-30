import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1 — adversarial + regression tests.
// In-memory DB and S3 only; every user, project and object key below is synthetic.
// No provider, storage or paid call exists in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(),
  copyS3ObjectToLibrary: vi.fn(),
  deleteS3Object: vi.fn(),
}))

import * as server from '@/lib/supabase/server'
import { copyS3ObjectToLibrary, createPresignedReadUrl } from '@/lib/storage/s3'
import { GET as SIGNED_URL } from '@/app/api/images/[id]/signed-url/route'
import { POST as SIGN_PATH } from '@/app/api/storage/sign-image-path/route'
import { POST as PROMOTE } from '@/app/api/images/[id]/save-to-library/route'
import { resolveMediaSource } from '@/app/api/channel-piece-media/_helpers'
import { POST as PRESIGN_UPLOAD } from '@/app/api/storage/presign-image-upload/route'

const USER = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const BLOB = '44444444-4444-4444-8444-444444444444'
const BLOB2 = '55555555-5555-4555-8555-555555555555'
const IMG_OWN = '66666666-6666-4666-8666-666666666666'

const original = (owner = USER, blob = BLOB, ext = 'png') => `users/${owner}/images/${blob}/original.${ext}`
const thumb = (owner = USER, blob = BLOB) => `users/${owner}/images/${blob}/thumb.webp`

let db: FakeDb
let authedUser: { id: string } | null

function image(overrides: Record<string, unknown> = {}) {
  return {
    id: IMG_OWN,
    user_id: USER,
    project_id: PROJECT,
    image_url: 'https://s3.example.test/public-1.png',
    thumbnail_url: null,
    storage_path: original(),
    thumbnail_path: thumb(),
    mime_type: 'image/png',
    file_size: 10,
    status: 'approved',
    ...overrides,
  }
}

function seed(images: Array<Record<string, unknown>> = [image()]) {
  db = createFakeDb({
    seed: {
      images,
      projects: [{ id: PROJECT, user_id: USER }],
      library_folders: [{ project_id: PROJECT, user_id: USER, is_project_root: true, path: '/Projeto' }],
      library_files: [],
    },
    generatedId: ['library_files'],
    uniquePartial: {
      library_files: [{ columns: ['user_id', 'source_image_id'], where: (row) => row.source_image_id != null && row.deleted_at == null }],
    },
  })
  vi.mocked(server.createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: authedUser }, error: authedUser ? null : { message: 'no' } }) },
    from: db.from,
  } as any)
}

const signedFor = (path: string) => `https://signed.example.test/${path}?sig=1`

beforeEach(() => {
  vi.clearAllMocks()
  authedUser = { id: USER }
  vi.mocked(createPresignedReadUrl).mockImplementation(async (path: string) => signedFor(path))
  vi.mocked(copyS3ObjectToLibrary).mockResolvedValue({ storagePath: `users/${USER}/library/${BLOB2}/imagem-ia.png`, publicUrl: 'https://s3.example.test/lib', fileSize: 10, mimeType: 'image/png' } as never)
  seed()
})

const signedUrl = (id = IMG_OWN) => SIGNED_URL(new Request('http://localhost/x'), { params: Promise.resolve({ id }) })
const signPath = (body: Record<string, unknown>) =>
  SIGN_PATH(new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

describe('GET /api/images/:id/signed-url', () => {
  it('signs the owner’s own original and thumbnail', async () => {
    const response = await signedUrl()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.imageUrl).toBe(signedFor(original()))
    expect(body.thumbnailUrl).toBe(signedFor(thumb()))
  })

  it.each([
    ['another tenant’s key', { storage_path: original(VICTIM) }],
    ['a traversal key', { storage_path: `users/${USER}/images/../${VICTIM}/images/${BLOB2}/original.png` }],
    ['a lookalike owner prefix', { storage_path: `users/${USER}x/images/${BLOB2}/original.png` }],
    ['a Library key used as an image key', { storage_path: `users/${USER}/library/${BLOB2}/x.png` }],
    ['a URL instead of a key', { storage_path: `https://s3.example.test/${original()}` }],
    ['a forged foreign thumbnail key', { thumbnail_path: thumb(VICTIM) }],
    ['a thumbnail key in the original slot', { storage_path: thumb() }],
  ])('an OWNED row forged with %s is never signed (404, nothing presigned)', async (_name, overrides) => {
    seed([image(overrides)])
    const response = await signedUrl()
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('IMAGE_NOT_FOUND')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('does not serve another user’s image at all', async () => {
    seed([image({ id: 'img-victim', user_id: VICTIM, storage_path: original(VICTIM), thumbnail_path: thumb(VICTIM) })])
    expect((await signedUrl('img-victim')).status).toBe(404)
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('a legacy row with NO stored key (provider URL / data URL) keeps its existing behavior', async () => {
    seed([image({ storage_path: null, thumbnail_path: null, image_url: 'https://provider.example.test/legacy.png' })])
    const response = await signedUrl()
    expect(response.status).toBe(200)
    expect((await response.json()).imageUrl).toBe('https://provider.example.test/legacy.png')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    authedUser = null
    seed()
    expect((await signedUrl()).status).toBe(401)
  })
})

describe('POST /api/storage/sign-image-path', () => {
  it('re-signs the owner’s own image keys, given as a key or as a stored URL', async () => {
    const byKey = await signPath({ storagePath: original() })
    expect(byKey.status).toBe(200)
    expect((await byKey.json()).imageUrl).toBe(signedFor(original()))

    const byUrl = await signPath({ imageUrl: `https://s3.example.test/bucket/${original()}` })
    expect(byUrl.status).toBe(200)
    const byThumb = await signPath({ imageUrl: `https://s3.example.test/bucket/${thumb()}` })
    expect(byThumb.status).toBe(200)
  })

  it.each([
    ['a traversal key that still starts with the owner prefix', { storagePath: `users/${USER}/images/../${VICTIM}/images/${BLOB2}/original.png` }],
    ['a traversal key hidden in a URL path', { imageUrl: `https://s3.example.test/bucket/users/${USER}/images/%2e%2e/${VICTIM}/images/${BLOB2}/original.png` }],
    ['a lookalike owner prefix', { storagePath: `users/${USER}evil/images/${BLOB2}/original.png` }],
    ['another tenant', { storagePath: original(VICTIM) }],
    ['another tenant in a URL', { imageUrl: `https://s3.example.test/bucket/${original(VICTIM)}` }],
    ['a dots-only segment', { storagePath: `users/${USER}/images/./${BLOB2}/original.png` }],
    ['a Library key', { storagePath: `users/${USER}/library/${BLOB2}/x.png` }],
    ['an absolute filesystem path', { storagePath: '/etc/passwd' }],
    ['an unrelated key', { storagePath: 'some/other/key.png' }],
    ['a missing body value', {}],
  ])('rejects %s (400, nothing presigned)', async (_name, body) => {
    const response = await signPath(body)
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_STORAGE_PATH')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })
})

describe('ChannelPiece media resolution (images branch)', () => {
  it('signs the owner’s own keys and never signs — nor falls back to the URL of — a forged row', async () => {
    seed([image(), image({ id: 'img-forged', storage_path: original(VICTIM), image_url: 'https://attacker.example.test/x.png' })])
    const client = { from: db.from } as any
    const good = await resolveMediaSource(client, { image_id: IMG_OWN, library_file_id: null } as any)
    expect(good.image_url).toBe(signedFor(original()))

    vi.mocked(createPresignedReadUrl).mockClear()
    const bad = await resolveMediaSource(client, { image_id: 'img-forged', library_file_id: null } as any)
    expect(bad.image_url).toBeNull()
    expect(bad.thumbnail_url).toBeNull()
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })
})

describe('Image → Library promotion', () => {
  const promote = (id = IMG_OWN) => PROMOTE(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) })

  it('still promotes a genuine image', async () => {
    const response = await promote()
    expect(response.status).toBe(201)
    expect(vi.mocked(copyS3ObjectToLibrary).mock.calls[0][0]).toMatchObject({ userId: USER, sourcePath: original() })
  })

  it('never copies an owned row that was forged to point at another tenant’s object', async () => {
    seed([image({ storage_path: `users/${USER}/images/../${VICTIM}/images/${BLOB2}/original.png` })])
    const response = await promote()
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(db.tables.library_files).toHaveLength(0)
  })
})

describe('POST /api/storage/presign-image-upload — folder and extension', () => {
  it('no longer lets a caller presign into the generated-image namespace', async () => {
    const createPresignedImageUpload = vi.fn()
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }) }))
    vi.doMock('@/lib/storage/s3', () => ({ createPresignedImageUpload: createPresignedImageUpload.mockResolvedValue({ uploadUrl: 'u' }) }))
    const { POST } = await import('@/app/api/storage/presign-image-upload/route')
    await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ folder: 'images', mimeType: 'image/png', filename: 'a.png' }) }))
    expect(createPresignedImageUpload.mock.calls[0][0].folder).toBe('posts')
    await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ folder: 'library', mimeType: 'image/png', filename: 'a.png' }) }))
    expect(createPresignedImageUpload.mock.calls[1][0].folder).toBe('library')
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('@/lib/storage/s3')
    void PRESIGN_UPLOAD
  })
})
