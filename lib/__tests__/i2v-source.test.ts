import { describe, expect, it } from 'vitest'
import {
  checkLibrarySourceFile,
  eligibleLibraryImages,
  i2vSourceFields,
  reconcileI2vSource,
} from '@/lib/video-generation/i2v-source'

describe('i2vSourceFields — exactly one source class, only for image_to_video', () => {
  it('generated → sourceImageId only', () => {
    expect(i2vSourceFields('image_to_video', { type: 'generated', id: 'img-1' })).toEqual({ sourceImageId: 'img-1' })
  })
  it('library → sourceLibraryFileId only', () => {
    expect(i2vSourceFields('image_to_video', { type: 'library', id: 'lib-1' })).toEqual({ sourceLibraryFileId: 'lib-1' })
  })
  it('no source, or any other operation → no source field at all', () => {
    expect(i2vSourceFields('image_to_video', null)).toEqual({})
    expect(i2vSourceFields('text_to_video', { type: 'library', id: 'lib-1' })).toEqual({})
    expect(i2vSourceFields(null, { type: 'generated', id: 'img-1' })).toEqual({})
  })
})

describe('reconcileI2vSource', () => {
  it('keeps the source only while the operation is image_to_video', () => {
    const source = { type: 'library', id: 'lib-1' } as const
    expect(reconcileI2vSource('image_to_video', source)).toBe(source)
    expect(reconcileI2vSource('text_to_video', source)).toBeNull()
    expect(reconcileI2vSource(null, source)).toBeNull()
  })
})

describe('eligibleLibraryImages', () => {
  const file = (overrides: Record<string, unknown> = {}) => ({ id: 'a', project_id: 'p1', kind: 'image', deleted_at: null, ...overrides })
  it('keeps live images of the Project and drops everything else', () => {
    const files = [file(), file({ id: 'v', kind: 'video' }), file({ id: 'd', deleted_at: 'x' }), file({ id: 'o', project_id: 'p2' }), file({ id: 'n', project_id: null })]
    expect(eligibleLibraryImages(files, 'p1').map((f) => f.id)).toEqual(['a'])
  })
})

describe('checkLibrarySourceFile', () => {
  it('accepts a live image, rejects deleted and non-image rows with stable codes', () => {
    expect(checkLibrarySourceFile({ kind: 'image', deleted_at: null })).toBeNull()
    expect(checkLibrarySourceFile({ kind: 'image', deleted_at: '2026-01-01' })).toBe('SOURCE_LIBRARY_FILE_DELETED')
    expect(checkLibrarySourceFile({ kind: 'video', deleted_at: null })).toBe('SOURCE_LIBRARY_FILE_NOT_IMAGE')
  })
})
