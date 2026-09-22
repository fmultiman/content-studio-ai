import type { AssetRef } from '@/lib/schemas/creative/primitives'
import type { VideoScene } from '@/lib/types'

/**
 * Converts persisted scene asset identities into transient neutral bindings.
 * Persistence stays limited to VideoScene.library_file_id; URLs and storage
 * metadata are intentionally not part of this result.
 */
export function deriveVideoSceneAssetBindings(
  scenes: VideoScene[],
): Record<string, AssetRef> {
  const bindings: Record<string, AssetRef> = {}

  for (const scene of scenes) {
    if (!scene.library_file_id) continue
    bindings[scene.id] = {
      type: 'library_file',
      ref: scene.library_file_id,
      fit: 'cover',
    }
  }

  return bindings
}
