/**
 * Creative Editor Canvas VIEWPORT (the editor's camera). Pure and UI-only:
 * zoom and pan never enter authoring state, persisted slides, render
 * requests or snapshots — moving the view never moves an element and never
 * makes the draft dirty (Static Detail Polish V1).
 */

export function calculatePreviewFitScale(availableWidth: number, availableHeight: number, canvasWidth: number, canvasHeight: number): number {
  if (availableWidth <= 0 || availableHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) return 0
  return Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight, 1)
}

/** Viewport zoom: 'fit' follows the available area; a number is an explicit scale. */
export type ViewportZoom = 'fit' | number

/** Offset (px) of the displayed Canvas from its centered position. */
export type ViewportPan = { x: number; y: number }

export type ViewportState = { zoom: ViewportZoom; pan: ViewportPan }

export const CENTERED: ViewportPan = { x: 0, y: 0 }

/** How much of the Canvas (px, on screen) always stays inside the viewport while panning. */
export const PAN_KEEP_VISIBLE = 80

type Size = { width: number; height: number }

/**
 * Keeps at least PAN_KEEP_VISIBLE px of the Canvas inside the viewport on each
 * axis, so it can be moved freely around the workbench but never lost —
 * Ajustar / Centralizar / 100% remain the deterministic recovery.
 */
export function clampPan(pan: ViewportPan, viewport: Size, scaled: Size, keepVisible = PAN_KEEP_VISIBLE): ViewportPan {
  const limit = (view: number, content: number) => Math.max(0, (view + content) / 2 - Math.min(keepVisible, content, view))
  const maxX = limit(viewport.width, scaled.width)
  const maxY = limit(viewport.height, scaled.height)
  const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, value))
  return { x: clamp(pan.x, maxX), y: clamp(pan.y, maxY) }
}

/** Top-left of the displayed Canvas inside the viewport: centered, then offset by pan. */
export function canvasOrigin(viewport: Size, scaled: Size, pan: ViewportPan): { left: number; top: number } {
  return { left: Math.round((viewport.width - scaled.width) / 2 + pan.x), top: Math.round((viewport.height - scaled.height) / 2 + pan.y) }
}

export type ViewportAction = 'fit' | 'center' | 'actual'

/**
 * The explicit viewport actions:
 *  - Ajustar ('fit'): zoom follows the available area, centered;
 *  - Centralizar ('center'): keep the zoom, recenter;
 *  - 100% ('actual'): zoom 1, centered.
 */
export function applyViewportAction(state: ViewportState, action: ViewportAction): ViewportState {
  if (action === 'fit') return { zoom: 'fit', pan: CENTERED }
  if (action === 'actual') return { zoom: 1, pan: CENTERED }
  return { zoom: state.zoom, pan: CENTERED }
}
