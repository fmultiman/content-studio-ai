import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1 — adversarial + regression tests.
// In-memory DB and S3 only; every user, project and object key below is synthetic.
// No provider, storage or paid call exists in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(),
  deleteS3Object: vi.fn(),
  moveLibraryS3Object: vi.fn(),
  headS3Object: vi.fn(),
  buildStoragePublicUrl: vi.fn(),
}))

import * as server from '@/lib/supabase/server'
import { buildStoragePublicUrl, createPresignedReadUrl, deleteS3Object, headS3Object, moveLibraryS3Object } from '@/lib/storage/s3'
import { DELETE, GET, PATCH, POST } from '@/app/api/library-files/route'
import { GET as DOWNLOAD } from '@/app/api/library-files/[id]/download/route'
import { resolveMediaSource } from '@/app/api/channel-piece-media/_helpers'
import { IMAGE_REFERENCE_MAX_BYTES, OPENAI_IMAGE_REFERENCE_MAX_BYTES } from '@/lib/media-source/profile'

const USER = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const FOREIGN_PROJECT = '44444444-4444-4444-8444-444444444444'
const FOLDER_ID = '55555555-5555-4555-8555-555555555555'
const BLOB = '66666666-6666-4666-8666-666666666666'
const BLOB2 = '77777777-7777-4777-8777-777777777777'

const own = (blob = BLOB, file = 'foto.png') => `users/${USER}/library/${blob}/${file}`
const foreign = (blob = BLOB2, file = 'secret.png') => `users/${VICTIM}/library/${blob}/${file}`

let db: FakeDb
let authedUser: { id: string } | null

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-own',
    user_id: USER,
    project_id: PROJECT,
    folder: '/Projeto',
    name: 'foto.png',
    kind: 'image',
    mime_type: 'image/png',
    file_size: 10,
    storage_provider: 's3',
    storage_path: own(),
    public_url: 'https://s3.example.test/x',
    thumbnail_url: null,
    origin: 'upload',
    deleted_at: null,
    ...overrides,
  }
}

function seed(files: Array<Record<string, unknown>> = [row()]) {
  db = createFakeDb({
    seed: {
      library_files: files,
      projects: [{ id: PROJECT, user_id: USER }, { id: FOREIGN_PROJECT, user_id: VICTIM }],
      library_folders: [{ id: FOLDER_ID, user_id: USER, project_id: PROJECT, path: '/Projeto' }],
    },
    generatedId: ['library_files'],
  })
  vi.mocked(server.createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: authedUser }, error: authedUser ? null : { message: 'no' } }) },
    from: db.from,
  } as any)
}

const json = (body: unknown, method = 'POST') => new Request('http://localhost/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const files = () => db.tables.library_files ?? []

beforeEach(() => {
  vi.clearAllMocks()
  authedUser = { id: USER }
  vi.mocked(createPresignedReadUrl).mockImplementation(async (path: string) => `https://signed.example.test/${path}?sig=1`)
  vi.mocked(deleteS3Object).mockResolvedValue(true)
  vi.mocked(headS3Object).mockResolvedValue({ size: 4096, contentType: 'image/png' })
  vi.mocked(buildStoragePublicUrl).mockImplementation((path: string) => `https://s3.example.test/bucket/${path}`)
  vi.mocked(moveLibraryS3Object).mockImplementation(async (input: any) => ({
    storagePath: `users/${input.userId}/library/${input.targetFolder.replace(/^\//, '')}/${BLOB}/foto.png`,
    publicUrl: 'https://s3.example.test/moved',
  }))
  seed()
})

const registration = (overrides: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  folder: '/Projeto',
  name: 'nova.png',
  kind: 'image',
  mimeType: 'image/png',
  fileSize: 1,
  storageProvider: 's3',
  storagePath: own(BLOB2, 'nova.png'),
  publicUrl: 'https://attacker.example.test/pixel.png',
  thumbnailUrl: 'https://attacker.example.test/thumb.png',
  ...overrides,
})

describe('POST /api/library-files — registration trusts nothing the browser says', () => {
  it.each([-1, 0])('registers OpenAI WebP references at 20 MiB %+d bytes using actual S3 metadata', async (offset) => {
    const size = OPENAI_IMAGE_REFERENCE_MAX_BYTES + offset
    vi.mocked(headS3Object).mockResolvedValue({ size, contentType: 'image/webp' })
    const response = await POST(json(registration({ profile: 'openai-image-reference', fileSize: 1, mimeType: 'image/png' })))
    expect(response.status).toBe(200)
    expect(files().at(-1)).toMatchObject({ mime_type: 'image/webp', file_size: size, storage_provider: 's3', project_id: PROJECT })
  })

  it('refuses actual OpenAI objects over 20 MiB despite a smaller browser size', async () => {
    vi.mocked(headS3Object).mockResolvedValue({ size: OPENAI_IMAGE_REFERENCE_MAX_BYTES + 1, contentType: 'image/webp' })
    const response = await POST(json(registration({ profile: 'openai-image-reference', fileSize: 1 })))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'REFERENCE_TOO_LARGE', error: expect.stringContaining('20 MiB') })
    expect(files()).toHaveLength(1)
  })

  it('retains OpenAI Project/key/MIME restrictions and rejects unknown profiles', async () => {
    expect((await POST(json(registration({ profile: 'openai-image-reference', projectId: FOREIGN_PROJECT })))).status).toBe(404)
    expect((await POST(json(registration({ profile: 'openai-image-reference', projectId: null })))).status).toBe(404)
    expect((await POST(json(registration({ profile: 'openai-image-reference', storagePath: foreign() })))).status).toBe(400)
    expect((await POST(json(registration({ profile: 'openai' })))).status).toBe(400)
    expect(headS3Object).not.toHaveBeenCalled()
    vi.mocked(headS3Object).mockResolvedValue({ size: 100, contentType: 'image/gif' })
    const response = await POST(json(registration({ profile: 'openai-image-reference', mimeType: 'image/png' })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('REFERENCE_FORMAT_UNSUPPORTED')
    expect(files()).toHaveLength(1)
  })
  it('registers a WebP reference at exactly 10 MiB using S3 MIME/size rather than browser metadata', async () => {
    vi.mocked(headS3Object).mockResolvedValue({ size: IMAGE_REFERENCE_MAX_BYTES, contentType: 'image/webp' })
    const response = await POST(json(registration({ profile: 'image-reference', mimeType: 'image/png', fileSize: 1 })))
    expect(response.status).toBe(200)
    expect(files().at(-1)).toMatchObject({ mime_type: 'image/webp', file_size: IMAGE_REFERENCE_MAX_BYTES, storage_provider: 's3', project_id: PROJECT })
  })

  it('refuses oversized actual reference objects despite a smaller claimed size', async () => {
    vi.mocked(headS3Object).mockResolvedValue({ size: IMAGE_REFERENCE_MAX_BYTES + 1, contentType: 'image/png' })
    const response = await POST(json(registration({ profile: 'image-reference', fileSize: 1 })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('REFERENCE_TOO_LARGE')
    expect(files()).toHaveLength(1)
  })

  it('refuses GIF reference objects despite a browser PNG claim, and requires an owned Project', async () => {
    vi.mocked(headS3Object).mockResolvedValue({ size: 100, contentType: 'image/gif' })
    const response = await POST(json(registration({ profile: 'image-reference' })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('REFERENCE_FORMAT_UNSUPPORTED')
    expect((await POST(json(registration({ profile: 'image-reference', projectId: null })))).status).toBe(404)
    expect((await POST(json(registration({ profile: 'image-reference', projectId: FOREIGN_PROJECT })))).status).toBe(404)
    expect(files()).toHaveLength(1)
  })
  it('registers the user’s own key in the user’s own Project and derives kind, size and URLs server-side', async () => {
    const response = await POST(json(registration({ kind: 'document', fileSize: 999_999_999 })))
    expect(response.status).toBe(200)
    const created = files().find((file) => file.name === 'nova.png')!
    expect(created).toMatchObject({
      user_id: USER,
      project_id: PROJECT,
      storage_path: own(BLOB2, 'nova.png'),
      kind: 'image', // from the MIME, not the browser's "document"
      file_size: 4096, // from S3's HEAD, not the browser
      public_url: `https://s3.example.test/bucket/${own(BLOB2, 'nova.png')}`,
      thumbnail_url: null,
    })
    expect(JSON.stringify(created)).not.toContain('attacker.example.test')
  })

  it.each([
    ['another tenant’s canonical namespace', foreign()],
    ['a traversal-like key', `users/${USER}/library/../${VICTIM}/library/${BLOB2}/x.png`],
    ['a URL instead of a key', `https://s3.example.test/bucket/users/${USER}/library/${BLOB2}/x.png`],
    ['an absolute filesystem path', `/etc/passwd`],
    ['a key outside the Library namespace', `users/${USER}/images/${BLOB2}/original.png`],
    ['a malformed key', 'nova.png'],
  ])('rejects %s and writes nothing', async (_name, storagePath) => {
    const response = await POST(json(registration({ storagePath })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_STORAGE_PATH')
    expect(files()).toHaveLength(1)
    expect(headS3Object).not.toHaveBeenCalled()
  })

  it('rejects a Project that belongs to someone else (404, no hint it exists) and accepts the user’s own', async () => {
    const denied = await POST(json(registration({ projectId: FOREIGN_PROJECT })))
    expect(denied.status).toBe(404)
    expect((await denied.json()).code).toBe('PROJECT_NOT_FOUND')
    const garbage = await POST(json(registration({ projectId: 'not-a-uuid' })))
    expect(garbage.status).toBe(404)
    expect(files()).toHaveLength(1)

    const allowed = await POST(json(registration()))
    expect(allowed.status).toBe(200)
    expect(files()).toHaveLength(2)
  })

  it('refuses to register an object that is not in storage', async () => {
    vi.mocked(headS3Object).mockRejectedValueOnce(new Error('NotFound'))
    const response = await POST(json(registration()))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('UPLOAD_NOT_FOUND')
    expect(files()).toHaveLength(1)
  })

  it('requires authentication', async () => {
    authedUser = null
    seed()
    expect((await POST(json(registration()))).status).toBe(401)
  })
})

describe('PATCH /api/library-files — move / restore cannot cross an ownership boundary', () => {
  it('ignores any browser-supplied storage path: the stored key only ever comes from the server-side move', async () => {
    const response = await PATCH(json({ ids: ['file-own'], targetFolderId: FOLDER_ID, storagePath: foreign(), storage_path: foreign(), userId: VICTIM }, 'PATCH'))
    expect(response.status).toBe(200)
    const file = files()[0]
    expect(file.storage_path).toBe(`users/${USER}/library/Projeto/${BLOB}/foto.png`)
    expect(file.user_id).toBe(USER)
    expect(JSON.stringify(file)).not.toContain(VICTIM)
  })

  it('refuses to move a file into a Project the user does not own (404) — before any storage move', async () => {
    const response = await PATCH(json({ ids: ['file-own'], targetFolder: '/', targetProjectId: FOREIGN_PROJECT }, 'PATCH'))
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PROJECT_NOT_FOUND')
    expect(moveLibraryS3Object).not.toHaveBeenCalled()
    expect(files()[0].project_id).toBe(PROJECT)
  })

  it('still moves to "no Project" (null) and into the user’s own Project', async () => {
    const toNone = await PATCH(json({ ids: ['file-own'], targetFolder: '/', targetProjectId: null }, 'PATCH'))
    expect(toNone.status).toBe(200)
    expect(files()[0].project_id).toBeNull()
    const toOwn = await PATCH(json({ ids: ['file-own'], targetFolder: '/Projeto', targetProjectId: PROJECT }, 'PATCH'))
    expect(toOwn.status).toBe(200)
    expect(files()[0].project_id).toBe(PROJECT)
  })

  it('never re-keys a traversal-forged row in S3 (the copy would pull another tenant’s object into the namespace)', async () => {
    seed([row({ id: 'file-traversal', storage_path: `users/${USER}/library/../${VICTIM}/library/${BLOB2}/x.png` })])
    const response = await PATCH(json({ ids: ['file-traversal'], targetFolderId: FOLDER_ID }, 'PATCH'))
    expect(response.status).toBe(200)
    expect(moveLibraryS3Object).not.toHaveBeenCalled()
  })

  it('Trash and restore keep working', async () => {
    expect((await DELETE(json({ ids: ['file-own'] }, 'DELETE'))).status).toBe(200)
    expect(files()[0].deleted_at).not.toBeNull()
    expect((await PATCH(json({ ids: ['file-own'], restore: true }, 'PATCH'))).status).toBe(200)
    expect(files()[0].deleted_at).toBeNull()
    expect(deleteS3Object).not.toHaveBeenCalled()
  })
})

describe('presign — a forged row never makes the server sign another tenant’s object', () => {
  const forgedRow = () => row({ id: 'file-forged', storage_path: foreign() })

  it('GET /api/library-files signs the genuine row and never the forged one', async () => {
    seed([row(), forgedRow()])
    const response = await GET(new Request('http://localhost/api/library-files?projectId=' + PROJECT))
    const body = await response.json()
    const signedPaths = vi.mocked(createPresignedReadUrl).mock.calls.map(([path]) => path)
    expect(signedPaths).toEqual([own()])
    const forged = body.files.find((file: any) => file.id === 'file-forged')
    expect(JSON.stringify(forged)).not.toContain('signed.example.test')
  })

  it('GET /api/library-files/:id/download: owned row → redirect; forged path on an owned row → 404 and no signing', async () => {
    seed([row(), forgedRow()])
    const good = await DOWNLOAD(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'file-own' }) })
    expect(good.status).toBe(307)
    vi.mocked(createPresignedReadUrl).mockClear()

    const bad = await DOWNLOAD(new Request('http://localhost/x'), { params: Promise.resolve({ id: 'file-forged' }) })
    expect(bad.status).toBe(404)
    expect((await bad.json()).code).toBe('LIBRARY_FILE_NOT_FOUND')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('ChannelPiece media resolution never signs, nor falls back to the URL of, a forged LibraryFile', async () => {
    seed([row(), forgedRow()])
    const client = { from: db.from } as any
    const good = await resolveMediaSource(client, { library_file_id: 'file-own', image_id: null } as any)
    expect(good.image_url).toContain('signed.example.test')

    vi.mocked(createPresignedReadUrl).mockClear()
    const bad = await resolveMediaSource(client, { library_file_id: 'file-forged', image_id: null } as any)
    expect(bad.image_url).toBeNull()
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })
})

describe('permanent delete — a forged storage_path is never a delete primitive', () => {
  it('deletes the owner’s object, and only removes the ROW of a forged one (the victim object is untouched)', async () => {
    seed([row(), row({ id: 'file-forged', storage_path: foreign() })])
    const response = await DELETE(json({ ids: ['file-own', 'file-forged'], permanent: true }, 'DELETE'))
    expect(response.status).toBe(200)
    expect(vi.mocked(deleteS3Object).mock.calls.map(([path]) => path)).toEqual([own()])
    expect(files()).toHaveLength(0)
  })

  it('never deletes another user’s row', async () => {
    seed([row({ id: 'file-victim', user_id: VICTIM, storage_path: foreign() })])
    const response = await DELETE(json({ ids: ['file-victim'], permanent: true }, 'DELETE'))
    expect(response.status).toBe(200)
    expect(deleteS3Object).not.toHaveBeenCalled()
    expect(files()).toHaveLength(1)
  })
})
