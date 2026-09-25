/**
 * Creative Editor Video Foundation V1 — primary-Scene Timeline Lite.
 *
 * Pure temporal math over the EXISTING authoring authority (VideoScene[]).
 * Nothing here is persisted: scene ranges are derived again from
 * VideoScene.duration + array order every time, exactly as the
 * VideoDraft -> TimelineManifest adapter derives segment ranges, and every
 * geometry value (x, width, pixelsPerFrame, scroll, ticks) is viewport state.
 *
 * Primary Scenes are contiguous: a Scene has no authored start frame. Moving
 * a Scene means REORDER; moving its right edge means CHANGE DURATION. There is
 * no gap, source in/out, ripple or overlap semantics here on purpose.
 */
import type { VideoScene } from '@/lib/types'
import { DEFAULT_TIMELINE_FPS } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'

export const TIMELINE_FPS = DEFAULT_TIMELINE_FPS

/** Shortest / longest Scene the Timeline edge handle may author (seconds). */
export const MIN_SCENE_DURATION_SECONDS = 0.5
export const MAX_SCENE_DURATION_SECONDS = 60

/** Same rounding as the adapter's secondsToFrames (video-draft-to-timeline.ts). */
export function secondsToFrames(seconds: number, fps: number = TIMELINE_FPS): number {
  return Math.max(1, Math.round(seconds * fps))
}

/** Inverse used when an edit is authored in frames; round-trips through secondsToFrames exactly. */
export function framesToSeconds(frames: number, fps: number = TIMELINE_FPS): number {
  return Number((frames / fps).toFixed(4))
}

export type SceneRange = {
  sceneId: string
  index: number
  startFrame: number
  durationFrames: number
  /** Exclusive. */
  endFrame: number
}

/** Contiguous primary-Scene ranges derived from VideoScene[] order + duration. */
export function deriveSceneRanges(scenes: readonly VideoScene[], fps: number = TIMELINE_FPS): SceneRange[] {
  const ranges: SceneRange[] = []
  let cursor = 0
  scenes.forEach((scene, index) => {
    const durationFrames = secondsToFrames(scene.duration, fps)
    ranges.push({ sceneId: scene.id, index, startFrame: cursor, durationFrames, endFrame: cursor + durationFrames })
    cursor += durationFrames
  })
  return ranges
}

export function totalDurationFrames(scenes: readonly VideoScene[], fps: number = TIMELINE_FPS): number {
  const ranges = deriveSceneRanges(scenes, fps)
  return ranges.length ? ranges[ranges.length - 1].endFrame : 0
}

export function clampFrame(frame: number, durationFrames: number): number {
  if (durationFrames <= 0) return 0
  return Math.min(Math.max(0, Math.round(frame)), durationFrames - 1)
}

/** Scene under a frame (the last Scene owns the final frame). */
export function sceneIndexAtFrame(ranges: readonly SceneRange[], frame: number): number {
  if (ranges.length === 0) return -1
  const found = ranges.findIndex((range) => frame >= range.startFrame && frame < range.endFrame)
  return found >= 0 ? found : frame < 0 ? 0 : ranges.length - 1
}

export function formatTimecode(frame: number, fps: number = TIMELINE_FPS): string {
  const safe = Math.max(0, Math.round(frame))
  const totalSeconds = Math.floor(safe / fps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hundredths = Math.floor(((safe % fps) / fps) * 100)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`
}

export function formatSeconds(seconds: number): string {
  return `${Number(seconds.toFixed(2))}s`
}

// ---------------------------------------------------------------------------
// Viewport geometry (UI state only)
// ---------------------------------------------------------------------------

/** Discrete temporal zoom levels in pixels per frame (30fps: 1.2 px/f = 36 px/s). */
export const TIMELINE_ZOOM_LEVELS = [0.4, 0.6, 0.8, 1.2, 1.6, 2.4, 3.2, 4.8, 6.4] as const
export const DEFAULT_PIXELS_PER_FRAME = 1.6

export function frameToX(frame: number, pixelsPerFrame: number): number {
  return frame * pixelsPerFrame
}

export function xToFrame(x: number, pixelsPerFrame: number): number {
  return pixelsPerFrame > 0 ? x / pixelsPerFrame : 0
}

export function stepTimelineZoom(pixelsPerFrame: number, direction: 1 | -1): number {
  const levels = TIMELINE_ZOOM_LEVELS as readonly number[]
  let closest = 0
  for (let i = 1; i < levels.length; i++) {
    if (Math.abs(levels[i] - pixelsPerFrame) < Math.abs(levels[closest] - pixelsPerFrame)) closest = i
  }
  return levels[Math.min(levels.length - 1, Math.max(0, closest + direction))]
}

/** Largest zoom level whose full duration fits the visible width (smallest level otherwise). */
export function fitTimelineZoom(durationFrames: number, visibleWidth: number): number {
  const levels = TIMELINE_ZOOM_LEVELS as readonly number[]
  if (durationFrames <= 0 || visibleWidth <= 0) return DEFAULT_PIXELS_PER_FRAME
  const fitting = levels.filter((level) => durationFrames * level <= visibleWidth)
  return fitting.length ? fitting[fitting.length - 1] : levels[0]
}

/** Keeps `frame` at the same on-screen x after a zoom change (zoom anchored on the playhead/pointer). */
export function scrollForAnchoredZoom(frame: number, anchorViewportX: number, nextPixelsPerFrame: number): number {
  return Math.max(0, frameToX(frame, nextPixelsPerFrame) - anchorViewportX)
}

const TICK_STEPS_SECONDS = [0.5, 1, 2, 5, 10, 15, 30, 60] as const
const MIN_TICK_SPACING_PX = 56

export type RulerTick = { frame: number; x: number; label: string; major: boolean }

/** Ruler ticks: density is derived from the zoom, never stored. */
export function rulerTicks(durationFrames: number, pixelsPerFrame: number, fps: number = TIMELINE_FPS): RulerTick[] {
  const step = TICK_STEPS_SECONDS.find((seconds) => seconds * fps * pixelsPerFrame >= MIN_TICK_SPACING_PX) ?? 60
  const stepFrames = Math.round(step * fps)
  const ticks: RulerTick[] = []
  for (let frame = 0; frame <= durationFrames; frame += stepFrames) {
    const seconds = frame / fps
    ticks.push({ frame, x: frameToX(frame, pixelsPerFrame), label: formatSeconds(seconds), major: Number.isInteger(seconds) })
  }
  return ticks
}

// ---------------------------------------------------------------------------
// Authoring operations (mutate VideoScene[] only)
// ---------------------------------------------------------------------------

/** Array order is the sequence; `order` is kept 1-based and contiguous (as /videos deleteScene does). */
export function renumberScenes(scenes: readonly VideoScene[]): VideoScene[] {
  return scenes.map((scene, index) => (scene.order === index + 1 ? scene : { ...scene, order: index + 1 }))
}

export function reorderScenes(scenes: readonly VideoScene[], fromIndex: number, toIndex: number): VideoScene[] {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= scenes.length) return [...scenes]
  const target = Math.min(Math.max(0, toIndex), scenes.length - 1)
  const next = [...scenes]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(target, 0, moved)
  return renumberScenes(next)
}

/**
 * Reorder target for a Scene dragged horizontally: the index whose slot the
 * dragged block's CENTER falls into once the dragged Scene is taken out of the
 * sequence. Never produces a gap — the sequence is re-derived contiguously.
 */
export function reorderTargetIndex(ranges: readonly SceneRange[], fromIndex: number, draggedCenterFrame: number): number {
  const dragged = ranges[fromIndex]
  if (!dragged) return fromIndex
  let cursor = 0
  let target = 0
  const others = ranges.filter((_, index) => index !== fromIndex)
  for (let i = 0; i < others.length; i++) {
    const midpoint = cursor + others[i].durationFrames / 2
    if (draggedCenterFrame > midpoint) target = i + 1
    cursor += others[i].durationFrames
  }
  return target
}

export function clampSceneDurationSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SCENE_DURATION_SECONDS
  return Math.min(MAX_SCENE_DURATION_SECONDS, Math.max(MIN_SCENE_DURATION_SECONDS, seconds))
}

export function setSceneDuration(scenes: readonly VideoScene[], sceneId: string, seconds: number): VideoScene[] {
  const duration = clampSceneDurationSeconds(seconds)
  return scenes.map((scene) => (scene.id === sceneId ? { ...scene, duration } : scene))
}

export type SnapResult = { frame: number; snappedTo: 'second' | 'playhead' | 'scene-edge' | null }

/**
 * Basic snapping for the right edge of a Scene: whole seconds, the playhead,
 * and other Scene boundaries, when within `thresholdPx` on screen.
 */
export function snapEdgeFrame(
  frame: number,
  options: { pixelsPerFrame: number; thresholdPx?: number; playheadFrame?: number; edges?: readonly number[]; fps?: number; disabled?: boolean },
): SnapResult {
  const fps = options.fps ?? TIMELINE_FPS
  const rounded = Math.round(frame)
  if (options.disabled) return { frame: rounded, snappedTo: null }
  const threshold = (options.thresholdPx ?? 8) / Math.max(options.pixelsPerFrame, 0.0001)
  const candidates: { frame: number; kind: NonNullable<SnapResult['snappedTo']> }[] = []
  if (options.playheadFrame !== undefined) candidates.push({ frame: options.playheadFrame, kind: 'playhead' })
  for (const edge of options.edges ?? []) candidates.push({ frame: edge, kind: 'scene-edge' })
  candidates.push({ frame: Math.round(frame / fps) * fps, kind: 'second' })
  let best: { frame: number; kind: NonNullable<SnapResult['snappedTo']> } | null = null
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.frame - frame)
    if (distance <= threshold && (!best || distance < Math.abs(best.frame - frame))) best = candidate
  }
  return best ? { frame: best.frame, snappedTo: best.kind } : { frame: rounded, snappedTo: null }
}

/**
 * Right-edge trim of a primary Scene = its new duration. `pointerFrame` is the
 * timeline frame under the pointer; the Scene's start stays where the
 * contiguous sequence puts it and downstream Scenes shift by re-derivation.
 */
export function durationFromRightEdge(
  range: SceneRange,
  pointerFrame: number,
  snap: Omit<Parameters<typeof snapEdgeFrame>[1], 'fps'> & { fps?: number },
): { seconds: number; frames: number; snappedTo: SnapResult['snappedTo'] } {
  const fps = snap.fps ?? TIMELINE_FPS
  const snapped = snapEdgeFrame(pointerFrame, { ...snap, fps })
  const minFrames = secondsToFrames(MIN_SCENE_DURATION_SECONDS, fps)
  const maxFrames = secondsToFrames(MAX_SCENE_DURATION_SECONDS, fps)
  const frames = Math.min(maxFrames, Math.max(minFrames, snapped.frame - range.startFrame))
  return { seconds: framesToSeconds(frames, fps), frames, snappedTo: frames === snapped.frame - range.startFrame ? snapped.snappedTo : null }
}
