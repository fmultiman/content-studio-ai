import { describe, expect, it } from 'vitest'
import { deriveVideoSceneAssetBindings } from '@/lib/video-scene-assets'
import { prepareVideoDraftTimeline } from '@/lib/creative/integration/prepare-video-draft-timeline'
import type { LibraryFile, VideoScene } from '@/lib/types'

const IDENTITY = { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' }
const PROJECT_ID = 'project-timeline-test'

const FILE: LibraryFile = {
  id: 'library-file-1',
  user_id: 'user-1',
  project_id: PROJECT_ID,
  folder: '/',
  name: 'hero.png',
  kind: 'image',
  mime_type: 'image/png',
  file_size: 12,
  storage_provider: 's3',
  storage_path: 'users/user-1/hero.png',
  public_url: '',
  thumbnail_url: null,
  deleted_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function scene(id: string, library_file_id?: string | null): VideoScene {
  return {
    id,
    order: Number(id.replace('scene-', '')),
    description: 'Scene description',
    prompt: 'Scene prompt',
    image_url: 'data:image/png;base64,LEGACY',
    library_file_id,
    duration: 3,
    movement: 'static',
  }
}

function draft(scenes: VideoScene[]) {
  return { id: 'draft-1', project_id: PROJECT_ID, production_id: 'production-1', scenes }
}

describe('deriveVideoSceneAssetBindings', () => {
  it('derives independent library_file bindings and excludes absent/null ids', () => {
    expect(deriveVideoSceneAssetBindings([
      scene('scene-1', 'library-file-1'),
      scene('scene-2'),
      scene('scene-3', null),
      scene('scene-4', 'library-file-1'),
    ])).toEqual({
      'scene-1': { type: 'library_file', ref: 'library-file-1', fit: 'cover' },
      'scene-4': { type: 'library_file', ref: 'library-file-1', fit: 'cover' },
    })
  })

  it('does not map legacy image_url into an AssetRef', () => {
    expect(deriveVideoSceneAssetBindings([scene('scene-1')])).toEqual({})
  })
})

describe('prepareVideoDraftTimeline', () => {
  const assetContext = { createPresignedReadUrl: async () => 'https://signed.example/hero' }

  it('uses persisted ids without requiring caller-built sceneAssets and produces a patched render input', async () => {
    const result = await prepareVideoDraftTimeline({
      draft: draft([scene('scene-1', FILE.id)]),
      identity: IDENTITY,
      lookupLibraryFile: (ref) => ref === FILE.id ? FILE : undefined,
      assetContext,
    })

    expect(result.sceneAssets['scene-1']).toEqual({ type: 'library_file', ref: FILE.id, fit: 'cover' })
    expect(result.manifest.segments[0]).toMatchObject({ kind: 'template' })
    expect(result.resolvedInput).toBeDefined()
    expect(result.resolvedInput?.resolvedTemplateSegments[0].resolvedAssets.hero).toMatchObject({
      source: 'library_file',
      mime_type: 'image/png',
      url: 'https://signed.example/hero',
    })
    expect(JSON.stringify(result.manifest)).not.toContain('LEGACY')
  })

  it('rejects deleted or cross-project files at the runtime preparation boundary', async () => {
    const deleted = { ...FILE, deleted_at: '2026-01-02T00:00:00Z' }
    const result = await prepareVideoDraftTimeline({
      draft: draft([scene('scene-1', FILE.id)]),
      identity: IDENTITY,
      lookupLibraryFile: () => deleted,
      assetContext,
    })

    expect(result.resolvedInput).toBeDefined()
    expect(result.resolvedInput?.resolvedTemplateSegments[0].resolvedAssets.hero.url).toBe('')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'library_file_not_found')).toBe(true)
  })
})
