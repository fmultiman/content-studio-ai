/**
 * CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — regressions from a real human Production pass.
 *
 *  - Canvas image source (Finding A): the Canvas paints only a resolved, signed URL; an unresolved image draws nothing.
 *  - Cover Anatomy child order (Finding E): DISPLAY order only. It never touches elementOrder, paint order, persisted
 *    state or Camadas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FreeStage, type FreeStageElement } from '@/components/creative/free/free-stage'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { authoringStateToPersistedSlide, createTemplateSlide, persistedSlideToAuthoringState, PersistedAuthoredSlideSchema } from '@/lib/creative/authoring/carousel-state'
import { deriveElementOrderRequest, deriveHiddenElementsRequest, derivePrimitiveTransformsRequest, resolvePreviewInput } from '@/lib/creative/authoring/authoring-state'
import { authoringReducer } from '@/lib/creative/authoring/reducer'
import type { AuthoringProductContext, AuthoringState } from '@/lib/creative/authoring/types'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout } from '@/lib/creative/templates/template-definitions'
import { moveElementInOrder, normalizeElementOrder, resolveElementStack } from '@/lib/creative/templates/element-stack'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'

const COVER = getTemplateLayout(TEMPLATE, 'cover')!

// The Cover paint order, BACK -> FRONT, as authored in the registry. Pinned literally: nothing about Anatomy may move it.
const COVER_PAINT_ORDER = ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'noteText', 'tape2', 'paper', 'title', 'kicker', 'intro', 'source', 'brandLogo']

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
const cover = () => persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId: 'cover', appearance: 'dark', id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait')

function renderCover(state: AuthoringState): string {
  const input = resolvePreviewInput(state)
  const props = documentaryCardPropsFromResolvedInput(
    { ...input, manifest: { ...input.manifest, sequence: { index: 1, total: 3 } } },
    'still', undefined, state.tuning, undefined, derivePrimitiveTransformsRequest(state),
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) },
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}
/** The stack layer of an Element as the renderer assigned it (the paint order made visible). */
const zOf = (state: AuthoringState) => resolveElementStack(TEMPLATE.id, 'cover', state.elementOrder).zIndex

describe('Canvas image source — the Canvas paints a resolved URL; only a genuinely unresolved image draws nothing', () => {
  const element = { element_id: 'e1', kind: 'image', asset_ref: 'ref-1', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, fit: 'cover' } as unknown as FreeStageElement
  const tokens = { colors: { background: '#fff', foreground: '#000' }, typography: { display: { family: 'Fraunces' }, body: { family: 'Source Sans 3' } } }
  const draw = (imageUrl: (ref: string) => { url?: string; alt?: string } | undefined) =>
    renderToStaticMarkup(createElement(FreeStage, { elements: [element], width: 1080, height: 1350, tokens, imageUrl, ImageComponent: ({ src, alt, style }) => createElement('img', { src, alt, style }) }))

  it('1/2/7. a resolved (signed) source is drawn as the image — no file-name text', () => {
    const html = draw(() => ({ url: 'https://signed.example/a.png?X-Amz-Signature=1', alt: 'capa-do-livro.png' }))
    expect(html).toContain('<img src="https://signed.example/a.png?X-Amz-Signature=1"')
    expect(html).toContain('data-free-kind="image"')
  })

  it('9. an image whose source is genuinely unresolved draws nothing (no broken image, no file-name text)', () => {
    const html = draw(() => undefined)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('capa-do-livro.png')
  })

  it('10. the authored identity stays the LibraryFile id; the renderer receives an asset ref, never a generation row', () => {
    const route = readFileSync(join(process.cwd(), 'app', 'api', 'creative', 'static-authoring', 'render', 'route.ts'), 'utf-8')
    expect(route).toContain('library_file_id')
    expect(route).not.toMatch(/from\('(images|video_generations)'\)/)
  })
})

describe('Cover Anatomy child order — human-readable DISPLAY order, derived, never paint order', () => {
  const sections = () => resolveLayoutSections(TEMPLATE, COVER)
  const idsOf = (sectionId: string) => sections().find((section) => section.id === sectionId)!.elements.map((element) => element.id)
  const labelsOf = (sectionId: string) => sections().find((section) => section.id === sectionId)!.elements.map((element) => element.label)

  it('22. Hero reads Fita da imagem -> Imagem principal (what is on top first); the removed backing is not listed', () => {
    expect(labelsOf('hero')).toEqual(['Fita da imagem', 'Imagem principal'])
    expect(sections().flatMap((section) => section.elements.map((element) => element.label))).not.toContain('Moldura da imagem principal')
  })

  it('23. Nota editorial reads Fita da nota -> Nota da edição -> Papel da nota', () => {
    expect(labelsOf('editorial-note')).toEqual(['Fita da nota', 'Nota da edição', 'Papel da nota'])
  })

  it('24. Bloco de título reads Título -> Papel do título', () => {
    expect(labelsOf(COVER.elements.length ? 'title-block' : '')).toEqual(['Título', 'Papel do título'])
    expect(idsOf('signature')).toEqual(['brandLogo'])
  })

  it('25. the display order does NOT modify elementOrder: the default stays the registry paint order, a custom order is stored verbatim', () => {
    expect([...COVER.defaultStackOrder]).toEqual(COVER_PAINT_ORDER)
    expect(cover().elementOrder).toBeUndefined()
    expect(deriveElementOrderRequest(cover())).toEqual(COVER_PAINT_ORDER)
    const custom = [...COVER_PAINT_ORDER.slice(0, 3), 'tape1', 'hero', 'botanical', ...COVER_PAINT_ORDER.slice(6)]
    const state = authoringReducer(cover(), { type: 'SET_ELEMENT_ORDER', order: custom })
    expect(state.elementOrder).toEqual(custom)
    expect(authoringStateToPersistedSlide(state, 's', 0).elementOrder).toEqual(custom)
    // Anatomy is independent of it: the same Sections, in the same display order, for any authored paint order
    expect(sections().map((section) => [section.id, section.elements.map((element) => element.id)])).toEqual(
      resolveLayoutSections(TEMPLATE, COVER).map((section) => [section.id, section.elements.map((element) => element.id)]),
    )
    expect(idsOf('hero')).toEqual(['tape1', 'hero'])
  })

  it('26. the display order does NOT change the final paint order: tape above hero, text above its paper, title above its paper (as before)', () => {
    const z = zOf(cover())
    expect(z.tape1).toBeGreaterThan(z.hero) // Anatomy lists the tape first; it is also the front-most of the two
    expect(z.noteText).toBeGreaterThan(z.note)
    expect(z.tape2).toBeGreaterThan(z.noteText)
    expect(z.title).toBeGreaterThan(z.paper)
    // …and the render actually uses those layers
    const html = renderCover(cover())
    for (const id of ['hero', 'tape1', 'note', 'noteText', 'tape2', 'paper', 'title']) expect(html).toContain(`z-index:${z[id]}`)
    // an authored order that puts the hero above its tape renders that order, whatever Anatomy lists first
    const custom = authoringReducer(cover(), { type: 'SET_ELEMENT_ORDER', order: [...COVER_PAINT_ORDER.filter((id) => id !== 'hero'), 'hero'] })
    expect(zOf(custom).hero).toBeGreaterThan(zOf(custom).tape1)
    expect(idsOf('hero')).toEqual(['tape1', 'hero'])
  })

  it('27. Sections stay derived and non-persisted: nothing of them is in the saved slide, and the registry imports no authored state', () => {
    const persisted = authoringStateToPersistedSlide(cover(), 's', 0)
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    const json = JSON.stringify(persisted)
    for (const forbidden of ['section', 'anatomy', 'editorial-note', 'title-block', 'Nota editorial']) expect(json).not.toContain(forbidden)
    const source = readFileSync(join(process.cwd(), 'lib', 'creative', 'templates', 'template-anatomy.ts'), 'utf-8')
    expect(source).not.toMatch(/from '.*(authoring|element-stack|carousel-state)/)
    expect(source).toContain('NOT persisted authored state')
  })
})

describe('Camadas regression — it keeps reading the factual paint order (not touched by this mission)', () => {
  it('28/29. the stack the Camadas tab lists is the persisted/default paint order, unaffected by the Anatomy registry', () => {
    expect(resolveElementStack(TEMPLATE.id, 'cover', undefined).order).toEqual(COVER_PAINT_ORDER)
    // Camadas shows the front-most first: exactly the reverse of the stack
    expect([...resolveElementStack(TEMPLATE.id, 'cover', undefined).order].reverse()[0]).toBe('brandLogo')
    // the Anatomy flat order is NOT the paint order (they are different things) and neither follows the other
    expect(resolveLayoutSections(TEMPLATE, COVER).flatMap((section) => section.elements.map((element) => element.id))).not.toEqual(COVER_PAINT_ORDER)
  })

  it('30. the supported reorder still works on the same stack (move one layer forward)', () => {
    const from = COVER_PAINT_ORDER.indexOf('hero')
    const moved = moveElementInOrder(COVER_PAINT_ORDER, from, from + 1)
    expect(moved.indexOf('hero')).toBe(from + 1)
    expect(moved.indexOf('botanical')).toBe(from)
    expect(normalizeElementOrder(COVER, moved)).toEqual(moved)
  })

  it('31. the final render follows the persisted paint-order semantics: layers strictly increase along the order, for the default and an authored one', () => {
    for (const order of [COVER_PAINT_ORDER, moveElementInOrder(COVER_PAINT_ORDER, COVER_PAINT_ORDER.indexOf('hero'), COVER_PAINT_ORDER.length - 1)]) {
      const state = authoringReducer(cover(), { type: 'SET_ELEMENT_ORDER', order })
      const z = zOf(state)
      const normalized = normalizeElementOrder(COVER, state.elementOrder)
      normalized.forEach((id, index) => { if (index > 0) expect(z[id]).toBeGreaterThan(z[normalized[index - 1]]) })
      expect(renderCover(state)).toContain(`z-index:${z.hero}`)
    }
  })
})
