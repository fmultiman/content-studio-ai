import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import {
  collectLibraryFileIds,
  validateSceneLibraryFileBindings,
} from '../video-scene-library-bindings'

const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'
const FILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function scene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: 'scene-1',
    order: 1,
    description: 'Scene',
    prompt: null,
    image_url: null,
    duration: 3,
    movement: 'static',
    ...overrides,
  }
}

describe('VideoScene LibraryFile bindings', () => {
  it('collects unique IDs and allows legacy/null scenes', () => {
    expect(collectLibraryFileIds([
      scene(),
      scene({ id: 'scene-2', library_file_id: FILE_A }),
      scene({ id: 'scene-3', library_file_id: FILE_A }),
      scene({ id: 'scene-4', library_file_id: null }),
    ])).toEqual([FILE_A])
    expect(validateSceneLibraryFileBindings([scene()], PROJECT_A, [])).toEqual({ valid: true, libraryFileIds: [] })
  })

  it('accepts same-project bindings, including duplicate refs', () => {
    const result = validateSceneLibraryFileBindings(
      [scene({ library_file_id: FILE_A }), scene({ id: 'scene-2', library_file_id: FILE_A })],
      PROJECT_A,
      [{ id: FILE_A, project_id: PROJECT_A, deleted_at: null }],
    )
    expect(result).toEqual({ valid: true, libraryFileIds: [FILE_A] })
  })

  it.each([
    ['malformed ID', 'not-a-uuid', 'INVALID_LIBRARY_FILE_ID'],
    ['missing file', FILE_B, 'LIBRARY_FILE_NOT_FOUND'],
    ['different project', FILE_A, 'LIBRARY_FILE_PROJECT_MISMATCH'],
    ['soft-deleted file', FILE_A, 'LIBRARY_FILE_DELETED'],
  ])('rejects %s before persistence', (_label, fileId, code) => {
    const records = code === 'LIBRARY_FILE_NOT_FOUND'
      ? []
      : [{
          id: fileId,
          project_id: code === 'LIBRARY_FILE_PROJECT_MISMATCH' ? PROJECT_B : PROJECT_A,
          deleted_at: code === 'LIBRARY_FILE_DELETED' ? '2026-01-01T00:00:00.000Z' : null,
        }]
    const result = validateSceneLibraryFileBindings([scene({ library_file_id: fileId })], PROJECT_A, records)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.error.code).toBe(code)
  })

  it('rejects a binding when the draft has no authoritative project', () => {
    const result = validateSceneLibraryFileBindings(
      [scene({ library_file_id: FILE_A })],
      null,
      [{ id: FILE_A, project_id: PROJECT_A, deleted_at: null }],
    )
    expect(result).toMatchObject({ valid: false, error: { code: 'DRAFT_PROJECT_REQUIRED' } })
  })

  it('round-trips the field without converting legacy image_url or creating AssetRef', () => {
    const original = scene({
      image_url: 'data:image/png;base64,legacy',
      library_file_id: FILE_A,
    })
    const loaded = JSON.parse(JSON.stringify({ scenes: [original] })).scenes[0] as VideoScene
    expect(loaded.library_file_id).toBe(FILE_A)
    expect(loaded.image_url).toBe(original.image_url)
    expect(loaded).not.toHaveProperty('asset_ref')
    expect(loaded).not.toHaveProperty('signed_url')
    expect(loaded).not.toHaveProperty('storage_path')
  })
})
