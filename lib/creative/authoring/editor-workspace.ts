/**
 * Creative Editor workbench geometry + labels.
 *
 * UI-only helpers: nothing here enters authoring state, persisted slides,
 * StaticRenderManifest, template props or render overrides.
 */
import type { AuthoringState } from './types'

/** Below this viewport width the floating palette is replaced by a stacked Inspector. */
export const FLOATING_WORKBENCH_MIN_VIEWPORT_WIDTH = 1024

export const INSPECTOR_PALETTE_MIN = { width: 320, height: 220 } as const
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
  { value: 'template', label: 'Template', compactLabel: 'Tpl.' },
  { value: 'content', label: 'Conteúdo', compactLabel: 'Conteúdo' },
  { value: 'assets', label: 'Assets', compactLabel: 'Assets' },
  { value: 'style', label: 'Style', compactLabel: 'Style' },
  { value: 'element', label: 'Element', compactLabel: 'Elem.' },
]

/** Authored ELEMENT instances the Element selector can target. Distinct from ASSET selection
 * (Assets tab): an asset is which resource fills a template role; an element is an authored
 * instance of that resource (or of a fixed text/image role) inside the composition. */
export type ElementKey = 'title' | 'hero' | 'source' | 'paper' | 'paperStrip' | 'tape1' | 'tape2' | 'tape3' | 'botanical' | 'pin'

/**
 * Only elements the variant actually renders (DocumentaryCard Cover/Info):
 * Cover has one tape (`tape1`, on the hero image); Info has one tape per image
 * card (`tape1`, `tape2`) plus the lower tape (`tape3`). No variant tapes the title.
 * Fonte (source/credit line) is Info-only: Cover's source_line is not
 * independently authored today, so the element genuinely does not exist there.
 */
export function elementsForVariant(variant: AuthoringState['variant']): { key: ElementKey; label: string }[] {
  const tapes: { key: ElementKey; label: string }[] = variant === 'cover'
    ? [{ key: 'tape1', label: 'Fita da imagem' }]
    : [{ key: 'tape1', label: 'Fita da imagem 1' }, { key: 'tape2', label: 'Fita da imagem 2' }, { key: 'tape3', label: 'Fita inferior' }]
  return [
    { key: 'title', label: 'Título' },
    ...(variant === 'cover' ? [{ key: 'hero' as const, label: 'Hero' }] : []),
    ...(variant === 'info' ? [{ key: 'source' as const, label: 'Fonte' }] : []),
    { key: 'paper', label: 'Paper' },
    { key: 'paperStrip', label: 'Faixa do título' },
    ...tapes,
    { key: 'pin', label: 'Pin' },
    { key: 'botanical', label: 'Botânica' },
  ]
}
