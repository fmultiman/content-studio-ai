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

/**
 * Linear fade envelope (0..1) at a placement-local frame — pure, engine-free
 * math over the neutral fade fields (VIDEO_AUDIO_AUTHORING_V1).
 */
export function audioEnvelope(localFrame: number, durationFrames: number, fadeInFrames = 0, fadeOutFrames = 0): number {
  const fadeIn = fadeInFrames > 0 ? Math.min(1, Math.max(0, localFrame / fadeInFrames)) : 1
  const fadeOut = fadeOutFrames > 0 ? Math.min(1, Math.max(0, (durationFrames - localFrame) / fadeOutFrames)) : 1
  return Math.min(fadeIn, fadeOut)
}

/**
 * Audio: plays from its absolute start for its placement duration, starting
 * `source_in_frame` frames into the source, at the authored gain shaped by the
 * fade envelope. Several audio segments (overlapping or not) are simply
 * mounted together — the engine mixes them. `startFrom` is the source-offset
 * prop every Remotion 4.x understands (newer names alias it).
 */
export const AudioSegmentLayer: React.FC<{ segment: AudioSegment; resolvedInput: ResolvedTimelineInput }> = ({ segment, resolvedInput }) => {
  const asset = resolvedInput.resolvedAssets[segment.payload.asset_ref]
  if (!asset?.url) return null
  const { gain = 1, source_in_frame: sourceIn = 0, fade_in_frames: fadeIn = 0, fade_out_frames: fadeOut = 0 } = segment.payload
  const volume = fadeIn > 0 || fadeOut > 0 ? (localFrame: number) => gain * audioEnvelope(localFrame, segment.duration_frames, fadeIn, fadeOut) : gain
  return (
    <Sequence from={segment.start_frame} durationInFrames={segment.duration_frames} layout="none" name={segment.id}>
      <Audio src={asset.url} startFrom={sourceIn} volume={volume} />
    </Sequence>
  )
}
