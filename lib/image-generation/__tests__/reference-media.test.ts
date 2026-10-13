import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ head: vi.fn(), open: vi.fn(), presignImage: vi.fn(), presignLibrary: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ headS3Object: mocks.head, openS3ObjectStream: mocks.open }))
vi.mock('@/lib/storage/image-storage', () => ({ presignImageObject: mocks.presignImage }))
vi.mock('@/lib/storage/library-storage', () => ({ presignLibraryRead: mocks.presignLibrary }))

import { loadGeminiImageReferences, validateGeminiReferenceBytes } from '@/lib/image-generation/reference-media'
import { resolveGeminiImageModel } from '@/lib/providers/gemini/image-models'
import { createFakeDb } from '@/lib/__tests__/helpers/fake-image-db'

const USER = 'user-1'
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = '11111111-1111-4111-8111-111111111111'
const KEY = `users/${USER}/library/${SOURCE}/source.png`
const REF = { type: 'library_file' as const, id: SOURCE }
const MODEL = resolveGeminiImageModel('gemini-nb-2.1')!
const MAX_BYTES = 10 * 1024 * 1024
let png: Buffer
let jpeg: Buffer
let webp: Buffer
let gif: Buffer
let oversizedWidth: Buffer
let boundaryWidth: Buffer
let animatedWebp: Buffer

beforeAll(async () => {
  const image = sharp({ create: { width: 20, height: 12, channels: 3, background: '#309040' } })
  ;[png, jpeg, webp, gif, boundaryWidth, oversizedWidth, animatedWebp] = await Promise.all([
    image.clone().png({ compressionLevel: 0 }).toBuffer(), image.clone().jpeg().toBuffer(), image.clone().webp().toBuffer(), image.clone().gif().toBuffer(),
    sharp({ create: { width: 8192, height: 1, channels: 3, background: '#309040' } }).png().toBuffer(),
    sharp({ create: { width: 8193, height: 1, channels: 3, background: '#309040' } }).png().toBuffer(),
    sharp(Buffer.concat([Buffer.alloc(20 * 12 * 3, 40), Buffer.alloc(20 * 12 * 3, 180)]),
      { raw: { width: 20, height: 24, channels: 3, pageHeight: 12 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer(),
  ])
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.head.mockResolvedValue({ size: png.length })
  mocks.open.mockImplementation(async () => ({ stream: Readable.from([png]) }))
})
afterEach(() => vi.restoreAllMocks())

function load(overrides: Partial<Parameters<typeof loadGeminiImageReferences>[0]> = {}) {
  const db = createFakeDb({ library_files: [{
    id: SOURCE, user_id: USER, project_id: PROJECT, kind: 'image', deleted_at: null,
    storage_path: KEY, public_url: 'http://169.254.169.254/never-fetch',
  }] })
  return loadGeminiImageReferences({ db: db as unknown as SupabaseClient, userId: USER, projectId: PROJECT, references: [REF], model: MODEL, ...overrides })
}

describe('Gemini reference format and decoding ceilings', () => {
  it.each(['gemini-nb-2.1', 'gemini-nb-lite'])('%s accepts PNG/JPEG/WebP using signatures and decoded dimensions', async (alias) => {
    const model = resolveGeminiImageModel(alias)!
    for (const [bytes, mimeType] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [webp, 'image/webp']] as const) {
      expect(await validateGeminiReferenceBytes(bytes, model)).toEqual({ mimeType, width: 20, height: 12 })
    }
  })

  it('accepts the 8192-pixel boundary and wide framing independently of the Video policy', async () => {
    expect(await validateGeminiReferenceBytes(boundaryWidth, MODEL)).toEqual({ mimeType: 'image/png', width: 8192, height: 1 })
    await expect(validateGeminiReferenceBytes(oversizedWidth, MODEL)).rejects.toMatchObject({ status: 422, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
  })

  it('rejects empty input and bytes over 10 MiB', async () => {
    await expect(validateGeminiReferenceBytes(Buffer.alloc(0), MODEL)).rejects.toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    await expect(validateGeminiReferenceBytes(Buffer.alloc(MAX_BYTES + 1), MODEL)).rejects.toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
  })

  it('rejects GIF and a truncated image with a valid PNG signature', async () => {
    for (const bytes of [gif, png.subarray(0, 16), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]) {
      await expect(validateGeminiReferenceBytes(bytes, MODEL)).rejects.toMatchObject({ status: 422, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
    }
  })

  it('rejects truncated PNG pixels even when the complete IHDR metadata is readable', async () => {
    const truncated = png.subarray(0, Math.floor(png.length / 2))
    expect(await sharp(truncated).metadata()).toMatchObject({ format: 'png', width: 20, height: 12 })
    await expect(validateGeminiReferenceBytes(truncated, MODEL)).rejects.toMatchObject({
      status: 422, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED',
    })
  })

  it('rejects animated WebP rather than silently sending its first frame', async () => {
    expect((await sharp(animatedWebp, { animated: true }).metadata()).pages).toBe(2)
    await expect(validateGeminiReferenceBytes(animatedWebp, MODEL)).rejects.toMatchObject({ code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })
})

describe('bounded durable-object reads', () => {
  it('reassembles stream chunks and hashes original bytes, without presigning source URLs', async () => {
    const stream = Readable.from([png.subarray(0, 8), png.subarray(8, 20), png.subarray(20)])
    const destroy = vi.spyOn(stream, 'destroy')
    mocks.open.mockResolvedValue({ stream })
    const [result] = await load()
    expect(result.bytes).toEqual(png)
    expect(result.provenance).toEqual({ ...REF, mimeType: 'image/png', width: 20, height: 12,
      byteLength: png.length, sha256: createHash('sha256').update(png).digest('hex'),
    })
    expect(mocks.head).toHaveBeenCalledWith(KEY)
    expect(mocks.open).toHaveBeenCalledWith(KEY)
    expect(destroy).toHaveBeenCalled()
    expect(mocks.presignImage).not.toHaveBeenCalled()
    expect(mocks.presignLibrary).not.toHaveBeenCalled()
  })

  it('rejects a HEAD size over the ceiling before opening a stream', async () => {
    mocks.head.mockResolvedValue({ size: MAX_BYTES + 1 })
    await expect(load()).rejects.toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('enforces the stream ceiling despite an understated HEAD, destroying the stream', async () => {
    const stream = Readable.from([Buffer.alloc(MAX_BYTES), Buffer.from([1])])
    const destroy = vi.spyOn(stream, 'destroy')
    mocks.head.mockResolvedValue({ size: 1 })
    mocks.open.mockResolvedValue({ stream })
    await expect(load()).rejects.toMatchObject({ code: 'SOURCE_IMAGE_TOO_LARGE' })
    expect(destroy).toHaveBeenCalled()
    expect(stream.destroyed).toBe(true)
  })

  it('accepts a valid image exactly at the 10 MiB stream ceiling', async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(MAX_BYTES - png.length)])
    mocks.head.mockResolvedValue({ size: MAX_BYTES })
    mocks.open.mockResolvedValue({ stream: Readable.from([bytes]) })
    const [result] = await load()
    expect(result.provenance.byteLength).toBe(MAX_BYTES)
    expect(result.provenance.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it.each(['head missing', 'head error', 'stream missing', 'stream error'])('maps %s to unavailable media', async (failure) => {
    if (failure === 'head missing') mocks.head.mockResolvedValue(null)
    if (failure === 'head error') mocks.head.mockRejectedValue(new Error('fake object error'))
    if (failure === 'stream missing') mocks.open.mockResolvedValue(null)
    if (failure === 'stream error') {
      const stream = Readable.from((async function* () { yield png.subarray(0, 8); throw new Error('fake read failed') })())
      mocks.open.mockResolvedValue({ stream })
    }
    await expect(load()).rejects.toMatchObject({ status: 422, code: 'SOURCE_MEDIA_UNAVAILABLE' })
  })

  it('returns no references without a Project or object access for text-to-image', async () => {
    expect(await load({ references: [], projectId: null })).toEqual([])
    expect(mocks.head).not.toHaveBeenCalled()
  })

  it('enforces the one-reference and Project requirements before source resolution', async () => {
    await expect(load({ references: [REF, REF] })).rejects.toMatchObject({ code: 'SOURCE_REFERENCE_LIMIT' })
    await expect(load({ projectId: null })).rejects.toMatchObject({ code: 'SOURCE_PROJECT_REQUIRED' })
    expect(mocks.head).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
