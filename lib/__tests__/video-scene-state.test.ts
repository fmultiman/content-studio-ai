import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { updateVideoSceneLibraryFile } from '../video-scene-state'

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeScene(id: string, libraryFileId?: string | null): VideoScene {
  return {
    id,
    order: Number(id.replace('scene-', '')),
    description: `Description ${id}`,
    prompt: `Prompt ${id}`,
    image_url: id === 'scene-2' ? 'data:image/png;base64,legacy' : null,
    library_file_id: libraryFileId,
    duration: 3,
    movement: 'static',
  }
}

describe('VideoScene library asset state', () => {
  it('updates only the target scene and preserves legacy image_url', () => {
    const scenes = [makeScene('scene-1'), makeScene('scene-2')]
    const updated = updateVideoSceneLibraryFile(scenes, 'scene-1', FILE_ID)

    expect(updated[0]).toMatchObject({ id: 'scene-1', library_file_id: FILE_ID })
    expect(updated[1]).toEqual(scenes[1])
    expect(updated[1].image_url).toContain('data:image/png')
  })

  it('clears only the target binding without deleting the LibraryFile or legacy image', () => {
    const scenes = [makeScene('scene-1', FILE_ID), makeScene('scene-2')]
    const updated = updateVideoSceneLibraryFile(scenes, 'scene-1', null)

    expect(updated[0].library_file_id).toBeNull()
    expect(updated[1]).toEqual(scenes[1])
  })
})
