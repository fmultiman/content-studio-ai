import type { ComponentType, CSSProperties } from 'react'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import { resolveFixtureAssetSync } from '@/lib/creative/assets/resolve-asset'
import { CoverVariant } from './CoverVariant'
import { InfoVariant } from './InfoVariant'
import { ListVariant } from './ListVariant'
import { GridVariant } from './GridVariant'
import { MapVariant } from './MapVariant'
import { NetworkVariant } from './NetworkVariant'
import { QuoteVariant } from './QuoteVariant'
import { ClosingVariant } from './ClosingVariant'
import { paletteFromTokens } from './primitives'
import { DOCUMENTARY_CARD_VARIANTS, type DocumentaryCardProps, type DocumentaryCardVariant, type DocumentaryCardVisualContext } from './types'
import type { DocumentaryCardPreviewTuning } from '@/lib/creative/authoring/types'
import { resolveElementStack } from '@/lib/creative/templates/element-stack'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE, type AssetSlotId } from '@/lib/creative/templates/template-definitions'
import type { MaterialName } from './primitives'
import type { CardPalette } from './primitives'

/** One code-backed component per template layout (editorial-documentary-collage-v1). */
const VARIANT_COMPONENTS: Record<DocumentaryCardVariant, ComponentType<{ context: DocumentaryCardVisualContext; palette: CardPalette }>> = {
  cover: CoverVariant,
  info: InfoVariant,
  list: ListVariant,
  grid: GridVariant,
  map: MapVariant,
  network: NetworkVariant,
  quote: QuoteVariant,
  closing: ClosingVariant,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function DocumentaryCard({
  variant,
  appearance,
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
  materialContain,
  primitiveTransforms,
  templateId,
  elementOrder,
  hiddenElements,
  previewTuning,
  typographyOverrides,
  frame = 0,
  durationInFrames = 180,
}: DocumentaryCardProps) {
  // Slice 1 — Portal Carousel V1: appearance is independent of structural
  // variant. When absent (every manifest authored before this axis existed),
  // fall back to the legacy per-variant default so nothing already rendered
  // changes: cover was always forced dark, info always used token defaults.
  const resolvedAppearance: NonNullable<DocumentaryCardProps['appearance']> = appearance ?? (variant === 'cover' ? 'dark' : 'light')
  const isDark = resolvedAppearance === 'dark'
  const tokenPalette = paletteFromTokens(tokens, isDark)
  const palette = isDark
    ? { ...tokenPalette, background: '#0b1020', foreground: '#f3ead8', paper: '#efe3ca', paperAlt: '#b9a681', ink: '#111923' }
    : tokenPalette
  const progress = mode === 'video' ? clamp(frame / Math.max(durationInFrames - 1, 1), 0, 1) : 1
  const contentOpacity = mode === 'video' && motion?.preset === 'fade' ? clamp(progress * 6, 0, 1) : 1
  const contentTranslateY = mode === 'video' && motion?.preset === 'fade' ? (1 - contentOpacity) * 18 : 0
  // ONE normalization for every render path (Editor preview, worker still, video).
  const stack = resolveElementStack(templateId, variant, elementOrder)
  const context: DocumentaryCardVisualContext = {
    variant,
    appearance,
    resolvedAppearance,
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
    materialContain,
    primitiveTransforms,
    templateId,
    elementOrder,
    hiddenElements,
    stack,
    hidden: new Set(hiddenElements ?? []),
    previewTuning,
    typographyOverrides,
    frame,
    durationInFrames,
    progress,
    contentOpacity,
    contentTranslateY,
  }
  const Variant = VARIANT_COMPONENTS[variant] ?? InfoVariant
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
      <Variant context={context} palette={palette} />
    </main>
  )
}

export type DocumentaryCardRuntimeInput = Pick<
  DocumentaryCardProps,
  'variant' | 'appearance' | 'content' | 'assets' | 'tokens' | 'canvas' | 'sequence' | 'primitiveMaterials' | 'primitiveTransforms' | 'templateId' | 'elementOrder' | 'hiddenElements'
>

export type DocumentaryCardRuntimeOptions = Pick<
  DocumentaryCardProps,
  'mode' | 'motion' | 'previewTuning' | 'typographyOverrides' | 'frame' | 'durationInFrames'
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
    tornPaper: input.primitiveMaterials?.paper
      ? { valid: true as const, value: input.primitiveMaterials.paper }
      : resolveFixtureAssetSync('fixture:asset:documentary-card:torn-paper-cream-01'),
    tape: input.primitiveMaterials?.tape
      ? { valid: true as const, value: input.primitiveMaterials.tape }
      : resolveFixtureAssetSync('fixture:asset:documentary-card:tape-kraft-01'),
  }
  const resolvedMaterialAssets = Object.fromEntries(
    Object.entries(materialAssets).map(([name, result]) => {
      if (!result.valid) throw new Error(`Documentary card material failed to resolve: ${result.error.message}`)
      return [name, result.value]
    }),
  ) as NonNullable<DocumentaryCardProps['materialAssets']>

  // Every other Project-filled slot (Authoring Usability Completion V1): its
  // material URL comes from the resolved LibraryFile; absent slots keep the
  // template-bundled default resolved by materialUrl().
  const slotMaterialUrls: Partial<Record<MaterialName, string>> = {}
  const materialContain: Partial<Record<MaterialName, boolean>> = {}
  for (const [slotId, asset] of Object.entries(input.primitiveMaterials ?? {}) as [AssetSlotId, NonNullable<DocumentaryCardProps['primitiveMaterials']>[AssetSlotId]][]) {
    const slot = EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.assetSlots[slotId]
    if (!slot || !asset?.url) continue
    slotMaterialUrls[slot.material] = asset.url
    if (asset.fit === 'contain') materialContain[slot.material] = true
  }

  return {
    ...input,
    mode: options.mode,
    motion: options.motion,
    previewTuning: options.previewTuning,
    typographyOverrides: options.typographyOverrides,
    frame: options.frame,
    durationInFrames: options.durationInFrames,
    materialAssets: resolvedMaterialAssets,
    primitiveMaterials: input.primitiveMaterials,
    materialContain,
    materialUrls: {
      ...slotMaterialUrls,
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
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials'],
  primitiveTransforms?: DocumentaryCardProps['primitiveTransforms'],
  layering?: Pick<DocumentaryCardProps, 'templateId' | 'elementOrder' | 'hiddenElements'>,
  typographyOverrides?: DocumentaryCardProps['typographyOverrides'],
): DocumentaryCardProps {
  const variant = input.manifest.template.variant
  if (!variant || !(DOCUMENTARY_CARD_VARIANTS as readonly string[]).includes(variant)) throw new Error(`Unsupported documentary card variant: ${variant ?? '(missing)'}`)
  return documentaryCardPropsFromRuntimeInput({
    variant: variant as DocumentaryCardVariant,
    appearance: input.manifest.template.appearance,
    content: input.manifest.content as DocumentaryCardProps['content'],
    assets: input.resolvedAssets,
    tokens: input.tokens,
    canvas: input.manifest.canvas,
    sequence: input.manifest.sequence,
    primitiveMaterials,
    primitiveTransforms,
    templateId: layering?.templateId,
    elementOrder: layering?.elementOrder,
    hiddenElements: layering?.hiddenElements,
  }, { mode, motion, previewTuning, typographyOverrides })
}
