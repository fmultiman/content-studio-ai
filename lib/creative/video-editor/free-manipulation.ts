/**
 * VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1 — pure geometry for moving and
 * resizing a free Element on the Preview stage.
 *
 * Coordinates are always STAGE fractions (the authored free box model): the
 * pointer is mapped through the on-screen stage rectangle, which already
 * reflects Fit / zoom / pan (layout-sized, no CSS transform), so no copy of
 * the viewport math lives here. Nothing in this module is persisted except the
 * resulting box, which goes through the existing free-composition helpers.
 */
import type { FreeElementBox } from '@/lib/types'
import { MIN_FREE_BOX, clampFreeBox } from './free-composition'

/** Preview interaction tool: UI-only, never persisted, never dirty. Hand/Pan is the default. */
export type PreviewInteractionMode = 'pan' | 'select'
export const DEFAULT_PREVIEW_INTERACTION_MODE: PreviewInteractionMode = 'pan'

export type StageRect = { left: number; top: number; width: number; height: number }
export type StagePoint = { x: number; y: number }
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
export const RESIZE_HANDLES: readonly ResizeHandle[] = ['nw', 'ne', 'sw', 'se']

/** Screen point -> stage fraction (may fall outside 0..1 while dragging past the stage edge). */
export function pointerToStage(clientX: number, clientY: number, rect: StageRect): StagePoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
}

const round = (value: number) => Math.round(value * 10_000) / 10_000
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Translate only: width/height are kept, the box stays on stage. */
export function moveFreeBox(start: FreeElementBox, dx: number, dy: number): FreeElementBox {
  return {
    x: round(clamp(start.x + dx, 0, 1 - start.width)),
    y: round(clamp(start.y + dy, 0, 1 - start.height)),
    width: start.width,
    height: start.height,
  }
}

/**
 * Corner resize: the opposite corner stays fixed; the dragged edges stay on
 * stage and never cross closer than MIN_FREE_BOX (the domain minimum).
 */
export function resizeFreeBox(start: FreeElementBox, handle: ResizeHandle, dx: number, dy: number): FreeElementBox {
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - MIN_FREE_BOX)
  if (handle === 'ne' || handle === 'se') right = clamp(right + dx, left + MIN_FREE_BOX, 1)
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - MIN_FREE_BOX)
  if (handle === 'sw' || handle === 'se') bottom = clamp(bottom + dy, top + MIN_FREE_BOX, 1)
  // Rounding can shave a few 1e-5 off the minimum; clampFreeBox keeps the domain invariant.
  return clampFreeBox({ x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) })
}

export function sameFreeBox(a: FreeElementBox, b: FreeElementBox): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
