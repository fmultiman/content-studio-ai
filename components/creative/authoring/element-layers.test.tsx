// @vitest-environment jsdom
/**
 * Creative Editor Template Foundation V1 — Camadas (element stack) list.
 */
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ElementLayers } from './element-layers'

beforeAll(() => {
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => true
})

afterEach(cleanup)

const LABELS = { paper: 'Papel do título', hero: 'Imagem principal', tape1: 'Fita da imagem', title: 'Título' }
const DEFAULT = ['paper', 'hero', 'tape1', 'title']

function Harness({ onParentPointerDown }: { onParentPointerDown?: () => void }) {
  const [order, setOrder] = useState<string[]>(DEFAULT)
  const [selected, setSelected] = useState('title')
  return (
    <div onPointerDown={onParentPointerDown}>
      <ElementLayers order={order} labels={LABELS} selectedId={selected} isDefault={order.join() === DEFAULT.join()} onSelect={setSelected} onReorder={setOrder} onRestoreDefault={() => setOrder(DEFAULT)} />
      <output data-testid="order">{order.join(',')}</output>
      <output data-testid="selected">{selected}</output>
    </div>
  )
}

const rows = () => within(screen.getByTestId('element-layers')).getAllByRole('listitem').map((row) => row.getAttribute('data-layer-id'))
const grip = (label: string) => screen.getByRole('button', { name: `Mover ${label} (setas para cima/baixo)` })

describe('ElementLayers (Camadas)', () => {
  it('shows the front-most element on top with product labels and Frente/Trás cues, never raw ids or z-index numbers', () => {
    render(<Harness />)
    expect(rows()).toEqual(['title', 'tape1', 'hero', 'paper'])
    expect(screen.getByText('Frente')).toBeTruthy()
    expect(screen.getByText('Trás')).toBeTruthy()
    expect(screen.getByText('Fita da imagem')).toBeTruthy()
    expect(screen.getByTestId('element-layers').textContent).not.toMatch(/tape1|z-index|\b\d{2}\b/)
  })

  it('dragging a row with the mouse reorders the stack (Imagem principal above Fita da imagem)', () => {
    render(<Harness />)
    const handle = grip('Imagem principal')
    const row = handle.closest('li') as HTMLElement
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ height: 28 } as DOMRect)
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 72 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 72 })
    expect(rows()).toEqual(['title', 'hero', 'tape1', 'paper'])
    // Paint order (back -> front) is what gets persisted.
    expect(screen.getByTestId('order').textContent).toBe('paper,tape1,hero,title')
  })

  it('never lets a row drag reach the Inspector (propagation stopped)', () => {
    const parent = vi.fn()
    render(<Harness onParentPointerDown={parent} />)
    fireEvent.pointerDown(grip('Título'), { button: 0, pointerId: 1, clientY: 10 })
    expect(parent).not.toHaveBeenCalled()
  })

  it('reorders with ArrowUp/ArrowDown on a focused grip', () => {
    render(<Harness />)
    fireEvent.keyDown(grip('Papel do título'), { key: 'ArrowUp' })
    expect(rows()).toEqual(['title', 'tape1', 'paper', 'hero'])
    fireEvent.keyDown(grip('Título'), { key: 'ArrowUp' })
    expect(rows()).toEqual(['title', 'tape1', 'paper', 'hero'])
  })

  it('clicking a row selects that element for editing', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fita da imagem' }))
    expect(screen.getByTestId('selected').textContent).toBe('tape1')
  })

  it('Ordem padrão restores the template stack and is disabled while already default', () => {
    render(<Harness />)
    const restore = screen.getByRole('button', { name: 'Ordem padrão' }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    fireEvent.keyDown(grip('Papel do título'), { key: 'ArrowUp' })
    expect(restore.disabled).toBe(false)
    fireEvent.click(restore)
    expect(screen.getByTestId('order').textContent).toBe(DEFAULT.join(','))
  })
})
