/**
 * CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1 — truthful copy, comparable
 * accessibility semantics, a collapsed structural reference, and bounded Free
 * selection synchronization. No domain, persistence or render change.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StyleSourcePanel, TemplateReference } from '@/components/creative/authoring/inspector-panels'
import { getTemplateDefinition, getTemplateLayout, DEFAULT_TEMPLATE_ID } from '@/lib/creative/templates/template-definitions'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
const STATIC = read('app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx')
const VIDEO = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
const PANELS = read('components/creative/video/free-scene-panels.tsx')
const MODE = read('components/creative/authoring/composition-mode-panel.tsx')
const template = getTemplateDefinition(DEFAULT_TEMPLATE_ID)!
const tokens = adaptProjectIdentityToVisualTokens('p1', { schema_version: 1 } as never)

describe('1. Template is named once and changed only through the confirmed mode panel', () => {
  it('Static no longer carries a second Template control (the one-option Select bypassed confirmation)', () => {
    expect(STATIC).not.toMatch(/template-selector|<Select |from '@\/components\/ui\/select'/)
    expect(STATIC).not.toContain('onValueChange={(value) => setTemplateId(value)}')
    expect(STATIC).toContain('<CompositionModePanel mode="template"')
  })

  it('Video no longer repeats the Template name below the mode panel', () => {
    const tab = VIDEO.slice(VIDEO.indexOf('<CompositionModePanel'), VIDEO.indexOf('</CompositionModePanel>'))
    expect(tab).not.toContain('{sceneView.template.name}')
    expect(tab).toContain('cada cena pode usar o template ou ser livre')
  })
})

describe('2. Comparable bounded choices expose the same semantics', () => {
  it('Static Layout and Appearance are radiogroups with checked radios (as in Video)', () => {
    expect(STATIC).toContain('role="radiogroup" aria-labelledby="static-layout-label"')
    expect(STATIC).toContain('role="radiogroup" aria-labelledby="static-appearance-label"')
    expect(STATIC.match(/role="radio" aria-checked=\{checked\}/g)?.length).toBe(2)
    expect(VIDEO).toContain('role="radiogroup" aria-label="Estrutura da cena"')
    expect(VIDEO).toContain('role="radiogroup" aria-label="Aparência da cena"')
  })

  it('the add-slide dialog uses the same radiogroup semantics', () => {
    expect(STATIC).toContain('role="radiogroup" aria-label="Estrutura do novo slide"')
    expect(STATIC).toContain('role="radiogroup" aria-label="Aparência do novo slide"')
    expect(STATIC).not.toMatch(/aria-pressed=\{addLayoutId|aria-pressed=\{addAppearance/)
  })

  it('each "Usar template" button names its Template for assistive technology', () => {
    expect(MODE).toContain('aria-label={`Usar o template ${template.name}`}')
  })

  it('Inspector tabs keep full accessible names in both editors (compact text is aria-hidden)', () => {
    for (const page of [STATIC, VIDEO]) {
      expect(page).toContain('title={section.label} aria-label={section.label}')
      expect(page).toContain('<span className="inspector-tab-compact" aria-hidden="true">')
    }
  })
})

describe('3. Structural reference: informational, collapsed, not an editing surface', () => {
  const html = renderToStaticMarkup(createElement(TemplateReference, { template, layout: getTemplateLayout(template, 'cover') }))

  it('is a closed disclosure labelled as read-only reference', () => {
    expect(html).toMatch(/^<details[^>]*data-testid="template-reference"/)
    expect(html).not.toMatch(/<details[^>]* open/)
    expect(html).toContain('referência, somente leitura')
    expect(html).toContain('Para editar, use Elementos (ordem e visibilidade) e Assets (recursos).')
  })

  it('distinguishes the layout’s elements from the editable Elementos tab', () => {
    expect(html).toContain('Elementos do layout')
    expect(html).toContain('Slots de assets')
    expect(html).not.toContain('Assets / slots')
  })

  it('both editors render the same reference', () => {
    // Static presents the same grammar as the lightweight Anatomia list of the Composição tab (CREATIVE_EDITOR_COMPOSITION_AND_SELECTION_PARITY_V1).
    expect(STATIC).toContain('anatomySections.map')
    expect(STATIC).toContain('Anatomia')
    expect(VIDEO).toContain('<TemplateReference template={sceneView.template} layout={sceneView.layout} />')
  })
})

describe('4. Constraints are stated as constraints; nothing claims what the code does not do', () => {
  it('Template-owned geometry is a property of the mode, not a missing feature', () => {
    expect(VIDEO).not.toContain('ainda não existem em vídeo')
    expect(VIDEO).toContain('a posição, a escala e a rotação desta camada são definidas pelo layout')
  })

  it('free Scene Motion copy no longer says a Template draws a Template-less Scene', () => {
    expect(VIDEO).not.toContain('o Motion desta versão é desenhado pelo Template, então esta cena fica estática')
    expect(VIDEO).toContain('Cenas livres são estáticas nesta versão')
  })

  it('Free Assets explains the single binding path instead of sending the user away', () => {
    expect(VIDEO).not.toContain('Troque ou ajuste cada uma em Elementos')
    expect(VIDEO).toContain('Trocar aqui usa a mesma imagem do elemento')
    expect(STATIC).toContain('Trocar aqui usa a mesma imagem do elemento')
  })

  it('Estilo states the real Identity precedence and never claims Identity lacks typography or colours', () => {
    for (const free of [false, true]) {
      const html = renderToStaticMarkup(createElement(StyleSourcePanel, { tokens, free }))
      expect(html).toContain('vêm da Identidade do Projeto quando ela as define')
      expect(html).toContain('o que ela não define usa o padrão do Studio')
      expect(html).not.toContain('estes valores não vêm dela')
      expect(html).not.toContain('ainda não define tipografia')
    }
    expect(PANELS).not.toMatch(/Fonte da Identidade|Cor da Identidade|cores e fontes da Identidade/)
    expect(MODE).not.toMatch(/Identidade (não|ainda não) define/)
  })

  it('an empty free composition is orientation, not an error, and names the Template as an option', () => {
    expect(PANELS).toContain('em branco (composição livre). Adicione um texto ou uma imagem, ou escolha um template na aba Template.')
    expect(STATIC).toContain('adicione texto ou imagem em Elementos, ou escolha um template na aba Template')
    expect(MODE).toContain("'Composição livre'")
    expect(`${PANELS}${MODE}`).not.toMatch(/erro|obrigatório|Selecione um template/i)
  })

  // Superseded by VIDEO_MOTION_CAPABILITY_TRUTH_V1 (M3), which now DOES own this: the
  // hardcoded `layoutId === 'cover'` check became narrow, code-backed Layout capability
  // metadata, and unsupported values were removed from the offered choices. Legacy
  // labels (movementLabel) still cover every historical value, including zoom_out/dolly.
  it('Motion capability truth landed in M3: no hardcoded per-preset effect check remains', () => {
    const authoring = read('lib/creative/video-editor/video-authoring.ts')
    expect(authoring).toContain("['zoom_out', 'Zoom Out']")
    expect(authoring).toContain("['dolly', 'Dolly Forward']")
    expect(authoring).not.toContain("if (preset === 'slow_push') return layoutId === 'cover' ? 'primary-media' : 'not-drawn'")
    expect(authoring).toContain('LAYOUT_SCENE_MOTION')
  })
})

describe('5. Single-piece Static uses no collection language', () => {
  it('PNG preview, Restaurar padrão and Gerar PNG speak of "arte" outside a carousel', () => {
    expect(STATIC).toContain("{isCarousel ? `PNG · Slide ${previewJob?.slideIndex}` : 'PNG da arte'}")
    expect(STATIC).toContain("aria-label={isCarousel ? `Ver PNG do slide ${currentRenderJob.slideIndex} de ${currentRenderJob.slideTotal}` : 'Ver PNG da arte'}")
    expect(STATIC).toContain("{isCarousel ? 'ao slide atual' : 'à arte'}")
    expect(STATIC).toContain("${isCarousel ? 'deste slide' : 'desta arte'}")
  })
})

describe('6. Bounded Free selection synchronization (no generic selection model)', () => {
  it('Video: opening a free element in Elementos selects it (chrome + timing follow one id), without a seek', () => {
    const helper = VIDEO.slice(VIDEO.indexOf('function openFreeElement('), VIDEO.indexOf('function forgetFreeElement('))
    expect(helper).toContain('setOpenElementId(elementId)')
    expect(helper).toContain('setSelectedElementId(elementId)')
    expect(helper).not.toMatch(/seek\(|cursor\.set/)
    expect(VIDEO).toContain('onOpen={openFreeElement}')
    // Template Camadas keep disclosure-only semantics.
    expect(VIDEO).toContain('onToggle={(id) => setOpenElementId((current) => (current === id ? null : id))}')
  })

  it('Video: a removed element or a Scene change leaves no stale open/selected id', () => {
    const forget = VIDEO.slice(VIDEO.indexOf('function forgetFreeElement('), VIDEO.indexOf('function removeSelectedScene('))
    expect(forget).toContain('setOpenElementId((current) => (current === elementId ? null : current))')
    expect(forget).toContain('setSelectedElementId((current) => (current === elementId ? null : current))')
    expect(VIDEO).toContain('onRemoved={forgetFreeElement}')
    const selectScene = VIDEO.slice(VIDEO.indexOf('function selectScene('), VIDEO.indexOf('function selectSceneById('))
    expect(selectScene).toContain('setOpenElementId(null)')
    expect(VIDEO).toContain('setSelectedIndex(index); setSelectedItemId(null); setSelectedElementId(null); setOpenElementId(null)')
    const removeScene = VIDEO.slice(VIDEO.indexOf('function removeSelectedScene('), VIDEO.indexOf('function moveScene('))
    expect(removeScene).toContain('setOpenElementId(null)')
    // Mode switches already cleared both (previous mission): still true.
    const mode = VIDEO.slice(VIDEO.indexOf('function setSelectedSceneMode('), VIDEO.indexOf('function setSelectedSceneMode(') + 400)
    expect(mode).toContain('setSelectedElementId(null)')
    expect(mode).toContain('setOpenElementId(null)')
  })

  it('Static: free element ids are slide-local; Template Camadas disclosure is kept across slides', () => {
    const sw = STATIC.slice(STATIC.indexOf('function switchSlide('), STATIC.indexOf('const dispatch ='))
    // Selection is the UI-only `selectedTarget`: it is cleared on a slide switch and when its element is removed.
    expect(sw).toContain('setSelectedTarget(null)')
    expect(STATIC).toContain("onRemoved={(id) => setSelectedTarget((current) => (current?.kind === 'free-element' && current.elementId === id ? null : current))}")
    for (const fn of ['function enterTemplate(', 'function enterFree(']) {
      const body = STATIC.slice(STATIC.indexOf(fn), STATIC.indexOf(fn) + 1600)
      expect(body).toContain('setSelectedTarget(null)')
    }
  })
})
