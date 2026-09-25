'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DockviewReact } from 'dockview-react'
import type { DockviewApi, DockviewGroupPanel, DockviewReadyEvent, IDockviewHeaderActionsProps } from 'dockview-react'
import { Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  FLOATING_WORKBENCH_MIN_VIEWPORT_WIDTH, constrainPaletteBox, initialInspectorPaletteBox, type PaletteBox,
} from '@/lib/creative/authoring/editor-workspace'

/**
 * Creative Editor workbench: the Canvas surface plus ONE floating Inspector
 * palette, hosted by Dockview purely as window infrastructure (move, resize,
 * bounds). Dockview state is UI-only and never enters authoring state.
 *
 * Why the context indirection: dockview-react renders each panel through a
 * portal whose component is captured ONCE, at panel creation
 * (ReactPart.createPortal). Passing inline closures such as
 * `{ canvas: () => renderCanvas() }` froze every panel on the first render's
 * state — clicks updated page state but the Canvas and Inspector never
 * re-rendered (tabs, zoom, slides, minimize all looked dead). The panel
 * components here are stable module-level functions that read their live
 * content from context, which does propagate through portals.
 */

const CANVAS_PANEL_ID = 'canvas'
const INSPECTOR_PANEL_ID = 'inspector'
const INSPECTOR_TITLE = 'Inspector'
const MINIMIZED_CLASS = 'creative-inspector-minimized'

type WorkbenchSlots = {
  canvas: ReactNode
  inspector: ReactNode
  minimized: boolean
  toggleMinimized: () => void
  closeInspector: () => void
}

const WorkbenchSlotsContext = createContext<WorkbenchSlots | null>(null)

function useWorkbenchSlots(): WorkbenchSlots {
  const slots = useContext(WorkbenchSlotsContext)
  if (!slots) throw new Error('Creative workbench panels must render inside <CreativeWorkbench>.')
  return slots
}

function CanvasPanel() {
  return <>{useWorkbenchSlots().canvas}</>
}

function InspectorPanel() {
  const { inspector, minimized } = useWorkbenchSlots()
  return minimized ? null : <div className="creative-editor-inspector-body" data-testid="inspector-body">{inspector}</div>
}

/**
 * Right side of the palette's single header. The rest of the header is the drag handle.
 * Static Detail Polish V1: [−] minimize/restore and [×] close are distinct states. Both
 * buttons stop pointerdown so a click never starts a titlebar drag.
 */
function InspectorHeaderActions(props: IDockviewHeaderActionsProps) {
  const { minimized, toggleMinimized, closeInspector } = useWorkbenchSlots()
  if (!props.panels.some((panel) => panel.id === INSPECTOR_PANEL_ID)) return null
  return (
    <div className="flex h-full items-center gap-0.5 pr-1.5">
      <Button
        size="icon-sm"
        variant="ghost"
        className="h-7 w-7"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={toggleMinimized}
        aria-label={minimized ? 'Restaurar Inspector' : 'Minimizar Inspector'}
        title={minimized ? 'Restaurar' : 'Minimizar'}
        aria-expanded={!minimized}
        data-testid="inspector-minimize"
      >
        {minimized ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="h-7 w-7"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={closeInspector}
        aria-label="Fechar Inspector"
        title="Fechar Inspector (reabra pela barra inferior)"
        data-testid="inspector-close"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// Module-level and therefore referentially stable: dockview captures these once.
const PANEL_COMPONENTS = { [CANVAS_PANEL_ID]: CanvasPanel, [INSPECTOR_PANEL_ID]: InspectorPanel }

type FloatingWindow = { position(bounds: Partial<PaletteBox>): void }

/**
 * `DockviewFloatingGroupPanel.position()` is dockview's own bounds setter; it
 * pins top/left alignment, so minimize/restore keeps X/Y exactly. The public
 * DockviewApi does not surface the floating window, so reach it through the
 * component it wraps, and fall back to the public group `setSize` if absent.
 */
function floatingWindowFor(api: DockviewApi, group: DockviewGroupPanel): FloatingWindow | undefined {
  const component = (api as unknown as { component?: { getFloatingWindowForGroup?: (g: DockviewGroupPanel) => FloatingWindow | undefined } }).component
  return component?.getFloatingWindowForGroup?.(group)
}

/** Pointer travel (px) above which a titlebar press counts as a drag, not a click. */
const TITLEBAR_CLICK_SLOP = 4

/**
 * Authoring Usability Completion V1 — double-click on the palette titlebar
 * (the drag handle only; never header actions or panel content) toggles
 * minimize/restore. A click that moved (i.e. ended a drag) disqualifies the
 * double-click, so dragging the palette can never minimize it by accident.
 * Uses the browser's own dblclick detection — no timers.
 */
export function bindTitlebarDoubleClick(titlebar: HTMLElement, onToggle: () => void): () => void {
  let pressAt: { x: number; y: number } | null = null
  const clickMoved: boolean[] = []
  const onPointerDown = (event: PointerEvent) => { pressAt = { x: event.clientX, y: event.clientY } }
  const onClick = (event: MouseEvent) => {
    const moved = pressAt ? Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > TITLEBAR_CLICK_SLOP : false
    clickMoved.push(moved)
    if (clickMoved.length > 2) clickMoved.shift()
  }
  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target && target !== titlebar && target.closest('button, a, input, select, textarea, [role="tab"]')) return
    if (clickMoved.some(Boolean)) return
    event.preventDefault()
    onToggle()
  }
  titlebar.addEventListener('pointerdown', onPointerDown)
  titlebar.addEventListener('click', onClick)
  titlebar.addEventListener('dblclick', onDoubleClick)
  return () => {
    titlebar.removeEventListener('pointerdown', onPointerDown)
    titlebar.removeEventListener('click', onClick)
    titlebar.removeEventListener('dblclick', onDoubleClick)
  }
}

function paletteElementFor(group: DockviewGroupPanel): HTMLElement | null {
  return group.element.closest<HTMLElement>('.dv-resize-container')
}

/** Palette box in the same coordinate space dockview's `setBounds` writes (`style.top/left` of the overlay). */
function paletteBox(palette: HTMLElement): PaletteBox {
  return { top: palette.offsetTop, left: palette.offsetLeft, width: palette.offsetWidth, height: palette.offsetHeight }
}

function subscribeViewport(onChange: () => void) {
  const query = window.matchMedia(`(min-width: ${FLOATING_WORKBENCH_MIN_VIEWPORT_WIDTH}px)`)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** True when the viewport is wide enough for the floating-palette workbench. */
export function useFloatingWorkbench(): boolean {
  return useSyncExternalStore(
    subscribeViewport,
    () => window.matchMedia(`(min-width: ${FLOATING_WORKBENCH_MIN_VIEWPORT_WIDTH}px)`).matches,
    () => true,
  )
}

type CreativeWorkbenchProps = {
  canvas: ReactNode
  inspector: ReactNode
  className?: string
  /**
   * Static Detail Polish V1 — Inspector open/closed is WORKSPACE UI state (never
   * authoring state). Controlled by the page so its bottom toolbar can offer the
   * reopen launcher. Absent = always open (legacy behaviour).
   */
  inspectorOpen?: boolean
  onInspectorOpenChange?: (open: boolean) => void
}

export function CreativeWorkbench({ canvas, inspector, className, inspectorOpen = true, onInspectorOpenChange }: CreativeWorkbenchProps) {
  const [minimized, setMinimized] = useState(false)
  // Last useful palette bounds, remembered in memory for this editor session only.
  const lastBoxRef = useRef<PaletteBox | null>(null)
  const inspectorOpenRef = useRef(inspectorOpen)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const expandedHeightRef = useRef<number | null>(null)
  const toggleRef = useRef<() => void>(() => {})
  const unbindTitlebarRef = useRef<(() => void) | null>(null)

  const inspectorGroup = useCallback(() => apiRef.current?.getPanel(INSPECTOR_PANEL_ID)?.group ?? null, [])

  const toggleMinimized = useCallback(() => {
    const api = apiRef.current
    const group = inspectorGroup()
    const host = hostRef.current
    const palette = group ? paletteElementFor(group) : null
    if (!api || !group || !host || !palette) { setMinimized(!minimized); return }
    const box = paletteBox(palette)
    const floating = floatingWindowFor(api, group)
    let next: PaletteBox
    if (minimized) {
      palette.classList.remove(MINIMIZED_CLASS)
      next = constrainPaletteBox({ ...box, height: expandedHeightRef.current ?? box.height }, host.clientWidth, host.clientHeight)
    } else {
      expandedHeightRef.current = box.height
      palette.classList.add(MINIMIZED_CLASS)
      const header = palette.querySelector<HTMLElement>('.dv-tabs-and-actions-container')
      next = { ...box, height: (header?.offsetHeight ?? 36) + (palette.offsetHeight - palette.clientHeight) }
    }
    if (floating) floating.position(next)
    else group.api.setSize({ height: next.height })
    setMinimized(!minimized)
  }, [inspectorGroup, minimized])

  useEffect(() => { toggleRef.current = toggleMinimized }, [toggleMinimized])
  useEffect(() => () => { unbindTitlebarRef.current?.() }, [])

  /** Adds the floating Inspector at `box` and binds its titlebar double-click. */
  const mountInspector = useCallback((api: DockviewApi, box: PaletteBox) => {
    api.addPanel({
      id: INSPECTOR_PANEL_ID,
      component: INSPECTOR_PANEL_ID,
      title: INSPECTOR_TITLE,
      floating: { position: { top: box.top, left: box.left }, width: box.width, height: box.height },
    })
    // The palette's titlebar = its drag handle (the tab bar's void area).
    const group = api.getPanel(INSPECTOR_PANEL_ID)?.group
    const titlebar = group ? paletteElementFor(group)?.querySelector<HTMLElement>('.dv-void-container') : null
    unbindTitlebarRef.current?.()
    unbindTitlebarRef.current = titlebar ? bindTitlebarDoubleClick(titlebar, () => toggleRef.current()) : null
  }, [])

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    const host = hostRef.current
    event.api.addPanel({ id: CANVAS_PANEL_ID, component: CANVAS_PANEL_ID, title: 'Canvas' })
    if (inspectorOpenRef.current) mountInspector(event.api, initialInspectorPaletteBox(host?.clientWidth ?? 1100, host?.clientHeight ?? 600))
  }, [mountInspector])

  const closeInspector = useCallback(() => onInspectorOpenChange?.(false), [onInspectorOpenChange])

  // Close removes the palette entirely (remembering its useful bounds); reopen restores them.
  useEffect(() => {
    inspectorOpenRef.current = inspectorOpen
    const api = apiRef.current
    const host = hostRef.current
    if (!api || !host) return
    const panel = api.getPanel(INSPECTOR_PANEL_ID)
    if (!inspectorOpen && panel) {
      const palette = paletteElementFor(panel.group)
      if (palette) {
        const box = paletteBox(palette)
        lastBoxRef.current = minimized && expandedHeightRef.current ? { ...box, height: expandedHeightRef.current } : box
      }
      unbindTitlebarRef.current?.()
      unbindTitlebarRef.current = null
      api.removePanel(panel)
      setMinimized(false)
    } else if (inspectorOpen && !panel) {
      const box = lastBoxRef.current
        ? constrainPaletteBox(lastBoxRef.current, host.clientWidth, host.clientHeight)
        : initialInspectorPaletteBox(host.clientWidth, host.clientHeight)
      mountInspector(api, box)
    }
  }, [inspectorOpen, minimized, mountInspector])

  // Keep the palette reachable when the workbench shrinks (window resize).
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const api = apiRef.current
      const group = inspectorGroup()
      const palette = group ? paletteElementFor(group) : null
      if (!api || !group || !palette || palette.classList.contains(MINIMIZED_CLASS)) return
      const box = paletteBox(palette)
      const next = constrainPaletteBox(box, host.clientWidth, host.clientHeight)
      if (next.top !== box.top || next.left !== box.left || next.width !== box.width || next.height !== box.height) floatingWindowFor(api, group)?.position(next)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [inspectorGroup])

  return (
    <WorkbenchSlotsContext.Provider value={{ canvas, inspector, minimized, toggleMinimized, closeInspector }}>
      <div ref={hostRef} className={cn('creative-editor-workbench relative min-h-0', className)} data-testid="creative-workbench">
        <DockviewReact
          className="creative-editor-dockview h-full w-full"
          components={PANEL_COMPONENTS}
          rightHeaderActionsComponent={InspectorHeaderActions}
          onReady={onReady}
          // V1 is floating-only: no HTML5/pointer docking, drop targets, edge docking or redocking.
          disableDnd
          dndEdges={false}
          floatingGroupBounds="boundedWithinViewport"
          // The palette's single header row (tab bar) is the only drag handle; content never drags.
          floatingGroupDragHandle="tabbar"
        />
      </div>
    </WorkbenchSlotsContext.Provider>
  )
}

/** Narrow-viewport fallback: no floating window, Inspector stacked under the Canvas. */
export function StackedWorkbench({ canvas, inspector }: Pick<CreativeWorkbenchProps, 'canvas' | 'inspector'>) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="creative-workbench-stacked">
      <div className="min-w-0 overflow-hidden rounded-lg border border-border/50 bg-background">{canvas}</div>
      <section aria-label={INSPECTOR_TITLE} className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card">
        <h2 className="border-b border-border/60 px-3 py-2 text-sm font-semibold">{INSPECTOR_TITLE}</h2>
        <div className="creative-editor-inspector-body">{inspector}</div>
      </section>
    </div>
  )
}
