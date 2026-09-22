import { describe, expect, it } from 'vitest'
import type { LibraryFile } from '@/lib/types'
import { filterProjectLibraryFiles } from '@/components/library/project-library-asset-picker'

const PROJECT_A = '11111111-1111-4111-8111-111111111111'
const PROJECT_B = '22222222-2222-4222-8222-222222222222'

function file(overrides: Partial<LibraryFile> = {}): LibraryFile {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: 'user-1',
    project_id: PROJECT_A,
    folder: '/',
    name: 'paper.png',
    kind: 'image',
    mime_type: 'image/png',
    file_size: 10,
    storage_provider: 's3',
    storage_path: 'users/user-1/library/paper.png',
    public_url: 'https://example.test/paper.png',
    thumbnail_url: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('ProjectLibraryAssetPicker filtering', () => {
  it('keeps only active image assets from the requested Project', () => {
    const result = filterProjectLibraryFiles([
      file(),
      file({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', project_id: PROJECT_B }),
      file({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', kind: 'video' }),
      file({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', deleted_at: '2026-01-01T00:00:00Z' }),
    ], PROJECT_A, ['image'])

    expect(result).toHaveLength(1)
    expect(result[0].project_id).toBe(PROJECT_A)
    expect(result[0].kind).toBe('image')
  })
})
