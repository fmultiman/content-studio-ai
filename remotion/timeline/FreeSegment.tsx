import React from 'react'
import { Img, Sequence, useCurrentFrame } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import type { TimelineSegment } from '@/lib/schemas/creative/timeline'
import { inactiveElementIds } from './frame-model'
import { FreeStage } from '@/components/creative/free/free-stage'

/**
 * VIDEO_FREE_SCENE_COMPOSITION_V1 — renderer adapter for a neutral `free`
 * segment: a Scene drawn WITHOUT a Template. It is selected by the segment
 * kind alone (no Template lookup, no DocumentaryCard) and only uses low-level
 * pieces: positioned boxes, Project Identity tokens and resolved LibraryFiles.
 *
 * Geometry: box fractions of the manifest stage (origin top-left). Text size is
 * a semantic step scaled by the stage's SHORTER side, so a composition keeps
 * its proportions on any stage. Paint order = payload order (back -> front).
 *
 * VIDEO_FREE_ELEMENT_TIMING_V1: `payload.element_timing` (segment-local, the
 * same entries Template segments carry) is evaluated at the Sequence-local
 * frame with the shared `inactiveElementIds`; an inactive element is simply
 * not drawn (its paint slot is kept, so stacking never shifts).
 *
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: the drawing itself is the
 * shared `FreeStage` (also used by the Static free still); this file keeps only
 * the Video concerns — the Sequence and the Scene-local timing.
 */

type FreeSegment = Extract<TimelineSegment, { kind: 'free' }>

export const FreeSegmentLayer: React.FC<{ segment: FreeSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => (
  <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
    <FreeSegmentFrame segment={segment} resolvedInput={resolvedInput} />
  </Sequence>
)

/** One frame of the free Scene; inside the Sequence, so useCurrentFrame() is Scene-local. */
const FreeSegmentFrame: React.FC<{ segment: FreeSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const localFrame = useCurrentFrame()
  const { width, height } = resolvedInput.manifest.specification
  const inactive = new Set(inactiveElementIds(segment.payload.element_timing, localFrame))
  return (
    <FreeStage
      elements={segment.payload.elements}
      width={width}
      height={height}
      tokens={resolvedInput.tokens}
      imageUrl={(ref) => resolvedInput.resolvedAssets[ref]}
      ImageComponent={Img}
      inactive={inactive}
      dataAttributes={{ 'data-segment': segment.id, 'data-kind': 'free' }}
    />
  )
}
