import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

export type DocumentaryCardCompositionProps = DocumentaryCardProps

function remotionProps(props: DocumentaryCardProps): DocumentaryCardProps {
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
