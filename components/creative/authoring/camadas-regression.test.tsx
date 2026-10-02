// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — Camadas is NOT changed by the Anatomy display-order fix.
 * Regression only: with the real Cover registry, the tab still lists the factual paint order front-first and
 * keeps its supported reordering.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ElementLayers } from './element-layers'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => true
})
afterEach(cleanup)

const COVER = getTemplateLayout(TEMPLATE, 'cover')!
const labels = Object.fromEntries(COVER.elements.map((element) => [element.id, element.label]))
const rows = () => within(screen.getByTestId('element-layers')).getAllByRole('listitem').map((row) => row.getAttribute('data-layer-id'))

describe('Camadas — real Cover registry', () => {
  it('28/29. lists the factual stack front-first (reverse of the paint order), not the Anatomy order', () => {
    render(<ElementLayers order={[...COVER.defaultStackOrder]} labels={labels} openId={null} isDefault onToggle={() => {}} onReorder={() => {}} onRestoreDefault={() => {}} renderPanel={() => null} />)
    expect(rows()).toEqual([...COVER.defaultStackOrder].reverse())
    // the Hero's tape is above the image here because it is painted above it; the removed backing / name atoms are not rows
    expect(rows()).not.toContain('heroFrame')
    expect(rows()).not.toContain('brandName')
    expect(rows().indexOf('tape1')).toBeLessThan(rows().indexOf('hero'))
  })

  it('30. the supported keyboard reorder still emits the moved stack', () => {
    const onReorder = vi.fn()
    render(<ElementLayers order={[...COVER.defaultStackOrder]} labels={labels} openId={null} isDefault onToggle={() => {}} onReorder={onReorder} onRestoreDefault={() => {}} renderPanel={() => null} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mover Imagem principal (setas para cima/baixo)' }), { key: 'ArrowUp' })
    expect(onReorder).toHaveBeenCalledTimes(1)
    const next = onReorder.mock.calls[0][0] as string[]
    const from = COVER.defaultStackOrder.indexOf('hero')
    expect(next.indexOf('hero')).toBe(from + 1)
    expect(next.indexOf('botanical')).toBe(from)
  })
})
