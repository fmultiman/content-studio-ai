// @vitest-environment jsdom
/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — ESTILOS follows the selection and edits only HOW a text looks:
 * effective default → optional local override, reversible with "Usar padrão". Selection alone never edits anything.
 */
import { useReducer, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { StylesTab, type StylesTarget } from './styles-tab'
import { FreeSceneElements } from '@/components/creative/video/free-scene-panels'
import { authoringReducer, createTemplateSlide, persistedSlideToAuthoringState, type AuthoringProductContext, type AuthoringState } from '@/lib/creative/authoring'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { RUNTIME_FONT_FAMILIES } from '@/lib/creative/typography/resolve-typography'
import { freeElements, updateFreeElement, type FreeTextPatch } from '@/lib/creative/video-editor/free-composition'
import type { FreeSceneComposition, FreeSceneElement, FreeTextElement } from '@/lib/types'

afterEach(cleanup)

const productContext = {
  projectId: 'p', projectName: 'Portal Comunidades Alternativas', productionId: null, productionTitle: null, editorialContentId: 'e', editorialContentTitle: 'e',
  channelPieceId: 'c', channel: 'instagram', format: 'carousel', primitiveProjectRef: 'project:portal-comunidades-alternativas',
  projectIdentity: { schema_version: 1 },
  identitySnapshot: { schema_version: 'visual-tokens.v0', snapshot_ref: 's', typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } }, colors: { background: '#F6F0E4', foreground: '#16352F' }, spacing: { unit: 8 } },
} as unknown as AuthoringProductContext
const tokens = productContext.identitySnapshot
const cover = (): AuthoringState => persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: null })!, productContext, 'portrait')
const CUSTOM_ID = '11111111-1111-4111-8111-111111111111'
const TEXT: FreeTextElement = { id: CUSTOM_ID, kind: 'text', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, text: 'Texto livre', typography: 'body', color: 'foreground', align: 'left', size: 'medium' }
const IMAGE: FreeSceneElement = { id: '22222222-2222-4222-8222-222222222222', kind: 'image', box: { x: 0, y: 0, width: 1, height: 0.5 }, library_file_id: '33333333-3333-4333-8333-333333333333', fit: 'cover' }

function TemplateHarness({ initialTarget, custom = [] }: { initialTarget: StylesTarget | null; custom?: FreeSceneElement[] }) {
  const [state, dispatch] = useReducer(authoringReducer, undefined, () => ({ ...cover(), elements: custom }))
  const [elements, setElements] = useState<FreeSceneElement[]>(custom)
  const layout = getTemplateLayout(TEMPLATE, 'cover')
  return (
    <div>
      <StylesTab
        tokens={tokens}
        target={initialTarget}
        template={{ layout, state, dispatch }}
        freeElements={elements}
        onPatchFreeText={(id, patch) => setElements((current) => freeElements(updateFreeElement({ id: 'host', composition: { kind: 'free', elements: current } as FreeSceneComposition }, id, patch)))}
      />
      <pre data-testid="state">{JSON.stringify({ typography: state.typography ?? null, title: state.tuning.title, elements })}</pre>
    </div>
  )
}
const snapshot = () => JSON.parse(screen.getByTestId('state').textContent as string) as { typography: Record<string, { fontFamily?: string; fontSizePx?: number }> | null; title: { lineHeight?: number }; elements: FreeTextElement[] }
const headline = () => screen.getByTestId('style-headline').textContent

describe('ESTILOS follows the selection', () => {
  it('no selection → ESTILOS DA COMPOSIÇÃO: the inherited Identity facts, no element controls', () => {
    render(<TemplateHarness initialTarget={null} />)
    expect(headline()).toBe('ESTILOS DA COMPOSIÇÃO')
    expect(screen.getByTestId('style-source').textContent).toContain('Fraunces')
    expect(screen.queryByTestId('font-family-picker')).toBeNull()
    expect(screen.queryByTestId('font-size-input')).toBeNull()
  })

  it('Template Title → ESTILOS · TÍTULO with font, numeric size and Entrelinha', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    expect(headline()).toBe('ESTILOS · TÍTULO')
    expect(screen.getByTestId('font-family-picker')).toBeTruthy()
    expect((screen.getByTestId('font-size-input') as HTMLInputElement).value).toBe('62')
    expect(screen.getByLabelText('Entrelinha')).toBeTruthy()
    expect(screen.queryByTestId('text-style-reset')).toBeNull()
  })

  it('another Template text Element (Introdução / Chamada / Fonte editorial) → its own contextual Styles, without Entrelinha', () => {
    for (const [id, label, size] of [['intro', 'INTRODUÇÃO', '30'], ['kicker', 'CHAMADA', '21'], ['source', 'FONTE EDITORIAL', '19']] as const) {
      const { unmount } = render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: id }} />)
      expect(headline()).toBe(`ESTILOS · ${label}`)
      expect((screen.getByTestId('font-size-input') as HTMLInputElement).value).toBe(size)
      expect(screen.queryByLabelText('Entrelinha')).toBeNull()
      unmount()
    }
  })

  it('a composite text block says so honestly (no fake controls)', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'noteText' }} />)
    expect(headline()).toBe('ESTILOS · NOTA DA EDIÇÃO')
    expect(screen.getByTestId('style-composite-note')).toBeTruthy()
    expect(screen.queryByTestId('font-family-picker')).toBeNull()
  })

  it('a non-text Element (image, paper, frame) gets truthful information and no typography controls', () => {
    for (const id of ['hero', 'note', 'heroFrame']) {
      const { unmount } = render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: id }} />)
      expect(screen.getByTestId('style-nontext-note')).toBeTruthy()
      expect(screen.queryByTestId('font-family-picker')).toBeNull()
      expect(screen.queryByTestId('font-size-input')).toBeNull()
      unmount()
    }
  })

  it('Custom Text → its contextual Styles (role, family, preset + numeric size); a Custom Image has none', () => {
    const { unmount } = render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: CUSTOM_ID }} custom={[TEXT]} />)
    expect(headline()).toBe('ESTILOS · TEXTO LIVRE')
    expect(screen.getByTestId('free-text-style')).toBeTruthy()
    unmount()
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: IMAGE.id }} custom={[IMAGE]} />)
    expect(screen.getByTestId('style-image-note')).toBeTruthy()
    expect(screen.queryByTestId('font-family-picker')).toBeNull()
  })

  it('a stale target (element no longer exists) falls back to the composition styles', () => {
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: 'gone' }} />)
    expect(headline()).toBe('ESTILOS DA COMPOSIÇÃO')
  })

  it('selection alone edits nothing: no dispatch, no patch', () => {
    const dispatch = vi.fn()
    const onPatch = vi.fn()
    render(<StylesTab tokens={tokens} target={{ kind: 'template-element', elementId: 'title' }} template={{ layout: getTemplateLayout(TEMPLATE, 'cover'), state: cover(), dispatch }} freeElements={[]} onPatchFreeText={onPatch} />)
    expect(dispatch).not.toHaveBeenCalled()
    expect(onPatch).not.toHaveBeenCalled()
  })
})

describe('font picker: only the supported runtime registry, previewed in the real face', () => {
  it('offers exactly the registry families, each rendered in its own font', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    const options = within(screen.getByTestId('font-family-picker')).getAllByRole('radio')
    expect(options.map((option) => option.getAttribute('data-font-family'))).toEqual([...RUNTIME_FONT_FAMILIES])
    for (const option of options) expect((option as HTMLElement).style.fontFamily.replace(/"/g, '')).toBe(option.getAttribute('data-font-family'))
  })

  it('shows the effective default (Identity family of the role) as the checked option, labelled as default', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'intro' }} />)
    const checked = screen.getAllByRole('radio', { checked: true }).map((option) => option.getAttribute('data-font-family'))
    expect(checked).toEqual(['Source Sans 3'])
    expect(screen.getByTestId('font-family-origin').textContent).toContain('Padrão')
  })

  it('choosing another family sets the override; choosing the default again clears it (no fake override)', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    const option = (family: string) => document.querySelector(`[data-font-family="${family}"]`) as HTMLElement
    fireEvent.click(option('Space Grotesk'))
    expect(snapshot().typography).toEqual({ title: { fontFamily: 'Space Grotesk' } })
    expect(screen.getByTestId('font-family-origin').textContent).toBe('Personalizada')
    fireEvent.click(option('Fraunces'))
    expect(snapshot().typography).toBeNull()
  })

  it('clicking the effective default while nothing is overridden does nothing', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    fireEvent.click(document.querySelector('[data-font-family="Fraunces"]') as HTMLElement)
    expect(snapshot().typography).toBeNull()
  })
})

describe('numeric size, line-height and reset (Template)', () => {
  it('an arbitrary px value (not a preset) is an explicit override; reset removes it', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    const input = screen.getByTestId('font-size-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '53' } })
    expect(snapshot().typography).toEqual({ title: { fontSizePx: 53 } })
    expect(screen.getByTestId('font-size-origin').textContent).toBe('Personalizado')
    fireEvent.click(screen.getByTestId('text-style-reset'))
    expect(snapshot().typography).toBeNull()
    expect((screen.getByTestId('font-size-input') as HTMLInputElement).value).toBe('62')
    expect(screen.getByTestId('font-size-origin').textContent).toContain('Padrão · 62px')
  })

  it('out-of-range values are not committed; clearing the field returns to the default', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    const input = screen.getByTestId('font-size-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '7' } })
    expect(snapshot().typography).toBeNull()
    fireEvent.change(input, { target: { value: '401' } })
    expect(snapshot().typography).toBeNull()
    fireEvent.change(input, { target: { value: '80' } })
    expect(snapshot().typography).toEqual({ title: { fontSizePx: 80 } })
    fireEvent.change(input, { target: { value: '' } })
    expect(snapshot().typography).toBeNull()
  })

  it('Entrelinha edits the ONE canonical source (tuning.title.lineHeight); Usar padrão restores it and the size together', () => {
    render(<TemplateHarness initialTarget={{ kind: 'template-element', elementId: 'title' }} />)
    fireEvent.change(screen.getByLabelText('Entrelinha'), { target: { value: '1.3' } })
    expect(snapshot().title.lineHeight).toBe(1.3)
    expect(snapshot().typography).toBeNull()
    fireEvent.change(screen.getByTestId('font-size-input'), { target: { value: '53' } })
    fireEvent.click(screen.getByTestId('text-style-reset'))
    expect(snapshot().typography).toBeNull()
    expect(snapshot().title).not.toHaveProperty('lineHeight')
  })

  it('the Info Title (two lines, two sizes) offers only the family', () => {
    const info = persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'info', appearance: 'light', id: 's', order: 0, primitiveProjectRef: null })!, productContext, 'portrait')
    render(<StylesTab tokens={tokens} target={{ kind: 'template-element', elementId: 'title' }} template={{ layout: getTemplateLayout(TEMPLATE, 'info'), state: info, dispatch: () => {} }} freeElements={[]} onPatchFreeText={() => {}} />)
    expect(screen.getByTestId('font-family-picker')).toBeTruthy()
    expect(screen.queryByTestId('font-size-input')).toBeNull()
    expect(screen.getByTestId('font-size-composite')).toBeTruthy()
    expect(screen.queryByLabelText('Entrelinha')).toBeNull()
  })
})

describe('Free / Custom Text: preset shortcuts + numeric size', () => {
  it('an existing preset-only element shows its preset as active and its px as the default', () => {
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: CUSTOM_ID }} custom={[TEXT]} />)
    expect(screen.getByRole('radio', { name: 'M', checked: true })).toBeTruthy()
    expect((screen.getByTestId('font-size-input') as HTMLInputElement).value).toBe('54')
    expect(screen.queryByTestId('text-style-reset')).toBeNull()
  })

  it('typing 53 sets an explicit size (the preset stops being active); a preset afterwards returns to that preset deterministically', () => {
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: CUSTOM_ID }} custom={[TEXT]} />)
    fireEvent.change(screen.getByTestId('font-size-input'), { target: { value: '53' } })
    expect(snapshot().elements[0].font_size_px).toBe(53)
    expect(snapshot().elements[0].size).toBe('medium')
    expect(screen.getAllByRole('radio', { checked: true }).some((radio) => radio.getAttribute('data-value') === 'medium')).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: 'G' }))
    expect(snapshot().elements[0]).not.toHaveProperty('font_size_px')
    expect(snapshot().elements[0].size).toBe('large')
    expect((screen.getByTestId('font-size-input') as HTMLInputElement).value).toBe('81')
  })

  it('a family is explicit and reversible; Usar padrão clears family and size but keeps the preset and role', () => {
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: CUSTOM_ID }} custom={[TEXT]} />)
    fireEvent.click(document.querySelector('[data-font-family="Inter"]') as HTMLElement)
    fireEvent.change(screen.getByTestId('font-size-input'), { target: { value: '70' } })
    expect(snapshot().elements[0]).toMatchObject({ font_family: 'Inter', font_size_px: 70 })
    fireEvent.click(screen.getByTestId('text-style-reset'))
    const element = snapshot().elements[0]
    expect(element).not.toHaveProperty('font_family')
    expect(element).not.toHaveProperty('font_size_px')
    expect(element).toMatchObject({ size: 'medium', typography: 'body' })
  })

  it('the role (Título / Texto) stays a semantic choice; its Identity family is the default shown', () => {
    render(<TemplateHarness initialTarget={{ kind: 'free-element', elementId: CUSTOM_ID }} custom={[TEXT]} />)
    expect(screen.getAllByRole('radio', { checked: true }).map((radio) => radio.getAttribute('data-font-family')).filter(Boolean)).toEqual(['Source Sans 3'])
    fireEvent.click(screen.getAllByTestId('free-text-typography').find((button) => button.getAttribute('data-value') === 'display') as HTMLElement)
    expect(snapshot().elements[0].typography).toBe('display')
    expect(screen.getAllByRole('radio', { checked: true }).map((radio) => radio.getAttribute('data-font-family')).filter(Boolean)).toEqual(['Fraunces'])
  })
})

describe('responsibility boundary: Elementos vs Estilos; Video untouched', () => {
  const host = { id: 'h', composition: { kind: 'free', elements: [TEXT] } as FreeSceneComposition }
  const props = { scene: host, fileNames: new Map<string, string>(), openId: CUSTOM_ID, onOpen: () => {}, onEdit: () => {}, onAddText: () => {}, onAddImage: () => {}, onReplaceImage: () => {} }

  it('Static (typographyInStyles) leaves font role and size out of Elementos; text, colour and alignment stay', () => {
    render(<FreeSceneElements {...props} typographyInStyles />)
    expect(screen.queryByTestId('free-text-typography')).toBeNull()
    expect(screen.queryByTestId('free-text-size')).toBeNull()
    expect(screen.getByTestId('free-text-input')).toBeTruthy()
    expect(screen.getAllByTestId('free-text-color').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('free-text-align').length).toBeGreaterThan(0)
  })

  it('Video (default) keeps its panel exactly: role and preset size in the element panel, no numeric size or family picker', () => {
    render(<FreeSceneElements {...props} />)
    expect(screen.getAllByTestId('free-text-typography').length).toBe(2)
    expect(screen.getAllByTestId('free-text-size').length).toBe(4)
    expect(screen.queryByTestId('font-size-input')).toBeNull()
    expect(screen.queryByTestId('font-family-picker')).toBeNull()
  })
})
