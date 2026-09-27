/**
 * Static Render Worker V1 — claim-time resolution of a frozen static
 * snapshot into the in-memory input the VPS worker renders with.
 *
 * Mirrors `resolve-runtime-input.ts` (video): the persisted snapshot is
 * signed-URL-free; fresh presigned URLs are generated here, at claim time,
 * only for LibraryFiles loaded from the DB scoped to the execution's own
 * project/user (the SSRF boundary). The result is returned to the worker
 * and never persisted.
 *
 * The render tree itself is unchanged: this produces exactly the props the
 * existing `StaticRenderManifestStill` composition already consumes
 * (`{ resolvedInput, overrides, primitiveMaterials, primitiveTransforms }`).
 */
import type { LibraryFile } from '@/lib/types'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { AssetSlotId } from '@/lib/creative/templates/template-definitions'
import type { AuthoringRenderOverrides, PrimitiveTransformsRequest } from '@/lib/creative/authoring/render-request'
import { resolveStaticFreeRenderManifest, resolveStaticRenderManifest, type AnyResolvedStaticInput } from '@/lib/creative/resolution/resolve-static-render'
import { isStaticFreeRenderManifest } from '@/lib/schemas/creative/static-render'
import { parseStaticRenderExecutionSnapshot, type StaticRenderSlideRef } from './static-snapshot'

export type ResolvedStaticWorkerInput = {
  /** Template-backed (`resolvedTemplate`) or free (`kind: 'free'`, CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1). */
  resolvedInput: AnyResolvedStaticInput
  overrides?: AuthoringRenderOverrides
  primitiveMaterials?: Partial<Record<AssetSlotId, ResolvedAsset>>
  primitiveTransforms?: PrimitiveTransformsRequest
  templateId?: string
  elementOrder?: string[]
  hiddenElements?: string[]
  output: { format: 'png'; width: number; height: number }
  slide: StaticRenderSlideRef | null
}

export type ResolveStaticRuntimeInputResult =
  | { ok: true; staticInput: ResolvedStaticWorkerInput; warnings: string[] }
  | { ok: false; code: string; message: string }

export async function resolveStaticRuntimeInput(input: {
  rawSnapshot: unknown
  libraryFiles: Pick<LibraryFile, 'id' | 'storage_path' | 'deleted_at'>[]
  createPresignedReadUrl: (path: string) => Promise<string | null>
}): Promise<ResolveStaticRuntimeInputResult> {
  const parsed = parseStaticRenderExecutionSnapshot(input.rawSnapshot)
  if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.message }
  const snapshot = parsed.snapshot

  // Free (Template-less) still: only Identity tokens and the frozen Library
  // image ids. Same SSRF boundary: only DB-loaded, project-scoped rows are presigned.
  if (isStaticFreeRenderManifest(snapshot.manifest)) {
    const free = resolveStaticFreeRenderManifest(snapshot.manifest, { identitySnapshot: snapshot.identitySnapshot })
    if (!free.valid) {
      const first = free.errors[0]
      return { ok: false, code: 'STATIC_MANIFEST_RESOLUTION_FAILED', message: `Free static manifest failed resolution${first ? `: ${first.code} ${first.message}` : '.'}`.slice(0, 500) }
    }
    const resolvedAssets: Record<string, ResolvedAsset> = {}
    for (const [key, asset] of Object.entries(snapshot.manifest.assets)) {
      const file = input.libraryFiles.find((candidate) => candidate.id === asset.ref && !candidate.deleted_at)
      if (!file?.storage_path) return { ok: false, code: 'FREE_IMAGE_UNAVAILABLE', message: `LibraryFile for free image "${key}" is missing or not owned by this project.` }
      const url = await input.createPresignedReadUrl(file.storage_path)
      if (!url) return { ok: false, code: 'ASSET_PRESIGN_FAILED', message: `Could not presign free image "${key}".` }
      resolvedAssets[key] = { ref: asset.ref, source: 'library_file', path: file.storage_path, url, mime_type: 'image/*', ...(asset.fit ? { fit: asset.fit } : {}) }
    }
    return {
      ok: true,
      warnings: [],
      staticInput: { resolvedInput: { ...free.value, resolvedAssets }, output: snapshot.output, slide: snapshot.slide },
    }
  }

  const resolved = resolveStaticRenderManifest(snapshot.manifest, { identitySnapshot: snapshot.identitySnapshot })
  if (!resolved.valid) {
    const first = resolved.errors[0]
    return {
      ok: false,
      code: 'STATIC_MANIFEST_RESOLUTION_FAILED',
      message: `Static manifest failed resolution${first ? `: ${first.code ?? first.kind} ${first.message}` : '.'}`.slice(0, 500),
    }
  }

  const warnings: string[] = []
  const primitiveMaterials: Partial<Record<AssetSlotId, ResolvedAsset>> = {}
  const frozenAssets = snapshot.primitiveAssets
  if (frozenAssets) {
    for (const slot of ['paper', 'tape'] as const) {
      const asset = frozenAssets[slot]
      if (!asset) continue
      const file = input.libraryFiles.find((candidate) => candidate.id === asset.libraryFileId && !candidate.deleted_at)
      if (!file?.storage_path) {
        return { ok: false, code: 'PRIMITIVE_LIBRARY_FILE_UNAVAILABLE', message: `LibraryFile for primitive "${slot}" is missing or not owned by this project.` }
      }
      const url = await input.createPresignedReadUrl(file.storage_path)
      if (!url) {
        return { ok: false, code: 'PRIMITIVE_PRESIGN_FAILED', message: `Could not presign primitive "${slot}".` }
      }
      primitiveMaterials[slot] = {
        ref: asset.libraryFileId,
        source: 'library_file',
        path: file.storage_path,
        url,
        mime_type: asset.mimeType,
        width: asset.width,
        height: asset.height,
        checksum: asset.checksum,
        version: asset.version,
      } as ResolvedAsset
    }
  }

  // Authoring Usability Completion V1 — slot overrides chosen in Assets.
  // Same SSRF/ownership boundary as primitives: only the FROZEN LibraryFile
  // id, looked up among this execution's project-scoped rows, is presigned.
  let resolvedInput = resolved.value
  for (const [slot, frozen] of Object.entries(snapshot.assetOverrides ?? {})) {
    if (!frozen) continue
    const file = input.libraryFiles.find((candidate) => candidate.id === frozen.libraryFileId && !candidate.deleted_at)
    if (!file?.storage_path) {
      return { ok: false, code: 'ASSET_LIBRARY_FILE_UNAVAILABLE', message: `LibraryFile for slot "${slot}" is missing or not owned by this project.` }
    }
    const url = await input.createPresignedReadUrl(file.storage_path)
    if (!url) return { ok: false, code: 'ASSET_PRESIGN_FAILED', message: `Could not presign asset for slot "${slot}".` }
    const asset: ResolvedAsset = { ref: frozen.libraryFileId, source: 'library_file', path: file.storage_path, url, mime_type: frozen.mimeType }
    if (slot === 'hero') {
      // Content image: the manifest already binds hero -> this library_file
      // (validated at enqueue); only its URL is time-sensitive.
      const hero = resolvedInput.resolvedAssets.hero
      if (hero && hero.ref === frozen.libraryFileId) {
        resolvedInput = { ...resolvedInput, resolvedAssets: { ...resolvedInput.resolvedAssets, hero: { ...hero, ...asset, fit: hero.fit ?? 'cover' } } }
      }
    } else {
      // Template material replaced by a Project image of unknown alpha bounds.
      primitiveMaterials[slot as AssetSlotId] = { ...asset, fit: 'contain' }
    }
  }

  return {
    ok: true,
    warnings,
    staticInput: {
      resolvedInput,
      ...(snapshot.overrides ? { overrides: snapshot.overrides } : {}),
      ...(Object.keys(primitiveMaterials).length > 0 ? { primitiveMaterials } : {}),
      ...(snapshot.primitiveTransforms ? { primitiveTransforms: snapshot.primitiveTransforms } : {}),
      ...(snapshot.templateId ? { templateId: snapshot.templateId } : {}),
      ...(snapshot.elementOrder ? { elementOrder: snapshot.elementOrder } : {}),
      ...(snapshot.hiddenElements ? { hiddenElements: snapshot.hiddenElements } : {}),
      output: snapshot.output,
      slide: snapshot.slide,
    },
  }
}
