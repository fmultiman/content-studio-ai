import type { VideoScene } from '@/lib/types'

export function updateVideoSceneLibraryFile(
  scenes: VideoScene[],
  sceneId: string,
  libraryFileId: string | null,
): VideoScene[] {
  return scenes.map((scene) =>
    scene.id === sceneId ? { ...scene, library_file_id: libraryFileId } : scene,
  )
}
