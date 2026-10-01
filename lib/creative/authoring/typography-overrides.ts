/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — pure helpers for the OPTIONAL local typography
 * override of a Template text Element (`AuthoringState.typography`).
 *
 * The model is deliberately narrow: effective default (Identity role / Template size) → optional local
 * `{ fontFamily?, fontSizePx? }`. A missing field means "use the default"; resolved defaults are never stored,
 * and an empty override is never kept ("Usar padrão" removes it). Layout-owned: a Layout switch drops it.
 */
import type { TypographyOverride, TypographyOverrides } from './types'
import { FONT_SIZE_PX_BOUNDS, clampFontSizePx, isRuntimeFontFamily } from '@/lib/creative/typography/resolve-typography'
import { elementLocalTypography, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'

export { FONT_SIZE_PX_BOUNDS, clampFontSizePx }

/** A valid override of one Element: supported family only, bounded size; undefined when nothing valid is left. */
export function sanitizeTypographyOverride(raw: unknown, allowSize = true): TypographyOverride | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { fontFamily, fontSizePx } = raw as { fontFamily?: unknown; fontSizePx?: unknown }
  const family = typeof fontFamily === 'string' && isRuntimeFontFamily(fontFamily) ? fontFamily : undefined
  const size = allowSize && typeof fontSizePx === 'number' ? clampFontSizePx(fontSizePx) : undefined
  if (!family && size === undefined) return undefined
  return { ...(family ? { fontFamily: family } : {}), ...(size !== undefined ? { fontSizePx: size } : {}) }
}

/**
 * The overrides a Layout can honour: only Elements declaring the local-typography capability keep an entry
 * (size only where the Element has a single Template size). Absent / empty → undefined (exact legacy state).
 */
export function normalizeTypographyOverrides(layout: TemplateLayoutDefinition | null | undefined, raw: unknown): TypographyOverrides | undefined {
  if (!layout || !raw || typeof raw !== 'object') return undefined
  const next: TypographyOverrides = {}
  for (const [elementId, value] of Object.entries(raw as Record<string, unknown>)) {
    const capability = elementLocalTypography(layout, elementId)
    if (!capability) continue
    const clean = sanitizeTypographyOverride(value, capability.fontSizePx !== undefined)
    if (clean) next[elementId] = clean
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/** Merge a patch into one Element's override (`undefined` value = remove that field). Empty result removes the entry. */
export function patchTypographyOverride(current: TypographyOverrides | undefined, elementId: string, patch: { fontFamily?: TypographyOverride['fontFamily'] | null; fontSizePx?: number | null }): TypographyOverrides | undefined {
  const merged: Record<string, unknown> = { ...(current?.[elementId] ?? {}) }
  if ('fontFamily' in patch) { if (patch.fontFamily) merged.fontFamily = patch.fontFamily; else delete merged.fontFamily }
  if ('fontSizePx' in patch) { if (typeof patch.fontSizePx === 'number') merged.fontSizePx = patch.fontSizePx; else delete merged.fontSizePx }
  const clean = sanitizeTypographyOverride(merged)
  // Nothing changed: keep the same map (no spurious dirty state).
  if (JSON.stringify(clean) === JSON.stringify(current?.[elementId])) return current
  const next = { ...(current ?? {}) }
  if (clean) next[elementId] = clean
  else delete next[elementId]
  return Object.keys(next).length > 0 ? next : undefined
}

/** "Usar padrão": remove the Element's local override entirely. */
export function resetTypographyOverride(current: TypographyOverrides | undefined, elementId: string): TypographyOverrides | undefined {
  if (!current || !(elementId in current)) return current
  const next = { ...current }
  delete next[elementId]
  return Object.keys(next).length > 0 ? next : undefined
}
