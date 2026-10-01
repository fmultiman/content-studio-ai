import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'
import { gifBytes, jpegBytes, pngBytes, toDataUrl, webpBytes } from './helpers/image-fixtures'

// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — trusted Image -> Video source resolution. In-memory DB and storage.

vi.mock('@/lib/storage/s3', () => ({ createPresignedReadUrl: vi.fn(async (path: string) => `https://signed.example.test/${path}?sig=1`) }))

import { createPresignedReadUrl } from '@/lib/storage/s3'
import { loadTrustedI2vSourceImage, resolveI2vSource, type I2vSourceLocator } from '@/lib/video-generation/i2v-source-media'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PROJECT = 'proj-1'
const BLOB = '33333333-3333-4333-8333-333333333333'

const imageKey = (user = USER, file = 'original.png') => `users/${user}/images/${BLOB}/${file}`
const libraryKey = (user = USER, file = 'capa.png') => `users/${user}/library/${BLOB}/${file}`

const imageRow = (overrides: Record<string, unknown> = {}) => ({ id: 'img-1', user_id: USER, project_id: PROJECT, user_input: 'Uma raposa', image_url: 'https://legacy.example.test/x.png', storage_path: imageKey(), mime_type: 'image/png', ...overrides })
const libRow = (overrides: Record<string, unknown> = {}) => ({ id: 'lib-1', user_id: USER, project_id: PROJECT, kind: 'image', mime_type: 'image/png', name: 'capa.png', storage_path: libraryKey(), public_url: 'https://cdn.example.test/capa.png', deleted_at: null, origin: 'upload', ...overrides })

const db = (rows: { images?: any[]; files?: any[] } = {}) => createFakeDb({ seed: { images: rows.images ?? [imageRow()], library_files: rows.files ?? [libRow()] }, generatedId: [] }) as any

const resolveBytes = (client: any, params: { sourceImageId?: string; sourceLibraryFileId?: string; userId?: string; projectId?: string }) =>
  resolveI2vSource(client, { userId: params.userId ?? USER, projectId: params.projectId ?? PROJECT, sourceImageId: params.sourceImageId, sourceLibraryFileId: params.sourceLibraryFileId, deliver: 'bytes' })

const storage = (bytes: Uint8Array | null, size = bytes?.byteLength ?? 0) => ({
  headObject: vi.fn(async () => (bytes ? { size } : null)),
  readObject: vi.fn(async (_key: string, _options: { maxBytes: number }) => (bytes ? { bytes } : null)),
})

async function load(client: any, params: Parameters<typeof resolveBytes>[1], bytes: Uint8Array | null) {
  const resolved = await resolveBytes(client, params)
  if (!resolved.ok) throw new Error(`resolve failed: ${resolved.status}`)
  const deps = storage(bytes)
  return { result: await loadTrustedI2vSourceImage(resolved.locator, deps), deps, locator: resolved.locator }
}

beforeEach(() => vi.clearAllMocks())

describe('1-6. trusted bytes from every legitimate source', () => {
  it('1. a generated PNG (`images`) resolves its trusted bytes', async () => {
    const { result, deps } = await load(db(), { sourceImageId: 'img-1' }, pngBytes(800, 600))
    expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/png', sourceKind: 'image', sourceId: 'img-1', filename: 'Uma-raposa.png' } })
    expect(deps.readObject).toHaveBeenCalledWith(imageKey(), { maxBytes: 30_000_000 })
  })

  it('2. a generated JPEG resolves as image/jpeg with a .jpg upload name', async () => {
    const client = db({ images: [imageRow({ storage_path: imageKey(USER, 'original.jpg'), mime_type: 'image/jpeg' })] })
    const { result } = await load(client, { sourceImageId: 'img-1' }, jpegBytes(1200, 900))
    expect(result).toMatchObject({ ok: true, image: { mimeType: 'image/jpeg', filename: 'Uma-raposa.jpg' } })
  })

  it('3/4. a Library PNG and a Library JPEG resolve their trusted bytes', async () => {
    const png = await load(db(), { sourceLibraryFileId: 'lib-1' }, pngBytes())
    expect(png.result).toMatchObject({ ok: true, image: { mimeType: 'image/png', sourceKind: 'library', sourceId: 'lib-1', filename: 'capa.png' } })
    expect(png.deps.readObject).toHaveBeenCalledWith(libraryKey(), { maxBytes: 30_000_000 })
    const jpeg = await load(db({ files: [libRow({ name: 'retrato.jpeg', mime_type: 'image/jpeg', storage_path: libraryKey(USER, 'retrato.jpeg') })] }), { sourceLibraryFileId: 'lib-1' }, jpegBytes())
    expect(jpeg.result).toMatchObject({ ok: true, image: { mimeType: 'image/jpeg', filename: 'retrato.jpg' } })
  })

  it('5/6. a Gallery render (origin studio_render) and an uploaded file are simply LibraryFiles: same path, the UI label is irrelevant', async () => {
    for (const origin of ['studio_render', 'upload']) {
      const { result } = await load(db({ files: [libRow({ origin })] }), { sourceLibraryFileId: 'lib-1' }, pngBytes())
      expect(result.ok).toBe(true)
    }
  })
})

describe('7-11. the trust chain refuses', () => {
  it('7. a deleted LibraryFile', async () => {
    const resolved = await resolveBytes(db({ files: [libRow({ deleted_at: '2026-09-01T00:00:00Z' })] }), { sourceLibraryFileId: 'lib-1' })
    expect(resolved).toMatchObject({ ok: false, status: 422, body: { code: 'SOURCE_LIBRARY_FILE_DELETED' } })
  })

  it('a LibraryFile that is not an image', async () => {
    const resolved = await resolveBytes(db({ files: [libRow({ kind: 'video', mime_type: 'video/mp4' })] }), { sourceLibraryFileId: 'lib-1' })
    expect(resolved).toMatchObject({ ok: false, status: 422, body: { code: 'SOURCE_LIBRARY_FILE_NOT_IMAGE' } })
  })

  it('8. another user’s source (image or file) is indistinguishable from not found (403)', async () => {
    expect(await resolveBytes(db({ images: [imageRow({ user_id: OTHER, storage_path: imageKey(OTHER) })] }), { sourceImageId: 'img-1' })).toMatchObject({ ok: false, status: 403 })
    expect(await resolveBytes(db({ files: [libRow({ user_id: OTHER, storage_path: libraryKey(OTHER) })] }), { sourceLibraryFileId: 'lib-1' })).toMatchObject({ ok: false, status: 403 })
  })

  it('9. a source of another Project (403)', async () => {
    expect(await resolveBytes(db({ images: [imageRow({ project_id: 'proj-other' })] }), { sourceImageId: 'img-1' })).toMatchObject({ ok: false, status: 403 })
    expect(await resolveBytes(db({ files: [libRow({ project_id: 'proj-other' })] }), { sourceLibraryFileId: 'lib-1' })).toMatchObject({ ok: false, status: 403 })
  })

  it.each([
    ['another user’s Library key', { files: [libRow({ storage_path: libraryKey(OTHER) })] }, { sourceLibraryFileId: 'lib-1' }],
    ['a traversal Library key', { files: [libRow({ storage_path: `users/${USER}/library/${BLOB}/../../../${OTHER}/secret.png` })] }, { sourceLibraryFileId: 'lib-1' }],
    ['a Library key in the images namespace', { files: [libRow({ storage_path: imageKey() })] }, { sourceLibraryFileId: 'lib-1' }],
    ['an absolute URL used as a Library key', { files: [libRow({ storage_path: 'https://evil.example.test/x.png' })] }, { sourceLibraryFileId: 'lib-1' }],
    ['another user’s image key', { images: [imageRow({ storage_path: imageKey(OTHER) })] }, { sourceImageId: 'img-1' }],
    ['a traversal image key', { images: [imageRow({ storage_path: `users/${USER}/images/${BLOB}/../../../${OTHER}/x/original.png` })] }, { sourceImageId: 'img-1' }],
    ['an image key outside the images namespace', { images: [imageRow({ storage_path: libraryKey() })] }, { sourceImageId: 'img-1' }],
  ])('10/11. %s is refused BEFORE any read (SOURCE_MEDIA_UNAVAILABLE)', async (_name, rows, params) => {
    const resolved = await resolveBytes(db(rows), params)
    expect(resolved).toMatchObject({ ok: false, status: 422, body: { code: 'SOURCE_MEDIA_UNAVAILABLE' } })
  })

  it('10/11. defense in depth: even a hand-built locator with a forged key reads nothing', async () => {
    const forged: I2vSourceLocator[] = [
      { kind: 'library', id: 'lib-1', ownerUserId: USER, storageKey: libraryKey(OTHER), legacyUrl: null, displayName: 'x' },
      { kind: 'image', id: 'img-1', ownerUserId: USER, storageKey: imageKey(OTHER), legacyUrl: null, displayName: 'x' },
    ]
    for (const locator of forged) {
      const deps = storage(pngBytes())
      expect(await loadTrustedI2vSourceImage(locator, deps)).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
      expect(deps.headObject).not.toHaveBeenCalled()
      expect(deps.readObject).not.toHaveBeenCalled()
    }
  })
})

describe('12-13. format and authority', () => {
  it.each([
    ['WebP bytes behind an image/png row', webpBytes()],
    ['GIF bytes', gifBytes()],
    ['text', new TextEncoder().encode('not an image')],
  ])('12. %s is SOURCE_IMAGE_FORMAT_UNSUPPORTED (the stored mime is never trusted)', async (_name, bytes) => {
    const { result } = await load(db(), { sourceLibraryFileId: 'lib-1' }, bytes)
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })

  it('an over-size object is refused from its HEAD size, without pulling it into memory', async () => {
    const resolved = await resolveBytes(db(), { sourceLibraryFileId: 'lib-1' })
    if (!resolved.ok) throw new Error('unexpected')
    const deps = storage(pngBytes(), 30_000_001)
    expect(await loadTrustedI2vSourceImage(resolved.locator, deps)).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(deps.readObject).not.toHaveBeenCalled()
  })

  it('a missing object, a failing read and an empty body are "unavailable"', async () => {
    const resolved = await resolveBytes(db(), { sourceLibraryFileId: 'lib-1' })
    if (!resolved.ok) throw new Error('unexpected')
    expect(await loadTrustedI2vSourceImage(resolved.locator, storage(null))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
    expect(await loadTrustedI2vSourceImage(resolved.locator, { headObject: async () => ({ size: 10 }), readObject: async () => { throw new Error('boom') } })).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
    expect(await loadTrustedI2vSourceImage(resolved.locator, { headObject: async () => ({ size: 0 }), readObject: async () => ({ bytes: new Uint8Array(0) }) })).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
  })

  it('dimensions beyond the provider contract are refused here, before any upload', async () => {
    const { result } = await load(db(), { sourceLibraryFileId: 'lib-1' }, pngBytes(1000, 2500))
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
  })

  it('13. the browser’s URL/path/public_url is never the authority: only the STORED row’s key is read', async () => {
    const client = db({ files: [libRow({ public_url: 'https://evil.example.test/steal.png' })] })
    const resolved = await resolveI2vSource(client, { userId: USER, projectId: PROJECT, sourceLibraryFileId: 'lib-1', deliver: 'bytes', ...({ storage_path: 'users/victim/x.png', sourceUrl: 'https://evil.example.test/a.png' } as object) })
    if (!resolved.ok) throw new Error('unexpected')
    const deps = storage(pngBytes())
    await loadTrustedI2vSourceImage(resolved.locator, deps)
    expect(deps.readObject.mock.calls.map((call) => call[0])).toEqual([libraryKey()])
    expect(JSON.stringify(resolved.locator)).not.toContain('evil.example.test')
  })
})

describe('14-15. legacy representations', () => {
  it('14. a legacy image whose image_url is a bounded PNG/JPEG data URL is normalized to bytes', async () => {
    const png = await load(db({ images: [imageRow({ storage_path: null, image_url: toDataUrl(pngBytes(640, 480)) })] }), { sourceImageId: 'img-1' }, null)
    expect(png.result).toMatchObject({ ok: true, image: { mimeType: 'image/png' } })
    expect(png.deps.readObject).not.toHaveBeenCalled()
    const jpeg = await load(db({ images: [imageRow({ storage_path: null, image_url: toDataUrl(jpegBytes(640, 480), 'image/jpeg') })] }), { sourceImageId: 'img-1' }, null)
    expect(jpeg.result).toMatchObject({ ok: true, image: { mimeType: 'image/jpeg' } })
  })

  it('14. a legacy data URL that is really a WebP is refused by its bytes', async () => {
    const { result } = await load(db({ images: [imageRow({ storage_path: null, image_url: toDataUrl(webpBytes(), 'image/png') })] }), { sourceImageId: 'img-1' }, null)
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })

  it('15. a legacy EXTERNAL URL fails closed: nothing is fetched, nothing is read', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('x'))
    const { result, deps } = await load(db({ images: [imageRow({ storage_path: null, image_url: 'https://picsum.photos/seed/x/800/600' })] }), { sourceImageId: 'img-1' }, null)
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(deps.readObject).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('a Library file with no trusted key has nothing to read (its public_url is never fetched)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('x'))
    const { result } = await load(db({ files: [libRow({ storage_path: null })] }), { sourceLibraryFileId: 'lib-1' }, null)
    expect(result).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('no presigned Content Studio URL is created for Kling; REST keeps exactly what it always received', () => {
  it('deliver=bytes (MCP): the key is proven without signing anything', async () => {
    const resolved = await resolveBytes(db(), { sourceImageId: 'img-1' })
    expect(resolved).toMatchObject({ ok: true, restSourceUrl: '' })
    const library = await resolveBytes(db(), { sourceLibraryFileId: 'lib-1' })
    expect(library).toMatchObject({ ok: true, restSourceUrl: '' })
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('deliver=url (REST, the default): the same presigned URLs and legacy fallbacks as before', async () => {
    const image = await resolveI2vSource(db(), { userId: USER, projectId: PROJECT, sourceImageId: 'img-1' })
    expect(image).toMatchObject({ ok: true, restSourceUrl: `https://signed.example.test/${imageKey()}?sig=1` })
    const file = await resolveI2vSource(db(), { userId: USER, projectId: PROJECT, sourceLibraryFileId: 'lib-1' })
    expect(file).toMatchObject({ ok: true, restSourceUrl: `https://signed.example.test/${libraryKey()}?sig=1` })
    const legacy = await resolveI2vSource(db({ images: [imageRow({ storage_path: null })] }), { userId: USER, projectId: PROJECT, sourceImageId: 'img-1' })
    expect(legacy).toMatchObject({ ok: true, restSourceUrl: 'https://legacy.example.test/x.png' })
  })
})
