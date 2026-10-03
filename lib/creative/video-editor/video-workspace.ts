/**
 * Creative Editor Video — Inspector sections and the render composition's
 * Template anatomy (UI-only; nothing here is persisted).
 *
 * Same Inspector family as Static (lib/creative/authoring/editor-workspace.ts):
 * Template · Conteúdo · Assets · Estilo · Elementos, plus the Video-only
 * Motion extension (Motion does not replace Elementos). No generic "Timing"
 * tab: timing is contextual to the selected Scene (Inspector Scene header)
 * and edited on the same VideoScene.duration the Timeline edge edits.
 */
import type { VideoScene } from '@/lib/types'
import type { AuthoringState } from '@/lib/creative/authoring/types'
import {
  layoutAssetSlots, slotView,
  type AuthoringSlotView, type TemplateAppearance, type TemplateDefinition, type TemplateLayoutDefinition,
} from '@/lib/creative/templates/template-definitions'
import { LEGACY_SCENE_LAYOUT_ID, resolveSceneComposition, type ResolvedSceneComposition } from './scene-composition'

export type VideoInspectorSection = 'template' | 'content' | 'assets' | 'style' | 'element' | 'motion'

export const VIDEO_INSPECTOR_SECTIONS: readonly { value: VideoInspectorSection; label: string; compactLabel: string }[] = [
  { value: 'template', label: 'Template', compactLabel: 'Tpl.' },
  { value: 'content', label: 'Conteúdo', compactLabel: 'Cont.' },
  { value: 'assets', label: 'Assets', compactLabel: 'Assets' },
  { value: 'style', label: 'Estilos', compactLabel: 'Estilos' },
  { value: 'element', label: 'Elementos', compactLabel: 'Elem.' },
  { value: 'motion', label: 'Motion', compactLabel: 'Motion' },
]

/**
 * VIDEO_SCENE_COMPOSITION_PARITY_V1 — the Inspector's view of ONE Scene's
 * composition, derived from `resolveSceneComposition` (the same resolution the
 * adapter hands the Live Player and the final render). Read from the
 * registry — never a copy. Without a Scene it is the legacy default every
 * Scene rendered with before (Cover · Dark · default stack).
 */
export const VIDEO_SCENE_LAYOUT_ID = LEGACY_SCENE_LAYOUT_ID

export type VideoSceneCompositionView = {
  template: TemplateDefinition
  layout: TemplateLayoutDefinition
  /** Normalized paint order, back -> front (as ElementLayers expects). */
  stackOrder: readonly string[]
  stackIsDefault: boolean
  hiddenElements: readonly string[]
  elementLabels: Readonly<Record<string, string>>
  /** The Scene's content-image slot, when its layout draws one. */
  heroSlot: AuthoringSlotView
  heroUsedBy: readonly string[]
  usesHero: boolean
  appearance: TemplateAppearance
  resolved: ResolvedSceneComposition
}

export function videoSceneComposition(scene?: Pick<VideoScene, 'order' | 'composition'>): VideoSceneCompositionView {
  const resolved = resolveSceneComposition(scene ?? { order: 1 })
  const { template, layout } = resolved
  const hero = layoutAssetSlots(template, layout).find(({ slot }) => slot.id === 'hero')
  return {
    template,
    layout,
    stackOrder: resolved.elementOrder,
    stackIsDefault: resolved.elementOrderIsDefault,
    hiddenElements: resolved.hiddenElements,
    elementLabels: Object.fromEntries(layout.elements.map((element) => [element.id, element.label])),
    heroSlot: hero?.slot ?? slotView(template, 'hero'),
    heroUsedBy: (hero?.elements ?? []).map((element) => element.label),
    usesHero: resolved.usesHero,
    appearance: resolved.appearance,
    resolved,
  }
}

/**
 * A Scene's primary image expressed in the Static slot language, so the
 * SAME resolver (resolveSlotResource) and card (AssetSlotCard) serve Video:
 * VideoScene.library_file_id is the `hero` override; absent = the Template
 * default, which is exactly the adapter's fixture hero (same file).
 */
export function sceneHeroSlotState(scene: Pick<VideoScene, 'library_file_id'>): Pick<AuthoringState, 'assetOverrides' | 'primitiveSelection'> {
  return {
    assetOverrides: scene.library_file_id ? { hero: { libraryFileId: scene.library_file_id } } : {},
    primitiveSelection: {},
  }
}

// Route helpers live in a dependency-free module (imported by proxy.ts and list pages).
export { CREATIVE_EDITOR_VIDEO_BASE_PATH, videoCreativeEditorHref, legacyVideoAuthoringRedirect } from './video-routes'
