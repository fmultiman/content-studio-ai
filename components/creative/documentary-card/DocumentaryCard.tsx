import type { CSSProperties } from 'react'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import { resolveFixtureAssetSync } from '@/lib/creative/assets/resolve-asset'
import { CoverVariant } from './CoverVariant'
import { InfoVariant } from './InfoVariant'
import { paletteFromTokens } from './primitives'
import type { DocumentaryCardProps, DocumentaryCardVisualContext } from './types'
import type { DocumentaryCardPreviewTuning } from '@/lib/creative/authoring/types'

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
  materialBaseUrl,
  materialUrls,
  materialAssets,
  previewTuning,
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
    materialBaseUrl,
    materialUrls,
    materialAssets,
    previewTuning,
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
    // A semantic fade is interpreted by the shared visual tree. Still output
    // remains fully opaque; video adapters provide only runtime frame data.
    opacity: mode === 'video' && motion?.preset === 'fade' ? contentOpacity : 1,
  }

  return (
    <main aria-label={`Editorial documentary card ${variant}`} style={rootStyle}>
      {variant === 'cover' ? <CoverVariant context={context} palette={palette} /> : <InfoVariant context={context} palette={palette} />}
    </main>
  )
}

export type DocumentaryCardRuntimeInput = Pick<
  DocumentaryCardProps,
  'variant' | 'content' | 'assets' | 'tokens' | 'canvas' | 'sequence'
>

export type DocumentaryCardRuntimeOptions = Pick<
  DocumentaryCardProps,
  'mode' | 'motion' | 'previewTuning' | 'frame' | 'durationInFrames'
>

/**
 * Shared runtime props builder for still and timeline adapters. It keeps the
 * material asset plan and DocumentaryCard tree identical across both paths.
 */
export function documentaryCardPropsFromRuntimeInput(
  input: DocumentaryCardRuntimeInput,
  options: DocumentaryCardRuntimeOptions,
): DocumentaryCardProps {
  const materialAssets = {
    tornPaper: resolveFixtureAssetSync('fixture:asset:documentary-card:torn-paper-cream-01'),
    tape: resolveFixtureAssetSync('fixture:asset:documentary-card:tape-kraft-01'),
  }
  const resolvedMaterialAssets = Object.fromEntries(
    Object.entries(materialAssets).map(([name, result]) => {
      if (!result.valid) throw new Error(`Documentary card material failed to resolve: ${result.error.message}`)
      return [name, result.value]
    }),
  ) as NonNullable<DocumentaryCardProps['materialAssets']>

  return {
    ...input,
    mode: options.mode,
    motion: options.motion,
    previewTuning: options.previewTuning,
    frame: options.frame,
    durationInFrames: options.durationInFrames,
    materialAssets: resolvedMaterialAssets,
    materialUrls: {
      tornPaper: resolvedMaterialAssets.tornPaper?.url,
      tape: resolvedMaterialAssets.tape?.url,
    },
  }
}

export function documentaryCardPropsFromResolvedInput(
  input: ResolvedStaticRenderInput,
  mode: DocumentaryCardProps['mode'] = 'still',
  motion: DocumentaryCardProps['motion'] = undefined,
  previewTuning?: DocumentaryCardPreviewTuning,
): DocumentaryCardProps {
  const variant = input.manifest.template.variant
  if (variant !== 'cover' && variant !== 'info') throw new Error(`Unsupported documentary card variant: ${variant ?? '(missing)'}`)
  return documentaryCardPropsFromRuntimeInput({
    variant,
    content: input.manifest.content as DocumentaryCardProps['content'],
    assets: input.resolvedAssets,
    tokens: input.tokens,
    canvas: input.manifest.canvas,
    sequence: input.manifest.sequence,
  }, { mode, motion, previewTuning })
}
