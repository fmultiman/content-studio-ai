/**
 * Phase 2G-B -- runtime (product) asset preparation for Timeline scene assets.
 *
 * Deliberately separate from the neutral resolver (`resolveTimelineManifest`,
 * lib/creative/resolution/resolve-timeline.ts). That resolver stays
 * synchronous and renderer/persistence-agnostic; its own `resolveAsset` gives
 * every `type: 'library_file'` AssetRef a placeholder (`url: ''`) by design
 * (see lib/creative/assets/resolve-asset.ts). Real LibraryFile resolution is
 * an async, product-layer step -- exactly the same separation Static already
 * proved in Phase 1B/1C via `adaptLibraryFileToResolvedAsset`. This module
 * reuses that adapter as-is; it does not duplicate it.
 *
 * No Supabase/S3 client lives here either -- `lookupLibraryFile` and
 * `context.createPresignedReadUrl` are both caller-supplied.
 */
import { adaptLibraryFileToResolvedAsset, type ProductAssetAdapterContext } from '@/lib/creative/integration/library-file-adapter'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import type { LibraryFile } from '@/lib/types'
import type { AdapterDiagnostic } from './video-draft-to-timeline'

/** Caller-supplied, synchronous lookup -- never a DB call performed inside this module. */
export type LibraryFileLookup = (ref: string) => LibraryFile | undefined

export type PrepareTimelineAssetsResult = {
  /** Keyed "<segmentId>:<slot>" -> real ResolvedAsset, ready to patch into a ResolvedTimelineInput's resolvedTemplateSegments. */
  resolvedAssets: Record<string, ResolvedAsset>
  diagnostics: AdapterDiagnostic[]
}

/**
 * Walks a TimelineManifest's template segments and resolves every
 * `type: 'library_file'` asset slot into a real ResolvedAsset via the
 * existing, Static-proven `adaptLibraryFileToResolvedAsset`. `fixture`
 * assets are left untouched -- the neutral resolver already handles those.
 *
 * Never falls back to a fixture asset when a library_file binding is
 * explicitly present but fails to resolve -- failures are reported as
 * diagnostics instead, so a caller can decide how to react.
 */
export async function prepareTimelineLibraryFileAssets(
  manifest: TimelineManifest,
  lookupLibraryFile: LibraryFileLookup,
  context: ProductAssetAdapterContext,
): Promise<PrepareTimelineAssetsResult> {
  const resolvedAssets: Record<string, ResolvedAsset> = {}
  const diagnostics: AdapterDiagnostic[] = []

  for (const segment of manifest.segments) {
    if (segment.kind !== 'template') continue

    for (const [slot, assetRef] of Object.entries(segment.payload.assets)) {
      if (assetRef.type !== 'library_file') continue
      const path = `segments.${segment.id}.assets.${slot}`

      const file = lookupLibraryFile(assetRef.ref)
      if (!file) {
        diagnostics.push({
          kind: 'asset_unresolved',
          code: 'library_file_not_found',
          message: `AssetRef "${assetRef.ref}" (segment "${segment.id}", slot "${slot}") did not resolve to a known LibraryFile.`,
          path,
        })
        continue
      }

      const resolved = await adaptLibraryFileToResolvedAsset(file, context)
      if (!resolved) {
        diagnostics.push({
          kind: 'asset_unresolved',
          code: 'library_file_unresolvable',
          message: `LibraryFile "${file.id}" (segment "${segment.id}", slot "${slot}") could not be resolved into a runtime asset (non-image, missing storage_path, or presign failure).`,
          path,
        })
        continue
      }

      resolvedAssets[`${segment.id}:${slot}`] = {
        ...resolved,
        fit: assetRef.fit ?? resolved.fit,
        focal_point: assetRef.focal_point ?? resolved.focal_point,
        alt: assetRef.alt ?? resolved.alt,
      }
    }
  }

  return { resolvedAssets, diagnostics }
}
