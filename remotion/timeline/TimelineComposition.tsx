import React from 'react'
import { useCurrentFrame } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { TemplateSegment } from './TemplateSegment'
import { TypographyReadyBoundary } from '../TypographyReadyBoundary'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

export type TimelineCompositionProps = {
  resolvedInput: ResolvedTimelineInput
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials']
}

/**
 * Remotion-only adapter: timeline owns WHEN; registered templates own HOW.
 * No Remotion types or state cross back into TimelineManifest/resolution.
 */
export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ resolvedInput, primitiveMaterials }) => {
  const globalFrame = useCurrentFrame()
  const tracks = [...resolvedInput.manifest.tracks]
    .filter((track) => track.kind === 'video' || track.kind === 'overlay')
    .sort((a, b) => a.order - b.order)

  return (
    <TypographyReadyBoundary typography={resolvedInput.typography}>
      {tracks.flatMap((track) => resolvedInput.resolvedTemplateSegments
        .filter((resolvedSegment) => resolvedSegment.segment.track_id === track.id)
        .map((resolvedSegment) => (
          <TemplateSegment
            globalFrame={globalFrame}
            key={resolvedSegment.segment.id}
            resolvedInput={resolvedInput}
            resolvedSegment={resolvedSegment}
            primitiveMaterials={primitiveMaterials}
          />
        )))}
    </TypographyReadyBoundary>
  )
}
