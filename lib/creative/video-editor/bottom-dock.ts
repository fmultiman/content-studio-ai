/**
 * Creative Editor Video — bottom authoring dock (CENAS / TIMELINE) geometry.
 *
 * VIEWPORT/UI state only: mode and height never enter VideoDraft, VideoScene,
 * TimelineManifest, render requests or snapshots, and never make the draft
 * dirty. Heights are derived from the measured workbench, so the Live Player
 * always keeps a usable area and the dock can get out of its way.
 */
import type { VideoScene } from '@/lib/types'

export type DockMode = 'collapsed' | 'normal' | 'expanded'

/** The compact persistent bar (CENAS | TIMELINE + summary + size controls). */
export const DOCK_BAR_HEIGHT = 36
/** Player viewport + transport that must remain above the dock. */
export const MIN_PREVIEW_AREA = 220
/** Smallest useful dock body (CENAS cards / ruler + one track). */
export const MIN_DOCK_BODY = 120
/** Dragging the handle below this body height collapses the dock. */
export const COLLAPSE_SNAP_BODY = 56

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Largest total dock height that still leaves the Player area usable. */
export function maxDockHeight(workbenchHeight: number): number {
  return Math.max(DOCK_BAR_HEIGHT + MIN_DOCK_BODY, workbenchHeight - MIN_PREVIEW_AREA)
}

/** Total dock height (bar included) for a preset mode in a workbench of `workbenchHeight` px. */
export function dockPresetHeight(mode: DockMode, workbenchHeight: number): number {
  if (mode === 'collapsed') return DOCK_BAR_HEIGHT
  const max = maxDockHeight(workbenchHeight)
  const normal = clamp(Math.round(workbenchHeight * 0.28), DOCK_BAR_HEIGHT + MIN_DOCK_BODY, Math.min(DOCK_BAR_HEIGHT + 200, max))
  if (mode === 'normal') return normal
  return clamp(Math.round(workbenchHeight * 0.55), normal, max)
}

export type DockState = { mode: DockMode; /** A handle-resized height; null = the mode's preset. */ height: number | null }

export const INITIAL_DOCK_STATE: DockState = { mode: 'normal', height: null }

/** The rendered total dock height for a state (always clamped to the current workbench). */
export function dockHeight(state: DockState, workbenchHeight: number): number {
  if (state.mode === 'collapsed') return DOCK_BAR_HEIGHT
  if (state.height === null) return dockPresetHeight(state.mode, workbenchHeight)
  return clamp(state.height, DOCK_BAR_HEIGHT + MIN_DOCK_BODY, maxDockHeight(workbenchHeight))
}

/** Handle drag: a dragged height. Too small collapses (the bar always stays). */
export function resizeDock(requestedHeight: number, workbenchHeight: number): DockState {
  if (requestedHeight - DOCK_BAR_HEIGHT < COLLAPSE_SNAP_BODY) return { mode: 'collapsed', height: null }
  const height = clamp(Math.round(requestedHeight), DOCK_BAR_HEIGHT + MIN_DOCK_BODY, maxDockHeight(workbenchHeight))
  const expandedAt = dockPresetHeight('expanded', workbenchHeight)
  return { mode: height >= expandedAt - 1 ? 'expanded' : 'normal', height }
}

/** Bar buttons / handle double-click. */
export function setDockMode(mode: DockMode): DockState {
  return { mode, height: null }
}

export function toggleDockCollapsed(state: DockState): DockState {
  return state.mode === 'collapsed' ? setDockMode('normal') : setDockMode('collapsed')
}

/** Compact summary shown in the collapsed bar (derived from the authored scenes, never stored). */
export function sequenceSummary(scenes: readonly Pick<VideoScene, 'duration'>[], totalSeconds: number): string {
  return `${scenes.length} ${scenes.length === 1 ? 'cena' : 'cenas'} · ${Number(totalSeconds.toFixed(2))}s`
}
