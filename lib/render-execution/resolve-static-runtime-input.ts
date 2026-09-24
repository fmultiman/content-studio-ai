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
import type { AuthoringRenderOverrides, PrimitiveTransformsRequest } from '@/lib/creative/authoring/render-request'
import { resolveStaticRenderManifest, type ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import { parseStaticRenderExecutionSnapshot, type StaticRenderSlideRef } from './static-snapshot'

export type ResolvedStaticWorkerInput = {
  resolvedInput: ResolvedStaticRenderInput
  overrides?: AuthoringRenderOverrides
  primitiveMaterials?: { paper?: ResolvedAsset; tape?: ResolvedAsset }
  primitiveTransforms?: PrimitiveTransformsRequest
  templateId?: string
  elementOrder?: string[]
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
  const primitiveMaterials: { paper?: ResolvedAsset; tape?: ResolvedAsset } = {}
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

  return {
    ok: true,
    warnings,
    staticInput: {
      resolvedInput: resolved.value,
      ...(snapshot.overrides ? { overrides: snapshot.overrides } : {}),
      ...(Object.keys(primitiveMaterials).length > 0 ? { primitiveMaterials } : {}),
      ...(snapshot.primitiveTransforms ? { primitiveTransforms: snapshot.primitiveTransforms } : {}),
      ...(snapshot.templateId ? { templateId: snapshot.templateId } : {}),
      ...(snapshot.elementOrder ? { elementOrder: snapshot.elementOrder } : {}),
      output: snapshot.output,
      slide: snapshot.slide,
    },
  }
}
