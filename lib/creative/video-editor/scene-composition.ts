/**
 * VIDEO_SCENE_COMPOSITION_PARITY_V1 — the authored spatial composition of a
 * Video Scene, and the ONE place its effective value is resolved.
 *
 * A Scene is an authored visual/narrative composition WITH a duration. This
 * module owns only the spatial half (layout · appearance · content · element
 * order · hidden elements), persisted as the optional `VideoScene.composition`
 * JSONB object. Duration and Motion stay temporal Scene state; the hero
 * binding stays `VideoScene.library_file_id`.
 *
 * Both the Live Authoring Player and the final render go through
 * `resolveSceneComposition` (via the VideoDraft -> TimelineManifest adapter),
 * so preview and render can only read the same authored values.
 *
 * Backward compatibility: every axis falls back to what the Scene has ALWAYS
 * rendered with (Cover · Dark · title "Cena N" · default stack · all visible).
 * Nothing is rewritten on read; untouched Scenes stay byte-identical.
 */
import type { VideoScene, VideoSceneComposition } from '@/lib/types'
import {
  DEFAULT_TEMPLATE_ID, getTemplateDefinition, getTemplateLayout, layoutUsesContentImage,
  type TemplateAppearance, type TemplateDefinition, type TemplateLayoutDefinition,
} from '@/lib/creative/templates/template-definitions'
import { MAX_ELEMENT_ORDER_LENGTH, isDefaultElementOrder, normalizeElementOrder, normalizeHiddenElements } from '@/lib/creative/templates/element-stack'
import { defaultContentForVariant } from '@/lib/creative/authoring/authoring-state'
import { applyContentAction, type ContentAction } from '@/lib/creative/authoring/reducer'
import type { AuthoringVariant } from '@/lib/creative/authoring/types'
import { COVER_CONTENT_FIELDS, INFO_CONTENT_FIELDS, LAYOUT_CONTENT_FIELDS, type ContentFieldDescriptor } from '@/lib/creative/authoring/layout-content-fields'

/**
 * The VideoDraft's Template family. Draft-wide, not per Scene, and not
 * persisted: exactly one Template is registered, so a stored id would be a
 * choice that does not exist. A second family would be chosen per VideoDraft.
 */
export const VIDEO_TEMPLATE_ID = DEFAULT_TEMPLATE_ID

/** What every Scene rendered with before Scene composition existed. */
export const LEGACY_SCENE_LAYOUT_ID = 'cover'

/**
 * Layouts a Scene may use. The Template descriptor declares every layout for
 * `video` and 1080×1920; each one listed here was verified at 9:16 through
 * the real Remotion render path (evidence in VIDEO_SCENE_COMPOSITION_PARITY_V1.md).
 * A layout that fails that check is removed here, never offered.
 */
export const VIDEO_SCENE_LAYOUT_IDS: readonly AuthoringVariant[] = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing']

export function isVideoSceneLayout(id: unknown): id is AuthoringVariant {
  return typeof id === 'string' && (VIDEO_SCENE_LAYOUT_IDS as readonly string[]).includes(id)
}

export type SceneCompositionFallback = 'layout' | 'appearance'

export type ResolvedSceneComposition = {
  template: TemplateDefinition
  layout: TemplateLayoutDefinition
  layoutId: AuthoringVariant
  appearance: TemplateAppearance
  content: Record<string, unknown>
  /** Normalized paint order, back -> front. */
  elementOrder: string[]
  /** Normalized hidden element ids (layout paint order). */
  hiddenElements: string[]
  elementOrderIsDefault: boolean
  /** Whether this layout draws the content image (the Scene's `hero` binding). */
  usesHero: boolean
  /** Which axes carry authored values (false = Template default). */
  authored: { layout: boolean; appearance: boolean; content: boolean; elementOrder: boolean; hiddenElements: boolean }
  /** Authored values that cannot be honoured today; resolved through the Template default instead (never rewritten in storage). */
  fallbacks: SceneCompositionFallback[]
}

function videoTemplate(): TemplateDefinition {
  const template = getTemplateDefinition(VIDEO_TEMPLATE_ID)
  if (!template) throw new Error('Video Scene composition requires the default Template.')
  return template
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The positional title every pre-composition Scene rendered ("Cena N"). */
export function legacySceneTitle(order: number): string {
  return `Cena ${order}`
}

/**
 * Starting content for a layout: the Template's example content (the same
 * source the Static "Novo slide" uses) with the Scene's current title
 * carried over. Cover starts from the title alone, like every legacy Scene.
 */
export function defaultSceneContent(layoutId: AuthoringVariant, title: string): Record<string, unknown> {
  if (layoutId === LEGACY_SCENE_LAYOUT_ID) return { title }
  const example = defaultContentForVariant(layoutId, 'a') as unknown as Record<string, unknown>
  return title.trim() ? { ...example, title } : example
}

export function resolveSceneComposition(scene: Pick<VideoScene, 'order' | 'composition'>): ResolvedSceneComposition {
  const template = videoTemplate()
  const raw: VideoSceneComposition = isPlainObject(scene.composition) ? scene.composition : {}
  const fallbacks: SceneCompositionFallback[] = []

  const layoutAuthored = raw.layout !== undefined
  let layoutId: AuthoringVariant = LEGACY_SCENE_LAYOUT_ID
  if (layoutAuthored) {
    if (isVideoSceneLayout(raw.layout) && getTemplateLayout(template, raw.layout)) layoutId = raw.layout
    else fallbacks.push('layout')
  }
  const layout = getTemplateLayout(template, layoutId)
  if (!layout) throw new Error(`Video Scene layout "${layoutId}" is not defined by the Template.`)

  const appearanceAuthored = raw.appearance !== undefined
  let appearance: TemplateAppearance = layout.defaultAppearance
  if (appearanceAuthored) {
    if ((layout.supportedAppearances as readonly string[]).includes(raw.appearance as string)) appearance = raw.appearance as TemplateAppearance
    else fallbacks.push('appearance')
  }

  const contentAuthored = isPlainObject(raw.content)
  const content = contentAuthored ? { ...(raw.content as Record<string, unknown>) } : defaultSceneContent(layoutId, legacySceneTitle(scene.order))

  const elementOrder = normalizeElementOrder(layout, raw.element_order)
  const hiddenElements = normalizeHiddenElements(layout, raw.hidden_elements)

  return {
    template,
    layout,
    layoutId,
    appearance,
    content,
    elementOrder,
    hiddenElements,
    elementOrderIsDefault: isDefaultElementOrder(layout, elementOrder),
    usesHero: layoutUsesContentImage(layout),
    authored: {
      layout: layoutAuthored,
      appearance: appearanceAuthored,
      content: contentAuthored,
      elementOrder: Array.isArray(raw.element_order),
      hiddenElements: Array.isArray(raw.hidden_elements) && raw.hidden_elements.length > 0,
    },
    fallbacks,
  }
}

// ── Scene edits (pure; they touch ONLY `composition`) ─────────────────────────

/** Drops empty axes so an untouched Scene never carries an empty composition. */
function withComposition(scene: VideoScene, next: VideoSceneComposition): VideoScene {
  const cleaned: VideoSceneComposition = {}
  if (next.layout !== undefined) cleaned.layout = next.layout
  if (next.appearance !== undefined) cleaned.appearance = next.appearance
  if (next.content !== undefined) cleaned.content = next.content
  if (next.element_order !== undefined) cleaned.element_order = next.element_order
  if (next.hidden_elements !== undefined && next.hidden_elements.length > 0) cleaned.hidden_elements = next.hidden_elements
  const { composition: _previous, ...rest } = scene
  void _previous
  return Object.keys(cleaned).length > 0 ? { ...rest, composition: cleaned } : rest
}

function currentComposition(scene: VideoScene): VideoSceneComposition {
  return isPlainObject(scene.composition) ? scene.composition : {}
}

/**
 * Structure switch. The element set changes, so authored order/visibility of
 * the old layout no longer apply; the title is carried over; appearance is
 * kept when the new layout supports it, otherwise it falls back to the new
 * layout's default (Static SET_VARIANT semantics).
 */
export function setSceneLayout(scene: VideoScene, layoutId: AuthoringVariant): VideoScene {
  if (!isVideoSceneLayout(layoutId)) return scene
  const resolved = resolveSceneComposition(scene)
  // Re-selecting the current structure is a no-op (a legacy Scene stays untouched).
  if (resolved.layoutId === layoutId && resolved.fallbacks.length === 0) return scene
  const template = videoTemplate()
  const nextLayout = getTemplateLayout(template, layoutId)
  if (!nextLayout) return scene
  const title = typeof resolved.content.title === 'string' ? resolved.content.title : legacySceneTitle(scene.order)
  const current = currentComposition(scene)
  const keepAppearance = current.appearance !== undefined && (nextLayout.supportedAppearances as readonly string[]).includes(current.appearance)
  return withComposition(scene, {
    layout: layoutId,
    appearance: keepAppearance ? current.appearance : undefined,
    content: defaultSceneContent(layoutId, title),
  })
}

export function setSceneAppearance(scene: VideoScene, appearance: TemplateAppearance): VideoScene {
  const resolved = resolveSceneComposition(scene)
  if (!(resolved.layout.supportedAppearances as readonly string[]).includes(appearance)) return scene
  return withComposition(scene, { ...currentComposition(scene), appearance })
}

/** One bounded structured-content edit (LayoutContentForm), applied to the Scene's effective content. */
export function applySceneContentAction(scene: VideoScene, action: ContentAction): VideoScene {
  const resolved = resolveSceneComposition(scene)
  const next = applyContentAction(resolved.content, action)
  if (next === resolved.content) return scene
  return withComposition(scene, { ...currentComposition(scene), content: next as Record<string, unknown> })
}

/** Camadas reorder. The layout's default stack is stored as "no override". */
export function setSceneElementOrder(scene: VideoScene, order: readonly string[]): VideoScene {
  const { layout } = resolveSceneComposition(scene)
  const normalized = normalizeElementOrder(layout, order)
  return withComposition(scene, { ...currentComposition(scene), element_order: isDefaultElementOrder(layout, normalized) ? undefined : normalized })
}

export function resetSceneElementOrder(scene: VideoScene): VideoScene {
  return withComposition(scene, { ...currentComposition(scene), element_order: undefined })
}

/** Camadas eye: show/hide ONE element of this Scene. */
export function toggleSceneElementVisibility(scene: VideoScene, elementId: string): VideoScene {
  const { layout, hiddenElements } = resolveSceneComposition(scene)
  if (!layout.elements.some((element) => element.id === elementId)) return scene
  const next = hiddenElements.includes(elementId) ? hiddenElements.filter((id) => id !== elementId) : [...hiddenElements, elementId]
  return withComposition(scene, { ...currentComposition(scene), hidden_elements: normalizeHiddenElements(layout, next) })
}

/** The bounded Content form for a layout (never a generic JSON form). */
export function sceneContentFields(layoutId: AuthoringVariant): readonly ContentFieldDescriptor[] {
  if (layoutId === 'cover') return COVER_CONTENT_FIELDS
  if (layoutId === 'info') return INFO_CONTENT_FIELDS
  return LAYOUT_CONTENT_FIELDS[layoutId] ?? []
}

// ── Write-boundary validation (API) ───────────────────────────────────────────

/** Upper bound for one Scene's serialized content (the largest layout example is ~2 KB). */
export const MAX_SCENE_CONTENT_BYTES = 16 * 1024
const COMPOSITION_KEYS = new Set(['layout', 'appearance', 'content', 'element_order', 'hidden_elements'])

function isElementIdList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_ELEMENT_ORDER_LENGTH
    && value.every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 64)
}

/**
 * Structural check of a persisted `composition` (the PATCH/POST boundary).
 * Content SEMANTICS are validated by the Template registry when the Scene is
 * previewed or rendered (resolveTimelineManifest), so a half-typed field can
 * still be saved as a draft and is reported where it is drawn.
 */
export function validateSceneCompositionShape(raw: unknown): { ok: true } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true }
  if (!isPlainObject(raw)) return { ok: false, message: 'Composição da cena inválida.' }
  for (const key of Object.keys(raw)) {
    if (!COMPOSITION_KEYS.has(key)) return { ok: false, message: `Campo de composição desconhecido: ${key}.` }
  }
  if (raw.layout !== undefined && !isVideoSceneLayout(raw.layout)) return { ok: false, message: 'Estrutura da cena não suportada em vídeo.' }
  const layout = getTemplateLayout(videoTemplate(), (raw.layout as string | undefined) ?? LEGACY_SCENE_LAYOUT_ID)
  if (raw.appearance !== undefined && !(layout?.supportedAppearances as readonly string[] | undefined)?.includes(raw.appearance as string)) {
    return { ok: false, message: 'Aparência não suportada por esta estrutura.' }
  }
  if (raw.content !== undefined) {
    if (!isPlainObject(raw.content)) return { ok: false, message: 'Conteúdo da cena inválido.' }
    if (JSON.stringify(raw.content).length > MAX_SCENE_CONTENT_BYTES) return { ok: false, message: 'Conteúdo da cena grande demais.' }
  }
  if (raw.element_order !== undefined && !isElementIdList(raw.element_order)) return { ok: false, message: 'Ordem de elementos inválida.' }
  if (raw.hidden_elements !== undefined && !isElementIdList(raw.hidden_elements)) return { ok: false, message: 'Elementos ocultos inválidos.' }
  return { ok: true }
}
