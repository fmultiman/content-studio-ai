import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ createPresignedImageUpload: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createPresignedImageUpload } from '@/lib/storage/s3'
import { POST } from '@/app/api/storage/presign-image-upload/route'
import { IMAGE_REFERENCE_MAX_BYTES, OPENAI_IMAGE_REFERENCE_MAX_BYTES, parseImageSourceProfile, sourceFormatErrorCopy, sourceMaxBytes, sourceMimeFromFile, sourceMimeTypes, sourceSizeErrorCopy } from '@/lib/media-source/profile'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const FOREIGN = '33333333-3333-4333-8333-333333333333'
const body = (overrides: Record<string, unknown> = {}) => ({ folder: 'library', mimeType: 'image/webp', filename: 'ref.webp', profile: 'image-reference', projectId: PROJECT, fileSize: IMAGE_REFERENCE_MAX_BYTES, ...overrides })
const presign = (payload: unknown) => POST(new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))

beforeEach(() => {
  vi.clearAllMocks()
  const db = createFakeDb({ seed: { projects: [{ id: PROJECT, user_id: USER }, { id: FOREIGN, user_id: 'other-user' }] } })
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, from: db.from } as any)
  vi.mocked(createPresignedImageUpload).mockResolvedValue({ uploadUrl: 'https://s3.example/upload', imageUrl: 'https://s3.example/ref.webp', storageProvider: 's3', storagePath: `users/${USER}/library/ref.webp`, mimeType: 'image/webp' })
})

describe('shared source profile policy', () => {
  it('keeps Video PNG/JPEG exactly, expands WebP only for image references', () => {
    expect(sourceMimeTypes('video-i2v')).toEqual(['image/png', 'image/jpeg'])
    expect(sourceMimeTypes('image-reference')).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(sourceMimeTypes('openai-image-reference')).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(sourceMimeFromFile({ name: 'ref.webp', type: '' }, 'image-reference')).toBe('image/webp')
    expect(sourceMimeFromFile({ name: 'ref.webp', type: '' }, 'video-i2v')).toBeNull()
    expect(sourceMimeFromFile({ name: 'ref.webp', type: 'image/gif' }, 'image-reference')).toBeNull()
    expect(sourceMimeFromFile({ name: 'ref.webp', type: '' }, 'openai-image-reference')).toBe('image/webp')
    expect(sourceMimeFromFile({ name: 'ref.webp', type: 'image/gif' }, 'openai-image-reference')).toBeNull()
  })

  it('validates the explicit profile union and preserves per-profile caps and error copy', () => {
    expect(parseImageSourceProfile('openai-image-reference')).toBe('openai-image-reference')
    expect(parseImageSourceProfile('openai')).toBeNull()
    expect(parseImageSourceProfile({ profile: 'openai-image-reference' })).toBeNull()
    expect(parseImageSourceProfile(null)).toBe('video-i2v')
    expect(sourceMaxBytes('video-i2v')).toBeNull()
    expect(sourceMaxBytes('image-reference')).toBe(10 * 1024 * 1024)
    expect(sourceMaxBytes('openai-image-reference')).toBe(20 * 1024 * 1024)
    expect(sourceSizeErrorCopy('image-reference')).toContain('10 MiB')
    expect(sourceSizeErrorCopy('openai-image-reference')).toContain('20 MiB')
    expect(sourceFormatErrorCopy('video-i2v')).not.toContain('WebP')
  })

  it('presigns an owned WebP reference exactly at the cap', async () => {
    expect((await presign(body())).status).toBe(200)
    expect(createPresignedImageUpload).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, folder: 'library', mimeType: 'image/webp' }))
  })

  it.each([{ fileSize: IMAGE_REFERENCE_MAX_BYTES + 1 }, { fileSize: 0 }, { fileSize: '10' }, { mimeType: 'image/gif' }, { folder: 'posts' }, { profile: 'arbitrary' }])('refuses invalid reference parameters before presign (%j)', async (invalid) => {
    expect((await presign(body(invalid))).status).toBe(400)
    expect(createPresignedImageUpload).not.toHaveBeenCalled()
  })

  it('keeps owned Project authorization before S3, and requires a Project for references', async () => {
    expect((await presign(body({ projectId: FOREIGN }))).status).toBe(404)
    expect((await presign(body({ projectId: null }))).status).toBe(400)
    expect(createPresignedImageUpload).not.toHaveBeenCalled()
  })

  it('preserves generic upload behavior when no profile is requested', async () => {
    expect((await presign({ folder: 'library', mimeType: 'image/webp', filename: 'generic.webp' })).status).toBe(200)
  })
})

describe('OpenAI reference presign', () => {
  it.each([-1, 0])('accepts an owned WebP reference at 20 MiB %+d bytes', async (offset) => {
    expect((await presign(body({ profile: 'openai-image-reference', fileSize: OPENAI_IMAGE_REFERENCE_MAX_BYTES + offset }))).status).toBe(200)
    expect(createPresignedImageUpload).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, folder: 'library', mimeType: 'image/webp' }))
  })

  it('rejects one byte over 20 MiB and preserves Gemini 10 MiB', async () => {
    const oversized = await presign(body({ profile: 'openai-image-reference', fileSize: OPENAI_IMAGE_REFERENCE_MAX_BYTES + 1 }))
    expect(oversized.status).toBe(400)
    expect(await oversized.json()).toMatchObject({ code: 'REFERENCE_TOO_LARGE', error: expect.stringContaining('20 MiB') })
    const gemini = await presign(body({ fileSize: IMAGE_REFERENCE_MAX_BYTES + 1 }))
    expect(gemini.status).toBe(400)
    expect(await gemini.json()).toMatchObject({ code: 'REFERENCE_TOO_LARGE', error: expect.stringContaining('10 MiB') })
    expect(createPresignedImageUpload).not.toHaveBeenCalled()
  })

  it.each([{ fileSize: 0 }, { fileSize: '20' }, { mimeType: 'image/gif' }, { folder: 'posts' }])('retains reference size/type/Library validations (%j)', async (invalid) => {
    expect((await presign(body({ ...invalid, profile: 'openai-image-reference' }))).status).toBe(400)
    expect(createPresignedImageUpload).not.toHaveBeenCalled()
  })

  it('refuses foreign and missing Projects before S3', async () => {
    expect((await presign(body({ profile: 'openai-image-reference', projectId: FOREIGN }))).status).toBe(404)
    expect((await presign(body({ profile: 'openai-image-reference', projectId: null }))).status).toBe(400)
    expect(createPresignedImageUpload).not.toHaveBeenCalled()
  })
})
