/** Runtime-only frame arithmetic for the Remotion timeline adapter. */
export type SegmentFrameState = {
  visible: boolean
  localFrame: number | null
  progress: number | null
}

export function segmentFrameState(
  globalFrame: number,
  startFrame: number,
  durationFrames: number,
): SegmentFrameState {
  const localFrame = globalFrame - startFrame
  if (localFrame < 0 || localFrame >= durationFrames) {
    return { visible: false, localFrame: null, progress: null }
  }

  return {
    visible: true,
    localFrame,
    progress: durationFrames <= 1 ? 1 : localFrame / (durationFrames - 1),
  }
}

type ElementTimingRange = { element_id: string; start_frame: number; duration_frames: number }

/**
 * VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1 — template elements that do NOT
 * participate at this segment-local frame (end exclusive). Elements without a
 * range participate for the whole segment.
 */
export function inactiveElementIds(timing: readonly ElementTimingRange[] | undefined, localFrame: number): string[] {
  if (!timing) return []
  return timing
    .filter((entry) => localFrame < entry.start_frame || localFrame >= entry.start_frame + entry.duration_frames)
    .map((entry) => entry.element_id)
}
