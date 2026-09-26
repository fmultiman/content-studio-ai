/**
 * Creative Editor Video Foundation V1 — Live Authoring Player input.
 *
 * Builds the ResolvedTimelineInput the browser Player paints from the CURRENT
 * in-memory VideoScene[] (saved or not), through the SAME pure chain the final
 * render uses:
 *
 *   VideoScene[] -> buildRenderExecutionSnapshot (deriveVideoSceneAssetBindings
 *   + adaptVideoDraftToTimelineManifest) -> resolveTimelineManifest
 *   (identitySnapshot override) -> patchResolvedTimelineAssets
 *
 * The only difference from claim-time resolution (resolve-runtime-input.ts)
 * is WHERE LibraryFile URLs come from: here, the short-lived display URLs the
 * authenticated `/api/library-files` listing already returns to the browser
 * (the Static editor paints its slot overrides the same way). The manifest is
 * transient; nothing here is persisted or sent to the render route, which
 * re-derives everything server-side from the saved VideoDraft.
 */
import type { VideoDraft, VideoScene, LibraryFile } from '@/lib/types'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'
import { resolveTimelineManifest, type ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { patchManifestAssets, patchResolvedTimelineAssets } from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import type { VideoTimeline } from './temporal-items'
import type { AdapterDiagnostic } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'

/** Same LibraryFile projection the Static slot cards use (signed display URL included). */
export type PreviewLibraryFile = SlotLibraryFile & Partial<Pick<LibraryFile, 'kind'>>

export type LivePreviewInputArgs = {
  draft: Pick<VideoDraft, 'id' | 'project_id' | 'production_id'>
  scenes: readonly VideoScene[]
  /** Gate B: the CURRENT (saved or not) independent temporal layer. */
  timeline?: VideoTimeline | null
  identitySnapshot: VisualTokensSnapshot
  libraryFiles: ReadonlyMap<string, PreviewLibraryFile>
}

export type LivePreviewInputResult =
  | { ok: true; resolvedInput: ResolvedTimelineInput; manifest: TimelineManifest; diagnostics: AdapterDiagnostic[]; missingAssets: string[] }
  | { ok: false; reason: 'no_scenes' | 'missing_context' | 'invalid_timeline'; message: string }

/** Browser-display ResolvedAsset for a LibraryFile (same shape the Static preview paints). */
export function previewLibraryFileAsset(file: PreviewLibraryFile): ResolvedAsset | null {
  if (!file.public_url) return null
  return {
    ref: file.id,
    source: 'library_file',
    path: `library_file:${file.id}`,
    url: file.public_url,
    mime_type: file.mime_type ?? 'image/*',
    alt: file.name,
    fit: 'cover',
  }
}

export function buildLivePreviewInput(args: LivePreviewInputArgs): LivePreviewInputResult {
  if (args.scenes.length === 0) return { ok: false, reason: 'no_scenes', message: 'Adicione uma cena para ver a prévia.' }
  if (!args.draft.project_id || !args.draft.production_id) {
    return { ok: false, reason: 'missing_context', message: 'O rascunho precisa de Projeto e Production para a prévia.' }
  }

  const { snapshot, diagnostics } = buildRenderExecutionSnapshot({
    draft: { id: args.draft.id, project_id: args.draft.project_id, production_id: args.draft.production_id, scenes: [...args.scenes], timeline: args.timeline ?? null },
    identitySnapshot: args.identitySnapshot,
  })

  const resolved = resolveTimelineManifest(snapshot.manifest, { identitySnapshot: args.identitySnapshot })
  if (!resolved.valid) {
    return { ok: false, reason: 'invalid_timeline', message: resolved.errors.map((error) => error.message).join('; ') }
  }

  const patch: Record<string, ResolvedAsset> = {}
  const missingAssets: string[] = []
  for (const segment of snapshot.manifest.segments) {
    if (segment.kind !== 'template') continue
    for (const [slot, assetRef] of Object.entries(segment.payload.assets)) {
      if (assetRef.type !== 'library_file') continue
      const file = args.libraryFiles.get(assetRef.ref)
      const asset = file ? previewLibraryFileAsset(file) : null
      if (asset) patch[`${segment.id}:${slot}`] = { ...asset, fit: assetRef.fit ?? asset.fit }
      else missingAssets.push(assetRef.ref)
    }
  }

  // Gate B: the independent layer's media live in the manifest-level `assets` map.
  const manifestAssets: Record<string, ResolvedAsset> = {}
  for (const [key, assetRef] of Object.entries(snapshot.manifest.assets)) {
    if (assetRef.type !== 'library_file') continue
    const file = args.libraryFiles.get(assetRef.ref)
    const asset = file ? previewLibraryFileAsset(file) : null
    if (asset) manifestAssets[key] = { ...asset, fit: assetRef.fit ?? asset.fit }
    else missingAssets.push(assetRef.ref)
  }

  return {
    ok: true,
    resolvedInput: patchManifestAssets(patchResolvedTimelineAssets(resolved.value, patch), manifestAssets),
    manifest: snapshot.manifest,
    diagnostics,
    missingAssets,
  }
}
