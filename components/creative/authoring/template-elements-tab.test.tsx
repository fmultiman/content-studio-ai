// @vitest-environment jsdom
/**
 * STATIC_TEMPLATE_ANATOMY_TREE_V1 — Template-mode Elementos tab: Sections over the
 * Layout's real Elements, separate ADICIONAR / ELEMENTOS ADICIONADOS, truthful
 * empty state, capabilities preserved, UI-only expansion, paint order untouched.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TemplateElementsTab } from './template-elements-tab'
import { FreeSceneElements } from '@/components/creative/video/free-scene-panels'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'
import type { FreeSceneComposition } from '@/lib/types'

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => true
})
afterEach(cleanup)

const TEXT_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'
const customText = { id: TEXT_ID, kind: 'text' as const, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, text: 'Meu texto', typography: 'display' as const, color: 'foreground' as const, align: 'left' as const, size: 'large' as const }
const customImage = { id: IMAGE_ID, kind: 'image' as const, box: { x: 0.1, y: 0.4, width: 0.5, height: 0.3 }, library_file_id: 'file-1', fit: 'cover' as const }

function setup(layoutId = 'cover', { custom = [] as FreeSceneComposition['elements'], openId = null as string | null, hiddenIds = [] as string[] } = {}) {
  const layout = getTemplateLayout(TEMPLATE, layoutId)!
  const spies = { onToggle: vi.fn(), onToggleVisibility: vi.fn(), onReorder: vi.fn(), onRestoreDefault: vi.fn(), onAddText: vi.fn(), onAddImage: vi.fn(), onEdit: vi.fn(), onOpen: vi.fn() }
  const labels = Object.fromEntries(layout.elements.map((element) => [element.id, element.label]))
  const view = render(
    <TemplateElementsTab
      layoutLabel={layout.label}
      sections={resolveLayoutSections(TEMPLATE, layout)}
      order={layout.defaultStackOrder}
      labels={labels}
      openId={openId}
      isDefaultOrder
      hidden={new Set(hiddenIds)}
      onToggle={spies.onToggle}
      onToggleVisibility={spies.onToggleVisibility}
      onReorder={spies.onReorder}
      onRestoreDefault={spies.onRestoreDefault}
      renderPanel={(id) => <div data-testid={`panel-${id}`}>controles de {id}</div>}
      custom={{ scene: { id: 'custom', composition: { kind: 'free', elements: custom } }, fileNames: new Map([['file-1', 'foto.png']]), openId: null, onOpen: spies.onOpen, onEdit: spies.onEdit, onAddText: spies.onAddText, onAddImage: spies.onAddImage, onReplaceImage: vi.fn(), wording: { unit: 'slide', stage: 'do formato da peça' } }}
    />,
  )
  return { layout, spies, ...view }
}

const sectionEl = (id: string) => document.querySelector(`[data-section-id="${id}"]`) as HTMLElement
const rowIds = (root: ParentNode) => [...root.querySelectorAll('[data-layer-id]')].map((row) => row.getAttribute('data-layer-id'))

describe('anatomy tree per Layout', () => {
  for (const layout of TEMPLATE.layouts) {
    it(`${layout.id}: shows each Section with exactly the layout's real Elements`, () => {
      setup(layout.id)
      const tree = screen.getByTestId('template-anatomy-tree')
      expect([...rowIds(tree)].sort()).toEqual(layout.elements.map((element) => element.id).sort())
      for (const section of resolveLayoutSections(TEMPLATE, layout)) expect(rowIds(sectionEl(section.id))).toEqual(section.elements.map((element) => element.id))
    })
  }

  it('Cover reads as Cabeçalho / Bloco de título / Introdução / Fonte editorial / Hero / Nota editorial / Assinatura / Decoração', () => {
    setup('cover')
    const labels = screen.getAllByTestId('anatomy-section-toggle').map((button) => button.textContent)
    expect(labels).toEqual(['Cabeçalho1', 'Bloco de título2', 'Introdução1', 'Fonte editorial1', 'Hero2', 'Nota editorial3', 'Assinatura1', 'Decoração4'])
  })

  it('does not expose internal chrome as Elements (only registered Element ids appear)', () => {
    const { layout } = setup('info')
    const known = new Set(layout.elements.map((element) => element.id))
    for (const id of rowIds(screen.getByTestId('template-anatomy-tree'))) expect(known.has(id as string)).toBe(true)
  })
})

describe('existing Template Element capabilities are preserved', () => {
  it('an open row renders its own control panel; row/eye use the existing callbacks', () => {
    const { spies } = setup('cover', { openId: 'hero' })
    expect(screen.getByTestId('panel-hero').textContent).toBe('controles de hero')
    const titleRow = within(sectionEl('title-block')).getByText('Título').closest('button') as HTMLElement
    fireEvent.click(titleRow)
    expect(spies.onToggle).toHaveBeenCalledWith('title')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar Imagem principal' }))
    expect(spies.onToggleVisibility).toHaveBeenCalledWith('hero')
  })

  it('a hidden Element stays listed and offers "Mostrar"', () => {
    setup('cover', { hiddenIds: ['tape1'] })
    expect(screen.getByRole('button', { name: 'Mostrar Fita da imagem' })).toBeTruthy()
  })

  it('adds no lock affordance and no invented controls to any row', () => {
    setup('cover')
    expect(screen.queryByLabelText(/bloquear|desbloquear|lock/i)).toBeNull()
    for (const row of document.querySelectorAll('[data-testid="template-anatomy-tree"] [data-layer-id]')) expect(row.querySelectorAll('button')).toHaveLength(2)
  })
})

describe('Sections are UI-only', () => {
  it('expanding / collapsing a Section fires no authoring callback', () => {
    const { spies } = setup('cover')
    const toggle = within(sectionEl('decoration')).getByTestId('anatomy-section-toggle')
    fireEvent.click(toggle)
    expect(sectionEl('decoration').getAttribute('data-expanded')).toBe('false')
    expect(rowIds(sectionEl('decoration'))).toEqual([])
    fireEvent.click(toggle)
    expect(sectionEl('decoration').getAttribute('data-expanded')).toBe('true')
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
  })
})

describe('paint order stays real and editable', () => {
  it('"Ordem das camadas" lists the true back→front stack (front first) and reorders through the same callback', () => {
    const { layout, spies } = setup('cover')
    fireEvent.click(screen.getByTestId('template-layer-order-toggle'))
    const order = screen.getByTestId('template-layer-order')
    expect(rowIds(order)).toEqual([...layout.defaultStackOrder].reverse())
    expect(within(order).getByText('Frente')).toBeTruthy()
    expect(within(order).getByText('Trás')).toBeTruthy()
    const grips = order.querySelectorAll<HTMLButtonElement>('[data-layer-grip]')
    fireEvent.keyDown(grips[1], { key: 'ArrowUp' })
    const expected = [...layout.defaultStackOrder]
    const last = expected.length - 1
    ;[expected[last], expected[last - 1]] = [expected[last - 1], expected[last]]
    expect(spies.onReorder).toHaveBeenCalledWith(expected)
    expect(order.querySelector('[data-layer-eye]')).toBeNull()
  })
})

describe('ADICIONAR ELEMENTOS vs ELEMENTOS ADICIONADOS', () => {
  it('add buttons live under Adicionar elementos, not under Elementos adicionados', () => {
    const { spies } = setup('cover')
    const add = screen.getByTestId('add-elements')
    expect(within(add).getByRole('heading', { name: 'Adicionar elementos' })).toBeTruthy()
    fireEvent.click(within(add).getByTestId('free-add-text'))
    fireEvent.click(within(add).getByTestId('free-add-image'))
    expect(spies.onAddText).toHaveBeenCalledTimes(1)
    expect(spies.onAddImage).toHaveBeenCalledTimes(1)
    expect(within(screen.getByTestId('added-elements')).queryByTestId('free-add-text')).toBeNull()
    expect(within(screen.getByTestId('added-elements')).queryByTestId('free-add-image')).toBeNull()
  })

  it('a Template without Custom Elements shows a truthful empty state — never "em branco (composição livre)"', () => {
    setup('cover')
    const added = screen.getByTestId('added-elements')
    expect(within(added).getByRole('heading', { name: 'Elementos adicionados' })).toBeTruthy()
    expect(within(added).getByTestId('free-scene-empty').textContent).toMatch(/Nenhum elemento adicionado/)
    expect(document.body.textContent).not.toMatch(/em branco/i)
    expect(document.body.textContent).not.toMatch(/composição livre/i)
  })

  it('Custom Elements appear only under Elementos adicionados, separate from Template anatomy', () => {
    setup('cover', { custom: [customText, customImage] })
    const added = screen.getByTestId('added-elements')
    expect([...added.querySelectorAll('[data-testid="free-element"]')].map((li) => li.getAttribute('data-element-id'))).toEqual([IMAGE_ID, TEXT_ID])
    const tree = screen.getByTestId('template-anatomy-tree')
    expect(tree.textContent).not.toContain('Meu texto')
    expect(rowIds(tree)).not.toContain(TEXT_ID)
    expect(within(added).queryByTestId('free-scene-empty')).toBeNull()
  })
})

describe('Free / Video panel is unchanged', () => {
  const host = (elements: FreeSceneComposition['elements']) => ({ id: 'slide-1', order: 0, composition: { kind: 'free' as const, elements } })
  it('default FreeSceneElements keeps its add buttons with the list and the "em branco" orientation', () => {
    render(<FreeSceneElements scene={host([])} fileNames={new Map()} openId={null} onOpen={vi.fn()} onEdit={vi.fn()} onAddText={vi.fn()} onAddImage={vi.fn()} onReplaceImage={vi.fn()} wording={{ unit: 'slide', stage: 'do formato da peça' }} />)
    expect(screen.getByTestId('free-add-text')).toBeTruthy()
    expect(screen.getByTestId('free-add-image')).toBeTruthy()
    expect(screen.getByTestId('free-scene-empty').textContent).toBe('Slide em branco (composição livre). Adicione um texto ou uma imagem, ou escolha um template na aba Template.')
    expect(screen.getByTestId('free-scene-elements-note')).toBeTruthy()
  })
})
