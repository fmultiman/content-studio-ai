import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { adaptVideoDraftToTimelineManifest } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import {
  DEFAULT_PIXELS_PER_FRAME, MAX_SCENE_DURATION_SECONDS, MIN_SCENE_DURATION_SECONDS, TIMELINE_FPS, TIMELINE_ZOOM_LEVELS,
  clampFrame, deriveSceneRanges, durationFromRightEdge, fitTimelineZoom, formatTimecode, frameToX, framesToSeconds,
  reorderScenes, reorderTargetIndex, rulerTicks, sceneIndexAtFrame, scrollForAnchoredZoom, secondsToFrames, setSceneDuration,
  snapEdgeFrame, stepTimelineZoom, totalDurationFrames, xToFrame,
} from '../scene-timeline'

function scene(id: string, order: number, duration: number, extra: Partial<VideoScene> = {}): VideoScene {
  return { id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static', ...extra }
}

const THREE = [scene('a', 1, 3), scene('b', 2, 5), scene('c', 3, 2.5)]

describe('primary-Scene ranges (derived, contiguous)', () => {
  it('derives contiguous frame ranges from order + duration', () => {
    expect(deriveSceneRanges(THREE)).toEqual([
      { sceneId: 'a', index: 0, startFrame: 0, durationFrames: 90, endFrame: 90 },
      { sceneId: 'b', index: 1, startFrame: 90, durationFrames: 150, endFrame: 240 },
      { sceneId: 'c', index: 2, startFrame: 240, durationFrames: 75, endFrame: 315 },
    ])
    expect(totalDurationFrames(THREE)).toBe(315)
  })

  it('matches the VideoDraft -> TimelineManifest adapter segment ranges exactly (one temporal truth)', () => {
    const { manifest } = adaptVideoDraftToTimelineManifest({
      draft: { id: 'd', project_id: 'p', production_id: 'q', scenes: THREE },
      identity: { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' },
    })
    const ranges = deriveSceneRanges(THREE)
    expect(manifest.segments.map((segment) => [segment.start_frame, segment.duration_frames])).toEqual(ranges.map((range) => [range.startFrame, range.durationFrames]))
    expect(manifest.specification.duration_frames).toBe(totalDurationFrames(THREE))
    expect(manifest.specification.fps).toBe(TIMELINE_FPS)
  })

  it('round-trips frame-authored durations through seconds', () => {
    for (const frames of [15, 16, 91, 112, 299, 1800]) expect(secondsToFrames(framesToSeconds(frames))).toBe(frames)
  })

  it('locates the Scene under a frame and clamps the cursor', () => {
    const ranges = deriveSceneRanges(THREE)
    expect(sceneIndexAtFrame(ranges, 0)).toBe(0)
    expect(sceneIndexAtFrame(ranges, 89)).toBe(0)
    expect(sceneIndexAtFrame(ranges, 90)).toBe(1)
    expect(sceneIndexAtFrame(ranges, 314)).toBe(2)
    expect(sceneIndexAtFrame(ranges, 9999)).toBe(2)
    expect(clampFrame(-5, 315)).toBe(0)
    expect(clampFrame(400, 315)).toBe(314)
    expect(clampFrame(12.6, 315)).toBe(13)
    expect(formatTimecode(95)).toBe('00:03.16')
  })
})

describe('viewport geometry (derived, never persisted)', () => {
  it('x and width are pure functions of frames and scale', () => {
    expect(frameToX(90, 2)).toBe(180)
    expect(xToFrame(180, 2)).toBe(90)
    expect(frameToX(90, DEFAULT_PIXELS_PER_FRAME)).toBe(144)
  })

  it('zoom steps through fixed levels and clamps at the ends', () => {
    expect(stepTimelineZoom(1.6, 1)).toBe(2.4)
    expect(stepTimelineZoom(1.6, -1)).toBe(1.2)
    expect(stepTimelineZoom(TIMELINE_ZOOM_LEVELS[0], -1)).toBe(TIMELINE_ZOOM_LEVELS[0])
    expect(stepTimelineZoom(TIMELINE_ZOOM_LEVELS[TIMELINE_ZOOM_LEVELS.length - 1], 1)).toBe(TIMELINE_ZOOM_LEVELS[TIMELINE_ZOOM_LEVELS.length - 1])
  })

  it('fit picks the largest level that shows the whole sequence', () => {
    expect(fitTimelineZoom(315, 800)).toBe(2.4)
    expect(fitTimelineZoom(315 * 100, 800)).toBe(TIMELINE_ZOOM_LEVELS[0])
  })

  it('anchored zoom keeps the anchor frame under the same viewport x', () => {
    const scroll = scrollForAnchoredZoom(150, 200, 3.2)
    expect(frameToX(150, 3.2) - scroll).toBe(200)
    expect(scrollForAnchoredZoom(10, 500, 1)).toBe(0)
  })

  it('ruler tick density follows zoom', () => {
    const coarse = rulerTicks(900, 0.4)
    const fine = rulerTicks(900, 4.8)
    expect(fine.length).toBeGreaterThan(coarse.length)
    for (const ticks of [coarse, fine]) {
      expect(ticks[0].frame).toBe(0)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i].x - ticks[i - 1].x).toBeGreaterThanOrEqual(56)
    }
  })
})

describe('Timeline edits map to VideoScene semantics only', () => {
  it('reorder changes array order and renumbers order 1..n, never timing', () => {
    const next = reorderScenes(THREE, 0, 2)
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(next.map((s) => s.order)).toEqual([1, 2, 3])
    expect(next.map((s) => s.duration)).toEqual([5, 2.5, 3])
    expect(deriveSceneRanges(next).map((r) => r.startFrame)).toEqual([0, 150, 225])
    expect(reorderScenes(THREE, 1, 1).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('drag target comes from the dragged center over the remaining Scenes (no gaps)', () => {
    const ranges = deriveSceneRanges(THREE)
    // dragging A (0-90) right past B's midpoint (in the sequence without A: B 0-150, C 150-225)
    expect(reorderTargetIndex(ranges, 0, 45)).toBe(0)
    expect(reorderTargetIndex(ranges, 0, 80)).toBe(1)
    expect(reorderTargetIndex(ranges, 0, 200)).toBe(2)
    // dragging C left to the start
    expect(reorderTargetIndex(ranges, 2, 10)).toBe(0)
  })

  it('duration edits clamp and shift downstream Scenes by re-derivation', () => {
    const next = setSceneDuration(THREE, 'a', 4)
    expect(deriveSceneRanges(next).map((r) => r.startFrame)).toEqual([0, 120, 270])
    expect(setSceneDuration(THREE, 'a', 0.1)[0].duration).toBe(MIN_SCENE_DURATION_SECONDS)
    expect(setSceneDuration(THREE, 'a', 999)[0].duration).toBe(MAX_SCENE_DURATION_SECONDS)
  })

  it('right-edge trim = duration, with snapping to seconds / playhead / edges', () => {
    const range = deriveSceneRanges(THREE)[1] // b: 90..240
    expect(durationFromRightEdge(range, 197, { pixelsPerFrame: 1 })).toMatchObject({ frames: 107, snappedTo: null })
    expect(durationFromRightEdge(range, 207, { pixelsPerFrame: 1, thresholdPx: 8 })).toMatchObject({ frames: 120, seconds: 4, snappedTo: 'second' })
    expect(durationFromRightEdge(range, 176, { pixelsPerFrame: 1, playheadFrame: 173 })).toMatchObject({ frames: 83, snappedTo: 'playhead' })
    expect(durationFromRightEdge(range, 207, { pixelsPerFrame: 1, disabled: true })).toMatchObject({ frames: 117, snappedTo: null })
    expect(durationFromRightEdge(range, 91, { pixelsPerFrame: 1 })).toMatchObject({ frames: 15, seconds: 0.5 })
  })

  it('snap threshold is in screen pixels, so it narrows as zoom grows', () => {
    expect(snapEdgeFrame(95, { pixelsPerFrame: 1, thresholdPx: 8 }).snappedTo).toBe('second')
    expect(snapEdgeFrame(95, { pixelsPerFrame: 4.8, thresholdPx: 8 }).snappedTo).toBeNull()
  })
})

describe('frame cursor (single editor clock)', () => {
  it('notifies subscribers only on change and never persists anything', async () => {
    const { createFrameCursor } = await import('../frame-cursor')
    const cursor = createFrameCursor()
    const seen: number[] = []
    const off = cursor.subscribe(() => seen.push(cursor.get()))
    cursor.set(10); cursor.set(10); cursor.set(42)
    off(); cursor.set(7)
    expect(seen).toEqual([10, 42])
    expect(cursor.get()).toBe(7)
  })
})
