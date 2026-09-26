import React from 'react'
import { Img, Sequence, useCurrentFrame } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import type { TimelineSegment } from '@/lib/schemas/creative/timeline'
import { inactiveElementIds } from './frame-model'

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
 */

type FreeSegment = Extract<TimelineSegment, { kind: 'free' }>
type FreeElement = FreeSegment['payload']['elements'][number]

/** Text size steps as a fraction of the stage's shorter side (1080 → 38 / 54 / 81 / 119 px). */
export const FREE_TEXT_SIZE_SCALE = { small: 0.035, medium: 0.05, large: 0.075, title: 0.11 } as const

function boxStyle(element: FreeElement, width: number, height: number, zIndex: number): React.CSSProperties {
  const { x, y, width: w, height: h } = element.box
  return { position: 'absolute', left: x * width, top: y * height, width: w * width, height: h * height, overflow: 'hidden', zIndex }
}

export const FreeSegmentLayer: React.FC<{ segment: FreeSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => (
  <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
    <FreeSegmentFrame segment={segment} resolvedInput={resolvedInput} />
  </Sequence>
)

/** One frame of the free Scene; inside the Sequence, so useCurrentFrame() is Scene-local. */
const FreeSegmentFrame: React.FC<{ segment: FreeSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const localFrame = useCurrentFrame()
  const { width, height } = resolvedInput.manifest.specification
  const { colors, typography } = resolvedInput.tokens
  const shortSide = Math.min(width, height)
  const inactive = new Set(inactiveElementIds(segment.payload.element_timing, localFrame))
  return (
    <>
      {/* isolation: the elements' z-index stays INSIDE this Scene, so later tracks (root B-roll, lower thirds) still paint above it. */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', isolation: 'isolate', background: colors.background }} data-segment={segment.id} data-kind="free">
        {segment.payload.elements.map((element, index) => {
          if (inactive.has(element.element_id)) return null
          if (element.kind === 'image') {
            const asset = resolvedInput.resolvedAssets[element.asset_ref]
            if (!asset?.url) return null
            return (
              <div key={element.element_id} style={boxStyle(element, width, height, index + 1)} data-free-element={element.element_id} data-free-kind="image">
                <Img src={asset.url} alt={asset.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: element.fit, display: 'block' }} />
              </div>
            )
          }
          const role = typography[element.typography]
          return (
            <div
              key={element.element_id}
              style={{
                ...boxStyle(element, width, height, index + 1),
                color: colors[element.color] ?? colors.foreground,
                fontFamily: role.family,
                fontWeight: role.weight,
                fontStyle: role.style,
                fontSize: FREE_TEXT_SIZE_SCALE[element.size] * shortSide,
                lineHeight: element.typography === 'display' ? 1.08 : 1.3,
                textAlign: element.align,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
              }}
              data-free-element={element.element_id}
              data-free-kind="text"
            >
              {element.text}
            </div>
          )
        })}
      </div>
    </>
  )
}
