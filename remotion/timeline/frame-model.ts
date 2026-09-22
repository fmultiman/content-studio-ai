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
