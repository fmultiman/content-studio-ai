import type { CSSProperties } from 'react'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import { CoverVariant } from './CoverVariant'
import { InfoVariant } from './InfoVariant'
import { paletteFromTokens } from './primitives'
import type { DocumentaryCardProps, DocumentaryCardVisualContext } from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function DocumentaryCard({
  variant,
  content,
  assets,
  tokens,
  canvas,
  mode,
  motion,
  sequence,
  frame = 0,
  durationInFrames = 180,
}: DocumentaryCardProps) {
  const tokenPalette = paletteFromTokens(tokens)
  const palette = variant === 'cover'
    ? { ...tokenPalette, background: '#0b1020', foreground: '#f3ead8', paper: '#efe3ca', paperAlt: '#b9a681', ink: '#111923' }
    : tokenPalette
  const progress = mode === 'video' ? clamp(frame / Math.max(durationInFrames - 1, 1), 0, 1) : 1
  const contentOpacity = mode === 'video' && motion?.preset === 'fade' ? clamp(progress * 6, 0, 1) : 1
  const contentTranslateY = mode === 'video' && motion?.preset === 'fade' ? (1 - contentOpacity) * 18 : 0
  const context: DocumentaryCardVisualContext = {
    variant,
    content,
    assets,
    tokens,
    canvas,
    mode,
    motion,
    sequence,
    frame,
    durationInFrames,
    progress,
    contentOpacity,
    contentTranslateY,
  }
  const rootStyle: CSSProperties = {
    background: palette.background,
    color: palette.foreground,
    fontFamily: tokens.typography.body.family,
    height: canvas.height,
    isolation: 'isolate',
    overflow: 'hidden',
    position: 'relative',
    width: canvas.width,
  }

  return (
    <main aria-label={`Editorial documentary card ${variant}`} style={rootStyle}>
      {variant === 'cover' ? <CoverVariant context={context} palette={palette} /> : <InfoVariant context={context} palette={palette} />}
    </main>
  )
}

export function documentaryCardPropsFromResolvedInput(
  input: ResolvedStaticRenderInput,
  mode: DocumentaryCardProps['mode'] = 'still',
  motion: DocumentaryCardProps['motion'] = undefined,
): DocumentaryCardProps {
  const variant = input.manifest.template.variant
  if (variant !== 'cover' && variant !== 'info') throw new Error(`Unsupported documentary card variant: ${variant ?? '(missing)'}`)
  return {
    variant,
    content: input.manifest.content as DocumentaryCardProps['content'],
    assets: input.resolvedAssets,
    tokens: input.tokens,
    canvas: input.manifest.canvas,
    mode,
    motion,
    sequence: input.manifest.sequence,
  }
}
