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
  it('Hero: position sliders only — the frame is its own Element now, so there is no frame toggle inside the Hero panel', () => {
    render(<Harness elementId="hero" />)
    expect(screen.getAllByRole('slider').map((slider) => slider.getAttribute('aria-label'))).toEqual(['Posição X', 'Posição Y', 'Rotação', 'Escala'])
    expect(screen.queryByTestId('hero-frame-toggle')).toBeNull()
    expect(tuning().hero).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 })
  })

  it('Moldura da imagem principal: no spatial control; it follows the image and says hiding one never hides the other', () => {
    render(<Harness elementId="heroFrame" />)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    const note = screen.getByTestId('follows-owner-note').textContent as string
    expect(note).toContain('“Imagem principal”')
    expect(note).toContain('ocultar “Imagem principal” não oculta este')
  })

  it('a fixed-geometry atom (Info: Texto principal) offers visibility/order only and points the text to Conteúdo', () => {
    const info = getTemplateLayout(TEMPLATE, 'info')!
    render(<TemplateElementPanel elementId="bodyText" state={{ ...initial(), variant: 'info' }} layout={info} elements={elementsForVariant('info')} dispatch={() => {}} />)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    expect(screen.getByTestId('fixed-element-note').textContent).toContain('Posição fixa do Template')
    expect(screen.getByTestId('fixed-element-note').textContent).toContain('Conteúdo')
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

  it('Logo da marca: positioned, and says where each part comes from (logo = Template, replaceable in Assets; name = Project); the panel itself has no replace button', () => {
    render(<Harness elementId="brandLogo" />)
    expect(screen.getAllByRole('slider')).toHaveLength(3)
    const note = screen.getByTestId('brand-ownership-note').textContent as string
    expect(note).toContain('Portal Comunidades Alternativas')
    expect(note).toContain('O logo vem do Template e pode ser trocado em Assets')
    expect(note).toContain('vem do Projeto')
    expect(screen.queryByRole('button', { name: /trocar/i })).toBeNull()
  })

  it('Nome da marca: follows the logo position, independent visibility', () => {
    render(<Harness elementId="brandName" />)
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    expect(screen.getByTestId('follows-owner-note').textContent).toContain('“Logo da marca”')
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
