/**
 * STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1 — the ONE narrow operation for
 * Template Layout A → Layout B on a Static slide.
 *
 * Ownership of `AuthoringState` under a Layout switch (classified from how each
 * field is consumed, not from its name):
 *
 *  LAYOUT-OWNED — replaced by the target Layout's own baseline:
 *    variant, contentOverride, heroRef, primitiveSelection (Project paper/tape choice),
 *    primitiveTransforms and tuning (per-Element position channels reused across layouts
 *    with different meanings), elementOrder, hiddenElements, assetOverrides, typography
 *    (local per-Element font/size overrides, CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1).
 *  APPEARANCE — kept when the target Layout supports it, else the target's default
 *    (`createTemplateSlide` rule; no cross-layout mapping is invented).
 *  COMPOSITION-INSTANCE — preserved untouched:
 *    `elements` (Custom Text/Image overlay above the Template), canvas, identity,
 *    productContext.
 *  UI-ONLY — preserved: debugPanelOpen.
 *
 * The target's baseline is exactly what "Adicionar slide" builds for that Layout
 * (`createTemplateSlide` → `persistedSlideToAuthoringState`), so a switched slide
 * is byte-identical to a freshly added one and to what a save + reload yields.
 * No content is mapped between layouts (Cover.title ≠ Lista.title by name alone).
 *
 * Pure. Not a generic composition converter; Free ↔ Template is a different path.
 */
import { createInitialAuthoringState } from './authoring-state'
import { createTemplateSlide, persistedSlideToAuthoringState } from './carousel-state'
import { DEFAULT_PRIMITIVE_TRANSFORMS } from './types'
import type { AuthoringAppearance, AuthoringState, AuthoringVariant } from './types'
import { PRIMITIVE_TRANSFORM_SLOTS } from '@/lib/creative/primitives/transforms'
import { DEFAULT_TEMPLATE_ID, getTemplateDefinition, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { isDefaultElementOrder } from '@/lib/creative/templates/element-stack'

type LayoutOwned = Pick<AuthoringState, 'variant' | 'appearance' | 'contentOverride' | 'primitiveSelection' | 'primitiveTransforms' | 'tuning'>

/** The Layout-owned slice of a brand-new slide of `layoutId` (null for a layout the Template does not define). */
function layoutBaseline(state: AuthoringState, layoutId: string, templateId: string, appearance: AuthoringAppearance): LayoutOwned | null {
  const context = state.productContext
  const fresh = createTemplateSlide({ templateId, layoutId, appearance, id: 'layout-baseline', order: 0, primitiveProjectRef: context?.primitiveProjectRef ?? null })
  if (!fresh) return null
  // Without a Project context (dev/test only) fall back to the fixture initial state; the page always has one.
  const base = context
    ? persistedSlideToAuthoringState(fresh, context, state.canvas, templateId)
    : { ...createInitialAuthoringState(fresh.variant, state.identity, state.canvas, fresh.appearance) }
  return {
    variant: base.variant,
    appearance: base.appearance,
    contentOverride: base.contentOverride,
    primitiveSelection: base.primitiveSelection,
    primitiveTransforms: base.primitiveTransforms,
    tuning: base.tuning,
  }
}

/**
 * Template Layout A → B. Returns the SAME reference when the target is the
 * current Layout or is not defined by the Template (a no-op, never a partial switch).
 */
export function replaceTemplateLayout(state: AuthoringState, layoutId: AuthoringVariant, templateId: string = DEFAULT_TEMPLATE_ID): AuthoringState {
  if (layoutId === state.variant) return state
  const template = getTemplateDefinition(templateId)
  const layout = template ? getTemplateLayout(template, layoutId) : null
  if (!layout) return state
  const baseline = layoutBaseline(state, layoutId, templateId, state.appearance)
  if (!baseline) return state
  const {
    heroRef: _heroRef, elementOrder: _elementOrder, hiddenElements: _hiddenElements, assetOverrides: _assetOverrides, typography: _typography,
    ...kept
  } = state
  void _heroRef; void _elementOrder; void _hiddenElements; void _assetOverrides; void _typography
  // `kept` still carries identity, canvas, productContext, debugPanelOpen and the Custom `elements` overlay.
  return { ...kept, ...baseline }
}

const isDefaultTransform = (value: { offsetX: number; offsetY: number; rotation: number; scale: number; opacity: number } | undefined) =>
  !value || (value.offsetX === DEFAULT_PRIMITIVE_TRANSFORMS.offsetX && value.offsetY === DEFAULT_PRIMITIVE_TRANSFORMS.offsetY && value.rotation === DEFAULT_PRIMITIVE_TRANSFORMS.rotation && value.scale === DEFAULT_PRIMITIVE_TRANSFORMS.scale && value.opacity === DEFAULT_PRIMITIVE_TRANSFORMS.opacity)

/** Key-order independent structural equality for the plain JSON values authored state is made of. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left).filter((key) => (left as Record<string, unknown>)[key] !== undefined)
  const rightKeys = Object.keys(right).filter((key) => (right as Record<string, unknown>)[key] !== undefined)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => sameJson((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

/**
 * True when leaving this Layout would discard authored Layout-owned work: any
 * content, tuning, Element transform, hidden id, paint order, hero/asset override
 * or Project paper/tape choice that differs from the Layout's own baseline.
 * Custom Elements are NOT counted: they survive the switch.
 */
export function hasLayoutOwnedAuthoredWork(state: AuthoringState, templateId: string = DEFAULT_TEMPLATE_ID): boolean {
  if (state.heroRef) return true
  if (state.assetOverrides && Object.keys(state.assetOverrides).length > 0) return true
  if (state.hiddenElements && state.hiddenElements.length > 0) return true
  if (state.typography && Object.keys(state.typography).length > 0) return true
  const template = getTemplateDefinition(templateId)
  const layout = template ? getTemplateLayout(template, state.variant) : null
  if (state.elementOrder && layout && !isDefaultElementOrder(layout, state.elementOrder)) return true
  if (PRIMITIVE_TRANSFORM_SLOTS.some((slot) => !isDefaultTransform(state.primitiveTransforms[slot as keyof typeof state.primitiveTransforms]))) return true
  const baseline = layoutBaseline(state, state.variant, templateId, state.appearance)
  if (!baseline) return true
  return !sameJson(state.contentOverride, baseline.contentOverride)
    || !sameJson(state.primitiveSelection, baseline.primitiveSelection)
    || !sameJson(state.tuning, baseline.tuning)
}
