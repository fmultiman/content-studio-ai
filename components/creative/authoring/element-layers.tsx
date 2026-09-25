'use client'

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical } from 'lucide-react'
import { moveElementInOrder } from '@/lib/creative/templates/element-stack'

/** Paint order (back -> front) index for a row shown at `displayIndex` in the front-first list. */
function orderIndex(length: number, displayIndex: number): number {
  return length - 1 - displayIndex
}

/**
 * Creative Editor — "Camadas": THE element navigator and stack-order editor
 * (Authoring Usability Completion V1 replaced the separate Element dropdown
 * and standalone Transformation block with it).
 *
 * Each row is an inline disclosure. Single-open: opening a row closes the
 * previous one; the open panel shows ONLY that element's own controls
 * (`renderPanel`). Open/closed is editor UI state owned by the caller and is
 * never persisted.
 *
 * Interaction targets are separate on purpose:
 *  - the grip (≡) is the ONLY thing that reorders — pointer drag with capture,
 *    or ArrowUp/ArrowDown when focused — and never toggles the disclosure;
 *  - the eye (Static Detail Polish V1) only shows/hides the element — it
 *    never reorders, never toggles the disclosure and stops its own events;
 *  - the row body toggles the disclosure and never reorders;
 *  - controls inside an open panel never start a reorder (they are outside
 *    the grip) and stop pointer propagation so they cannot reach the Inspector.
 * Drag uses pointer events, not HTML5 drag-and-drop (Dockview uses that for
 * docking), and the drop target is the row actually under the pointer, even
 * if the list scrolls mid-drag (Template Foundation V1 production fix).
 *
 * Top row = FRONT (painted last). Never shows numeric z-index values.
 */
export function ElementLayers({
  order,
  labels,
  openId,
  isDefault,
  onToggle,
  onReorder,
  onRestoreDefault,
  renderPanel,
  hidden,
  onToggleVisibility,
  readOnly = false,
  note,
}: {
  /** Normalized paint order, back -> front. */
  order: readonly string[]
  labels: Readonly<Record<string, string>>
  /** The single expanded element, or null. */
  openId: string | null
  isDefault: boolean
  /** Row body click: open this element (closing any other), or close it if already open. */
  onToggle: (id: string) => void
  onReorder: (order: string[]) => void
  onRestoreDefault: () => void
  /** The open element's own controls. */
  renderPanel: (id: string) => ReactNode
  /** Authored hidden elements (Static Detail Polish V1). A hidden element stays listed, selectable and editable. */
  hidden?: ReadonlySet<string>
  /** Eye click: show/hide ONE element. Absent = no eye (e.g. read-only contexts). */
  onToggleVisibility?: (id: string) => void
  /**
   * Read-only anatomy (Creative Editor Video Static Parity V1): the same list,
   * front-first, with no grip, no reorder, no eye, no disclosure and no
   * restore — for compositions whose element state is not authorable yet.
   */
  readOnly?: boolean
  /** Replaces the interaction hint (e.g. why the stack is read-only). */
  note?: ReactNode
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<{ id: string; from: number; to: number } | null>(null)
  const display = [...order].reverse()
  // While dragging, preview the prospective order so the list reflows live.
  const shown = drag ? moveElementInOrder(display, drag.from, drag.to) : display

  function commitDisplayMove(from: number, to: number) {
    if (from === to) return
    onReorder(moveElementInOrder(order, orderIndex(order.length, from), orderIndex(order.length, to)))
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string, index: number) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ id, from: index, to: index })
  }

  /**
   * Target = the row currently under the pointer (by live row rects), not a
   * clientY delta from the press: the list may scroll mid-drag (wheel, or
   * auto-scroll), which moves rows under a stationary pointer.
   */
  function targetIndexAt(clientY: number, fallback: number): number {
    const rows = listRef.current ? [...listRef.current.querySelectorAll<HTMLLIElement>(':scope > li')] : []
    if (rows.length === 0) return fallback
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index].getBoundingClientRect()
      // In a gap above this row (or above the first row): land here.
      if (clientY < rect.top) return index
      if (clientY <= rect.bottom) return index
    }
    return rows.length - 1
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return
    event.stopPropagation()
    const to = targetIndexAt(event.clientY, drag.to)
    if (to !== drag.to) setDrag({ ...drag, to })
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitDisplayMove(drag.from, targetIndexAt(event.clientY, drag.to))
    setDrag(null)
  }

  function onGripKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const to = event.key === 'ArrowUp' ? index - 1 : index + 1
    if (to < 0 || to >= display.length) return
    commitDisplayMove(index, to)
    // Keep focus on the moved row's grip.
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>('[data-layer-grip]')[to]?.focus())
  }

  return (
    <section className="space-y-1.5" aria-label="Camadas" data-testid="element-layers">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Camadas</span>
        {readOnly
          ? <span className="text-[10px] text-muted-foreground">somente leitura</span>
          : <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50 disabled:no-underline" disabled={isDefault} onClick={onRestoreDefault} title="Restaurar ordem de camadas do Template">Ordem padrão</button>}
      </div>
      {note ?? <p className="text-[11px] leading-snug text-muted-foreground">Clique em um elemento para ajustá-lo. Arraste ≡ para trazer à frente ou levar para trás. O olho mostra ou oculta o elemento.</p>}
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Frente</p>
      <ol ref={listRef} className="min-w-0 space-y-0.5 overflow-x-hidden" data-dragging={drag ? 'true' : undefined}>
        {shown.map((id, index) => {
          const open = id === openId
          const dragging = drag?.id === id
          const label = labels[id] ?? id
          const panelId = `element-panel-${id}`
          const isHidden = hidden?.has(id) ?? false
          if (readOnly) {
            return (
              <li key={id} data-layer-id={id} data-read-only="true" className="min-w-0 rounded-md border border-border/60 px-2 py-1.5 text-xs">
                <span className="block min-w-0 truncate">{label}</span>
              </li>
            )
          }
          return (
            <li key={id} data-layer-id={id} data-open={open ? 'true' : undefined} data-hidden={isHidden ? 'true' : undefined} className={`min-w-0 rounded-md border text-xs ${open ? 'border-primary/70 bg-primary/5' : 'border-border/60'} ${dragging ? 'opacity-70 ring-1 ring-primary' : ''}`}>
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  data-layer-grip
                  aria-label={`Mover ${label} (setas para cima/baixo)`}
                  title="Arraste para reordenar"
                  className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
                  onPointerDown={(event) => onPointerDown(event, id, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(event) => onGripKeyDown(event, index)}
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                {onToggleVisibility ? (
                  <button
                    type="button"
                    data-layer-eye
                    aria-label={isHidden ? `Mostrar ${label}` : `Ocultar ${label}`}
                    aria-pressed={!isHidden}
                    title={isHidden ? 'Mostrar elemento' : 'Ocultar elemento'}
                    className={`flex h-7 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted ${isHidden ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); onToggleVisibility(id) }}
                  >
                    {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-1 py-1 pr-2 text-left"
                  onClick={() => onToggle(id)}
                  aria-expanded={open}
                  aria-controls={open ? panelId : undefined}
                  data-layer-toggle
                >
                  <span className={`min-w-0 truncate ${isHidden ? 'italic text-muted-foreground' : ''}`}>{label}</span>
                  {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                </button>
              </div>
              {open ? (
                <div
                  id={panelId}
                  role="region"
                  aria-label={label}
                  data-layer-panel
                  className="min-w-0 border-t border-border/60 px-2 pb-2 pt-2"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {renderPanel(id)}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trás</p>
    </section>
  )
}
