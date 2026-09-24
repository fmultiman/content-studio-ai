import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import type { AuthoringRenderOverrides } from '@/lib/creative/authoring/render-request'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'
import { TypographyReadyBoundary } from './TypographyReadyBoundary'
import { RenderAssetsReadyBoundary } from './RenderAssetsReadyBoundary'
import { materialUrl, type MaterialName } from '@/components/creative/documentary-card/primitives'

/**
 * Remotion serves the bundled publicDir under `/public/` (the same prefix
 * resolve-typography already uses for fonts). DocumentaryCard's material
 * fallback base is the Next.js web root (`/creative-fixtures`), which 404s
 * inside a Remotion render — so paperStrip / pin / botanical (Pack B)
 * silently disappeared from every Remotion output. Only this Remotion
 * adapter changes the base; the web preview keeps its own.
 */
const REMOTION_MATERIAL_BASE_URL = '/public/creative-fixtures'
const DOCUMENTARY_CARD_MATERIALS: readonly MaterialName[] = ['tornPaper', 'paperStrip', 'paperDark', 'paperScrap', 'archival', 'tape', 'pin', 'botanical', 'botanicalLeaf', 'ornament']

export type DocumentaryCardCompositionProps = DocumentaryCardProps

export function remotionTemplateProps<T>(props: T): T {
  if (!props || typeof props !== 'object') return props
  const value = props as Record<string, unknown>
  const assets = value.assets
  const normalizedAssets = assets && typeof assets === 'object'
    ? Object.fromEntries(Object.entries(assets).map(([slot, asset]) => {
        if (!asset || typeof asset !== 'object') return [slot, asset]
        const resolved = asset as Record<string, unknown>
        const path = typeof resolved.path === 'string' ? resolved.path : undefined
        return [slot, path?.startsWith('public/') ? { ...resolved, url: `/public/${path.slice('public/'.length)}` } : asset]
      }))
    : assets
  const materialUrls = value.materialUrls && typeof value.materialUrls === 'object'
    ? Object.fromEntries(Object.entries(value.materialUrls).map(([name, url]) => [name, typeof url === 'string' && url.startsWith('/creative-fixtures/') ? `/public${url}` : url]))
    : value.materialUrls
  const isDocumentaryCard = 'materialUrls' in value
  const materialBaseUrl = isDocumentaryCard && typeof value.materialBaseUrl !== 'string' ? REMOTION_MATERIAL_BASE_URL : value.materialBaseUrl
  return { ...value, assets: normalizedAssets, materialUrls, ...(isDocumentaryCard ? { materialBaseUrl } : {}) } as T
}

/** Every image URL a DocumentaryCard still will paint (materials + bound assets), post-normalization. */
export function documentaryCardImageUrls(props: DocumentaryCardProps): string[] {
  const materials = DOCUMENTARY_CARD_MATERIALS.map((name) => materialUrl(name, props.materialBaseUrl, props.materialUrls))
  const assets = Object.values(props.assets ?? {}).map((asset) => (asset && typeof asset === 'object' ? asset.url : undefined))
  return [...materials, ...assets].filter((url): url is string => typeof url === 'string' && url.length > 0)
}

export function remotionProps(props: DocumentaryCardProps): DocumentaryCardProps {
  return remotionTemplateProps(props)
}

export const DocumentaryCardComposition: React.FC<DocumentaryCardCompositionProps> = (props) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  return <DocumentaryCard {...remotionProps(props)} mode="video" frame={frame} durationInFrames={durationInFrames} />
}

export const DocumentaryCardStillComposition: React.FC<DocumentaryCardCompositionProps> = (props) => (
  <DocumentaryCard {...remotionProps(props)} mode="still" />
)

export type StaticRenderManifestStillProps = {
  resolvedInput: ResolvedStaticRenderInput
  overrides?: AuthoringRenderOverrides
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials']
  primitiveTransforms?: DocumentaryCardProps['primitiveTransforms']
  templateId?: string
  elementOrder?: string[]
}

/**
 * Official Wave 5 adapter boundary: Remotion receives the renderer-neutral
 * resolved input, then chooses the registered component by component_key.
 * No manifest fixture is assembled here and no resolver state is persisted.
 */
export const StaticRenderManifestStillComposition: React.FC<StaticRenderManifestStillProps> = ({ resolvedInput, overrides, primitiveMaterials, primitiveTransforms, templateId, elementOrder }) => {
  const binding = resolveTemplateBinding(resolvedInput.resolvedTemplate.descriptor.component_key)
  if (!binding) throw new Error(`No visual component is registered for component_key "${resolvedInput.resolvedTemplate.descriptor.component_key}"`)
  const props = binding.createProps({
    variant: resolvedInput.resolvedTemplate.ref.variant,
    appearance: resolvedInput.resolvedTemplate.ref.appearance,
    content: resolvedInput.manifest.content,
    assets: resolvedInput.resolvedAssets,
    tokens: resolvedInput.tokens,
    canvas: resolvedInput.manifest.canvas,
    sequence: resolvedInput.manifest.sequence,
    primitiveMaterials,
    primitiveTransforms,
    templateId,
    elementOrder,
  }, { mode: 'still', overrides })
  const renderProps = remotionTemplateProps(props)
  // A still is one captured frame: hold it until every painted image loaded.
  const imageUrls = 'materialUrls' in (renderProps as object) ? documentaryCardImageUrls(renderProps as DocumentaryCardProps) : []
  return (
    <TypographyReadyBoundary typography={resolvedInput.typography}>
      <RenderAssetsReadyBoundary urls={imageUrls}>{binding.component(renderProps)}</RenderAssetsReadyBoundary>
    </TypographyReadyBoundary>
  )
}
