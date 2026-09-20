import React from 'react'
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

export type DocumentaryCardCompositionProps = DocumentaryCardProps

function remotionProps(props: DocumentaryCardProps): DocumentaryCardProps {
  return {
    ...props,
    assets: Object.fromEntries(
      Object.entries(props.assets).map(([slot, asset]) => [
        slot,
        {
          ...asset,
          url: asset.path.startsWith('public/')
            ? staticFile(asset.path.slice('public/'.length))
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
