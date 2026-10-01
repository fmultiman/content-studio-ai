// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — destructive-switch
 * semantics at the UI boundary: an empty free composition enters a Template
 * directly; a populated one (and every Template → free switch) asks first;
 * cancelling changes nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CompositionModePanel } from './composition-mode-panel'

afterEach(cleanup)

const TEMPLATES = [{ id: 'editorial-documentary-collage-v1', name: 'Editorial Documentary Collage', description: 'Colagem documental.' }]

function setup(props: { mode: 'free' | 'template'; freeHasContent: boolean }) {
  const onChooseTemplate = vi.fn()
  const onChooseFree = vi.fn()
  render(
    <CompositionModePanel mode={props.mode} templates={TEMPLATES} currentTemplateId={props.mode === 'template' ? TEMPLATES[0].id : null} scope="desta peça" freeHasContent={props.freeHasContent} onChooseTemplate={onChooseTemplate} onChooseFree={onChooseFree}>
      <p>controles do template</p>
    </CompositionModePanel>,
  )
  return { onChooseTemplate, onChooseFree }
}

describe('CompositionModePanel', () => {
  it('states FREE truthfully and lists registry Templates (no Blank entry)', () => {
    setup({ mode: 'free', freeHasContent: false })
    expect(screen.getByTestId('composition-mode-state').textContent).toBe('Composição livre')
    expect(screen.getAllByTestId('composition-mode-template').map((button) => button.getAttribute('data-template-id'))).toEqual(['editorial-documentary-collage-v1'])
    expect(screen.queryByText(/controles do template/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Em branco|Blank/)
    // CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1: each Template choice is named for assistive technology.
    expect(screen.getByRole('button', { name: 'Usar o template Editorial Documentary Collage' })).toBeTruthy()
  })

  it('A. empty free → Template switches directly (nothing to lose)', () => {
    const { onChooseTemplate } = setup({ mode: 'free', freeHasContent: false })
    fireEvent.click(screen.getByTestId('composition-mode-template'))
    expect(onChooseTemplate).toHaveBeenCalledWith('editorial-documentary-collage-v1')
    expect(screen.queryByTestId('composition-mode-confirm')).toBeNull()
  })

  it('B. populated free → Template asks; Cancel keeps free; Substituir replaces', () => {
    const { onChooseTemplate } = setup({ mode: 'free', freeHasContent: true })
    fireEvent.click(screen.getByTestId('composition-mode-template'))
    expect(screen.getByTestId('composition-mode-confirm').textContent).toMatch(/elementos livres desta peça serão descartados/)
    fireEvent.click(screen.getByTestId('composition-mode-cancel'))
    expect(onChooseTemplate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('composition-mode-template'))
    fireEvent.click(screen.getByTestId('composition-mode-confirm-action'))
    expect(onChooseTemplate).toHaveBeenCalledTimes(1)
  })

  it('C. Template → free always asks (authored Template state would be lost)', () => {
    const { onChooseFree } = setup({ mode: 'template', freeHasContent: false })
    expect(screen.getByTestId('composition-mode-state').textContent).toBe('Template')
    expect(screen.getByText('controles do template')).toBeTruthy()
    fireEvent.click(screen.getByTestId('composition-mode-free'))
    expect(screen.getByTestId('composition-mode-confirm').textContent).toMatch(/substituída por uma composição livre em branco/)
    fireEvent.click(screen.getByTestId('composition-mode-cancel'))
    expect(onChooseFree).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('composition-mode-free'))
    fireEvent.click(screen.getByTestId('composition-mode-confirm-action'))
    expect(onChooseFree).toHaveBeenCalledTimes(1)
  })
})
