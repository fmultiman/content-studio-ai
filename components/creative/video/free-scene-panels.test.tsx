// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1 — the shared free Elementos
 * panel reports disclosure and removal so the host (Static or Video) can keep
 * its bounded selection coherent; the empty state is orientation, not an error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FreeSceneElements } from './free-scene-panels'
import type { FreeSceneComposition } from '@/lib/types'

afterEach(cleanup)

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
})
