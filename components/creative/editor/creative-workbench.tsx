'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DockviewReact } from 'dockview-react'
import type { DockviewApi, DockviewGroupPanel, DockviewReadyEvent, IDockviewHeaderActionsProps } from 'dockview-react'
import { Minus, Plus } from 'lucide-react'
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

/** Right side of the palette's single header. The rest of the header is the drag handle. */
function InspectorHeaderActions(props: IDockviewHeaderActionsProps) {
  const { minimized, toggleMinimized } = useWorkbenchSlots()
  if (!props.panels.some((panel) => panel.id === INSPECTOR_PANEL_ID)) return null
  return (
    <div className="flex h-full items-center pr-1.5">
      <Button
        size="icon-sm"
        variant="ghost"
        className="h-7 w-7"
        onClick={toggleMinimized}
        aria-label={minimized ? 'Restaurar Inspector' : 'Minimizar Inspector'}
        aria-expanded={!minimized}
        data-testid="inspector-minimize"
      >
        {minimized ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
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
}

export function CreativeWorkbench({ canvas, inspector, className }: CreativeWorkbenchProps) {
  const [minimized, setMinimized] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const expandedHeightRef = useRef<number | null>(null)

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

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    const host = hostRef.current
    const box = initialInspectorPaletteBox(host?.clientWidth ?? 1100, host?.clientHeight ?? 600)
    event.api.addPanel({ id: CANVAS_PANEL_ID, component: CANVAS_PANEL_ID, title: 'Canvas' })
    event.api.addPanel({
      id: INSPECTOR_PANEL_ID,
      component: INSPECTOR_PANEL_ID,
      title: INSPECTOR_TITLE,
      floating: { position: { top: box.top, left: box.left }, width: box.width, height: box.height },
    })
  }, [])

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
    <WorkbenchSlotsContext.Provider value={{ canvas, inspector, minimized, toggleMinimized }}>
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
