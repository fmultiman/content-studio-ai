import type { CSSProperties, ReactNode } from 'react'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'

export type CardPalette = {
  background: string
  foreground: string
  muted: string
  accent: string
  paper: string
  paperAlt: string
  ink: string
}

export function paletteFromTokens(tokens: VisualTokensSnapshot): CardPalette {
  return {
    background: tokens.colors.background,
    foreground: tokens.colors.foreground,
    muted: tokens.colors.muted ?? tokens.colors.foreground,
    accent: tokens.colors.accent ?? tokens.colors.foreground,
    paper: tokens.colors.background.toLowerCase() === '#0b1020' ? '#e9ddc6' : '#efe3ca',
    paperAlt: tokens.colors.background.toLowerCase() === '#0b1020' ? '#b9a681' : '#d7c69d',
    ink: tokens.colors.background.toLowerCase() === '#0b1020' ? '#111923' : tokens.colors.foreground,
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

export function PaperPlane({
  children,
  color,
  rotation,
  style,
  className,
}: {
  children?: ReactNode
  color: string
  rotation: number
  style?: CSSProperties
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        background: color,
        boxShadow: '0 18px 36px rgba(0, 0, 0, .18)',
        clipPath: 'polygon(2% 5%, 98% 0, 100% 94%, 5% 100%, 0 18%)',
        transform: `rotate(${rotation}deg)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Tape({ color, rotation, style }: { color: string; rotation: number; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        background: color,
        boxShadow: '0 2px 5px rgba(0, 0, 0, .16)',
        height: 28,
        opacity: .86,
        transform: `rotate(${rotation}deg)`,
        width: 110,
        ...style,
      }}
    />
  )
}

export function Botanical({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 120 220" style={style}>
      <path d="M58 216C55 158 62 92 71 10" fill="none" stroke={color} strokeLinecap="round" strokeWidth="3" />
      <path d="M65 150C30 143 16 122 11 98c29 2 48 18 54 38M67 118c25-8 37-24 43-50-28 6-42 19-47 36M58 80C31 74 17 58 12 37c25 1 42 12 50 28M70 64c20-8 31-20 37-40-24 4-36 14-42 29" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    </svg>
  )
}

export function NetworkLines({ color, style }: { color: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 420 220" style={style}>
      <g fill="none" stroke={color} strokeDasharray="2 12" strokeWidth="2" opacity=".7">
        <path d="M14 172C76 52 176 190 235 42s122 42 171-22" />
        <path d="M0 62c82 118 157-68 243 48s132 24 177-70" />
      </g>
      <g fill={color}>
        <circle cx="79" cy="89" r="6" /><circle cx="235" cy="42" r="7" /><circle cx="355" cy="98" r="5" />
      </g>
    </svg>
  )
}

export function SequenceMarker({
  index,
  total,
  color,
  ink,
  style,
}: {
  index?: number
  total?: number
  color: string
  ink: string
  style?: CSSProperties
}) {
  if (!index || !total) return null
  return (
    <div
      style={{
        alignItems: 'center',
        border: `2px solid ${color}`,
        borderRadius: 999,
        color: ink,
        display: 'flex',
        fontFamily: 'inherit',
        fontSize: 19,
        fontWeight: 700,
        justifyContent: 'center',
        letterSpacing: '.06em',
        minWidth: 78,
        padding: '8px 14px',
        ...style,
      }}
    >
      {index}/{total}
    </div>
  )
}

export function BrandMark({
  asset,
  tokens,
  palette,
  style,
}: {
  asset?: ResolvedAsset
  tokens: VisualTokensSnapshot
  palette: CardPalette
  style?: CSSProperties
}) {
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 14, ...style }}>
      <AssetSurface
        asset={asset}
        label="Project brand mark"
        style={{
          backgroundColor: asset ? undefined : palette.accent,
          border: `2px solid ${palette.accent}`,
          borderRadius: '50%',
          height: 56,
          overflow: 'hidden',
          width: 56,
        }}
      />
      <div style={{ color: palette.foreground, fontFamily: tokens.typography.display.family, fontSize: 20, fontWeight: tokens.typography.display.weight, letterSpacing: '.08em', lineHeight: 1.1, maxWidth: 230, textTransform: 'uppercase' }}>
        Project identity
      </div>
    </div>
  )
}
