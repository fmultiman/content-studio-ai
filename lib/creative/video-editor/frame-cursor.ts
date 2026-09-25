/**
 * Creative Editor Video — the editor's single temporal cursor (`currentFrame`).
 *
 * UI/editor state only: never persisted, never part of VideoDraft or the
 * TimelineManifest. The Live Player is its clock (every `frameupdate` writes
 * here) and every seek (transport, ruler scrub, Scene selection, keyboard)
 * goes through the Player and writes here — one cursor, no second clock.
 *
 * Kept outside React state on purpose: playback writes ~30 times per second,
 * and only the few views that show the cursor (timecode, playhead, Scene
 * progress) subscribe, so the editor shell and Inspector do not re-render
 * every frame.
 */
import { useSyncExternalStore } from 'react'

export type FrameCursor = {
  get: () => number
  set: (frame: number) => void
  subscribe: (listener: () => void) => () => void
}

export function createFrameCursor(initial = 0): FrameCursor {
  let frame = initial
  const listeners = new Set<() => void>()
  return {
    get: () => frame,
    set: (next) => {
      if (next === frame) return
      frame = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function useFrameCursor(cursor: FrameCursor): number {
  return useSyncExternalStore(cursor.subscribe, cursor.get, cursor.get)
}
