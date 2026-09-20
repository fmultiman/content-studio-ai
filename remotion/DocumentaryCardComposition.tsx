import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import type { AuthoringRenderOverrides } from '@/lib/creative/authoring/render-request'

export type DocumentaryCardCompositionProps = DocumentaryCardProps

export function remotionProps(props: DocumentaryCardProps): DocumentaryCardProps {
  return {
    ...props,
    materialUrls: {
      tornPaper: '/public/creative-fixtures/torn-paper-cream-01.png',
      tape: '/public/creative-fixtures/tape-kraft-01.png',
    },
    assets: Object.fromEntries(
      Object.entries(props.assets).map(([slot, asset]) => [
        slot,
        {
          ...asset,
          url: asset.path.startsWith('public/')
            ? `/public/${asset.path.slice('public/'.length)}`
            : asset.url,
        },
      ]),
    ),
  }
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
}

/**
 * Official Wave 5 adapter boundary: Remotion receives the renderer-neutral
 * resolved input, then chooses the registered component by component_key.
 * No manifest fixture is assembled here and no resolver state is persisted.
 */
export const StaticRenderManifestStillComposition: React.FC<StaticRenderManifestStillProps> = ({ resolvedInput, overrides }) => {
  if (resolvedInput.resolvedTemplate.descriptor.component_key !== 'editorial.documentary-card') {
    throw new Error(`No visual component is registered for component_key "${resolvedInput.resolvedTemplate.descriptor.component_key}"`)
  }

  const props = documentaryCardPropsFromResolvedInput(resolvedInput, 'still', undefined, overrides?.documentaryCard)
  return <DocumentaryCard {...remotionProps(props)} mode="still" />
}
