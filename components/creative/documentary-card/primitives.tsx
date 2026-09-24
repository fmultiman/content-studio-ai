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

export function BrandMark({
  asset,
  tokens,
  palette,
  label,
  logoSize = 56,
  style,
}: {
  asset?: ResolvedAsset
  tokens: VisualTokensSnapshot
  palette: CardPalette
  /** Brand label beside the logo; absent renders the logo alone. */
  label?: string
  logoSize?: number
  style?: CSSProperties
}) {
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: logoSize * 0.28, ...style }}>
      <AssetSurface
        asset={asset}
        label="Project brand mark"
        style={{
          backgroundColor: asset ? undefined : palette.accent,
          border: `2px solid ${palette.accent}`,
          borderRadius: '50%',
          flexShrink: 0,
          height: logoSize,
          overflow: 'hidden',
          width: logoSize,
        }}
      />
      {label ? (
        <>
          <div aria-hidden="true" style={{ alignSelf: 'stretch', background: palette.accent, opacity: .7, width: 2 }} />
          <div style={{ color: palette.foreground, fontFamily: tokens.typography.display.family, fontSize: logoSize * 0.22, fontWeight: tokens.typography.display.weight, letterSpacing: '.08em', lineHeight: 1.22, maxWidth: logoSize * 2.1, textTransform: 'uppercase' }}>
            {label}
          </div>
        </>
      ) : null}
    </div>
  )
}
