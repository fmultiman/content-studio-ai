'use client'

/**
 * Creative Editor Video — bottom authoring dock (CENAS | TIMELINE).
 *
 * Lives INSIDE the workbench's preview panel (like the Static bottom toolbar),
 * so the floating Inspector keeps the full workbench height and the Player
 * regains the space whenever the dock collapses to its bar. Collapsed /
 * normal / expanded and the handle-resized height are UI state only (see
 * lib/creative/video-editor/bottom-dock.ts) — never VideoDraft, never render.
 */
import { useRef, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DOCK_BAR_HEIGHT, dockHeight, resizeDock, setDockMode, toggleDockCollapsed, type DockState,
} from '@/lib/creative/video-editor/bottom-dock'

export type AuthoringView = 'scenes' | 'timeline'

export function AuthoringDock({ view, onViewChange, dock, onDockChange, workbenchHeight, resizable, summary, children }: {
  view: AuthoringView
  onViewChange: (view: AuthoringView) => void
  dock: DockState
  onDockChange: (dock: DockState) => void
  /** Measured height of the panel hosting the Player + dock. */
  workbenchHeight: number
  /** Desktop workbench: handle resize. Stacked fallback: presets only. */
  resizable: boolean
  summary: string
  children: ReactNode
}) {
  const height = dockHeight(dock, workbenchHeight)
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const collapsed = dock.mode === 'collapsed'

  function onHandleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not an active pointer */ }
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height }
  }
  function onHandleMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onDockChange(resizeDock(drag.startHeight + (drag.startY - event.clientY), workbenchHeight))
  }
  function onHandleEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }
  function onHandleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onDockChange(resizeDock(height + (event.key === 'ArrowUp' ? 24 : -24), workbenchHeight))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onDockChange(toggleDockCollapsed(dock))
    }
  }

  return (
    <section
      className="relative flex shrink-0 flex-col border-t border-border/50 bg-background"
      style={{ height }}
      aria-label="Autoria temporal"
      data-testid="video-lower-region"
      data-mode={view}
      data-dock={dock.mode}
      data-dock-height={height}
    >
      {resizable ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Redimensionar painel de Cenas / Timeline (setas; Enter recolhe/expande)"
          aria-valuenow={Math.round(height)}
          tabIndex={0}
          title="Arraste para redimensionar · duplo clique recolhe/expande"
          className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-ns-resize touch-none items-center justify-center focus-visible:outline-none"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleEnd}
          onPointerCancel={onHandleEnd}
          onDoubleClick={() => onDockChange(toggleDockCollapsed(dock))}
          onKeyDown={onHandleKey}
          data-testid="dock-resize-handle"
        >
          <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2 px-3" style={{ height: DOCK_BAR_HEIGHT }}>
        <div className="flex rounded-md border border-border/60 p-0.5" role="tablist" aria-label="Vista">
          {(['scenes', 'timeline'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={view === mode}
              onClick={() => { onViewChange(mode); if (collapsed) onDockChange(setDockMode('normal')) }}
              className={cn('rounded px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', view === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              data-testid={`lower-mode-${mode}`}
            >
              {mode === 'scenes' ? 'Cenas' : 'Timeline'}
            </button>
          ))}
        </div>
        <span className="min-w-0 truncate text-xs text-muted-foreground" data-testid="sequence-summary">{summary}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5" role="group" aria-label="Tamanho do painel">
          <Button size="icon-sm" variant={collapsed ? 'secondary' : 'ghost'} onClick={() => onDockChange(collapsed ? setDockMode('normal') : setDockMode('collapsed'))} aria-label={collapsed ? 'Mostrar painel' : 'Recolher painel'} title={collapsed ? 'Mostrar painel' : 'Recolher painel (o Player ganha o espaço)'} data-testid="dock-toggle">
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon-sm" variant={dock.mode === 'expanded' ? 'secondary' : 'ghost'} onClick={() => onDockChange(setDockMode(dock.mode === 'expanded' ? 'normal' : 'expanded'))} aria-label={dock.mode === 'expanded' ? 'Tamanho normal' : 'Expandir painel'} title={dock.mode === 'expanded' ? 'Tamanho normal' : 'Expandir painel'} aria-pressed={dock.mode === 'expanded'} data-testid="dock-expand">
            <ChevronsUp className={cn('h-3.5 w-3.5 transition-transform', dock.mode === 'expanded' && 'rotate-180')} />
          </Button>
        </div>
      </div>
      {collapsed ? null : <div className="min-h-0 flex-1 overflow-hidden border-t border-border/40" data-testid="dock-body">{children}</div>}
    </section>
  )
}
