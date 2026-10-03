// @vitest-environment jsdom
/**
 * COVER_ELEMENT_COMPLETENESS_V1 — the Template Element panel offers only controls the Element's
 * contract supports, and the Cover Content tab exposes every authored Cover string by role.
 * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — follows / fixed atoms say so, hide independently and
 * never offer a spatial control they cannot honour.
 */
import { useReducer } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TemplateElementPanel } from './template-element-panel'
import { LayoutContentForm } from './layout-content-form'
import { authoringReducer, createTemplateSlide, persistedSlideToAuthoringState, type AuthoringProductContext, type AuthoringState } from '@/lib/creative/authoring'
import { elementsForVariant } from '@/lib/creative/authoring/editor-workspace'
import { STATIC_COVER_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { DocumentaryCardCoverContentSchema } from '@/lib/schemas/creative/documentary-card'
import type { SlotResource } from '@/lib/creative/authoring/asset-slots'

afterEach(cleanup)

const productContext = {
  projectId: 'p', projectName: 'Portal Comunidades Alternativas', productionId: null, productionTitle: null, editorialContentId: 'e', editorialContentTitle: 'e',
  channelPieceId: 'c', channel: 'instagram', format: 'carousel', primitiveProjectRef: 'project:portal-comunidades-alternativas',
  projectIdentity: { schema_version: 1 }, identitySnapshot: { schema_version: 'visual-tokens.v0', snapshot_ref: 's', typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } }, colors: { background: '#fff', foreground: '#000' }, spacing: { unit: 8 } },
} as unknown as AuthoringProductContext
const initial = (): AuthoringState => persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: null })!, productContext, 'portrait')

function Harness({ elementId }: { elementId: string }) {
  const [state, dispatch] = useReducer(authoringReducer, undefined, initial)
  return (
    <div>
      <TemplateElementPanel elementId={elementId} state={state} layout={getTemplateLayout(TEMPLATE, 'cover')} elements={elementsForVariant('cover')} dispatch={dispatch} />
      <pre data-testid="tuning">{JSON.stringify(state.tuning)}</pre>
    </div>
  )
}
const tuning = () => JSON.parse(screen.getByTestId('tuning').textContent as string)

describe('TemplateElementPanel', () => {
  it('Hero: the visual baseline (position, rotation, size, opacity) — the frame is its own Element now, so there is no frame toggle inside the Hero panel', () => {
    render(<Harness elementId="hero" />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala', 'Opacidade'])
    expect(screen.queryByTestId('hero-frame-toggle')).toBeNull()
    expect(tuning().hero).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 })
  })

  it('the Cover Hero has no backing/moldura Element to point at (CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1)', () => {
    expect(getTemplateLayout(TEMPLATE, 'cover')!.elements.some((element) => element.id === 'heroFrame')).toBe(false)
  })

  it('a formerly fixed text (Info: Texto principal) now has Posição X/Y + Rotação in tuning.body; Restaurar removes it', () => {
    function InfoHarness() {
      const [state, dispatch] = useReducer(authoringReducer, undefined, () => ({ ...initial(), variant: 'info' as const }))
      return (
        <div>
          <TemplateElementPanel elementId="bodyText" state={state} layout={getTemplateLayout(TEMPLATE, 'info')} elements={elementsForVariant('info')} dispatch={dispatch} />
          <pre data-testid="tuning">{JSON.stringify(state.tuning)}</pre>
        </div>
      )
    }
    render(<InfoHarness />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação'])
    expect(screen.queryByTestId('fixed-element-note')).toBeNull()
    fireEvent.change(screen.getByLabelText('Posição Y'), { target: { value: '9' } })
    expect(tuning().body).toEqual({ offsetX: 0, offsetY: 9, rotation: 0 })
    fireEvent.click(screen.getByText('Restaurar elemento'))
    expect(tuning()).not.toHaveProperty('body')
  })

  it('the panel has no fixed-geometry branch left in the Template: a (hypothetical) fixed control still renders only its note and offers no control', () => {
    const elements = [{ key: 'x', label: 'X', control: { type: 'fixed' as const } }]
    render(<TemplateElementPanel elementId="x" state={initial()} layout={null} elements={elements} dispatch={() => {}} />)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    expect(screen.getByTestId('fixed-element-note').textContent).toContain('Posição fixa do Template')
  })

  it('Introdução / Chamada: only X, Y and rotation (no scale, opacity, size or Entrelinha); the change creates the optional group, Restaurar removes it', () => {
    render(<Harness elementId="intro" />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação'])
    expect(screen.queryByLabelText('Entrelinha')).toBeNull()
    fireEvent.change(screen.getByLabelText('Posição X'), { target: { value: '12' } })
    expect(tuning().intro).toEqual({ offsetX: 12, offsetY: 0, rotation: 0 })
    fireEvent.click(screen.getByText('Restaurar elemento'))
    expect(tuning()).not.toHaveProperty('intro')
  })

  it('Título no longer shows Entrelinha in Elementos (it lives in Estilos); Fonte editorial is positioned by the shared source group', () => {
    const { unmount } = render(<Harness elementId="title" />)
    expect(screen.queryByLabelText('Entrelinha')).toBeNull()
    unmount()
    render(<Harness elementId="source" />)
    fireEvent.change(screen.getByLabelText('Rotação'), { target: { value: '1' } })
    expect(tuning().source.rotation).toBe(1)
    expect(screen.queryByLabelText('Entrelinha')).toBeNull()
  })

  it('Logo da marca: the full visual baseline incl. Escala, and says where each part comes from (logo = Template, replaceable in Assets; name = Project); the panel itself has no replace button', () => {
    render(<Harness elementId="brandLogo" />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala', 'Opacidade'])
    const note = screen.getByTestId('brand-ownership-note').textContent as string
    expect(note).toContain('Portal Comunidades Alternativas')
    expect(note).toContain('O logo vem do Template e pode ser trocado em Assets')
    expect(note).toContain('vem do Projeto')
    expect(screen.queryByRole('button', { name: /trocar/i })).toBeNull()
  })

  it('Logo da marca: moving the Escala slider stores Size in the existing brand tuning; Restaurar elemento removes it entirely (CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1)', () => {
    render(<Harness elementId="brandLogo" />)
    const scale = screen.getByLabelText('Escala') as HTMLInputElement
    expect(scale.value).toBe('1')
    expect(Number(scale.max)).toBeGreaterThan(1)
    fireEvent.change(scale, { target: { value: '1.8' } })
    expect(tuning().brand).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1.8 })
    expect((screen.getByLabelText('Escala') as HTMLInputElement).value).toBe('1.8')
    fireEvent.change(screen.getByLabelText('Opacidade'), { target: { value: '0.5' } })
    expect(tuning().brand).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1.8, opacity: 0.5 })
    fireEvent.click(screen.getByText('Restaurar elemento'))
    expect(tuning()).not.toHaveProperty('brand')
    expect((screen.getByLabelText('Escala') as HTMLInputElement).value).toBe('1')
  })

  it('Hero: Opacidade is stored in tuning.hero and reset drops it; Escala keeps its existing range', () => {
    render(<Harness elementId="hero" />)
    const scale = screen.getByLabelText('Escala') as HTMLInputElement
    expect([scale.min, scale.max]).toEqual(['0.9', '1.15'])
    fireEvent.change(screen.getByLabelText('Opacidade'), { target: { value: '0.4' } })
    expect(tuning().hero).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1, opacity: 0.4 })
    fireEvent.click(screen.getByText('Restaurar elemento'))
    expect(tuning().hero).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 })
  })

  it('resource section follows the class: image/brand/material say which resource is used; procedural says it is Template-generated (no replace); text shows none', () => {
    const resource = { name: 'Logo completo.png', origin: 'project' } as unknown as SlotResource
    const { unmount } = render(<TemplateElementPanel elementId="brandLogo" state={initial()} layout={getTemplateLayout(TEMPLATE, 'cover')} elements={elementsForVariant('cover')} dispatch={() => {}} resource={resource} />)
    expect(screen.getByText('Recurso usado')).toBeTruthy()
    expect(screen.getByText('Logo completo.png')).toBeTruthy()
    unmount()
    const list = getTemplateLayout(TEMPLATE, 'list')!
    const listState = { ...initial(), variant: 'list' as const }
    const { unmount: unmountFrame } = render(<TemplateElementPanel elementId="heroFrame" state={listState} layout={list} elements={elementsForVariant('list')} dispatch={() => {}} />)
    expect(screen.getByText('Gerado pelo Template')).toBeTruthy()
    expect(screen.queryByText('Recurso usado')).toBeNull()
    unmountFrame()
    const { unmount: unmountMap } = render(<TemplateElementPanel elementId="map" state={{ ...initial(), variant: 'map' as const }} layout={getTemplateLayout(TEMPLATE, 'map')} elements={elementsForVariant('map')} dispatch={() => {}} />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala', 'Opacidade'])
    expect(screen.getByText('Gerado pelo Template')).toBeTruthy()
    unmountMap()
    render(<Harness elementId="title" />)
    expect(screen.queryByText('Recurso usado')).toBeNull()
    expect(screen.queryByText('Gerado pelo Template')).toBeNull()
  })

  it('a follows Element names its owner and shares its opacity (the only kind of exception the Template has)', () => {
    render(<Harness elementId="noteText" />)
    expect(screen.getByTestId('follows-owner-note').textContent).toContain('a opacidade de “Papel da nota”')
  })

  it('there is no separate Nome da marca Element: the signature is the one complete logo', () => {
    expect(getTemplateLayout(TEMPLATE, 'cover')!.elements.some((element) => element.id === 'brandName')).toBe(false)
  })

  it('Nota da edição (the note text): no spatial control at all; it names its owner and where the text is edited', () => {
    render(<Harness elementId="noteText" />)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    const note = screen.getByTestId('follows-owner-note').textContent as string
    expect(note).toContain('“Papel da nota”')
    expect(note).toContain('ocultar “Papel da nota” não oculta este')
    expect(note).toContain('ocultar este não oculta “Papel da nota”')
    expect(note).toContain('Conteúdo (Nota da edição)')
  })

  it('Papel da nota keeps its material transform sliders', () => {
    render(<Harness elementId="note" />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala', 'Opacidade'])
  })
})

describe('Cover Content tab (Static)', () => {
  function Content() {
    const [state, dispatch] = useReducer(authoringReducer, undefined, initial)
    return (
      <div>
        <LayoutContentForm fields={STATIC_COVER_CONTENT_FIELDS} content={state.contentOverride} dispatch={dispatch} />
        <pre data-testid="content">{JSON.stringify(state.contentOverride)}</pre>
      </div>
    )
  }
  const content = () => JSON.parse(screen.getByTestId('content').textContent as string)

  it('shows every authored Cover string by its role (no generic "Texto") and bounds each input to the schema', () => {
    render(<Content />)
    for (const [label, max] of [['Chamada (kicker)', 48], ['Título', 120], ['Introdução', 220], ['Fonte editorial', 160], ['Nota da edição', 240]] as const) {
      const input = screen.getByLabelText(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`)) as HTMLTextAreaElement
      expect(input.maxLength).toBe(max)
    }
    expect(screen.queryByLabelText('Texto')).toBeNull()
    expect((screen.getByLabelText(/^Introdução/) as HTMLTextAreaElement).value).toContain('Uma pergunta lançada num país em transição')
    expect((screen.getByLabelText(/^Fonte editorial/) as HTMLTextAreaElement).value).toBe('Publicado originalmente em 1983.')
    expect((screen.getByLabelText(/^Chamada/) as HTMLTextAreaElement).value).toBe('Memória viva • Livros')
    expect((screen.getByLabelText(/^Nota da edição/) as HTMLTextAreaElement).value).toContain('Edição apresentada')
  })

  it('editing one field changes only that field; clearing an optional one removes it and the content stays schema-valid', () => {
    render(<Content />)
    fireEvent.change(screen.getByLabelText(/^Introdução/), { target: { value: 'Outra introdução' } })
    expect(content().subtitle).toBe('Outra introdução')
    expect(content().source_line).toBe('Publicado originalmente em 1983.')
    fireEvent.change(screen.getByLabelText(/^Fonte editorial/), { target: { value: '' } })
    expect(content()).not.toHaveProperty('source_line')
    expect(DocumentaryCardCoverContentSchema.safeParse(content()).success).toBe(true)
  })
})
