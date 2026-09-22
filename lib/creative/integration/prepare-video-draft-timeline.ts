import type { IdentitySnapshotRef } from '@/lib/schemas/creative/primitives'
import type { VideoDraft } from '@/lib/types'
import { deriveVideoSceneAssetBindings } from '@/lib/video-scene-assets'
import { resolveTimelineManifest, type ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import {
  adaptVideoDraftToTimelineManifest,
  type AdapterDiagnostic,
} from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import {
  patchResolvedTimelineAssets,
  prepareTimelineLibraryFileAssets,
  type LibraryFileLookup,
} from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import type { ProductAssetAdapterContext } from './library-file-adapter'

export type PrepareVideoDraftTimelineInput = {
  draft: Pick<VideoDraft, 'id' | 'project_id' | 'production_id' | 'scenes'>
  identity: IdentitySnapshotRef
  lookupLibraryFile: LibraryFileLookup
  assetContext: ProductAssetAdapterContext
}

export type PreparedVideoDraftTimeline = {
  sceneAssets: ReturnType<typeof deriveVideoSceneAssetBindings>
  manifest: ReturnType<typeof adaptVideoDraftToTimelineManifest>['manifest']
  resolvedInput?: ResolvedTimelineInput
  diagnostics: AdapterDiagnostic[]
}

/**
 * Product-facing bridge from persisted VideoScene bindings to the existing
 * pure Timeline adapter and runtime LibraryFile preparation.
 *
 * The lookup remains injected so this boundary does not acquire a database
 * client. It is scoped here to the authoritative VideoDraft project and
 * active LibraryFiles before runtime URLs are requested.
 */
export async function prepareVideoDraftTimeline(
  input: PrepareVideoDraftTimelineInput,
): Promise<PreparedVideoDraftTimeline> {
  if (!input.draft.project_id) {
    throw new Error('prepareVideoDraftTimeline requires a VideoDraft with a project_id.')
  }

  const sceneAssets = deriveVideoSceneAssetBindings(input.draft.scenes)
  const adapted = adaptVideoDraftToTimelineManifest({
    draft: input.draft,
    identity: input.identity,
    sceneAssets,
  })

  const resolved = resolveTimelineManifest(adapted.manifest)
  if (!resolved.valid) {
    return {
      sceneAssets,
      manifest: adapted.manifest,
      diagnostics: [
        ...adapted.diagnostics,
        ...resolved.errors.map((error) => ({
          kind: 'asset_unresolved' as const,
          code: `timeline_${error.code}`,
          message: error.message,
          path: error.path ?? 'timeline',
        })),
      ],
    }
  }

  const projectScopedLookup: LibraryFileLookup = (ref) => {
    const file = input.lookupLibraryFile(ref)
    if (!file || file.id !== ref || file.project_id !== input.draft.project_id || file.deleted_at !== null) {
      return undefined
    }
    return file
  }

  const prepared = await prepareTimelineLibraryFileAssets(
    adapted.manifest,
    projectScopedLookup,
    input.assetContext,
  )
  const resolvedInput = patchResolvedTimelineAssets(resolved.value, prepared.resolvedAssets)

  return {
    sceneAssets,
    manifest: adapted.manifest,
    resolvedInput,
    diagnostics: [
      ...adapted.diagnostics,
      ...prepared.diagnostics,
    ],
  }
}
