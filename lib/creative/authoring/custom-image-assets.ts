import { freeAssetKey } from '@/lib/creative/video-editor/free-composition'

/**
 * STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 — the ONE structural exception to the
 * "Template assets are fixtures" rule of the static render enqueue route.
 *
 * A Template manifest may carry non-fixture assets ONLY as the backing asset
 * of a Custom Image in `manifest.elements`. Everything else (a swapped hero or
 * logo, an unreferenced library_file, a mismatched key, any other asset type)
 * keeps being rejected. Ownership of the referenced files is a separate,
 * server-side check (same authority as the Free composition branch).
 */

const CUSTOM_IMAGE_KEY_RE = /^library_file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

type AssetLike = { type: string; ref: string }
type ElementLike = { kind: string; asset_ref?: string }

export type TemplateManifestAssetCheck =
  | { ok: true; /** LibraryFile ids that back Custom Images (empty when there are none). */ libraryFileIds: string[] }
  | { ok: false; reason: string }

export function classifyTemplateManifestAssets(manifest: {
  assets: Record<string, AssetLike>
  elements?: readonly ElementLike[]
}): TemplateManifestAssetCheck {
  const imageAssetRefs = new Set(
    (manifest.elements ?? []).filter((element) => element.kind === 'image' && typeof element.asset_ref === 'string').map((element) => element.asset_ref as string),
  )
  const libraryFileIds: string[] = []

  for (const [key, asset] of Object.entries(manifest.assets)) {
    if (asset.type === 'fixture') continue

    const match = CUSTOM_IMAGE_KEY_RE.exec(key)
    if (!match) return { ok: false, reason: `asset "${key}" is not a fixture or a Custom Image asset key` }
    const [, libraryFileId] = match
    if (asset.type !== 'library_file') return { ok: false, reason: `asset "${key}" must be a library_file` }
    if (asset.ref !== libraryFileId) return { ok: false, reason: `asset "${key}" does not match its declared library file` }
    if (key !== freeAssetKey(libraryFileId) || !imageAssetRefs.has(key)) return { ok: false, reason: `asset "${key}" is not referenced by a Custom Image element` }

    if (!libraryFileIds.includes(libraryFileId)) libraryFileIds.push(libraryFileId)
  }

  return { ok: true, libraryFileIds }
}
