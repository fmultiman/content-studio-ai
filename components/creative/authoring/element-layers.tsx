'use client'

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { moveElementInOrder } from '@/lib/creative/templates/element-stack'

/** Paint order (back -> front) index for a row shown at `displayIndex` in the front-first list. */
function orderIndex(length: number, displayIndex: number): number {
  return length - 1 - displayIndex
}

/**
 * Creative Editor Template Foundation V1 — "Camadas": the active slide's
 * element stack as a compact reorderable list. Top row = FRONT (painted
 * last). Never shows numeric z-index values.
 *
 * Drag uses pointer events with pointer capture on the grip only — no HTML5
 * drag-and-drop, which Dockview listens to for its own panel docking — and
 * stops propagation, so a row drag can never move the floating Inspector
 * (only its header can). ArrowUp/ArrowDown on a focused grip reorders by one.
 */
export function ElementLayers({
  order,
  labels,
  selectedId,
  isDefault,
  onSelect,
  onReorder,
  onRestoreDefault,
}: {
  /** Normalized paint order, back -> front. */
  order: readonly string[]
  labels: Readonly<Record<string, string>>
  selectedId?: string
  isDefault: boolean
  onSelect: (id: string) => void
  onReorder: (order: string[]) => void
  onRestoreDefault: () => void
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

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
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
        <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50 disabled:no-underline" disabled={isDefault} onClick={onRestoreDefault} title="Restaurar a ordem padrão do template">Ordem padrão</button>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Frente</p>
      <ol ref={listRef} className="max-h-60 min-w-0 space-y-0.5 overflow-y-auto overflow-x-hidden" data-dragging={drag ? 'true' : undefined}>
        {shown.map((id, index) => {
          const selected = id === selectedId
          const dragging = drag?.id === id
          return (
            <li key={id} data-layer-id={id} className={`flex min-w-0 items-center gap-1 rounded-md border text-xs ${selected ? 'border-primary bg-primary/10' : 'border-border/60'} ${dragging ? 'opacity-70 ring-1 ring-primary' : ''}`}>
              <button
                type="button"
                data-layer-grip
                aria-label={`Mover ${labels[id] ?? id} (setas para cima/baixo)`}
                title="Arraste para reordenar"
                className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
                onPointerDown={(event) => onPointerDown(event, id, index)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="min-w-0 flex-1 truncate py-1 pr-2 text-left" onClick={() => onSelect(id)} aria-pressed={selected}>
                {labels[id] ?? id}
              </button>
            </li>
          )
        })}
      </ol>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Trás</p>
    </section>
  )
}
