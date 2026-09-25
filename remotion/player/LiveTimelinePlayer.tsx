'use client'

/**
 * Creative Editor Video Foundation V1 — Live Authoring Player adapter.
 *
 * The ONE place product UI reaches `@remotion/player`. It lives under
 * remotion/ (the renderer/adapter surface) so app/, lib/ and components/ stay
 * Remotion-free (lib/creative/__tests__/renderer-isolation.test.ts): the
 * editor passes a neutral ResolvedTimelineInput and receives frames back
 * through a small, renderer-agnostic controller.
 *
 * It paints the SAME TimelineComposition -> TemplateSegment -> registered
 * Template component tree the final VPS render uses. The only difference is
 * the template-props URL step: fixtures/materials are served from Next's
 * public root here, and from the Remotion bundle's /public in the worker.
 *
 * This is an AUTHORING preview. It never produces, stores or replaces the
 * final MP4 (render_executions -> VPS worker -> MinIO).
 */
import React, { useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { AbsoluteFill } from 'remotion'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { TimelineComposition } from '../timeline/TimelineComposition'

export type LivePlayerController = {
  play: () => void
  pause: () => void
  toggle: () => void
  seekTo: (frame: number) => void
  getCurrentFrame: () => number
  isPlaying: () => boolean
}

export type LiveTimelinePlayerProps = {
  resolvedInput: ResolvedTimelineInput
  /** Display box in CSS px (the Player scales the composition into it). */
  width: number
  height: number
  controllerRef?: React.Ref<LivePlayerController | null>
  /** Every frame change, during playback and seeking (Remotion `frameupdate`). */
  onFrame?: (frame: number) => void
  onPlayingChange?: (playing: boolean) => void
  onError?: (message: string) => void
}

const passThroughProps = <T,>(props: T): T => props

type LivePreviewProps = { resolvedInput: ResolvedTimelineInput }

// Module-level (stable identity): the Player must not remount the composition on every edit.
const LivePreviewComposition: React.FC<LivePreviewProps> = ({ resolvedInput }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <TimelineComposition resolvedInput={resolvedInput} adaptTemplateProps={passThroughProps} />
  </AbsoluteFill>
)

export function LiveTimelinePlayer({ resolvedInput, width, height, controllerRef, onFrame, onPlayingChange, onError }: LiveTimelinePlayerProps) {
  const playerRef = useRef<PlayerRef>(null)
  const callbacks = useRef({ onFrame, onPlayingChange, onError })
  useEffect(() => { callbacks.current = { onFrame, onPlayingChange, onError } }, [onFrame, onPlayingChange, onError])

  useImperativeHandle(controllerRef, () => ({
    play: () => playerRef.current?.play(),
    pause: () => playerRef.current?.pause(),
    toggle: () => playerRef.current?.toggle(),
    seekTo: (frame: number) => playerRef.current?.seekTo(frame),
    getCurrentFrame: () => playerRef.current?.getCurrentFrame() ?? 0,
    isPlaying: () => playerRef.current?.isPlaying() ?? false,
  }), [])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const handleFrame = (event: { detail: { frame: number } }) => callbacks.current.onFrame?.(event.detail.frame)
    const handlePlay = () => callbacks.current.onPlayingChange?.(true)
    const handlePause = () => callbacks.current.onPlayingChange?.(false)
    const handleError = (event: { detail: { error: Error } }) => callbacks.current.onError?.(event.detail.error.message)
    player.addEventListener('frameupdate', handleFrame)
    player.addEventListener('play', handlePlay)
    player.addEventListener('pause', handlePause)
    player.addEventListener('error', handleError)
    return () => {
      player.removeEventListener('frameupdate', handleFrame)
      player.removeEventListener('play', handlePlay)
      player.removeEventListener('pause', handlePause)
      player.removeEventListener('error', handleError)
    }
  }, [])

  const inputProps = useMemo(() => ({ resolvedInput }), [resolvedInput])
  const { specification } = resolvedInput.manifest

  return (
    <Player
      ref={playerRef}
      component={LivePreviewComposition}
      inputProps={inputProps}
      durationInFrames={Math.max(1, specification.duration_frames)}
      fps={specification.fps}
      compositionWidth={specification.width}
      compositionHeight={specification.height}
      style={{ width, height }}
      controls={false}
      clickToPlay
      spaceKeyToPlayOrPause={false}
      moveToBeginningWhenEnded
    />
  )
}
