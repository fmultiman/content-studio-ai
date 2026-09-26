import React from 'react'
import { useCurrentFrame } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { TemplateSegment } from './TemplateSegment'
import { AudioSegmentLayer, MediaSegmentLayer, TextSegmentLayer } from './IndependentSegments'
import { TypographyReadyBoundary } from '../TypographyReadyBoundary'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'

export type TimelineCompositionProps = {
  resolvedInput: ResolvedTimelineInput
  primitiveMaterials?: DocumentaryCardProps['primitiveMaterials']
  primitiveTransforms?: DocumentaryCardProps['primitiveTransforms']
  /** See TemplateSegment: omitted by the final render (Remotion bundle URLs); identity in the Live Player. */
  adaptTemplateProps?: <T>(props: T) => T
}

/**
 * Remotion-only adapter: timeline owns WHEN; registered templates own HOW.
 * No Remotion types or state cross back into TimelineManifest/resolution.
 *
 * VIDEO_TIMELINE_GATE_B: visual tracks paint in track `order` (primary Scenes,
 * then independent B-roll, then text overlays); a later track paints above an
 * earlier one. Audio tracks produce sound only.
 */
export const TimelineComposition: React.FC<TimelineCompositionProps> = ({ resolvedInput, primitiveMaterials, primitiveTransforms, adaptTemplateProps }) => {
  const globalFrame = useCurrentFrame()
  const tracks = [...resolvedInput.manifest.tracks].sort((a, b) => a.order - b.order)
  const templateById = new Map(resolvedInput.resolvedTemplateSegments.map((entry) => [entry.segment.id, entry]))

  return (
    <TypographyReadyBoundary typography={resolvedInput.typography}>
      {tracks.flatMap((track) => resolvedInput.manifest.segments
        .filter((segment) => segment.track_id === track.id)
        .map((segment) => {
          if (track.kind === 'audio') {
            return segment.kind === 'audio' ? <AudioSegmentLayer key={segment.id} segment={segment} resolvedInput={resolvedInput} /> : null
          }
          if (track.kind !== 'video' && track.kind !== 'overlay') return null
          if (segment.kind === 'template') {
            const resolvedSegment = templateById.get(segment.id)
            return resolvedSegment ? (
              <TemplateSegment
                globalFrame={globalFrame}
                key={segment.id}
                resolvedInput={resolvedInput}
                resolvedSegment={resolvedSegment}
                primitiveMaterials={primitiveMaterials}
                primitiveTransforms={primitiveTransforms}
                adaptTemplateProps={adaptTemplateProps}
              />
            ) : null
          }
          if (segment.kind === 'media') return <MediaSegmentLayer key={segment.id} segment={segment} resolvedInput={resolvedInput} />
          if (segment.kind === 'text') return <TextSegmentLayer key={segment.id} segment={segment} resolvedInput={resolvedInput} />
          return null
        }))}
    </TypographyReadyBoundary>
  )
}
