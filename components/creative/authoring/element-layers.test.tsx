// @vitest-environment jsdom
/**
 * Creative Editor — Camadas as THE element navigator (inline single-open
 * accordion) + stack-order editor. Authoring Usability Completion V1.
 */
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ElementLayers } from './element-layers'
import { PrimitiveTransformControls, TitleTuningControls } from './primitive-controls'

beforeAll(() => {
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => true
})

afterEach(cleanup)

const LABELS = { paper: 'Papel do título', hero: 'Imagem principal', tape1: 'Fita da imagem', title: 'Título' }
const DEFAULT = ['paper', 'hero', 'tape1', 'title']
const TRANSFORM = { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 1 }

function Harness({ onParentPointerDown, elements = LABELS, defaultOrder = DEFAULT }: { onParentPointerDown?: () => void; elements?: Record<string, string>; defaultOrder?: string[] }) {
  const [order, setOrder] = useState<string[]>(defaultOrder)
  const [openId, setOpenId] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  // Mirrors the page: an open id the current element set lacks is treated as closed.
  const open = openId && openId in elements ? openId : null
  return (
    <div onPointerDown={onParentPointerDown}>
      <ElementLayers
        order={order}
        labels={elements}
        openId={open}
        isDefault={order.join() === defaultOrder.join()}
        onToggle={(id) => setOpenId((current) => (current === id ? null : id))}
        onReorder={setOrder}
        onRestoreDefault={() => setOrder(defaultOrder)}
        renderPanel={(id) => id === 'title'
          ? <TitleTuningControls tuning={{ offsetX: 0, offsetY: 0, rotation: 0 }} onChange={(field, value) => setLog((l) => [...l, `${id}.${field}=${value}`])} onReset={() => setLog((l) => [...l, `${id}.reset`])} />
          : <PrimitiveTransformControls slot="tape1" transforms={TRANSFORM} onChange={(field, value) => setLog((l) => [...l, `${id}.${field}=${value}`])} onReset={() => setLog((l) => [...l, `${id}.reset`])} />}
      />
      <output data-testid="order">{order.join(',')}</output>
      <output data-testid="log">{log.join('|')}</output>
    </div>
  )
}

function VisibilityHarness() {
  const [hidden, setHidden] = useState<Set<string>>(new Set(['hero']))
  return <ElementLayers order={DEFAULT} labels={LABELS} openId={null} isDefault onToggle={() => {}} onReorder={() => {}} onRestoreDefault={() => {}} renderPanel={() => null} hidden={hidden} onToggleVisibility={(id) => setHidden((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })} />
}

/** Lay rows out 28px tall from `offset` (a scroll position), by their live DOM order. */
function layoutRows(offset = 0) {
  const items = within(screen.getByTestId('element-layers')).getAllByRole('listitem')
  items.forEach((row) => {
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
      const index = [...(row.parentElement?.children ?? [])].indexOf(row)
      const top = index * 28 - offset
      return { top, bottom: top + 28, height: 28, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
  })
}

const rows = () => within(screen.getByTestId('element-layers')).getAllByRole('listitem').map((row) => row.getAttribute('data-layer-id'))
const grip = (label: string) => screen.getByRole('button', { name: `Mover ${label} (setas para cima/baixo)` })
const toggle = (label: string) => screen.getByRole('button', { name: label })
const panels = () => screen.queryAllByRole('region').filter((region) => region.hasAttribute('data-layer-panel'))
const openRows = () => within(screen.getByTestId('element-layers')).getAllByRole('listitem').filter((row) => row.getAttribute('data-open') === 'true').map((row) => row.getAttribute('data-layer-id'))

describe('ElementLayers — element navigator (accordion)', () => {
  it('keeps hidden elements listed and toggles only through the eye target', () => {
    render(<VisibilityHarness />)
    const eye = screen.getByRole('button', { name: 'Mostrar Imagem principal' })
    expect(eye.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('element-layers').querySelector('[data-layer-id="hero"]')?.hasAttribute('data-hidden')).toBe(true)
    fireEvent.click(eye)
    expect(screen.getByRole('button', { name: 'Ocultar Imagem principal' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('element-layers').querySelector('[data-layer-id="hero"]')?.hasAttribute('data-hidden')).toBe(false)
  })

  it('exposes the bounded Entrelinha slider only when the title capability is supplied', () => {
    render(<TitleTuningControls tuning={{ offsetX: 0, offsetY: 0, rotation: 0 }} lineHeight={{ defaultValue: 1.04, min: 0.8, max: 1.5 }} onChange={() => {}} onReset={() => {}} />)
    const slider = screen.getByRole('slider', { name: 'Entrelinha' }) as HTMLInputElement
    expect(slider.min).toBe('0.8')
    expect(slider.max).toBe('1.5')
    expect(slider.value).toBe('1.04')
  })

  it('lists the front-most element on top with product labels and Frente/Trás cues, never raw ids or z-index numbers', () => {
    render(<Harness />)
    expect(rows()).toEqual(['title', 'tape1', 'hero', 'paper'])
    expect(screen.getByText('Frente')).toBeTruthy()
    expect(screen.getByText('Trás')).toBeTruthy()
    expect(screen.getByTestId('element-layers').textContent).not.toMatch(/tape1|z-index|\b\d{2}\b/)
  })

  it('has no separate element dropdown and no standalone transformation block', () => {
    render(<Harness />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull() // nothing expanded yet -> no controls anywhere
  })

  it('clicking a collapsed row selects + expands it, with its controls inline under it', () => {
    render(<Harness />)
    fireEvent.click(toggle('Título'))
    expect(openRows()).toEqual(['title'])
    expect(toggle('Título').getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('region', { name: 'Título' })
    expect(within(panel).getByRole('slider', { name: 'Posição X' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Restaurar elemento' })).toBeTruthy()
  })

  it('clicking the same expanded row collapses it', () => {
    render(<Harness />)
    fireEvent.click(toggle('Título'))
    fireEvent.click(toggle('Título'))
    expect(openRows()).toEqual([])
    expect(panels()).toHaveLength(0)
  })

  it('opening another row closes the first — only one open at a time', () => {
    render(<Harness />)
    fireEvent.click(toggle('Título'))
    fireEvent.click(toggle('Fita da imagem'))
    expect(openRows()).toEqual(['tape1'])
    expect(panels()).toHaveLength(1)
  })

  it('renders element-specific controls (Título: X/Y/rotação; Fita: + escala/opacidade)', () => {
    render(<Harness />)
    fireEvent.click(toggle('Título'))
    const title = screen.getByRole('region', { name: 'Título' })
    expect(within(title).getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação'])
    fireEvent.click(toggle('Fita da imagem'))
    const tape = screen.getByRole('region', { name: 'Fita da imagem' })
    expect(within(tape).getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala', 'Opacidade'])
  })

  it('discloses with the keyboard (native button: Enter/Space)', () => {
    render(<Harness />)
    const body = toggle('Título')
    body.focus()
    fireEvent.click(body) // Enter/Space on a native <button> dispatch click
    expect(openRows()).toEqual(['title'])
  })

  it('a row-body click never reorders', () => {
    render(<Harness />)
    fireEvent.click(toggle('Imagem principal'))
    expect(screen.getByTestId('order').textContent).toBe(DEFAULT.join(','))
  })

  it('a slider inside an open panel never reorders and never reaches the Inspector', () => {
    const parent = vi.fn()
    render(<Harness onParentPointerDown={parent} />)
    fireEvent.click(toggle('Título'))
    layoutRows()
    const slider = screen.getByRole('slider', { name: 'Posição X' })
    fireEvent.pointerDown(slider, { button: 0, pointerId: 3, clientY: 20 })
    fireEvent.pointerMove(slider, { pointerId: 3, clientY: 90 })
    fireEvent.pointerUp(slider, { pointerId: 3, clientY: 90 })
    fireEvent.change(slider, { target: { value: '12' } })
    expect(screen.getByTestId('order').textContent).toBe(DEFAULT.join(','))
    expect(screen.getByTestId('log').textContent).toBe('title.offsetX=12')
    expect(parent).not.toHaveBeenCalled()
  })

  it('Restaurar elemento resets only that element (not the stack)', () => {
    render(<Harness />)
    fireEvent.keyDown(grip('Papel do título'), { key: 'ArrowUp' })
    fireEvent.click(toggle('Título'))
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar elemento' }))
    expect(screen.getByTestId('log').textContent).toBe('title.reset')
    expect(screen.getByTestId('order').textContent).not.toBe(DEFAULT.join(','))
  })

  it('an expanded element that the new layout lacks is simply closed (no invalid open state)', () => {
    const { rerender } = render(<Harness />)
    fireEvent.click(toggle('Imagem principal'))
    expect(openRows()).toEqual(['hero'])
    const infoLike = { paper: 'Cartão 2', title: 'Título' }
    rerender(<Harness elements={infoLike} defaultOrder={['paper', 'title']} />)
    expect(panels()).toHaveLength(0)
  })
})

describe('ElementLayers — stack order (grip only)', () => {
  it('dragging the grip reorders without toggling the accordion', () => {
    render(<Harness />)
    layoutRows()
    const handle = grip('Imagem principal') // shown row 2 (y 56–84)
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 70 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 42 }) // over row 1
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 42 })
    fireEvent.click(handle) // the click that follows a real mouse drag
    expect(rows()).toEqual(['title', 'hero', 'tape1', 'paper'])
    expect(screen.getByTestId('order').textContent).toBe('paper,tape1,hero,title')
    expect(openRows()).toEqual([])
  })

  it('keeps an expanded element open (same identity) while it is reordered', () => {
    render(<Harness />)
    fireEvent.click(toggle('Imagem principal'))
    fireEvent.keyDown(grip('Imagem principal'), { key: 'ArrowUp' })
    expect(rows()).toEqual(['title', 'hero', 'tape1', 'paper'])
    expect(openRows()).toEqual(['hero'])
  })

  it('targets the row under the pointer even when the list scrolls mid-drag (stationary pointer)', () => {
    render(<Harness />)
    layoutRows()
    const handle = grip('Imagem principal') // row 2 at y 56–84
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 70 })
    // The list scrolls by one row: y 70 is now over shown row 3 (Papel do título).
    layoutRows(28)
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 70 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 70 })
    expect(rows()).toEqual(['title', 'tape1', 'paper', 'hero'])
  })

  it('never lets a grip drag reach the Inspector (propagation stopped)', () => {
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

  it('Ordem padrão restores only the template stack and is disabled while already default', () => {
    render(<Harness />)
    const restore = screen.getByRole('button', { name: 'Ordem padrão' }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    expect(restore.title).toBe('Restaurar ordem de camadas do Template')
    fireEvent.keyDown(grip('Papel do título'), { key: 'ArrowUp' })
    expect(restore.disabled).toBe(false)
    fireEvent.click(restore)
    expect(screen.getByTestId('order').textContent).toBe(DEFAULT.join(','))
    expect(screen.getByTestId('log').textContent).toBe('')
  })
})

describe('ElementLayers — read-only anatomy (Creative Editor Video Static Parity V1)', () => {
  it('lists the stack front-first with no grip, eye, disclosure or restore, and never calls back', () => {
    const calls: string[] = []
    render(
      <ElementLayers
        readOnly
        order={DEFAULT}
        labels={LABELS}
        openId={null}
        isDefault
        onToggle={() => calls.push('toggle')}
        onReorder={() => calls.push('reorder')}
        onRestoreDefault={() => calls.push('restore')}
        renderPanel={() => null}
        onToggleVisibility={() => calls.push('eye')}
        note={<p>gap note</p>}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Título', 'Fita da imagem', 'Imagem principal', 'Papel do título'])
    expect(document.querySelector('[data-layer-grip]')).toBeNull()
    expect(document.querySelector('[data-layer-eye]')).toBeNull()
    expect(document.querySelector('[data-layer-toggle]')).toBeNull()
    expect(screen.queryByText('Ordem padrão')).toBeNull()
    expect(screen.getByText('somente leitura')).toBeTruthy()
    expect(screen.getByText('gap note')).toBeTruthy()
    fireEvent.click(rows[0])
    expect(calls).toEqual([])
  })
})
