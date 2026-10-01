/**
 * Creative Editor workbench geometry + labels.
 *
 * UI-only helpers: nothing here enters authoring state, persisted slides,
 * StaticRenderManifest, template props or render overrides.
 */
import type { AuthoringState } from './types'
import {
  DEFAULT_TEMPLATE_ID,
  getTemplateDefinition,
  getTemplateLayout,
  type AuthoringAssetSlotId,
  type TemplateElementControl,
} from '@/lib/creative/templates/template-definitions'

/** Below this viewport width the floating palette is replaced by a stacked Inspector. */
export const FLOATING_WORKBENCH_MIN_VIEWPORT_WIDTH = 1024

/**
 * Authoring Usability Completion V1: 320 -> 272 px. Gate: at 272 the body
 * content box (~246 px) still fits the compact tabs, Posição/Rotação sliders
 * (label + track + value), the Camadas grip + label + chevron and the asset
 * cards without horizontal overflow. Keep in sync with app/globals.css.
 */
export const INSPECTOR_PALETTE_MIN = { width: 272, height: 220 } as const
/** 360px keeps the five full tab labels readable (measured ~324px of 11px text + padding). */
export const INSPECTOR_PALETTE_PREFERRED = { width: 360, height: 540 } as const
/** Gap kept between the palette and the workbench edges when placing it. */
export const INSPECTOR_PALETTE_MARGIN = 12
/** Share of the workbench height the palette may take by default, leaving room to move it vertically. */
const INSPECTOR_PALETTE_MAX_HEIGHT_RATIO = 0.8

export type PaletteBox = { top: number; left: number; width: number; height: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Default palette placement: top-right of the WORKBENCH (not the Canvas), sized
 * so it never fills the full workbench height — the old 620px default in a
 * ~560px host left zero vertical travel ("horizontal rail").
 */
export function initialInspectorPaletteBox(workbenchWidth: number, workbenchHeight: number): PaletteBox {
  const m = INSPECTOR_PALETTE_MARGIN
  const width = clamp(INSPECTOR_PALETTE_PREFERRED.width, INSPECTOR_PALETTE_MIN.width, workbenchWidth - 2 * m)
  const height = clamp(
    Math.min(INSPECTOR_PALETTE_PREFERRED.height, Math.round(workbenchHeight * INSPECTOR_PALETTE_MAX_HEIGHT_RATIO)),
    INSPECTOR_PALETTE_MIN.height,
    workbenchHeight - 2 * m,
  )
  return { top: m, left: Math.max(0, workbenchWidth - width - m), width, height }
}

/**
 * Keep an existing palette box inside a (possibly shrunken) workbench without
 * moving it when it already fits. Size shrinks only when the workbench is
 * smaller than the palette; position then clamps into view.
 */
export function constrainPaletteBox(box: PaletteBox, workbenchWidth: number, workbenchHeight: number): PaletteBox {
  const width = Math.min(box.width, Math.max(INSPECTOR_PALETTE_MIN.width, workbenchWidth))
  const height = Math.min(box.height, Math.max(INSPECTOR_PALETTE_MIN.height, workbenchHeight))
  return {
    width,
    height,
    left: clamp(box.left, 0, workbenchWidth - width),
    top: clamp(box.top, 0, workbenchHeight - height),
  }
}

const CHANNEL_NAMES: Record<string, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', blog: 'Blog' }
const FORMAT_NAMES: Record<string, string> = { carousel: 'Carousel', post: 'Post', reel: 'Reel', story: 'Story', single: 'Post' }

/** `instagram` + `carousel` → `Instagram Carousel`; unknown values fall back to capitalized raw tokens. */
export function channelFormatLabel(channel: string, format: string): string {
  const cap = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value
  return [CHANNEL_NAMES[channel] ?? cap(channel), FORMAT_NAMES[format] ?? cap(format)].filter(Boolean).join(' ')
}

export type InspectorSection = 'template' | 'content' | 'assets' | 'style' | 'element'

/** Deterministic full/compact labels; compact is used when the palette is narrow, never horizontal scroll. */
export const INSPECTOR_SECTIONS: readonly { value: InspectorSection; label: string; compactLabel: string }[] = [
  { value: 'template', label: 'Composição', compactLabel: 'Comp.' },
  { value: 'content', label: 'Conteúdo', compactLabel: 'Cont.' },
  { value: 'assets', label: 'Assets', compactLabel: 'Assets' },
  { value: 'style', label: 'Estilo', compactLabel: 'Estilo' },
  { value: 'element', label: 'Elementos', compactLabel: 'Elem.' },
]

/** Authored ELEMENT instances the Element selector can target. Distinct from ASSET selection
 * (Assets tab): an asset is which resource fills a template slot; an element is an authored
 * instance of that resource (or of a fixed text/image role) inside the composition.
 * Creative Editor Template Foundation V1: element ids are template-scoped strings. */
export type ElementKey = string

export type EditorElement = { key: ElementKey; label: string; control: TemplateElementControl; assetSlot?: AuthoringAssetSlotId }

/**
 * The active layout's authored elements, exactly as the Template defines
 * them (lib/creative/templates/template-definitions.ts) — never a second
 * hand-maintained list. Fonte is Info-only and Hero Cover-only because the
 * layouts say so, not because this helper special-cases them.
 */
export function elementsForVariant(variant: AuthoringState['variant'], templateId: string = DEFAULT_TEMPLATE_ID): EditorElement[] {
  const template = getTemplateDefinition(templateId) ?? getTemplateDefinition(DEFAULT_TEMPLATE_ID)
  const layout = template ? getTemplateLayout(template, variant) : null
  return (layout?.elements ?? []).map((element) => ({ key: element.id, label: element.label, control: element.control, ...(element.assetSlot ? { assetSlot: element.assetSlot } : {}) }))
}
