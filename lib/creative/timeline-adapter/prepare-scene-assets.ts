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
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import type { LibraryFile } from '@/lib/types'
import type { AdapterDiagnostic } from './video-draft-to-timeline'

/** Caller-supplied, synchronous lookup -- never a DB call performed inside this module. */
export type LibraryFileLookup = (ref: string) => LibraryFile | undefined

export type PrepareTimelineAssetsResult = {
  /** Keyed "<segmentId>:<slot>" -> real ResolvedAsset, ready to patch into a ResolvedTimelineInput's resolvedTemplateSegments. */
  resolvedAssets: Record<string, ResolvedAsset>
  /** Gate B: manifest-level `assets` map (independent media/audio segments), keyed like the manifest. */
  resolvedManifestAssets: Record<string, ResolvedAsset>
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

      // Template slots (Scene hero) draw images only; video/audio belong to independent segments.
      const resolved = file.kind === 'image' ? await adaptLibraryFileToResolvedAsset(file, context) : null
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

  // Gate B: media referenced by independent segments (B-roll, audio) live in
  // the manifest-level map, resolved the same way (never a fixture fallback).
  const resolvedManifestAssets: Record<string, ResolvedAsset> = {}
  for (const [key, assetRef] of Object.entries(manifest.assets)) {
    if (assetRef.type !== 'library_file') continue
    const file = lookupLibraryFile(assetRef.ref)
    const resolved = file ? await adaptLibraryFileToResolvedAsset(file, context) : null
    if (!resolved) {
      diagnostics.push({
        kind: 'asset_unresolved',
        code: file ? 'library_file_unresolvable' : 'library_file_not_found',
        message: `AssetRef "${assetRef.ref}" (manifest asset "${key}") could not be resolved into a runtime asset.`,
        path: `assets.${key}`,
      })
      continue
    }
    resolvedManifestAssets[key] = { ...resolved, fit: assetRef.fit ?? resolved.fit }
  }

  return { resolvedAssets, resolvedManifestAssets, diagnostics }
}

/** Gate B: merges runtime-prepared manifest-level assets into a ResolvedTimelineInput (pure data merge). */
export function patchManifestAssets(resolved: ResolvedTimelineInput, patch: Record<string, ResolvedAsset>): ResolvedTimelineInput {
  if (Object.keys(patch).length === 0) return resolved
  return { ...resolved, resolvedAssets: { ...resolved.resolvedAssets, ...patch } }
}

/**
 * Merges a real-asset patch (from prepareTimelineLibraryFileAssets) into a
 * ResolvedTimelineInput already produced by the neutral `resolveTimelineManifest`.
 * The neutral resolver's own `resolvedAssets` for a `library_file` slot stays a
 * placeholder (Phase 2G-B, §4) -- this is the one place that placeholder gets
 * replaced with the real, runtime-prepared asset, and it happens entirely
 * outside the neutral resolver. Pure data merge; no Remotion/Supabase/S3 here.
 */
export function patchResolvedTimelineAssets(
  resolved: ResolvedTimelineInput,
  patch: Record<string, ResolvedAsset>,
): ResolvedTimelineInput {
  if (Object.keys(patch).length === 0) return resolved
  return {
    ...resolved,
    resolvedTemplateSegments: resolved.resolvedTemplateSegments.map((entry) => {
      const patchedSlots: Record<string, ResolvedAsset> = { ...entry.resolvedAssets }
      let touched = false
      for (const slot of Object.keys(entry.resolvedAssets)) {
        const key = `${entry.segment.id}:${slot}`
        if (patch[key]) {
          patchedSlots[slot] = patch[key]
          touched = true
        }
      }
      return touched ? { ...entry, resolvedAssets: patchedSlots } : entry
    }),
  }
}
