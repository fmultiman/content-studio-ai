import type { CSSProperties, ReactNode } from 'react'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import type { PrimitiveTransforms } from '@/lib/creative/primitives/transforms'
import {
  EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE,
  type AssetMetrics,
  type AssetSlotId,
  type TemplateMaterialName,
} from '@/lib/creative/templates/template-definitions'

export type CardPalette = {
  background: string
  foreground: string
  muted: string
  accent: string
  paper: string
  paperAlt: string
  ink: string
}

export type MaterialName = TemplateMaterialName

/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the LOCAL typography override of a Template text Element
 * as inline style: only what the author set (a supported registry family; a size in px on the 1080px reference
 * canvas, scaled like every other Template measure). No override = `{}`, so the legacy tree is untouched.
 */
export function localTypography(context: { typographyOverrides?: Record<string, { fontFamily?: string; fontSizePx?: number }>; canvas: { width: number } }, elementId: string): CSSProperties {
  const override = context.typographyOverrides?.[elementId]
  if (!override) return {}
  return {
    ...(override.fontFamily ? { fontFamily: override.fontFamily } : {}),
    ...(override.fontSizePx ? { fontSize: override.fontSizePx * (context.canvas.width / 1080) } : {}),
  }
}

/**
 * Template-bundled default file per material, derived from the Template
 * registry's asset slots (never a second hand-maintained list). Keep
 * infra/render-worker-runtime/export.mjs REQUIRED_STATIC_ASSETS aligned.
 */
const MATERIAL_SLOTS: Record<MaterialName, AssetSlotId> = Object.fromEntries(
  Object.values(EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.assetSlots).map((slot) => [slot.material, slot.id]),
) as Record<MaterialName, AssetSlotId>

export function materialUrl(name: MaterialName, baseUrl?: string, urls?: Partial<Record<MaterialName, string>>): string {
  if (urls?.[name]) return urls[name] as string
  const slot = EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.assetSlots[MATERIAL_SLOTS[name]]
  return `${baseUrl ?? '/creative-fixtures'}/${slot.defaultAsset.path}`
}

/**
 * Visible-bounds metrics of a material. A Project primitive that replaces a
 * slot (paper/tape) is today always the same file as the template default
 * (identical sha256 — see lib/creative/primitives/discovery.ts), so the
 * default's metrics apply to it too.
 */
export function materialMetrics(name: MaterialName): AssetMetrics {
  return EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.assetSlots[MATERIAL_SLOTS[name]].defaultAsset.metrics
}

/**
 * Derives paper/paperAlt/ink from an EXPLICIT appearance flag. Slice 1 —
 * Portal Carousel V1: this used to infer "dark" from a magic-hex equality
 * check against tokens.colors.background, which coupled appearance to
 * whatever identity tokens happened to resolve to. Appearance is now an
 * authoring-layer input the caller resolves and passes in explicitly.
 */
export function paletteFromTokens(tokens: VisualTokensSnapshot, isDark: boolean): CardPalette {
  return {
    background: tokens.colors.background,
    foreground: tokens.colors.foreground,
    muted: tokens.colors.muted ?? tokens.colors.foreground,
    accent: tokens.colors.accent ?? tokens.colors.foreground,
    paper: isDark ? '#e9ddc6' : '#efe3ca',
    paperAlt: isDark ? '#b9a681' : '#d7c69d',
    ink: isDark ? '#111923' : tokens.colors.foreground,
  }
}

export function AssetSurface({
  asset,
  label,
  style,
}: {
  asset?: ResolvedAsset
  label: string
  style?: CSSProperties
}) {
  return (
    <div
      aria-label={label}
      role="img"
      style={{
        backgroundImage: asset ? `url(${asset.url})` : undefined,
        backgroundPosition: asset?.focal_point
          ? `${asset.focal_point.x * 100}% ${asset.focal_point.y * 100}%`
          : 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: asset?.ref ? (asset.fit === 'contain' ? 'contain' : 'cover') : 'auto',
        ...style,
      }}
    />
  )
}

/** Canvas-space box of an element's VISIBLE area (px). Height defaults to the asset's visible aspect. */
export type LayerBox = { left: number; top: number; width: number; height?: number }

/** One authored element's transform: template base rotation + the author's bounded refinement. */
export function elementTransform(rotation: number, transform?: PrimitiveTransforms, flipX = false): CSSProperties {
  const offsetX = transform?.offsetX ?? 0
  const offsetY = transform?.offsetY ?? 0
  const scale = transform?.scale ?? 1
  return {
    transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation + (transform?.rotation ?? 0)}deg) scale(${scale})${flipX ? ' scaleX(-1)' : ''}`,
    transformOrigin: 'center',
    opacity: transform?.opacity ?? 1,
  }
}

/**
 * Creative Editor Template Foundation V1 — one transparent Pack B asset
 * placed by its VISIBLE (alpha) bounds, so layout coordinates describe what
 * the eye sees, not the PNG's transparent padding. Children (text on a
 * paper) are laid out inside the visible box and never flipped.
 */
export function AssetLayer({
  url,
  metrics,
  box,
  rotation = 0,
  transform,
  flipX = false,
  zIndex,
  filter,
  shadow = false,
  contain = false,
  hidden = false,
  label,
  children,
}: {
  url: string
  metrics: AssetMetrics
  /**
   * Authoring Usability Completion V1: a Project image replacing a template
   * slot has unknown visible (alpha) bounds, so it is fitted whole inside the
   * element's visible box instead of being placed by the default's metrics.
   */
  contain?: boolean
  /** Static Detail Polish V1: an authored element the slide hides paints nothing (it keeps its stack place). */
  hidden?: boolean
  box: LayerBox
  rotation?: number
  transform?: PrimitiveTransforms
  flipX?: boolean
  zIndex?: number
  filter?: string
  shadow?: boolean
  label?: string
  children?: ReactNode
}) {
  if (hidden) return null
  const height = box.height ?? (box.width * metrics.visible.height) / metrics.visible.width
  const scaleX = box.width / metrics.visible.width
  const scaleY = height / metrics.visible.height
  const imageStyle: CSSProperties = contain ? {
    backgroundImage: `url(${url})`,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'contain',
    inset: 0,
    position: 'absolute',
    ...(flipX ? { transform: 'scaleX(-1)' } : {}),
    ...(filter || shadow ? { filter: [shadow ? 'drop-shadow(0 14px 22px rgba(0, 0, 0, .28))' : '', filter ?? ''].join(' ').trim() } : {}),
  } : {
    backgroundImage: `url(${url})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    height: metrics.height * scaleY,
    left: -metrics.visible.x * scaleX,
    position: 'absolute',
    top: -metrics.visible.y * scaleY,
    width: metrics.width * scaleX,
    ...(flipX ? { transform: 'scaleX(-1)', transformOrigin: `${(metrics.visible.x + metrics.visible.width / 2) * scaleX}px center` } : {}),
    ...(filter || shadow ? { filter: [shadow ? 'drop-shadow(0 14px 22px rgba(0, 0, 0, .28))' : '', filter ?? ''].join(' ').trim() } : {}),
  }
  return (
    <div
      aria-hidden={label ? undefined : true}
      aria-label={label}
      data-element={label}
      style={{ height, left: box.left, position: 'absolute', top: box.top, width: box.width, zIndex, ...elementTransform(rotation, transform) }}
    >
      <div style={imageStyle} />
      {children ? <div style={{ inset: 0, position: 'absolute' }}>{children}</div> : null}
    </div>
  )
}

/**
 * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — the text printed on a paper, as its OWN Element.
 *
 * A sibling of the paper's `AssetLayer` with the SAME box, rotation and transform channel: the text
 * sits exactly where the paper's visible area is, follows the paper's position, and owns its own
 * visibility and paint layer. Hiding the paper never hides the text (and vice-versa); replacing the
 * paper's file never touches the text. The paper's transform (opacity included) is shared by design:
 * it is the anchor the text follows, not a parent.
 */
export function AssetTextLayer({
  metrics,
  box,
  rotation = 0,
  transform,
  zIndex,
  hidden = false,
  label,
  children,
}: {
  metrics: AssetMetrics
  box: LayerBox
  rotation?: number
  transform?: PrimitiveTransforms
  zIndex?: number
  hidden?: boolean
  label?: string
  children?: ReactNode
}) {
  if (hidden) return null
  const height = box.height ?? (box.width * metrics.visible.height) / metrics.visible.width
  return (
    <div aria-label={label} data-element={label} style={{ height, left: box.left, position: 'absolute', top: box.top, width: box.width, zIndex, ...elementTransform(rotation, transform) }}>
      <div style={{ inset: 0, position: 'absolute' }}>{children}</div>
    </div>
  )
}

/** Canvas-space box + base rotation of a content-image plate (the photo and its frame share it). */
export type PlateGeometry = { left: number; top: number; width: number; height: number; padding: number; rotation: number }
type PlateTuning = { offsetX: number; offsetY: number; rotation: number; scale: number } | undefined

/**
 * Both halves of a framed content image use THESE inline styles verbatim (height/width + padding stay
 * on the element, so content-box and border-box renderers lay the frame and the photo out identically).
 */
function plateStyle(geometry: PlateGeometry, tuning: PlateTuning, zIndex: number): CSSProperties {
  return {
    height: geometry.height,
    left: geometry.left,
    padding: geometry.padding,
    position: 'absolute',
    top: geometry.top,
    width: geometry.width,
    zIndex,
    transform: `translate(${tuning?.offsetX ?? 0}px, ${tuning?.offsetY ?? 0}px) rotate(${geometry.rotation + (tuning?.rotation ?? 0)}deg) scale(${tuning?.scale ?? 1})`,
    transformOrigin: 'center',
  }
}

/** The pale photo border + shadow of a content image: a procedural Element (no file), painted under the image. */
export function PlateFrame({ geometry, tuning, zIndex, hidden, background, shadow }: { geometry: PlateGeometry; tuning: PlateTuning; zIndex: number; hidden: boolean; background: string; shadow: string }) {
  if (hidden) return null
  return <div aria-hidden="true" data-element="Moldura" style={{ ...plateStyle(geometry, tuning, zIndex), background, boxShadow: shadow }} />
}

/**
 * The content image itself, in the plate's box. `frameHidden` only changes the GEOMETRY (the photo takes the
 * whole plate instead of sitting inside the border) — the image is always painted, whatever the frame does.
 */
export function PlateImage({ geometry, tuning, zIndex, hidden, frameHidden, label, children }: { geometry: PlateGeometry; tuning: PlateTuning; zIndex: number; hidden: boolean; frameHidden: boolean; label: string; children: ReactNode }) {
  if (hidden) return null
  return (
    <div aria-label={label} data-hero-frame={frameHidden ? 'off' : 'on'} style={plateStyle({ ...geometry, padding: frameHidden ? 0 : geometry.padding }, tuning, zIndex)}>
      <div style={{ height: '100%', overflow: 'hidden', position: 'relative', width: '100%' }}>{children}</div>
    </div>
  )
}

export function GrainOverlay({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        backgroundImage: `radial-gradient(${color} 0.7px, transparent 0.9px), radial-gradient(${color} 0.55px, transparent 0.75px)`,
        backgroundPosition: '0 0, 13px 11px',
        backgroundSize: '23px 23px, 31px 31px',
        mixBlendMode: 'soft-light',
        opacity: .2,
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}

/** Small four-point star (Pack B Slide 1 background chrome). */
export function Sparkle({ color, size, style }: { color: string; size: number; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width={size} height={size} style={{ position: 'absolute', ...style }}>
      <path d="M10 0 L11.6 8.4 L20 10 L11.6 11.6 L10 20 L8.4 11.6 L0 10 L8.4 8.4 Z" fill={color} />
    </svg>
  )
}

/**
 * CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — the brand signature as ONE complete logo asset.
 *
 * The Project/Template logo file is a complete logo/wordmark: it already carries the brand name, so nothing else
 * is drawn beside it, and it is never masked (no circle, no border) or cropped (`contain`, anchored to the left of
 * its box). Without an asset the accent disc placeholder stays, so an empty slot is still visible.
 */
export function BrandLogo({ asset, palette, width, height, style }: { asset?: ResolvedAsset; palette: CardPalette; width: number; height: number; style?: CSSProperties }) {
  return (
    <div style={{ alignItems: 'center', display: 'flex', ...style }}>
      <AssetSurface
        asset={asset}
        label="Project brand mark"
        style={{
          backgroundColor: asset ? undefined : palette.accent,
          backgroundPosition: 'left center',
          backgroundSize: asset ? 'contain' : undefined,
          borderRadius: asset ? undefined : '50%',
          flexShrink: 0,
          height,
          width: asset ? width : height,
        }}
      />
    </div>
  )
}

/**
 * The brand signature: logo artwork + (optionally) the brand name. STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1
 * made them two Elements: a caller paints ONE part by passing `show`, and the other part keeps its layout
 * space (`visibility: hidden`), so the visible part stays exactly where the whole signature put it.
 */
export function BrandMark({
  asset,
  tokens,
  palette,
  label,
  logoSize = 56,
  show = 'both',
  style,
}: {
  asset?: ResolvedAsset
  tokens: VisualTokensSnapshot
  palette: CardPalette
  /** Brand label beside the logo; absent renders the logo alone. */
  label?: string
  logoSize?: number
  show?: 'both' | 'logo' | 'name'
  style?: CSSProperties
}) {
  const logoVisibility: CSSProperties = show === 'name' ? { visibility: 'hidden' } : {}
  const nameVisibility: CSSProperties = show === 'logo' ? { visibility: 'hidden' } : {}
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: logoSize * 0.28, ...style }}>
      <AssetSurface
        asset={show === 'name' ? undefined : asset}
        label="Project brand mark"
        style={{
          backgroundColor: asset && show !== 'name' ? undefined : palette.accent,
          border: `2px solid ${palette.accent}`,
          borderRadius: '50%',
          flexShrink: 0,
          height: logoSize,
          overflow: 'hidden',
          width: logoSize,
          ...logoVisibility,
        }}
      />
      {label ? (
        <>
          <div aria-hidden="true" style={{ alignSelf: 'stretch', background: palette.accent, opacity: .7, width: 2, ...nameVisibility }} />
          <div style={{ ...nameVisibility, color: palette.foreground, fontFamily: tokens.typography.display.family, fontSize: logoSize * 0.22, fontWeight: tokens.typography.display.weight, letterSpacing: '.08em', lineHeight: 1.22, maxWidth: logoSize * 2.1, textTransform: 'uppercase' }}>
            {label}
          </div>
        </>
      ) : null}
    </div>
  )
}
