// @vitest-environment jsdom
/**
 * Portal Carousel Completion V1 — Content tab for the structured layouts:
 * descriptor-driven fields dispatch bounded content actions and edits land
 * in the slide's content through the real reducer.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LayoutContentForm } from './layout-content-form'
import { LAYOUT_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { authoringReducer, createInitialAuthoringState, type AuthoringState, type AuthoringVariant } from '@/lib/creative/authoring'

afterEach(cleanup)

function Harness({ variant }: { variant: AuthoringVariant }) {
  const [state, setState] = useState<AuthoringState>(() => createInitialAuthoringState(variant, 'a', 'portrait'))
  return (
    <>
      <LayoutContentForm fields={LAYOUT_CONTENT_FIELDS[variant]!} content={state.contentOverride} dispatch={(action) => setState((current) => authoringReducer(current, action))} />
      <output data-testid="content">{JSON.stringify(state.contentOverride)}</output>
    </>
  )
}

const content = () => JSON.parse(screen.getByTestId('content').textContent ?? '{}')

// Many Radix Selects render slowly in jsdom.
describe('LayoutContentForm', { timeout: 30000 }, () => {
  it('Grade: edits a tile label and respects the 2..6 tile bound', () => {
    render(<Harness variant="grid" />)
    const tiles = screen.getByTestId('content-list-tiles')
    expect(within(tiles).getByText('Temas (6/6)')).toBeTruthy()
    expect((within(tiles).getByRole('button', { name: /Adicionar tema/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(tiles).getAllByLabelText('Rótulo')[0], { target: { value: 'rurais e agrícolas' } })
    expect(content().tiles[0]).toEqual({ icon: 'tree', label: 'rurais e agrícolas' })
    fireEvent.click(within(tiles).getByRole('button', { name: 'Remover tema 6' }))
    expect(content().tiles).toHaveLength(5)
  })

  it('an optional text cleared is removed from the content (schema min(1) when present)', () => {
    render(<Harness variant="quote" />)
    fireEvent.change(screen.getByLabelText(/Destaque final/), { target: { value: '' } })
    expect('callout' in content()).toBe(false)
    expect(content().quote).toBe('Isso não diminui o valor do livro. Muda a forma de lê-lo.')
  })

  it('Rede: the callout group can be left out and put back', () => {
    render(<Harness variant="network" />)
    const group = screen.getByTestId('content-group-callout')
    const toggle = within(group).getByRole('checkbox') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect('callout' in content()).toBe(false)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(content().callout).toEqual({ icon: 'radio', text: 'Texto do destaque' })
  })

  it('Mapa: places stay within 1..12 and use UF selects', () => {
    render(<Harness variant="map" />)
    const places = screen.getByTestId('content-list-places')
    expect(within(places).getByText('Lugares (10/12)')).toBeTruthy()
    fireEvent.click(within(places).getByRole('button', { name: /Adicionar lugar/ }))
    expect(content().places).toHaveLength(11)
    expect(content().places[10]).toEqual({ name: 'Novo lugar', uf: 'SP' })
    expect(within(places).getAllByRole('combobox', { name: 'UF' })).toHaveLength(11)
  })

  it('Lista: never removes below 2 items', () => {
    render(<Harness variant="list" />)
    const items = screen.getByTestId('content-list-items')
    fireEvent.click(within(items).getByRole('button', { name: 'Remover item 3' }))
    expect(content().items).toHaveLength(2)
    expect((within(items).getByRole('button', { name: 'Remover item 1' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
