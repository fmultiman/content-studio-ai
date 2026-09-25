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
  DEFAULT_TEMPLATE_ID, getTemplateDefinition, getTemplateLayout, layoutAssetSlots, slotView,
  type AuthoringSlotView, type TemplateDefinition, type TemplateLayoutDefinition,
} from '@/lib/creative/templates/template-definitions'
import { resolveElementStack } from '@/lib/creative/templates/element-stack'

export type VideoInspectorSection = 'template' | 'content' | 'assets' | 'style' | 'element' | 'motion'

export const VIDEO_INSPECTOR_SECTIONS: readonly { value: VideoInspectorSection; label: string; compactLabel: string }[] = [
  { value: 'template', label: 'Template', compactLabel: 'Tpl.' },
  { value: 'content', label: 'Conteúdo', compactLabel: 'Cont.' },
  { value: 'assets', label: 'Assets', compactLabel: 'Assets' },
  { value: 'style', label: 'Estilo', compactLabel: 'Estilo' },
  { value: 'element', label: 'Elementos', compactLabel: 'Elem.' },
  { value: 'motion', label: 'Motion', compactLabel: 'Motion' },
]

/**
 * The composition every Scene renders with TODAY: the VideoDraft adapter
 * (video-draft-to-timeline.ts) emits `editorial.documentary-card` / `cover`
 * with no templateId, element order, hidden set or tuning, so DocumentaryCard
 * resolves the DEFAULT Template's `cover` layout with its default stack and the
 * cover's default (dark) appearance. Read from the registry — never a copy.
 */
export const VIDEO_SCENE_LAYOUT_ID = 'cover'

export type VideoSceneComposition = {
  template: TemplateDefinition
  layout: TemplateLayoutDefinition
  /** Paint order, back -> front (as ElementLayers expects). */
  stackOrder: readonly string[]
  elementLabels: Readonly<Record<string, string>>
  heroSlot: AuthoringSlotView
  heroUsedBy: readonly string[]
  appearance: 'dark'
}

export function videoSceneComposition(): VideoSceneComposition {
  const template = getTemplateDefinition(DEFAULT_TEMPLATE_ID)
  const layout = template ? getTemplateLayout(template, VIDEO_SCENE_LAYOUT_ID) : null
  if (!template || !layout) throw new Error('Video Scene composition requires the default Template cover layout.')
  const hero = layoutAssetSlots(template, layout).find(({ slot }) => slot.id === 'hero')
  return {
    template,
    layout,
    stackOrder: resolveElementStack(undefined, VIDEO_SCENE_LAYOUT_ID, undefined).order,
    elementLabels: Object.fromEntries(layout.elements.map((element) => [element.id, element.label])),
    heroSlot: hero?.slot ?? slotView(template, 'hero'),
    heroUsedBy: (hero?.elements ?? []).map((element) => element.label),
    appearance: 'dark',
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

/**
 * Canonical Creative Editor Video route for ONE VideoDraft.
 *
 * Neutral on purpose: the Creative Editor (authoring / composition) is an
 * independent surface, not a child of /videos. Long-term, /videos is AI
 * video/clip source-media generation plus that workflow's history/results
 * (analogous to /imagens); reusable media lives in the Library; outputs live
 * in the Gallery. /videos' links into this route are migration shortcuts, not
 * ownership; other entries (Video ChannelPieces, Project/Production context,
 * a VideoDraft link) may open the same route. The VideoDraft
 * id is the only authority in the URL; Project/Production context is read from
 * the draft itself — no ChannelPiece <-> VideoDraft link is implied.
 */
export const CREATIVE_EDITOR_VIDEO_BASE_PATH = '/creative-editor/video'

export function videoCreativeEditorHref(videoDraftId: string): string {
  return `${CREATIVE_EDITOR_VIDEO_BASE_PATH}/${encodeURIComponent(videoDraftId)}`
}
