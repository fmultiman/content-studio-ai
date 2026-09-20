import type { CSSProperties } from 'react'
import type { CanvasSpec, MotionSpec, SequenceContext, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { QuoteCardContent } from '@/lib/schemas/creative/quote-card'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'

export type QuoteCardProps = {
  variant: 'default'
  content: QuoteCardContent
  assets: Record<string, ResolvedAsset>
  tokens: VisualTokensSnapshot
  canvas: CanvasSpec
  mode: 'still' | 'video'
  motion?: MotionSpec
  sequence?: SequenceContext
  frame?: number
  durationInFrames?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function QuoteCard({
  content,
  tokens,
  canvas,
  mode,
  motion,
  sequence,
  frame = 0,
  durationInFrames = 180,
}: QuoteCardProps) {
  const progress = mode === 'video' ? clamp(frame / Math.max(durationInFrames - 1, 1), 0, 1) : 1
  const opacity = mode === 'video' && motion?.preset === 'fade' ? clamp(progress * 6, 0, 1) : 1
  const translateY = mode === 'video' && motion?.preset === 'fade' ? (1 - opacity) * 18 : 0
  const rootStyle: CSSProperties = {
    background: tokens.colors.background,
    color: tokens.colors.foreground,
    fontFamily: tokens.typography.body.family,
    height: canvas.height,
    opacity,
    overflow: 'hidden',
    padding: `${tokens.spacing.safe_area?.top ?? 72}px ${tokens.spacing.safe_area?.right ?? 64}px ${tokens.spacing.safe_area?.bottom ?? 72}px ${tokens.spacing.safe_area?.left ?? 64}px`,
    position: 'relative',
    transform: `translateY(${translateY}px)`,
    width: canvas.width,
  }
  const labelStyle: CSSProperties = {
    color: tokens.colors.accent ?? tokens.colors.foreground,
    fontFamily: tokens.typography.label?.family ?? tokens.typography.body.family,
    fontSize: 22,
    fontWeight: tokens.typography.label?.weight ?? 600,
    letterSpacing: '.12em',
    textTransform: tokens.typography.label?.text_transform === 'lowercase' ? 'lowercase' : 'uppercase',
  }

  return (
    <main aria-label="Editorial quote card" style={rootStyle}>
      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
        {content.eyebrow ? <span style={labelStyle}>{content.eyebrow}</span> : <span style={labelStyle}>Field note</span>}
        {sequence ? <span style={{ color: tokens.colors.muted ?? tokens.colors.foreground, fontSize: 20 }}>{sequence.index}/{sequence.total}</span> : null}
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: canvas.height * .62 }}>
        <div aria-hidden="true" style={{ background: tokens.colors.accent ?? tokens.colors.foreground, height: 8, marginBottom: 42, width: 96 }} />
        <blockquote style={{ fontFamily: tokens.typography.display.family, fontSize: canvas.height >= 1800 ? 74 : 66, fontWeight: tokens.typography.display.weight, letterSpacing: '-.025em', lineHeight: 1.04, margin: 0, maxWidth: canvas.width - 160 }}>
          “{content.quote}”
        </blockquote>
        {content.attribution ? <p style={{ color: tokens.colors.muted ?? tokens.colors.foreground, fontSize: 28, margin: '42px 0 0' }}>— {content.attribution}</p> : null}
      </section>
      <footer style={{ borderTop: `2px solid ${tokens.colors.muted ?? tokens.colors.foreground}66`, bottom: tokens.spacing.safe_area?.bottom ?? 72, left: tokens.spacing.safe_area?.left ?? 64, paddingTop: 18, position: 'absolute', right: tokens.spacing.safe_area?.right ?? 64 }}>
        <span style={{ color: tokens.colors.muted ?? tokens.colors.foreground, fontSize: 20 }}>{content.source_line ?? 'Editorial archive'}</span>
      </footer>
    </main>
  )
}

export type QuoteCardRuntimeInput = Pick<QuoteCardProps, 'variant' | 'content' | 'assets' | 'tokens' | 'canvas' | 'sequence'>
export type QuoteCardRuntimeOptions = Pick<QuoteCardProps, 'mode' | 'motion' | 'frame' | 'durationInFrames'>

export function quoteCardPropsFromRuntimeInput(input: QuoteCardRuntimeInput, options: QuoteCardRuntimeOptions): QuoteCardProps {
  return { ...input, ...options }
}
