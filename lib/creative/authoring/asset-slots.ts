/**
 * Creative Editor Authoring Usability Completion V1 — what fills each slot.
 *
 * Pure (no React, no fetch). One resolution shared by the Assets tab (what
 * the author sees), the Editor preview (what the Canvas paints) and tests, so
 * the card and the Canvas cannot disagree. Precedence per slot:
 *   1. an authored override (Assets "Trocar": a Project LibraryFile),
 *   2. the Project primitive catalog selection (paper / tape, legacy),
 *   3. the Template default (bundled resource / example content image).
 * "Usar padrão" removes 1 and 2 — never a Library upload of the default.
 */
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import type { AssetSlotId, AuthoringAssetSlotId, AuthoringSlotView } from '@/lib/creative/templates/template-definitions'
import type { LibraryFile } from '@/lib/types'
import type { AuthoringState } from './types'

export type SlotResourceOrigin = 'template' | 'project' | 'generated'

export const SLOT_ORIGIN_LABELS: Readonly<Record<SlotResourceOrigin, string>> = {
  template: 'Template',
  project: 'Projeto',
  generated: 'Imagem gerada',
}

/** The LibraryFile fields the editor needs (signed display URL included). */
export type SlotLibraryFile = Pick<LibraryFile, 'id' | 'name' | 'public_url' | 'thumbnail_url' | 'mime_type'> & Partial<Pick<LibraryFile, 'origin'>>

export type SlotResource = {
  /** Product name of the resource currently filling the slot. */
  name: string
  origin: SlotResourceOrigin
  thumbnailUrl: string | null
  /** True when the slot is filled by something other than the Template default ("Usar padrão" applies). */
  replaced: boolean
  libraryFileId?: string
  /** An override points at a LibraryFile that is no longer available (trashed / other project). */
  missing?: boolean
}

type SlotState = Pick<AuthoringState, 'assetOverrides' | 'primitiveSelection'>

export function resolveSlotResource(
  slot: AuthoringSlotView,
  state: SlotState,
  files: ReadonlyMap<string, SlotLibraryFile>,
  primitives: readonly PrimitiveListItem[],
  fixtureBaseUrl = '/creative-fixtures',
): SlotResource {
  const override = state.assetOverrides?.[slot.id]
  if (override?.libraryFileId) {
    const file = files.get(override.libraryFileId)
    if (!file) return { name: 'Arquivo indisponível', origin: 'project', thumbnailUrl: null, replaced: true, libraryFileId: override.libraryFileId, missing: true }
    return { name: file.name, origin: file.origin === 'studio_render' ? 'generated' : 'project', thumbnailUrl: file.thumbnail_url || file.public_url || null, replaced: true, libraryFileId: file.id }
  }
  const category = slot.projectCategory
  const primitiveKey = category ? state.primitiveSelection[category] : undefined
  const primitive = primitiveKey ? primitives.find((item) => item.key === primitiveKey && item.category === category) : undefined
  if (primitive) {
    const file = files.get(primitive.library_file_ref)
    return {
      name: primitive.display_name,
      origin: 'project',
      thumbnailUrl: file?.thumbnail_url || file?.public_url || `${fixtureBaseUrl}/${slot.defaultAsset.path}`,
      replaced: true,
      libraryFileId: primitive.library_file_ref,
    }
  }
  return { name: slot.defaultAsset.label, origin: 'template', thumbnailUrl: `${fixtureBaseUrl}/${slot.defaultAsset.path}`, replaced: false }
}

/**
 * Editor-preview materials for the slide's overrides: the SAME shape the
 * claim-time resolver hands the worker (fit 'contain' for material slots,
 * hero as a library_file content asset), built from signed display URLs.
 */
export function previewOverrideAssets(
  overrides: AuthoringState['assetOverrides'],
  files: ReadonlyMap<string, SlotLibraryFile>,
): { materials: Partial<Record<AssetSlotId, ResolvedAsset>>; hero?: ResolvedAsset; logo?: ResolvedAsset } {
  const materials: Partial<Record<AssetSlotId, ResolvedAsset>> = {}
  let hero: ResolvedAsset | undefined
  let logo: ResolvedAsset | undefined
  for (const [slot, value] of Object.entries(overrides ?? {}) as [AuthoringAssetSlotId, { libraryFileId: string } | undefined][]) {
    const file = value ? files.get(value.libraryFileId) : undefined
    const url = file?.public_url
    if (!file || !url) continue
    const asset: ResolvedAsset = { ref: file.id, source: 'library_file', path: `library_file:${file.id}`, url, mime_type: file.mime_type ?? 'image/*' }
    if (slot === 'hero') hero = { ...asset, fit: 'cover' }
    else if (slot === 'logo') logo = { ...asset, fit: 'contain' }
    else materials[slot] = { ...asset, fit: 'contain' }
  }
  return { materials, ...(hero ? { hero } : {}), ...(logo ? { logo } : {}) }
}
