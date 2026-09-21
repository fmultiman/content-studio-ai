import { describe, it, expect } from 'vitest'
import { adaptLibraryFileToResolvedAsset } from '../library-file-adapter'
import type { LibraryFile } from '@/lib/types'

describe('Productization Phase 1B: LibraryFile Asset Adapter', () => {
  const dummyContext = {
    createPresignedReadUrl: async (path: string) => `https://mock-s3.local/${path}?signature=123`
  }

  it('should map a canonical LibraryFile into a ResolvedAsset using presigned URLs', async () => {
    // 1. Arrange: Real shape of a DB LibraryFile
    const canonicalFile: LibraryFile = {
      id: 'lf-1234',
      user_id: 'usr-1',
      project_id: 'proj-1',
      folder: 'campaigns',
      name: 'Hero Shot',
      kind: 'image',
      mime_type: 'image/jpeg',
      file_size: 1024000,
      storage_provider: 's3',
      storage_path: 'users/usr-1/library/camp/hero.jpg',
      public_url: 'https://mock.com/old',
      thumbnail_url: null,
      deleted_at: null,
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-20T00:00:00Z',
    }

    // 2. Act: Integration boundary
    const resolved = await adaptLibraryFileToResolvedAsset(canonicalFile, dummyContext)

    // 3. Assert
    expect(resolved).not.toBeNull()
    expect(resolved?.ref).toBe('lf-1234')
    expect(resolved?.source).toBe('library_file')
    expect(resolved?.mime_type).toBe('image/jpeg')
    expect(resolved?.alt).toBe('Hero Shot')
    expect(resolved?.path).toBe('users/usr-1/library/camp/hero.jpg')
    
    // Most important: The renderer doesn't get AWS credentials, just the URL
    expect(resolved?.url).toBe('https://mock-s3.local/users/usr-1/library/camp/hero.jpg?signature=123')
  })

  it('should reject non-image kinds', async () => {
    const canonicalPdf: LibraryFile = {
      id: 'lf-doc',
      user_id: 'usr-1',
      project_id: null,
      folder: 'docs',
      name: 'Guide.pdf',
      kind: 'document',
      mime_type: 'application/pdf',
      file_size: 500000,
      storage_provider: 's3',
      storage_path: 'users/usr-1/library/docs/guide.pdf',
      public_url: '',
      thumbnail_url: null,
      deleted_at: null,
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-20T00:00:00Z'
    }

    const resolved = await adaptLibraryFileToResolvedAsset(canonicalPdf, dummyContext)
    expect(resolved).toBeNull()
  })

  it('should return null if S3 fails to generate a presigned URL', async () => {
    const errorContext = {
      createPresignedReadUrl: async () => null
    }

    const canonicalFile: LibraryFile = {
      id: 'lf-1234',
      user_id: 'usr-1',
      project_id: 'proj-1',
      folder: 'campaigns',
      name: 'Hero Shot',
      kind: 'image',
      mime_type: 'image/jpeg',
      file_size: 1000,
      storage_provider: 's3',
      storage_path: 'users/usr-1/library/camp/hero.jpg',
      public_url: '',
      thumbnail_url: null,
      deleted_at: null,
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-20T00:00:00Z'
    }

    const resolved = await adaptLibraryFileToResolvedAsset(canonicalFile, errorContext)
    expect(resolved).toBeNull()
  })
})
