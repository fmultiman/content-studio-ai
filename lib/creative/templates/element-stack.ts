/**
 * Creative Editor Template Foundation V1 — the ONE element stack-order
 * normalizer. Editor preview, the enqueue route (frozen snapshot) and the
 * VPS worker's DocumentaryCard all go through `resolveElementStack`, so a
 * slide can never paint in one order in the Editor and another in the PNG.
 *
 * Order convention: paint order, BACK first → FRONT last (index 0 is
 * painted first). The Camadas UI displays it reversed so the top row is the
 * front-most element. Users never see numeric z-index values.
 *
 * Pure, dependency-free (worker bundle constraint), like template-definitions.
 */
import {
  DEFAULT_TEMPLATE_ID,
  getTemplateDefinition,
  getTemplateLayout,
  type TemplateLayoutDefinition,
} from './template-definitions'

/** Upper bound for a persisted order array; anything longer is not a real authored order. */
export const MAX_ELEMENT_ORDER_LENGTH = 64

/**
 * Normalizes any persisted/requested order against a layout's current
 * element set:
 *  - missing / non-array → the template default stack;
 *  - unknown ids (old or foreign) and non-strings → dropped;
 *  - duplicates → first occurrence wins;
 *  - an element the template gained later (absent from the persisted order)
 *    → inserted right after its nearest preceding default-order neighbour
 *    that is present (or at the back when none is), deterministically; an
 *    Element declared `stackPlacement: 'front'` goes on top instead.
 * Known persisted relative order is always preserved.
 */
export function normalizeElementOrder(layout: TemplateLayoutDefinition, raw: unknown): string[] {
  const defaults = [...layout.defaultStackOrder]
  if (!Array.isArray(raw)) return defaults
  const known = new Set(layout.elements.map((element) => element.id))
  const result: string[] = []
  for (const value of raw.slice(0, MAX_ELEMENT_ORDER_LENGTH)) {
    if (typeof value === 'string' && known.has(value) && !result.includes(value)) result.push(value)
  }
  if (result.length === 0) return defaults
  for (let index = 0; index < defaults.length; index++) {
    const id = defaults[index]
    if (result.includes(id)) continue
    // An Element that always painted above the whole stack keeps doing so for an order authored before the Template gained it.
    if (layout.elements.find((element) => element.id === id)?.stackPlacement === 'front') { result.push(id); continue }
    let insertAt = 0
    for (let back = index - 1; back >= 0; back--) {
      const anchor = result.indexOf(defaults[back])
      if (anchor !== -1) { insertAt = anchor + 1; break }
    }
    result.splice(insertAt, 0, id)
  }
  return result
}

export function isDefaultElementOrder(layout: TemplateLayoutDefinition, order: readonly string[]): boolean {
  const normalized = normalizeElementOrder(layout, order)
  return normalized.length === layout.defaultStackOrder.length && normalized.every((id, index) => id === layout.defaultStackOrder[index])
}

export type ElementStack = {
  order: string[]
  /** Paint layer per element id: strictly increasing back → front. */
  zIndex: Readonly<Record<string, number>>
}

/** Stack layers sit between the template background chrome (< STACK_BASE_Z) and fixed template text (>= STACK_TOP_Z). */
export const STACK_BASE_Z = 10
export const STACK_TOP_Z = 200

export function elementStackFromOrder(order: readonly string[]): ElementStack {
  const zIndex: Record<string, number> = {}
  order.forEach((id, index) => { zIndex[id] = STACK_BASE_Z + index * 2 })
  return { order: [...order], zIndex }
}

/**
 * Renderer entry point. Unknown template/layout never throws here (the
 * render contract already validated them upstream); it yields an empty stack
 * so the renderer falls back to its own document order.
 */
/**
 * Static Detail Polish V1 — authored hidden elements, normalized the same way
 * everywhere (Editor, persistence, enqueue): only ids the layout defines,
 * deduplicated, in the layout's default paint order (so equal sets always
 * serialize identically). Unknown/legacy ids are dropped, never an error.
 */
export function normalizeHiddenElements(layout: Pick<TemplateLayoutDefinition, 'defaultStackOrder'>, hidden: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(hidden) || hidden.length === 0) return []
  const wanted = new Set(hidden.filter((id): id is string => typeof id === 'string'))
  return layout.defaultStackOrder.filter((id) => wanted.has(id))
}

export function resolveElementStack(templateId: string | undefined, layoutId: string, rawOrder: unknown): ElementStack {
  const template = getTemplateDefinition(templateId ?? DEFAULT_TEMPLATE_ID)
  const layout = template ? getTemplateLayout(template, layoutId) : null
  if (!layout) return elementStackFromOrder([])
  return elementStackFromOrder(normalizeElementOrder(layout, rawOrder))
}

/** Pure array move used by drag and keyboard reordering. Out-of-range moves return a copy unchanged. */
export function moveElementInOrder(order: readonly string[], fromIndex: number, toIndex: number): string[] {
  const next = [...order]
  if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length || fromIndex === toIndex) return next
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
