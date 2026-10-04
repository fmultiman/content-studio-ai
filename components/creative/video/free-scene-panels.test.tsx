// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1 — the shared free Elementos
 * panel reports disclosure and removal so the host (Static or Video) can keep
 * its bounded selection coherent; the empty state is orientation, not an error.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FreeSceneElements } from './free-scene-panels'
import type { FreeSceneComposition } from '@/lib/types'

afterEach(cleanup)

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => true
})

const TEXT = '11111111-1111-4111-8111-111111111111'
const host = (elements: FreeSceneComposition['elements']) => ({ id: 'slide-1', order: 0, composition: { kind: 'free' as const, elements } })
const text = { id: TEXT, kind: 'text' as const, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, text: 'Olá', typography: 'display' as const, color: 'foreground' as const, align: 'left' as const, size: 'large' as const }

function setup(openId: string | null, elements: FreeSceneComposition['elements'] = [text]) {
  const onOpen = vi.fn()
  const onEdit = vi.fn()
  const onRemoved = vi.fn()
  render(<FreeSceneElements scene={host(elements)} fileNames={new Map()} openId={openId} onOpen={onOpen} onEdit={onEdit} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} onRemoved={onRemoved} wording={{ unit: 'arte', stage: 'do formato da peça' }} />)
  return { onOpen, onEdit, onRemoved }
}

describe('FreeSceneElements (shared free Elementos panel)', () => {
  it('opening a row reports the element id; the open row exposes aria-expanded', () => {
    const { onOpen } = setup(null)
    const toggle = screen.getByTestId('free-element-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(onOpen).toHaveBeenCalledWith(TEXT)
  })

  it('removing the open element closes it AND reports the removal (no stale selection)', () => {
    const { onOpen, onEdit, onRemoved } = setup(TEXT)
    expect(screen.getByTestId('free-element-toggle').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByTestId('free-element-remove'))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(null)
    expect(onRemoved).toHaveBeenCalledWith(TEXT)
  })

  it('removing a closed element still reports it (the host may have it selected elsewhere)', () => {
    const { onOpen, onRemoved } = setup(null)
    fireEvent.click(screen.getByTestId('free-element-remove'))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onRemoved).toHaveBeenCalledWith(TEXT)
  })

  it('the empty state names the unit as a free composition and offers the Template as an option', () => {
    setup(null, [])
    expect(screen.getByTestId('free-scene-empty').textContent).toBe('Arte em branco (composição livre). Adicione um texto ou uma imagem, ou escolha um template na aba Template.')
  })

  it('icon-only element actions carry accessible names', () => {
    setup(null)
    for (const name of ['Ocultar', 'Trazer para frente', 'Enviar para trás', 'Remover elemento']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('Static reorderable mode reuses the front-first grip semantics and commits one array reorder', () => {
    const a = { ...text, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'A' }
    const b = { ...text, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: 'B' }
    const c = { ...text, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', text: 'C' }
    let current = host([a, b, c])
    let view: ReturnType<typeof render>
    const onEdit = vi.fn((edit: (value: typeof current) => typeof current) => {
      current = edit(current)
      view.rerender(<FreeSceneElements scene={current} fileNames={new Map()} openId={null} onOpen={vi.fn()} onEdit={onEdit} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} reorderable wording={{ unit: 'arte', stage: 'do formato da peça' }} />)
    })
    view = render(<FreeSceneElements scene={current} fileNames={new Map()} openId={null} onOpen={vi.fn()} onEdit={onEdit} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} reorderable wording={{ unit: 'arte', stage: 'do formato da peça' }} />)
    const rows = screen.getAllByTestId('free-element')
    rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: index * 28, bottom: index * 28 + 28, height: 28, left: 0, right: 300, width: 300, x: 0, y: index * 28, toJSON: () => ({}) } as DOMRect)))
    expect(rows.map((row) => row.getAttribute('data-element-id'))).toEqual([c.id, b.id, a.id])
    expect(screen.queryByTestId('free-element-forward')).toBeNull()
    expect(screen.queryByTestId('free-element-backward')).toBeNull()

    const grip = screen.getByRole('button', { name: 'Mover C (setas para cima/baixo)' })
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 14 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 90 })
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 90 })
    expect(current.composition.elements.map((element) => element.id)).toEqual([c.id, a.id, b.id])
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('a no-op drop stays clean and the visibility eye remains an independent action', () => {
    const a = { ...text, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'A' }
    const b = { ...text, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', text: 'B' }
    let current = host([a, b])
    let view: ReturnType<typeof render>
    const onEdit = vi.fn((edit: (value: typeof current) => typeof current) => { current = edit(current); view.rerender(<FreeSceneElements scene={current} fileNames={new Map()} openId={null} onOpen={vi.fn()} onEdit={onEdit} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} reorderable wording={{ unit: 'arte', stage: 'do formato da peça' }} />) })
    view = render(<FreeSceneElements scene={current} fileNames={new Map()} openId={null} onOpen={vi.fn()} onEdit={onEdit} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} reorderable wording={{ unit: 'arte', stage: 'do formato da peça' }} />)
    screen.getAllByTestId('free-element').forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ top: index * 28, bottom: index * 28 + 28, height: 28, left: 0, right: 300, width: 300, x: 0, y: index * 28, toJSON: () => ({}) } as DOMRect)))
    const grip = screen.getByRole('button', { name: 'Mover B (setas para cima/baixo)' })
    fireEvent.pointerDown(grip, { button: 0, pointerId: 2, clientY: 14 })
    fireEvent.pointerUp(grip, { pointerId: 2, clientY: 14 })
    expect(onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByTestId('free-element-visibility')[0])
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(current.composition.elements.find((element) => element.id === b.id)?.hidden).toBe(true)
  })
})
