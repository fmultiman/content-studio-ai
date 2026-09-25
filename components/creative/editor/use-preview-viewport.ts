'use client'

/**
 * Creative Editor Preview Surface VIEWPORT — the camera shared by the Static
 * Canvas and the Video Live Player (extracted from the Static editor, where it
 * was proven in Static Detail Polish V1; behavior unchanged).
 *
 * UI state only: zoom and pan never enter authoring state, persisted slides,
 * VideoDraft, TimelineManifest, render requests or snapshots, and never make a
 * draft dirty. Distinct from any Timeline temporal zoom/scroll.
 *
 * - Fit keeps a 12px margin on every side of the viewport;
 * - pointer drag on the viewport pans (grab cursor); wheel pans on the floating
 *   (desktop) workbench only — the stacked fallback keeps page scrolling;
 * - pan is clamped so part of the surface always stays visible;
 * - Ajustar / Centralizar / 100% are the deterministic recovery actions.
 */
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  CENTERED, applyViewportAction, calculatePreviewFitScale, canvasOrigin, clampPan, stepViewportZoom,
  type ViewportAction, type ViewportPan, type ViewportZoom,
} from '@/lib/creative/authoring/viewport'

export type PreviewViewport = ReturnType<typeof usePreviewViewport>

export function usePreviewViewport({ surfaceWidth, surfaceHeight, floating, fallbackFitScale = 0.33 }: {
  surfaceWidth: number
  surfaceHeight: number
  /** Desktop floating workbench (wheel pans) vs stacked fallback (wheel scrolls the page). */
  floating: boolean
  /** Scale used before the viewport has been measured. */
  fallbackFitScale?: number
}) {
  const [zoom, setZoom] = useState<ViewportZoom>('fit')
  const [pan, setPan] = useState<ViewportPan>(CENTERED)
  // The active pan drag (pointer + start). State, not a ref: it is set once per drag and read by the move handler.
  const [panDrag, setPanDrag] = useState<{ pointerId: number; x: number; y: number; from: ViewportPan } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Callback-ref state, not useRef: in the floating workbench the surface mounts inside a Dockview
  // portal AFTER the page's effects run, so a ref read in an effect could miss it (Fit stuck at fallback).
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = container
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [container])

  // Wheel pans the surface (desktop workbench only).
  useEffect(() => {
    const el = container
    if (!el || !floating) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return // browser/trackpad zoom stays the browser's
      event.preventDefault()
      setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [container, floating])

  const measuredFitScale = calculatePreviewFitScale(size.width - 24, size.height - 24, surfaceWidth, surfaceHeight)
  const fitScale = measuredFitScale > 0 ? measuredFitScale : fallbackFitScale
  const scale = zoom === 'fit' ? fitScale : zoom
  // Floor the scaled box so Fit never overflows its viewport by a sub-pixel.
  const scaledWidth = Math.floor(surfaceWidth * scale)
  const scaledHeight = Math.floor(surfaceHeight * scale)
  // Positioned by the viewport (centered + pan), never scrolled: no scrollbars, no page scroll.
  const viewSize = { width: size.width || scaledWidth, height: size.height || scaledHeight }
  const scaledSize = { width: scaledWidth, height: scaledHeight }
  const effectivePan = clampPan(pan, viewSize, scaledSize)
  const origin = canvasOrigin(viewSize, scaledSize, effectivePan)

  function action(next: ViewportAction) {
    const state = applyViewportAction({ zoom, pan }, next)
    setZoom(state.zoom)
    setPan(state.pan)
  }
  function step(direction: 1 | -1) {
    setZoom(stepViewportZoom(zoom === 'fit' ? fitScale : zoom, direction))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    setPanDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: effectivePan })
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    setPan(clampPan({ x: drag.from.x + event.clientX - drag.x, y: drag.from.y + event.clientY - drag.y }, viewSize, scaledSize))
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!panDrag || panDrag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setPanDrag(null)
  }

  return {
    /** Callback ref for the viewport element (named without a "Ref" suffix: it is a state setter, not a ref). */
    attach: setContainer,
    size,
    zoom,
    setZoom,
    fitScale,
    scale,
    scaledWidth,
    scaledHeight,
    origin,
    effectivePan,
    panning: panDrag !== null,
    action,
    step,
    /** Spread on the viewport element: pan by dragging (grab cursor). */
    panHandlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  }
}
