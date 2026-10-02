/**
 * COVER_ELEMENT_COMPLETENESS_V1 — every meaningful Cover unit has an explicit owner:
 * Elements (kicker, intro, source, brand, note text), content children, derived chrome and internal
 * detail; all backward compatible. STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 later split the compounds
 * (hero frame, brand, note text) into independent atoms — see atomic-visual-elements.test.ts for the matrix.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { DocumentaryCardCoverContentSchema } from '@/lib/schemas/creative/documentary-card'
import {
  PersistedAuthoredSlideSchema, authoringStateToPersistedSlide, createTemplateSlide, persistedSlideToAuthoringState,
} from '../carousel-state'
import {
  deriveHiddenElementsRequest, derivePrimitiveTransformsRequest, deriveTuningOverrides, resetTuningGroup, resolvePreviewInput, setTuningField, TUNING_BOUNDS,
} from '../authoring-state'
import { STATIC_COVER_CONTENT_FIELDS, COVER_CONTENT_FIELDS } from '../layout-content-fields'
import { hasLayoutOwnedAuthoredWork } from '../layout-switch'
import { authoringReducer } from '../reducer'
import { authoringRenderOverridesSchema, authoringRenderRequestSchema } from '../render-request'
import { DEFAULT_TUNING } from '../types'
import type { PersistedAuthoredSlide } from '../carousel-state'
import type { AuthoringProductContext, AuthoringState } from '../types'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, AUTHORING_ASSET_SLOT_IDS, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { normalizeElementOrder, normalizeHiddenElements, resolveElementStack } from '@/lib/creative/templates/element-stack'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import type { FreeSceneElement } from '@/lib/types'

const productContext: AuthoringProductContext = {
  projectId: 'project-1', projectName: 'Portal Comunidades Alternativas', productionId: null, productionTitle: null, editorialContentId: 'ec-1',
  editorialContentTitle: 'Carrossel', channelPieceId: 'cp-1', channel: 'instagram', format: 'carousel', primitiveProjectRef: 'project:portal-comunidades-alternativas',
  projectIdentity: { schema_version: 1 } as AuthoringProductContext['projectIdentity'],
  identitySnapshot: {
    schema_version: 'visual-tokens.v0', snapshot_ref: 'project:project-1:snapshot',
    typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } },
    colors: { background: '#F6F0E4', foreground: '#16352F' }, spacing: { unit: 8 },
  },
}
const CUSTOM: FreeSceneElement = { id: '11111111-1111-4111-8111-111111111111', kind: 'text', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, text: 'Custom', typography: 'body', color: 'foreground', align: 'left', size: 'small' }

const cover = () => persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait')
const COVER = getTemplateLayout(TEMPLATE, 'cover')!

function render(state: AuthoringState, hero?: { url: string; fit?: 'cover' | 'contain' }): string {
  const input = resolvePreviewInput(state)
  const resolvedAssets = hero ? { ...input.resolvedAssets, hero: { ref: 'hero', source: 'library_file', path: 'p', url: hero.url, mime_type: 'image/png', fit: hero.fit ?? 'cover' } } : input.resolvedAssets
  const props = documentaryCardPropsFromResolvedInput(
    { ...input, resolvedAssets: resolvedAssets as typeof input.resolvedAssets, manifest: { ...input.manifest, sequence: { index: 1, total: 3 } } },
    'still', undefined, state.tuning, undefined, derivePrimitiveTransformsRequest(state),
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) },
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}
const hiding = (state: AuthoringState, ...ids: string[]) => ids.reduce((current, id) => authoringReducer(current, { type: 'TOGGLE_ELEMENT_VISIBILITY', id }), state)
const withContent = (state: AuthoringState, key: string, value: string) => authoringReducer(state, { type: 'SET_CONTENT_VALUE', path: [key], value, optional: key !== 'title' })
const has = (html: string, label: string) => html.includes(`data-element="${label}"`)

describe('Cover content (Static): every authored string is reachable and named by its role', () => {
  const byKey = Object.fromEntries(STATIC_COVER_CONTENT_FIELDS.map((field) => [field.key, field]))

  it('1-4. Introdução, Fonte editorial, Nota da edição and Chamada (kicker) are authorable in Static', () => {
    expect(byKey.subtitle).toMatchObject({ label: 'Introdução', optional: true })
    expect(byKey.source_line).toMatchObject({ label: 'Fonte editorial', optional: true })
    expect(byKey.detail_note).toMatchObject({ label: 'Nota da edição', optional: true })
    expect(byKey.eyebrow).toMatchObject({ label: 'Chamada (kicker)', optional: true })
    expect(byKey.title).toMatchObject({ label: 'Título' })
    // No generic "Texto": every role is named.
    expect(STATIC_COVER_CONTENT_FIELDS.some((field) => field.label === 'Texto')).toBe(false)
  })

  it('the descriptors carry exactly the schema bounds (the form can never produce content the renderer rejects)', () => {
    for (const field of STATIC_COVER_CONTENT_FIELDS) {
      if (field.kind !== 'text') continue
      const ok = { title: 'T', [field.key]: 'x'.repeat(field.maxLength as number) }
      const tooLong = { title: 'T', [field.key]: 'x'.repeat((field.maxLength as number) + 1) }
      expect(DocumentaryCardCoverContentSchema.safeParse(ok).success, `${field.key} at the bound`).toBe(true)
      expect(DocumentaryCardCoverContentSchema.safeParse(tooLong).success, `${field.key} over the bound`).toBe(false)
    }
  })

  it('each field edits ONLY its own key; clearing an optional field removes it and the content stays valid', () => {
    let state = cover()
    for (const [key, value] of [['subtitle', 'Nova introdução'], ['source_line', 'Nova fonte'], ['detail_note', 'Rótulo: nova nota'], ['eyebrow', 'NOVO KICKER']] as const) {
      const before = { ...(state.contentOverride as Record<string, unknown>) }
      state = withContent(state, key, value)
      const after = state.contentOverride as Record<string, unknown>
      expect(after[key]).toBe(value)
      for (const other of Object.keys(before)) if (other !== key) expect(after[other]).toEqual(before[other])
    }
    for (const key of ['subtitle', 'source_line', 'detail_note', 'eyebrow']) state = withContent(state, key, '')
    const content = state.contentOverride as Record<string, unknown>
    for (const key of ['subtitle', 'source_line', 'detail_note', 'eyebrow']) expect(content).not.toHaveProperty(key)
    expect(DocumentaryCardCoverContentSchema.safeParse(content).success).toBe(true)
  })

  it('5. brand ownership is explicit: the label is the live Project name (not authored per slide) and is not a Content field; the logo artwork is the "logo" Asset Slot (Template default until replaced)', () => {
    expect(byKey.brand_label).toBeUndefined()
    expect((cover().contentOverride as { brand_label?: string }).brand_label).toBe('Portal Comunidades Alternativas')
    expect((AUTHORING_ASSET_SLOT_IDS as readonly string[]).includes('logo')).toBe(true)
    expect(resolvePreviewInput(cover()).manifest.assets).toHaveProperty('logo')
    // Video keeps its own descriptor set (unchanged).
    // CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1: the logo file already carries the brand name, so no "Nome da marca" text field is offered.
    expect(COVER_CONTENT_FIELDS.map((field) => field.label)).toEqual(['Chamada', 'Título', 'Texto', 'Linha de fonte', 'Nota da edição'])
  })
})

describe('Cover Template Elements and anatomy', () => {
  it('6. the exact Cover Element set, with stable ids and truthful labels', () => {
    expect(COVER.elements.map((element) => [element.id, element.label])).toEqual([
      ['title', 'Título'], ['paper', 'Papel do título'], ['hero', 'Imagem principal'], ['tape1', 'Fita da imagem'],
      ['note', 'Papel da nota'], ['noteText', 'Nota da edição'], ['tape2', 'Fita da nota'],
      ['botanical', 'Botânica seca'], ['botanicalLeaf', 'Ramo de folhas'], ['archival', 'Fragmento de mapa'], ['ornament', 'Ornamento celeste'],
      ['kicker', 'Chamada'], ['intro', 'Introdução'], ['source', 'Fonte editorial'], ['brandLogo', 'Logo da marca'],
    ])
    expect([...COVER.defaultStackOrder].sort()).toEqual(COVER.elements.map((element) => element.id).sort())
  })

  it('7. every Element resolves into its Section (no fallback section)', () => {
    const sections = resolveLayoutSections(TEMPLATE, COVER)
    expect(sections.map((section) => [section.label, section.elements.map((element) => element.id)])).toEqual([
      ['Cabeçalho', ['kicker']], ['Bloco de título', ['title', 'paper']], ['Introdução', ['intro']], ['Fonte editorial', ['source']],
      // Anatomy reads like the visible object (what is on top first): DISPLAY order only — paint order is the stack, untouched.
      ['Hero', ['tape1', 'hero']], ['Nota editorial', ['tape2', 'noteText', 'note']], ['Assinatura', ['brandLogo']],
      ['Decoração', ['botanical', 'botanicalLeaf', 'archival', 'ornament']],
    ])
  })

  it('8. internal/derived nodes are not Elements (stars, grain, gradient, source rule, sequence badge)', () => {
    const ids = COVER.elements.map((element) => element.id)
    for (const internal of ['sparkle', 'grain', 'background', 'rule', 'sourceRule', 'frame', 'sequence', 'badge', 'noteBacking']) expect(ids).not.toContain(internal)
    const html = render(cover())
    expect(has(html, 'Chamada') && has(html, 'Introdução') && has(html, 'Fonte editorial')).toBe(true)
    // the source rule is a child of the source Element, not an Element of its own
    expect(html.match(/data-element="Fonte editorial"/g)).toHaveLength(1)
  })

  it('capabilities match the semantic type: text/brand are positioned, the note text follows its anchor', () => {
    const control = (id: string) => COVER.elements.find((element) => element.id === id)!.control
    expect(control('kicker')).toEqual({ type: 'tuning', group: 'kicker' })
    expect(control('intro')).toEqual({ type: 'tuning', group: 'intro' })
    expect(control('source')).toEqual({ type: 'tuning', group: 'source' })
    expect(control('brandLogo')).toEqual({ type: 'tuning', group: 'brand' })
    expect(control('noteText')).toEqual({ type: 'follows', parent: 'note' })
    // The removed Cover atoms are gone from the registry (their ids may still sit in old saved state: see the Hero tests).
    expect(COVER.elements.some((element) => element.id === 'heroFrame' || element.id === 'brandName')).toBe(false)
    // no font/size capability was added to any new Element
    for (const id of ['kicker', 'intro', 'source', 'brandLogo', 'noteText']) expect(COVER.elements.find((element) => element.id === id)?.typography?.lineHeight).toBeUndefined()
  })
})

describe('Hero: the book cover alone (no backing Element), complete artwork, no crop', () => {
  const geometry = (html: string) => html.match(/aria-label="Imagem principal"[^>]*?(height:[\d.]+px;left:[\d.]+px;)/)?.[1]
  const legacySlide = (extra: Partial<PersistedAuthoredSlide>): PersistedAuthoredSlide => ({
    ...createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: null })!,
    ...extra,
  })

  it('9/16. the default Cover has no hero backing: no Moldura Element, no cream border, no shadow, no padding, transparent surface', () => {
    const html = render(cover())
    expect(has(html, 'Moldura')).toBe(false)
    expect(html).not.toContain('data-hero-frame="on"')
    expect(html).not.toContain('#e8dcc3')
    expect(html).not.toMatch(/box-shadow:0 22px 40px/)
    expect(html).toMatch(/aria-label="Documentary hero evidence fixture"[^>]*background-color:transparent/)
    expect(html).not.toMatch(/aria-label="Imagem principal"[^>]*padding:14px/)
  })

  it('10. the image keeps the box it always had by default (the former plate minus its 14px margin): 440 x 648 at (580, 228)', () => {
    const html = render(cover())
    expect(geometry(html)).toBe('height:648px;left:580px;')
    expect(html).toMatch(/aria-label="Imagem principal"[^>]*top:228px;width:440px/)
  })

  it('18-19. the COMPLETE artwork is shown, never cropped or stretched: always contain, whatever fit the asset carries', () => {
    for (const hero of [{ url: '/library/book-a.png' }, { url: '/library/book-b.png', fit: 'cover' as const }, { url: '/library/book-c.png', fit: 'contain' as const }]) {
      const html = render(cover(), hero)
      expect(html).toContain(hero.url)
      const surface = html.match(/<div aria-label="Documentary hero evidence fixture"[^>]*>/)?.[0] ?? ''
      expect(surface).toContain('background-size:contain')
      expect(surface).not.toContain('background-size:cover')
      expect(surface).not.toMatch(/background-size:\s*100%/)
      expect(geometry(html)).toBe('height:648px;left:580px;')
    }
  })

  it('17. state saved with the old backing (hidden "heroFrame", its place in the order, the legacy tuning.hero.frame toggle) cannot change the image', () => {
    const baseline = render(cover())
    const staleOrder = [...COVER.defaultStackOrder.slice(0, 3), 'heroFrame', ...COVER.defaultStackOrder.slice(3)]
    const stale = [
      legacySlide({ hiddenElements: ['heroFrame'] }),
      legacySlide({ elementOrder: staleOrder }),
      legacySlide({ tuning: { hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, frame: false }, title: { offsetX: 0, offsetY: 0, rotation: 0 } } }),
    ]
    for (const row of stale) {
      expect(PersistedAuthoredSlideSchema.safeParse(row).success).toBe(true)
      const loaded = persistedSlideToAuthoringState(row, productContext, 'portrait')
      // sanitized away on load (no migration, nothing re-persisted): the unknown id never reaches the state
      expect(loaded.hiddenElements ?? []).not.toContain('heroFrame')
      expect(loaded.elementOrder ?? []).not.toContain('heroFrame')
      expect(loaded.tuning.hero).not.toHaveProperty('frame')
      expect(render(loaded)).toBe(baseline)
      expect(authoringStateToPersistedSlide(loaded, 's', 0).hiddenElements ?? []).not.toContain('heroFrame')
    }
    // a stale frozen render request that still names the id (or the legacy flag) renders the same markup
    expect(render({ ...cover(), hiddenElements: ['heroFrame'] })).toBe(baseline)
    expect(render({ ...cover(), tuning: { ...cover().tuning, hero: { ...cover().tuning.hero, frame: false } } })).toBe(baseline)
  })

  it('20. no crop state exists: the Hero tuning is exactly offset/rotation/scale, nothing new is persisted', () => {
    expect(Object.keys(cover().tuning.hero).sort()).toEqual(['offsetX', 'offsetY', 'rotation', 'scale'])
    const persisted = JSON.stringify(authoringStateToPersistedSlide(cover(), 's', 0))
    for (const forbidden of ['crop', 'focal', 'sourceOffset', 'sourceScale', 'heroFrame']) expect(persisted).not.toContain(forbidden)
  })

  it('12. the tape keeps its behaviour', () => {
    const tape = (html: string) => html.match(/<div aria-label="Fita da imagem"[^>]*>/)?.[0]
    const moved = authoringReducer(cover(), { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'tape1', field: 'rotation', value: 5 })
    expect(tape(render(moved))).toContain('rotate(11deg)')
  })

  it('hiding the hero hides the image alone (there is nothing else to leave behind)', () => {
    const off = render(hiding(cover(), 'hero'))
    expect(off).not.toContain('aria-label="Imagem principal"')
    expect(has(off, 'Moldura')).toBe(false)
    expect(off).toContain('aria-label="Fita da imagem"')
  })

  it('21. layouts that really have a hero frame keep it (Lista / Citação)', () => {
    for (const id of ['list', 'quote']) {
      const layout = getTemplateLayout(TEMPLATE, id)!
      expect(layout.elements.map((element) => element.id)).toContain('heroFrame')
      expect(layout.defaultStackOrder).toContain('heroFrame')
    }
  })
})

describe('Compounds: text is not paper, the source rule belongs to the source', () => {
  it('13. the editorial note: paper and text are separate Elements; the paper carries no text', () => {
    const html = render(cover())
    const paper = html.match(/<div aria-label="Papel da nota"[\s\S]*?<\/div><\/div>/)?.[0] ?? ''
    expect(paper).toContain('paper-scrap-light-01')
    expect(paper).not.toContain('Edição apresentada')
    expect(html.match(/<div aria-label="Nota da edição"[\s\S]*?<\/div><\/div><\/div>/)?.[0]).toContain('Edição apresentada')
    // the text takes the paper's box and transform
    const box = (label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*?(height:[\\d.]+px;left:[\\d.]+px;position:absolute;top:[\\d.]+px;width:[\\d.]+px;)`))?.[1]
    expect(box('Nota da edição')).toBe(box('Papel da nota'))
  })

  it('13. hiding the text keeps the paper; hiding the paper keeps the text (two independent Elements)', () => {
    const textHidden = render(hiding(cover(), 'noteText'))
    expect(has(textHidden, 'Papel da nota')).toBe(true)
    expect(textHidden).not.toContain('Edição apresentada')
    const paperHidden = render(hiding(cover(), 'note'))
    expect(has(paperHidden, 'Papel da nota')).toBe(false)
    expect(paperHidden).toContain('Edição apresentada')
  })

  it('the note text follows the paper transform (moving the note moves both)', () => {
    const moved = authoringReducer(cover(), { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'note', field: 'offsetX', value: 40 })
    const html = render(moved)
    expect(html.match(/<div aria-label="Papel da nota"[^>]*>/)?.[0]).toContain('translate(40px, 0px)')
    expect(html.match(/<div aria-label="Nota da edição"[^>]*>/)?.[0]).toContain('translate(40px, 0px)')
  })

  it('14. the source text and its decorative line are ONE Element: hidden together, one drawn line, no separate rule Element', () => {
    const html = render(cover())
    const source = html.match(/<div data-element="Fonte editorial"[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(source).toContain('Publicado originalmente em 1983.')
    expect(source).toContain('aria-hidden="true"')
    const hidden = render(hiding(cover(), 'source'))
    expect(hidden.match(/<div data-element="Fonte editorial"[^>]*>/)?.[0]).toContain('display:none')
    expect(COVER.elements.some((element) => /rule|line|linha/i.test(element.id + element.label))).toBe(false)
  })
})

describe('New Elements: position, visibility and order', () => {
  it('each is hideable and takes its bounded tuning, defaulting to the Template position', () => {
    const base = render(cover())
    for (const [label, group] of [['Chamada', 'kicker'], ['Introdução', 'intro'], ['Assinatura', 'brand']] as const) {
      expect(base).toMatch(new RegExp(`data-element="${label}"|aria-label="Project brand mark"`))
      const tuned = render({ ...cover(), tuning: setTuningField(cover().tuning, group, 'offsetX', 30) })
      expect(tuned).toContain('translate(30px, 0px)')
    }
    const sourceTuned = render({ ...cover(), tuning: setTuningField(cover().tuning, 'source', 'rotation', 1) })
    expect(sourceTuned.match(/<div data-element="Fonte editorial"[^>]*>/)?.[0]).toContain('rotate(1deg)')
    expect(render(hiding(cover(), 'kicker'))).toMatch(/data-element="Chamada"[^>]*display:none/)
    expect(render(hiding(cover(), 'intro'))).toMatch(/data-element="Introdução"[^>]*display:none/)
  })

  it('11-13. Assinatura is ONE complete logo: no name text beside it, no mask, hideable as one unit, positioned by its tuning', () => {
    const html = render(cover())
    // the Project name is derived into content (brand_label) but is NOT drawn: the logo file already carries it
    expect((cover().contentOverride as { brand_label?: string }).brand_label).toBe('Portal Comunidades Alternativas')
    expect(html).not.toContain('Portal Comunidades Alternativas')
    expect(html.match(/aria-label="Project brand mark"/g)).toHaveLength(1)
    expect(html).toMatch(/bottom:[\d.]+px;left:110px/)
    const mark = html.match(/<div aria-label="Project brand mark"[^>]*>/)?.[0] ?? ''
    expect(mark).toContain('background-size:contain')
    expect(mark).not.toContain('border-radius')
    expect(mark).not.toContain('border:')
    // the registry: one brand Element, no separate name atom
    expect(COVER.elements.filter((element) => element.id.startsWith('brand')).map((element) => element.id)).toEqual(['brandLogo'])
    // hiding it hides the whole signature; the legacy compound id "brand" means the same; a stale "brandName" id is dropped
    expect(render(hiding(cover(), 'brandLogo'))).toMatch(/display:none[^>]*>\s*<div aria-label="Project brand mark"/)
    expect(normalizeHiddenElements(COVER, ['brand'])).toEqual(['brandLogo'])
    expect(normalizeHiddenElements(COVER, ['brandName'])).toEqual([])
    expect(normalizeElementOrder(COVER, [...COVER.defaultStackOrder, 'brandName'])).toEqual([...COVER.defaultStackOrder])
  })

  it('14/15. replacing the logo asset renders that ONE complete file (the existing logo slot), nothing else', () => {
    const input = resolvePreviewInput(cover())
    const withLogo = { ...input, resolvedAssets: { ...input.resolvedAssets, logo: { ref: 'logo', source: 'library_file', path: 'p', url: '/library/logo-completo.svg', mime_type: 'image/svg+xml', fit: 'contain' } } }
    const props = documentaryCardPropsFromResolvedInput(
      { ...withLogo, manifest: { ...withLogo.manifest, sequence: { index: 1, total: 3 } } } as typeof input, 'still', undefined, cover().tuning, undefined, derivePrimitiveTransformsRequest(cover()),
      { templateId: TEMPLATE.id, elementOrder: cover().elementOrder, hiddenElements: deriveHiddenElementsRequest(cover(), TEMPLATE.id) },
    )
    const html = renderToStaticMarkup(createElement(DocumentaryCard, props))
    expect(html.match(/logo-completo\.svg/g)).toHaveLength(1)
    expect(html).not.toContain('Portal Comunidades Alternativas')
  })

  it('the new text Elements still paint above the whole stack by default, like the fixed layer they replace', () => {
    const stack = resolveElementStack(TEMPLATE.id, 'cover', undefined)
    for (const id of ['kicker', 'intro', 'source', 'brandLogo']) expect(stack.zIndex[id]).toBeGreaterThan(stack.zIndex.title)
    expect(Math.max(...Object.values(stack.zIndex))).toBeLessThan(200)
    // z order of the legacy Elements relative to each other is unchanged
    const legacy = ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper', 'title']
    expect(COVER.defaultStackOrder.filter((id) => legacy.includes(id))).toEqual(legacy)
  })

  it('a paint order saved BEFORE these Elements existed keeps them on top; the note text sits right after its paper', () => {
    const legacyOrder = ['title', 'ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper']
    const normalized = normalizeElementOrder(COVER, legacyOrder)
    expect(normalized.slice(-4)).toEqual(['kicker', 'intro', 'source', 'brandLogo'])
    expect(normalized.indexOf('noteText')).toBe(normalized.indexOf('note') + 1)
    expect(normalized.filter((id) => !['noteText', 'kicker', 'intro', 'source', 'brandLogo'].includes(id))).toEqual(legacyOrder)
  })

  it('hidden ids of the new Elements persist and normalize like any Element', () => {
    expect(normalizeHiddenElements(COVER, ['brandName', 'noteText', 'unknown', 'kicker'])).toEqual(['noteText', 'kicker'])
  })
})

describe('Persistence, backward compatibility and the render contract', () => {
  const authored = () => {
    let state = cover()
    state = { ...state, tuning: setTuningField(setTuningField(setTuningField(state.tuning, 'kicker', 'offsetY', -12), 'intro', 'rotation', 1), 'brand', 'offsetX', 20) }
    state = hiding(state, 'tape1', 'noteText', 'source')
    return authoringReducer(state, { type: 'SET_CUSTOM_ELEMENTS', elements: [CUSTOM] })
  }

  it('19. save/reload preserves every new authored Cover field', () => {
    const state = authored()
    const persisted = authoringStateToPersistedSlide(state, 's', 0)
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    const reloaded = persistedSlideToAuthoringState(JSON.parse(JSON.stringify(persisted)), productContext, 'portrait')
    expect(reloaded.tuning).toEqual(state.tuning)
    expect(reloaded.tuning.hero).not.toHaveProperty('frame')
    expect(reloaded.tuning.kicker).toEqual({ offsetX: 0, offsetY: -12, rotation: 0 })
    expect(reloaded.hiddenElements).toEqual(['tape1', 'noteText', 'source'])
    expect(render(reloaded)).toBe(render(state))
  })

  it('20. a legacy row (no new fields at all) loads with the legacy defaults and persists back unchanged', () => {
    const legacy = { ...createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: null })!, tuning: { hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }, title: { offsetX: 0, offsetY: 0, rotation: 0 } } }
    expect(PersistedAuthoredSlideSchema.safeParse(legacy).success).toBe(true)
    const loaded = persistedSlideToAuthoringState(legacy, productContext, 'portrait')
    expect(loaded.tuning.hero).not.toHaveProperty('frame')
    for (const group of ['kicker', 'intro', 'brand']) expect(loaded.tuning).not.toHaveProperty(group)
    expect(deriveTuningOverrides(loaded)).toBeUndefined()
    const back = authoringStateToPersistedSlide(loaded, 's', 0)
    expect(back.tuning).not.toHaveProperty('kicker')
    expect(render(loaded)).not.toContain('data-hero-frame="on"')
  })

  it('an untouched optional group is never persisted, and a reset removes it (serialises like a never-adjusted slide)', () => {
    const adjusted = setTuningField(cover().tuning, 'intro', 'offsetX', 10)
    expect(authoringStateToPersistedSlide({ ...cover(), tuning: adjusted }, 's', 0).tuning).toHaveProperty('intro')
    expect(resetTuningGroup(adjusted, 'intro')).toEqual(DEFAULT_TUNING)
    expect(authoringStateToPersistedSlide({ ...cover(), tuning: resetTuningGroup(adjusted, 'intro') }, 's', 0).tuning).not.toHaveProperty('intro')
  })

  it('the bounds of the new groups are the same bounded position as the title/source', () => {
    for (const group of ['kicker', 'intro', 'brand'] as const) expect(TUNING_BOUNDS[group]).toEqual(TUNING_BOUNDS.source)
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, intro: { offsetX: 999, offsetY: 0, rotation: 0 } } }).success).toBe(false)
  })

  it('21. the render request and the frozen snapshot carry the new authored state; an old snapshot still parses', () => {
    const state = authored()
    const overrides = deriveTuningOverrides(state)!
    expect(authoringRenderOverridesSchema.parse(overrides).documentaryCard?.hero.frame).toBeUndefined()
    const request = { manifest: resolvePreviewInput(state).manifest, overrides, templateId: TEMPLATE.id, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) }
    expect(authoringRenderRequestSchema.safeParse(request).success).toBe(true)
    const snapshot = buildStaticRenderExecutionSnapshot({ manifest: request.manifest, identitySnapshot: productContext.identitySnapshot, overrides, templateId: TEMPLATE.id, hiddenElements: request.hiddenElements, slide: null })
    const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.snapshot.overrides?.documentaryCard?.intro).toEqual({ offsetX: 0, offsetY: 0, rotation: 1 })
      expect(parsed.snapshot.overrides?.documentaryCard?.brand?.offsetX).toBe(20)
      expect(parsed.snapshot.hiddenElements).toEqual(['tape1', 'noteText', 'source'])
    }
    const legacy = buildStaticRenderExecutionSnapshot({ manifest: request.manifest, identitySnapshot: productContext.identitySnapshot, overrides: { documentaryCard: { ...DEFAULT_TUNING, hero: { offsetX: 1, offsetY: 0, rotation: 0, scale: 1 } } }, slide: null })
    expect(parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(legacy))).ok).toBe(true)
  })

  it('22. the Cover renderer accepts the pre-existing tuning shapes (hero/title/source only) unchanged', () => {
    const tuned = { ...cover(), tuning: { hero: { offsetX: 10, offsetY: 0, rotation: 1, scale: 1.05 }, title: { offsetX: 4, offsetY: 0, rotation: 0, lineHeight: 1.1 }, source: { offsetX: 0, offsetY: 3, rotation: 0 } } }
    const html = render(tuned)
    expect(html).toContain('translate(10px, 0px) rotate(4.2deg) scale(1.05)')
    expect(html).toContain('line-height:1.1')
    expect(html).not.toContain('data-hero-frame="on"')
  })
})

describe('Layout switch protects the new Cover state', () => {
  const authoredCover = () => {
    let state = cover()
    state = { ...state, tuning: setTuningField(setTuningField(setTuningField(state.tuning, 'kicker', 'offsetY', 8), 'intro', 'offsetX', 9), 'brand', 'rotation', 1) }
    state = hiding(state, 'tape1', 'noteText', 'kicker', 'brandLogo')
    return authoringReducer(state, { type: 'SET_CUSTOM_ELEMENTS', elements: [CUSTOM] })
  }

  it('the new Cover state counts as Layout-owned work (confirmation is required)', () => {
    expect(hasLayoutOwnedAuthoredWork(cover())).toBe(false)
    expect(hasLayoutOwnedAuthoredWork(hiding(cover(), 'tape1'))).toBe(true)
    expect(hasLayoutOwnedAuthoredWork({ ...cover(), tuning: setTuningField(cover().tuning, 'intro', 'offsetX', 1) })).toBe(true)
    expect(hasLayoutOwnedAuthoredWork(hiding(cover(), 'noteText'))).toBe(true)
  })

  it('17. Cover → Info resets every new Cover field: tuning groups, hidden ids', () => {
    const next = authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'info' })
    expect(next.tuning).toEqual(persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'info', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait').tuning)
    for (const group of ['kicker', 'intro', 'brand']) expect(next.tuning).not.toHaveProperty(group)
    expect(next.tuning.hero).not.toHaveProperty('frame')
    expect(next.hiddenElements).toBeUndefined()
    expect(authoringReducer(next, { type: 'SET_VARIANT', variant: 'cover' }).tuning).toEqual(cover().tuning)
    expect(resolveElementStack(TEMPLATE.id, 'info', undefined).order).not.toContain('kicker')
  })

  it('18. Custom Elements survive the switch', () => {
    expect(authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'closing' }).elements).toEqual([CUSTOM])
  })
})
