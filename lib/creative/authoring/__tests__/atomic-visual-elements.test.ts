/**
 * STATIC_TEMPLATE_ATOMIC_VISUAL_ELEMENTS_V1 — every meaningful independent visible unit of every
 * Documentary layout is its own Element ("atom"): own visibility, own place in the paint order and,
 * when a file is behind it, its own Asset Slot. A paper and its text, a photo and its frame, a logo and the
 * brand name never hide (or restyle, or re-source) each other; nothing is a Group or a parent.
 *
 * Matrix per layout: (1) registry classification, (2) default paint order (legacy relative order kept),
 * (3) every atom paints, (4) hiding one atom hides only that atom, (5) paint order follows the stack,
 * (6) anchored atoms track their anchor, (7) saved (legacy) orders keep text on paper / frame under image,
 * (8) file-backed vs procedural vs text slot ownership, (9) persistence round-trip + legacy ids,
 * (10) layout switch resets Layout-owned atom state and keeps Custom Elements.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import {
  PersistedAuthoredSlideSchema, authoringStateToPersistedSlide, createTemplateSlide, persistedSlideToAuthoringState,
} from '../carousel-state'
import {
  defaultContentForVariant, deriveAssetOverridesRequest, deriveHiddenElementsRequest, derivePrimitiveTransformsRequest, resolvePreviewInput, variantUsesContentImage, variantUsesLogo,
} from '../authoring-state'
import { previewOverrideAssets, type SlotLibraryFile } from '../asset-slots'
import { hasLayoutOwnedAuthoredWork } from '../layout-switch'
import { authoringReducer } from '../reducer'
import { authoringRenderRequestSchema } from '../render-request'
import type { AuthoringProductContext, AuthoringState } from '../types'
import {
  AUTHORING_ASSET_SLOT_IDS, EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout, layoutAssetSlots, layoutUsesLogo, slotView,
  type TemplateLayoutDefinition,
} from '@/lib/creative/templates/template-definitions'
import { normalizeElementOrder, normalizeHiddenElements, resolveElementStack } from '@/lib/creative/templates/element-stack'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import type { FreeSceneElement } from '@/lib/types'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf-8')

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

const LAYOUT_IDS = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'] as const
type LayoutId = typeof LAYOUT_IDS[number]
const layoutOf = (id: string): TemplateLayoutDefinition => getTemplateLayout(TEMPLATE, id)!

/** Content that makes EVERY optional unit of a layout exist, so every atom has something to paint. */
function fullContent(layoutId: LayoutId): Record<string, unknown> {
  const base = defaultContentForVariant(layoutId, 'a') as unknown as Record<string, unknown>
  switch (layoutId) {
    case 'cover': return { ...base, eyebrow: 'Memória viva', subtitle: 'Introdução do cover', source_line: 'Fonte do cover', detail_note: 'Nota da edição: texto da nota', brand_label: 'Portal Comunidades Alternativas' }
    case 'info': return { ...base, intro: 'Chamada do info', annotation: 'Anotação do info', source_line: 'Fonte do info', title: 'Uma pergunta, duas edições' }
    case 'list': return { ...base, intro: 'Introdução da lista', image_caption: 'Legenda da imagem', callout: 'Destaque da lista' }
    case 'grid': return { ...base, intro: 'Introdução da grade', ideas_title: 'Ideias', ideas: [{ icon: 'leaf', label: 'Ideia um' }, { icon: 'leaf', label: 'Ideia dois' }] }
    case 'map': return { ...base, intro: 'Introdução do mapa', places_more: 'e outros', note: 'Nota do mapa' }
    case 'network': return { ...base, kicker: 'Chamada da rede', intro: 'Introdução da rede', callout: { icon: 'leaf', text: 'Destaque da rede', bullets: ['a', 'b'] } }
    case 'quote': return { ...base, intro: 'Introdução da citação', bullets: ['Tópico um', 'Tópico dois'], callout: 'Destaque da citação' }
    case 'closing': return { ...base, cta_title: 'Convite', cta_text: 'Texto do convite', contact: 'contato@exemplo.org', tagline: 'Frase final', brand_label: 'Portal Comunidades Alternativas', items: [{ icon: 'leaf', label: 'Item um' }, { icon: 'leaf', label: 'Item dois' }] }
  }
}

const baseState = (layoutId: LayoutId, appearance?: 'light' | 'dark'): AuthoringState => {
  const state = persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId, appearance, id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait')
  return { ...state, contentOverride: fullContent(layoutId) as never }
}

type RenderExtras = { hero?: { url: string }; logo?: { url: string } }
function render(state: AuthoringState, extras: RenderExtras = {}): string {
  const input = resolvePreviewInput(state)
  const resolvedAssets = {
    ...input.resolvedAssets,
    ...(extras.hero ? { hero: { ref: 'hero', source: 'library_file', path: 'p', url: extras.hero.url, mime_type: 'image/png', fit: 'cover' } } : {}),
    ...(extras.logo ? { logo: { ref: 'logo', source: 'library_file', path: 'p', url: extras.logo.url, mime_type: 'image/png', fit: 'contain' } } : {}),
  }
  const props = documentaryCardPropsFromResolvedInput(
    { ...input, resolvedAssets: resolvedAssets as typeof input.resolvedAssets, manifest: { ...input.manifest, sequence: { index: 2, total: 5 } } },
    'still', undefined, state.tuning, undefined, derivePrimitiveTransformsRequest(state),
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) },
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}

const hide = (state: AuthoringState, ...ids: string[]) => ids.reduce((current, id) => authoringReducer(current, { type: 'TOGGLE_ELEMENT_VISIBILITY', id }), state)
const zOf = (state: AuthoringState) => resolveElementStack(TEMPLATE.id, state.variant, state.elementOrder).zIndex

/** Every element an atom paints carries its own stack z-index (unique per atom); hidden ones carry display:none or are not drawn. */
function paintedAtoms(state: AuthoringState, html: string): string[] {
  const zIndex = zOf(state)
  return layoutOf(state.variant).elements.map((element) => element.id).filter((id) => {
    const tags = html.match(new RegExp(`<div[^>]*style="[^"]*z-index:${zIndex[id]}(?:;|")[^"]*"[^>]*>`, 'g')) ?? []
    return tags.some((tag) => !/display:none/.test(tag))
  })
}

// The default paint order of every layout on origin/main (before atoms), BACK → FRONT.
const LEGACY_DEFAULT_ORDER: Record<LayoutId, string[]> = {
  cover: ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'noteText', 'tape2', 'paper', 'title', 'kicker', 'intro', 'source', 'brand'],
  info: ['archival', 'botanicalLeaf', 'tape1', 'tape2', 'botanical', 'card1', 'pin', 'paper', 'pin2', 'tape3', 'paperStrip', 'paperDark', 'title', 'source'],
  list: ['archival', 'botanicalLeaf', 'hero', 'tape1', 'botanical', 'callout', 'note', 'tape2', 'paperStrip', 'title'],
  grid: ['archival', 'botanicalLeaf', 'tiles', 'note', 'paperStrip', 'tape1', 'title'],
  map: ['botanicalLeaf', 'map', 'botanical', 'note', 'tape1', 'paperStrip', 'title'],
  network: ['ornament', 'cards', 'callout', 'paperStrip', 'title'],
  quote: ['botanicalLeaf', 'hero', 'callout', 'quote', 'tape1', 'paperStrip', 'title'],
  closing: ['ornament', 'botanicalLeaf', 'botanical', 'note', 'tape1', 'title'],
}

/** [text/atom, anchor] pairs whose relative paint position is fixed by the design: the text is ABOVE its paper, a frame BELOW its image. */
const TEXT_OVER_PAPER: Record<LayoutId, [string, string][]> = {
  cover: [['noteText', 'note']],
  info: [['card1Text', 'card1'], ['card2Text', 'paper'], ['introText', 'introBanner']],
  list: [['noteText', 'note'], ['calloutText', 'callout']],
  grid: [['ideasText', 'note']],
  map: [['noteText', 'note'], ['mapPins', 'map']],
  network: [['cardsText', 'cards'], ['calloutText', 'callout']],
  quote: [['quoteText', 'quote'], ['calloutText', 'callout']],
  closing: [['inviteText', 'note']],
}
const FRAME_UNDER_IMAGE: Record<string, [string, string][]> = {
  cover: [['heroFrame', 'hero']], list: [['heroFrame', 'hero']], quote: [['heroFrame', 'hero']], network: [['links', 'cards']],
}

describe.each(LAYOUT_IDS)('%s — atomic visual Elements', (layoutId) => {
  const layout = layoutOf(layoutId)
  const ids = layout.elements.map((element) => element.id)
  const control = (id: string) => layout.elements.find((element) => element.id === id)!.control

  it('1. registry: every Element is one atom with a spatial classification (independent / follows its anchor / fixed geometry)', () => {
    expect(new Set(ids).size).toBe(ids.length)
    expect([...layout.defaultStackOrder].sort()).toEqual([...ids].sort())
    for (const element of layout.elements) {
      expect(['transform', 'tuning', 'follows', 'fixed']).toContain(element.control.type)
      if (element.control.type === 'follows') {
        const parentId = element.control.parent
        const parent = layout.elements.find((candidate) => candidate.id === parentId)
        // a parent is an ANCHOR (something with its own position), never another follower: no chains, no graph
        expect(parent, `${element.id} -> ${parentId}`).toBeDefined()
        expect(['transform', 'tuning']).toContain(parent!.control.type)
      }
    }
    // Sections stay derived UI metadata: every atom resolves into a Section, none falls back
    expect(resolveLayoutSections(TEMPLATE, layout).flatMap((section) => section.elements.map((element) => element.id)).sort()).toEqual([...ids].sort())
    expect(resolveLayoutSections(TEMPLATE, layout).some((section) => section.id === 'other')).toBe(false)
  })

  it('2. default paint order: the pre-atom order is kept as a relative order; every new atom sits beside its anchor', () => {
    const legacy = LEGACY_DEFAULT_ORDER[layoutId]
    expect(layout.defaultStackOrder.filter((id) => legacy.includes(id))).toEqual(legacy.filter((id) => id !== 'brand'))
    for (const [text, anchor] of TEXT_OVER_PAPER[layoutId]) {
      const order = layout.defaultStackOrder
      expect(order.indexOf(text)).toBe(order.indexOf(anchor) + 1)
    }
    for (const [frame, image] of FRAME_UNDER_IMAGE[layoutId] ?? []) expect(layout.defaultStackOrder.indexOf(frame)).toBe(layout.defaultStackOrder.indexOf(image) - 1)
    // text units that used to paint on the fixed top layer still end the order (on top of everything that existed before)
    const preexisting = legacy.filter((id) => id !== 'brand' && layout.defaultStackOrder.includes(id) && layout.elements.find((element) => element.id === id)!.stackPlacement !== 'front')
    for (const element of layout.elements.filter((candidate) => candidate.stackPlacement === 'front' && !legacy.includes(candidate.id))) {
      for (const id of preexisting) expect(layout.defaultStackOrder.indexOf(element.id), `${element.id} over ${id}`).toBeGreaterThan(layout.defaultStackOrder.indexOf(id))
    }
  })

  it('3. the default render paints every atom (each has its own layer)', () => {
    const state = baseState(layoutId)
    expect(paintedAtoms(state, render(state)).sort()).toEqual([...ids].sort())
  })

  it('4. hiding ONE atom hides exactly that atom — never its anchor, its text, its frame, its siblings', () => {
    const state = baseState(layoutId)
    const all = paintedAtoms(state, render(state))
    for (const id of ids) {
      const painted = paintedAtoms(hide(state, id), render(hide(state, id)))
      expect(painted.sort(), `hide ${id}`).toEqual(all.filter((other) => other !== id).sort())
    }
  })

  it('5. paint order follows the stack: reversing it reverses the layers of every atom (text/fixed units included)', () => {
    const state = baseState(layoutId)
    const reversed = authoringReducer(state, { type: 'SET_ELEMENT_ORDER', order: [...layout.defaultStackOrder].reverse() })
    const html = render(reversed)
    expect(paintedAtoms(reversed, html).sort()).toEqual([...ids].sort())
    const z = zOf(reversed)
    layout.defaultStackOrder.forEach((id, index) => { if (index > 0) expect(z[id]).toBeLessThan(z[layout.defaultStackOrder[index - 1]]) })
    // default: anchored text above its paper, frame/links under their image/cards
    const zd = zOf(state)
    for (const [text, anchor] of TEXT_OVER_PAPER[layoutId]) expect(zd[text]).toBeGreaterThan(zd[anchor])
    for (const [frame, image] of FRAME_UNDER_IMAGE[layoutId] ?? []) expect(zd[frame]).toBeLessThan(zd[image])
  })

  it('6. a follower takes its anchor position (and only that): moving the anchor moves the follower, hiding one never hides the other', () => {
    const followers = layout.elements.filter((element) => element.control.type === 'follows')
    for (const follower of followers) {
      const anchor = layout.elements.find((element) => element.id === (follower.control as { parent: string }).parent)!
      let state = baseState(layoutId)
      if (anchor.control.type === 'transform') state = authoringReducer(state, { type: 'SET_PRIMITIVE_TRANSFORM', slot: anchor.control.key, field: 'offsetX', value: 37 })
      else if (anchor.control.type === 'tuning' && anchor.control.group === 'hero') state = { ...state, tuning: { ...state.tuning, hero: { ...state.tuning.hero, offsetX: 11 } } }
      else if (anchor.control.type === 'tuning' && anchor.control.group === 'brand') state = { ...state, tuning: { ...state.tuning, brand: { offsetX: 13, offsetY: 0, rotation: 0 } } }
      else continue
      const html = render(state)
      const z = zOf(state)
      const tag = (id: string) => html.match(new RegExp(`<div[^>]*style="[^"]*z-index:${z[id]}(?:;|")[^"]*"[^>]*>`))?.[0] ?? ''
      const needle = anchor.control.type === 'transform' ? 'translate(37px' : anchor.control.type === 'tuning' && anchor.control.group === 'hero' ? 'translate(11px' : 'translate(13px'
      expect(tag(anchor.id), `${anchor.id} moved`).toContain(needle)
      expect(tag(follower.id), `${follower.id} follows ${anchor.id}`).toContain(needle)
      // independent visibility both ways
      expect(paintedAtoms(hide(state, anchor.id), render(hide(state, anchor.id)))).toContain(follower.id)
      expect(paintedAtoms(hide(state, follower.id), render(hide(state, follower.id)))).toContain(anchor.id)
    }
  })

  it('7. a paint order saved before the atoms existed keeps texts on their paper, frames under their image, fixed texts on top', () => {
    // a heavily customized legacy order (the Cover's noteText already existed and is the author's to place, so it is not shuffled in)
    const legacy = LEGACY_DEFAULT_ORDER[layoutId].filter((id) => id !== 'brand' && id !== 'noteText')
    const shuffled = [...legacy].reverse()
    const normalized = normalizeElementOrder(layout, shuffled)
    for (const [text, anchor] of TEXT_OVER_PAPER[layoutId]) {
      if (!ids.includes(text)) continue
      // when the anchor is itself a fixed-layer unit the pair is placed together on top; otherwise right above it
      expect(normalized.indexOf(text)).toBeGreaterThan(normalized.indexOf(anchor))
    }
    for (const [frame, image] of FRAME_UNDER_IMAGE[layoutId] ?? []) expect(normalized.indexOf(frame)).toBe(normalized.indexOf(image) - 1)
    expect(normalized.filter((id) => legacy.includes(id))).toEqual(shuffled)
    // an atom the Template gained as a fixed-layer unit lands on top of the whole saved order
    for (const element of layout.elements.filter((candidate) => candidate.stackPlacement === 'front' && !LEGACY_DEFAULT_ORDER[layoutId].includes(candidate.id))) {
      for (const id of legacy) expect(normalized.indexOf(element.id), `${element.id} over ${id}`).toBeGreaterThan(normalized.indexOf(id))
    }
  })

  it('8. slot ownership: file-backed atoms own a slot; text and procedural atoms carry no fake file', () => {
    for (const element of layout.elements) {
      if (element.kind === 'text' || element.kind === 'shape') expect(element.assetSlot, element.id).toBeUndefined()
      else expect((AUTHORING_ASSET_SLOT_IDS as readonly string[]).includes(element.assetSlot as string), element.id).toBe(true)
    }
    const slots = layoutAssetSlots(TEMPLATE, layout).map(({ slot }) => slot.id)
    expect(slots.includes('logo')).toBe(variantUsesLogo(layoutId))
    expect(slots.includes('hero')).toBe(variantUsesContentImage(layoutId))
    expect(layoutUsesLogo(layout)).toBe(variantUsesLogo(layoutId))
  })

  it('9. persistence: atom state round-trips; a legacy row (no atom state) loads to the same render', () => {
    const state = hide(baseState(layoutId), ids[ids.length - 1], ids[1])
    const persisted = authoringStateToPersistedSlide(state, 's', 0)
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    const reloaded = persistedSlideToAuthoringState(JSON.parse(JSON.stringify(persisted)), productContext, 'portrait')
    expect(reloaded.hiddenElements).toEqual(normalizeHiddenElements(layout, state.hiddenElements))
    expect(render(reloaded)).toBe(render(state))
    const legacyRow = createTemplateSlide({ templateId: TEMPLATE.id, layoutId, id: 's', order: 0, primitiveProjectRef: null })!
    expect(persistedSlideToAuthoringState(legacyRow, productContext, 'portrait').hiddenElements).toBeUndefined()
    expect(persistedSlideToAuthoringState(legacyRow, productContext, 'portrait').elementOrder).toBeUndefined()
  })

  it('10. layout switch resets Layout-owned atom state (hidden ids, order) and keeps Custom Elements', () => {
    const other = layoutId === 'cover' ? 'info' : 'cover'
    let state = hide(baseState(layoutId), ids[0])
    state = authoringReducer(state, { type: 'SET_ELEMENT_ORDER', order: [...layout.defaultStackOrder].reverse() })
    state = authoringReducer(state, { type: 'SET_CUSTOM_ELEMENTS', elements: [CUSTOM] })
    expect(hasLayoutOwnedAuthoredWork(state)).toBe(true)
    const next = authoringReducer(state, { type: 'SET_VARIANT', variant: other })
    expect(next.hiddenElements).toBeUndefined()
    expect(next.elementOrder).toBeUndefined()
    expect(next.elements).toEqual([CUSTOM])
  })
})

describe('Cover — the editorial note and the required proofs A–G', () => {
  const cover = () => baseState('cover')
  const ZERO = (state: AuthoringState, id: string) => zOf(state)[id]
  const heroUrl = '/library/hero-a.png'
  const has = (html: string, text: string) => html.includes(text)

  it('NOTE RULE: "Nota da edição" text is ABOVE "Papel da nota" paper — default order, z-index and DOM order', () => {
    const state = cover()
    const order = resolveElementStack(TEMPLATE.id, 'cover', state.elementOrder).order
    expect(order.indexOf('noteText')).toBe(order.indexOf('note') + 1)
    expect(ZERO(state, 'noteText')).toBeGreaterThan(ZERO(state, 'note'))
    const html = render(state)
    expect(html.indexOf('aria-label="Papel da nota"')).toBeLessThan(html.indexOf('aria-label="Nota da edição"'))
    expect(has(html, 'texto da nota')).toBe(true)
  })

  it('NOTE RULE: hiding the paper leaves the text visible; hiding the text leaves the paper', () => {
    const paperHidden = render(hide(cover(), 'note'))
    expect(has(paperHidden, 'aria-label="Papel da nota"')).toBe(false)
    expect(has(paperHidden, 'texto da nota')).toBe(true)
    const textHidden = render(hide(cover(), 'noteText'))
    expect(has(textHidden, 'aria-label="Papel da nota"')).toBe(true)
    expect(has(textHidden, 'texto da nota')).toBe(false)
  })

  it('NOTE RULE: the paper resource change does not affect the text; the text keeps the paper geometry', () => {
    const state = authoringReducer(cover(), { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'note', field: 'rotation', value: 2 })
    const html = render(state)
    const box = (label: string) => html.match(new RegExp(`aria-label="${label}"[^>]*?(height:[\\d.]+px;left:[\\d.]+px;position:absolute;top:[\\d.]+px;width:[\\d.]+px;)`))?.[1]
    expect(box('Nota da edição')).toBe(box('Papel da nota'))
    // the paper's file lives in the "paperScrap" slot; replacing it touches the paper layer only
    const replaced = authoringReducer(cover(), { type: 'SET_ASSET_OVERRIDE', slot: 'paperScrap', libraryFileId: '0c5e2b9d-8a41-4c1f-b0a2-5d6e7f8a9b10' })
    const materials = { paperScrap: { ref: 'x', source: 'library_file', path: 'p', url: '/library/new-paper.png', mime_type: 'image/png', fit: 'contain' } }
    const input = resolvePreviewInput(replaced)
    const props = documentaryCardPropsFromResolvedInput({ ...input, manifest: { ...input.manifest, sequence: { index: 2, total: 5 } } }, 'still', undefined, replaced.tuning, materials as never, derivePrimitiveTransformsRequest(replaced), { templateId: TEMPLATE.id, elementOrder: undefined, hiddenElements: undefined })
    const swapped = renderToStaticMarkup(createElement(DocumentaryCard, props))
    expect(swapped).toContain('/library/new-paper.png')
    const textOf = (html2: string) => html2.match(/<div aria-label="Nota da edição"[\s\S]*?<\/div><\/div><\/div>/)?.[0]
    expect(textOf(swapped)).toBe(textOf(render(cover())))
  })

  it('NOTE RULE: a legacy Cover order (saved before the atoms) still renders the text on top of the paper', () => {
    const legacy = ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper', 'title']
    const state = authoringReducer(cover(), { type: 'SET_ELEMENT_ORDER', order: legacy })
    expect(paintedAtoms(state, render(state))).toContain('noteText')
    const order = normalizeElementOrder(layoutOf('cover'), legacy)
    expect(order.indexOf('noteText')).toBe(order.indexOf('note') + 1)
    const z = resolveElementStack(TEMPLATE.id, 'cover', legacy).zIndex
    expect(z.noteText).toBeGreaterThan(z.note)
  })

  it('A. hide the paper → the text stays        B. hide the text → the paper stays', () => {
    expect(paintedAtoms(hide(cover(), 'note'), render(hide(cover(), 'note')))).toContain('noteText')
    expect(paintedAtoms(hide(cover(), 'noteText'), render(hide(cover(), 'noteText')))).toContain('note')
  })

  it('C. hide a tape → both the note paper and its text stay (the tape is its own Element)', () => {
    const state = hide(cover(), 'tape2')
    const painted = paintedAtoms(state, render(state))
    expect(painted).toEqual(expect.arrayContaining(['note', 'noteText', 'tape1']))
    expect(painted).not.toContain('tape2')
  })

  it('D. hide the hero backing → the image stays        E. hide the hero image → the backing stays', () => {
    const backingHidden = hide(cover(), 'heroFrame')
    const htmlD = render(backingHidden, { hero: { url: heroUrl } })
    expect(paintedAtoms(backingHidden, htmlD)).toContain('hero')
    expect(htmlD).toContain(heroUrl)
    expect(htmlD).not.toContain('#e8dcc3')
    const imageHidden = hide(cover(), 'hero')
    const htmlE = render(imageHidden, { hero: { url: heroUrl } })
    expect(paintedAtoms(imageHidden, htmlE)).toContain('heroFrame')
    expect(htmlE).toContain('#e8dcc3')
    expect(htmlE).not.toContain(heroUrl)
  })

  it('F. logo artwork ownership is explicit: the "logo" slot (content asset), its own Element, a separate name Element', () => {
    const logo = layoutOf('cover').elements.find((element) => element.id === 'brandLogo')!
    const name = layoutOf('cover').elements.find((element) => element.id === 'brandName')!
    expect(logo).toMatchObject({ kind: 'image', assetSlot: 'logo' })
    expect(name).toMatchObject({ kind: 'text' })
    expect(name.assetSlot).toBeUndefined()
    expect(slotView(TEMPLATE, 'logo')).toMatchObject({ id: 'logo', role: 'content', label: 'Logo da marca' })
    // hiding the logo leaves the name (and keeps its place); hiding the name leaves the logo
    const noLogo = render(hide(cover(), 'brandLogo'))
    expect(noLogo).toContain('Portal Comunidades Alternativas')
    expect(noLogo).toMatch(/aria-label="Project brand mark"[^>]*visibility:hidden|visibility:hidden[^>]*aria-label="Project brand mark"|aria-label="Project brand mark"/)
    const noName = render(hide(cover(), 'brandName'))
    expect(noName).toContain('aria-label="Project brand mark"')
    const legacyBrand = normalizeHiddenElements(layoutOf('cover'), ['brand'])
    expect(legacyBrand).toEqual(['brandLogo', 'brandName'])
  })

  it('G. replacing a file-backed Element changes only that resource: hero → only the hero layer; logo → only the logo layer; paper slot → only paper layers', () => {
    const base = render(cover())
    const heroSwapped = render(cover(), { hero: { url: heroUrl } })
    expect(heroSwapped).toContain(heroUrl)
    expect(heroSwapped.replace(heroUrl, '')).not.toBe(base) // the hero layer changed…
    expect(base.match(/pack-b\/[\w-]+\.png/g)).toEqual(heroSwapped.match(/pack-b\/[\w-]+\.png/g)) // …and no material file changed
    const logoSwapped = render(cover(), { logo: { url: '/library/logo-b.png' } })
    expect(logoSwapped).toContain('/library/logo-b.png')
    expect(logoSwapped).not.toContain('comunidades-alternativas-logo-v1.svg')
    expect(base).toContain('comunidades-alternativas-logo-v1.svg')
    expect(base.match(/pack-b\/[\w-]+\.png/g)).toEqual(logoSwapped.match(/pack-b\/[\w-]+\.png/g))
    expect(logoSwapped.replace('/library/logo-b.png', '/creative-fixtures/comunidades-alternativas-logo-v1.svg')).toBe(base) // the two renders differ ONLY in the logo layer's file
  })
})

describe('Info / Lista / Encerramento — brand, frames and invitation atoms', () => {
  it('Info: the brand tab paper and the logo are independent (hide the tab → the logo stays, and vice-versa)', () => {
    const state = baseState('info', 'light')
    expect(paintedAtoms(hide(state, 'brandTab'), render(hide(state, 'brandTab')))).toContain('brandLogo')
    expect(paintedAtoms(hide(state, 'brandLogo'), render(hide(state, 'brandLogo')))).toContain('brandTab')
  })
  it('Info: the intro banner paper and the intro text are independent; the body text is its own unit', () => {
    const state = baseState('info', 'light')
    expect(paintedAtoms(hide(state, 'introBanner'), render(hide(state, 'introBanner')))).toContain('introText')
    expect(paintedAtoms(hide(state, 'introText'), render(hide(state, 'introText')))).toContain('introBanner')
    expect(paintedAtoms(hide(state, 'bodyText'), render(hide(state, 'bodyText')))).not.toContain('bodyText')
    expect(paintedAtoms(hide(state, 'annotation'), render(hide(state, 'annotation')))).toContain('bodyText')
  })
  it('Info: hiding a card paper keeps the card text', () => {
    const state = baseState('info', 'light')
    const html = render(hide(state, 'card1'))
    expect(html).toContain((fullContent('info').fact_cards as { primary: string }[])[0].primary)
  })
  it('Lista: the frame and the image are independent; the caption paper and caption text are independent; the brand logo has its own Element', () => {
    const state = baseState('list', 'light')
    expect(paintedAtoms(hide(state, 'heroFrame'), render(hide(state, 'heroFrame')))).toContain('hero')
    expect(paintedAtoms(hide(state, 'hero'), render(hide(state, 'hero')))).toContain('heroFrame')
    expect(render(hide(state, 'note'))).toContain('Legenda da imagem')
    expect(render(hide(state, 'noteText'))).not.toContain('Legenda da imagem')
    expect(render(hide(state, 'brandLogo'))).toMatch(/display:none[^>]*>(<div[^>]*aria-label="Project brand mark")/)
  })
  it('Encerramento: hiding the invitation paper keeps its text; the name and logo are independent', () => {
    const state = baseState('closing', 'dark')
    expect(render(hide(state, 'note'))).toContain('Texto do convite')
    expect(render(hide(state, 'inviteText'))).not.toContain('Texto do convite')
    expect(render(hide(state, 'brandName'))).toContain('aria-label="Project brand mark"')
    expect(render(hide(state, 'brandLogo'))).toContain('Portal Comunidades Alternativas')
  })
})

describe('the "logo" Asset Slot (existing LibraryFile model; not a Project Identity redesign)', () => {
  const LOGO_FILE = '6f3a0b3e-2c7b-4c3e-9a51-1f2d3c4b5a69'
  const files = new Map<string, SlotLibraryFile>([[LOGO_FILE, { id: LOGO_FILE, name: 'logo-marca.png', public_url: 'https://signed.example/logo.png', thumbnail_url: null, mime_type: 'image/png', origin: 'upload' }]])

  it('the slot is registered once, layouts that draw a signature offer it, and the others do not', () => {
    expect((AUTHORING_ASSET_SLOT_IDS as readonly string[]).filter((id) => id === 'logo')).toHaveLength(1)
    expect(LAYOUT_IDS.filter((id) => layoutUsesLogo(layoutOf(id)))).toEqual(['cover', 'info', 'list', 'closing'])
    expect(LAYOUT_IDS.filter((id) => variantUsesLogo(id))).toEqual(['cover', 'info', 'list', 'closing'])
  })

  it('the editor preview paints the override with the worker shape (contain), and the state persists / validates like every slot', () => {
    expect(previewOverrideAssets({ logo: { libraryFileId: LOGO_FILE } }, files).logo).toMatchObject({ ref: LOGO_FILE, source: 'library_file', fit: 'contain', url: 'https://signed.example/logo.png' })
    let state = authoringReducer(baseState('cover'), { type: 'SET_ASSET_OVERRIDE', slot: 'logo', libraryFileId: LOGO_FILE })
    expect(deriveAssetOverridesRequest(state)).toEqual({ logo: { libraryFileId: LOGO_FILE } })
    const persisted = authoringStateToPersistedSlide(state, 's', 0)
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    expect(persistedSlideToAuthoringState(persisted, productContext, 'portrait').assetOverrides).toEqual({ logo: { libraryFileId: LOGO_FILE } })
    expect(PersistedAuthoredSlideSchema.safeParse({ ...persisted, assetOverrides: { logo: { libraryFileId: 'not-a-uuid' } } }).success).toBe(false)
    state = authoringReducer(state, { type: 'USE_TEMPLATE_DEFAULT_ASSET', slot: 'logo' })
    expect(state.assetOverrides).toBeUndefined()
    const request = { manifest: resolvePreviewInput(baseState('cover')).manifest, assetOverrides: { logo: { libraryFileId: LOGO_FILE } }, templateId: TEMPLATE.id }
    expect(authoringRenderRequestSchema.safeParse(request).success).toBe(true)
  })

  it('a library_file logo is a valid manifest binding; the claim-time resolver freezes the id and refreshes only the URL; a missing file fails the claim', async () => {
    const base = resolvePreviewInput(baseState('cover')).manifest
    const manifest = { ...base, assets: { ...base.assets, logo: { type: 'library_file' as const, ref: LOGO_FILE, fit: 'contain' as const } } }
    expect(resolveStaticRenderManifest(manifest, { identitySnapshot: productContext.identitySnapshot }).valid).toBe(true)
    const snapshot = JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({
      manifest, identitySnapshot: productContext.identitySnapshot, assetOverrides: { logo: { libraryFileId: LOGO_FILE, mimeType: 'image/png', name: 'logo-marca.png' } }, slide: null,
    })))
    expect(parseStaticRenderExecutionSnapshot(snapshot).ok).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/X-Amz|https:\/\//)
    const rows = [{ id: LOGO_FILE, storage_path: 'users/u/library/logo-marca.png', deleted_at: null }]
    const one = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: rows, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=1` })
    const two = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: rows, createPresignedReadUrl: async (path) => `https://signed.example/${path}?t=2` })
    if (!one.ok || !two.ok) throw new Error('resolution failed')
    expect(one.staticInput.resolvedInput.resolvedAssets.logo).toMatchObject({ ref: LOGO_FILE, source: 'library_file', fit: 'contain', url: 'https://signed.example/users/u/library/logo-marca.png?t=1' })
    expect(two.staticInput.resolvedInput.resolvedAssets.logo.url).toContain('t=2')
    // the logo override never leaks into the material slots
    expect((one.staticInput.primitiveMaterials as Record<string, unknown> | undefined)?.logo).toBeUndefined()
    const gone = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: [], createPresignedReadUrl: async () => 'https://signed.example/x' })
    expect(gone).toMatchObject({ ok: false, code: 'ASSET_LIBRARY_FILE_UNAVAILABLE' })
  })

  it('the enqueue route binds the logo like the hero: only on layouts that draw one, from the validated override', () => {
    const route = read('app', 'api', 'creative', 'static-authoring', 'render', 'route.ts')
    expect(route).toMatch(/logoOverride && layoutUsesLogo\(layout\)/)
    expect(route).toMatch(/logo: \{ type: 'library_file' as const, ref: logoOverride\.libraryFileId, fit: 'contain' as const \}/)
  })
})

describe('Backward compatibility (migration: none)', () => {
  it('a compound id persisted by an earlier mission keeps its meaning: hidden "brand" hides both atoms; "brand" in a saved order expands in place', () => {
    const cover = layoutOf('cover')
    expect(normalizeHiddenElements(cover, ['brand', 'noteText'])).toEqual(['noteText', 'brandLogo', 'brandName'])
    const saved = ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'noteText', 'tape2', 'paper', 'title', 'kicker', 'intro', 'source', 'brand']
    const normalized = normalizeElementOrder(cover, saved)
    expect(normalized.slice(-2)).toEqual(['brandLogo', 'brandName'])
    expect(normalized.indexOf('heroFrame')).toBe(normalized.indexOf('hero') - 1)
    expect(normalized).not.toContain('brand')
  })

  it('every pre-existing authored field still loads: slides with tuning, transforms, order and hidden ids render without error in every layout', () => {
    for (const layoutId of LAYOUT_IDS) {
      const layout = layoutOf(layoutId)
      const row = { ...createTemplateSlide({ templateId: TEMPLATE.id, layoutId, id: 's', order: 0, primitiveProjectRef: null })!, elementOrder: LEGACY_DEFAULT_ORDER[layoutId].filter((id) => id !== 'brand'), hiddenElements: [LEGACY_DEFAULT_ORDER[layoutId][0]] }
      const state = persistedSlideToAuthoringState(row, productContext, 'portrait')
      expect(state.elementOrder).toEqual(normalizeElementOrder(layout, row.elementOrder))
      expect(() => render({ ...state, contentOverride: fullContent(layoutId) as never })).not.toThrow()
    }
  })
})
