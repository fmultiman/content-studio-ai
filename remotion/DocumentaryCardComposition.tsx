import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import type { AuthoringRenderOverrides } from '@/lib/creative/authoring/render-request'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'
import { TypographyReadyBoundary } from './TypographyReadyBoundary'

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
  return { ...value, assets: normalizedAssets, materialUrls } as T
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
}

/**
 * Official Wave 5 adapter boundary: Remotion receives the renderer-neutral
 * resolved input, then chooses the registered component by component_key.
 * No manifest fixture is assembled here and no resolver state is persisted.
 */
export const StaticRenderManifestStillComposition: React.FC<StaticRenderManifestStillProps> = ({ resolvedInput, overrides, primitiveMaterials, primitiveTransforms }) => {
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
  }, { mode: 'still', overrides })
  return <TypographyReadyBoundary typography={resolvedInput.typography}>{binding.component(remotionTemplateProps(props))}</TypographyReadyBoundary>
}
