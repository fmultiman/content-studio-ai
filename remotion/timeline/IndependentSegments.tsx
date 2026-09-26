import React from 'react'
import { Audio, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import type { TimelineSegment } from '@/lib/schemas/creative/timeline'

/**
 * VIDEO_TIMELINE_GATE_B — renderer adapter for the INDEPENDENT timeline layer:
 * neutral `media` / `text` / `audio` segments with their own absolute timing.
 *
 * Remotion is the engine detail HERE only: a neutral segment's
 * start_frame/duration_frames become a <Sequence>; nothing Remotion-specific
 * ever reaches the manifest or the authored VideoDraft. Stacking = the order
 * the caller renders layers in (track order), never the Timeline's row order.
 */

type MediaSegment = Extract<TimelineSegment, { kind: 'media' }>
type TextSegment = Extract<TimelineSegment, { kind: 'text' }>
type AudioSegment = Extract<TimelineSegment, { kind: 'audio' }>

const fill: React.CSSProperties = { position: 'absolute', inset: 0 }

/** B-roll: full-frame media over the primary Scene. Video starts at its source start (no source in/out yet) and is muted — sound comes only from audio segments. */
export const MediaSegmentLayer: React.FC<{ segment: MediaSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const asset = resolvedInput.resolvedAssets[segment.payload.asset_ref]
  if (!asset?.url) return null
  const objectFit = segment.payload.fit === 'contain' ? 'contain' : 'cover'
  const style: React.CSSProperties = { ...fill, width: '100%', height: '100%', objectFit, background: '#000' }
  return (
    <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
      <div style={fill} data-segment={segment.id} data-kind="media">
        {asset.mime_type.startsWith('video/')
          ? <OffthreadVideo src={asset.url} muted style={style} />
          : <Img src={asset.url} style={style} />}
      </div>
    </Sequence>
  )
}

/** One bounded lower-third presentation (identity typography), with a short fade in/out. */
const LowerThird: React.FC<{ segment: TextSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const frame = useCurrentFrame()
  const fadeFrames = Math.min(8, Math.floor(segment.duration_frames / 3))
  const opacity = fadeFrames > 0
    ? interpolate(frame, [0, fadeFrames, segment.duration_frames - fadeFrames, segment.duration_frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1
  const { width, height } = resolvedInput.manifest.specification
  const unit = width / 1080
  const [headline, ...rest] = segment.payload.text.split('\n')
  const { typography } = resolvedInput.tokens
  return (
    <div style={fill} data-segment={segment.id} data-kind="text">
      <div
        style={{
          position: 'absolute', left: 56 * unit, right: 56 * unit, bottom: height * 0.14,
          padding: `${22 * unit}px ${30 * unit}px`, background: 'rgba(11, 16, 32, 0.86)', borderLeft: `${10 * unit}px solid #c9a45c`,
          color: '#f3ead8', opacity, transform: `translateY(${(1 - opacity) * 24 * unit}px)`,
        }}
      >
        <div style={{ fontFamily: typography.display.family, fontWeight: typography.display.weight, fontSize: 46 * unit, lineHeight: 1.12 }}>{headline}</div>
        {rest.length ? <div style={{ fontFamily: typography.body.family, fontSize: 28 * unit, lineHeight: 1.3, marginTop: 8 * unit, opacity: 0.85 }}>{rest.join(' ')}</div> : null}
      </div>
    </div>
  )
}

export const TextSegmentLayer: React.FC<{ segment: TextSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => (
  <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
    <LowerThird segment={segment} resolvedInput={resolvedInput} />
  </Sequence>
)

/** Audio: plays from its absolute start for its placement duration, at the authored gain. */
export const AudioSegmentLayer: React.FC<{ segment: AudioSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const asset = resolvedInput.resolvedAssets[segment.payload.asset_ref]
  if (!asset?.url) return null
  return (
    <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
      <Audio src={asset.url} volume={segment.payload.gain} />
    </Sequence>
  )
}
