/**
 * Portal Carousel Growth V1 — "Adicionar slide" (Template-level initializer),
 * layout "list" (Lista) and the real Slide 3 content.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import { renderEmphasis } from '@/components/creative/documentary-card/ListVariant'
import {
  authoringReducer,
  authoringStateToPersistedSlide,
  createTemplateSlide,
  defaultCarouselSlides,
  deriveElementOrderRequest,
  deriveManifestFromState,
  nextSlideId,
  nextSlideOrder,
  persistedSlideToAuthoringState,
  StaticAuthoringStateSchema,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION,
  type AuthoringListContent,
  type AuthoringProductContext,
  LIST_ITEMS_MAX,
  LIST_ITEMS_MIN,
} from '@/lib/creative/authoring'
import { LIST_EXAMPLE_CONTENT } from '@/lib/creative/templates/layout-examples'
import { documentaryCardFixtures } from '@/lib/creative/fixtures/documentary-card-fixtures'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { DocumentaryCardListContentSchema } from '@/lib/schemas/creative/documentary-card'
import {
  DEFAULT_TEMPLATE_ID,
  EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE,
  getTemplateLayout,
  layoutAssetSlots,
  layoutUsesContentImage,
} from '@/lib/creative/templates/template-definitions'

const PRIMITIVES = 'project:portal-comunidades-alternativas'

const productContext = {
  projectId: 'project-1',
  projectName: 'Portal Comunidades Alternativas',
  productionId: null,
  productionTitle: null,
  editorialContentId: 'ec-1',
  editorialContentTitle: 'O que são comunidades alternativas?',
  channelPieceId: 'cp-1',
  channel: 'instagram',
  format: 'carousel',
  projectIdentity: {},
  identitySnapshot: documentaryCardFixtures.cover45.tokens,
  primitiveProjectRef: PRIMITIVES,
} as unknown as AuthoringProductContext

const PACK_A_SLIDE_3: AuthoringListContent = {
  title: 'Quem estava fazendo essa pergunta?',
  intro: '**Carlos A. P. Tavares** (1956–) escrevia sobre aquele universo no momento em que ele se organizava.',
  items: [
    { icon: 'microphone', text: 'Apresentava o programa **Sociedade Alternativa,** na Rádio Gazeta AM de São Paulo.' },
    { icon: 'pencil', text: 'Escrevia a coluna **Anarquismo Vivo,** na revista **Planeta.**' },
    { icon: 'book', text: 'Formado em Jornalismo pela Faculdade Cásper Líbero. Trabalhou como bancário e livreiro.' },
  ],
  image_caption: 'Revista Planeta, março de 1983, texto “Anarquismo vivo”.',
}

function listSlide(appearance?: 'light' | 'dark') {
  const slide = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'list', appearance, id: 'slide-3', order: 2, primitiveProjectRef: PRIMITIVES })
  if (!slide) throw new Error('list layout missing')
  return slide
}

describe('Template layout "list" (Lista)', () => {
  const layout = getTemplateLayout(EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE, 'list')

  it('is ONE new template-scoped layout with Light/Dark and a full default stack', () => {
    expect(layout?.label).toBe('Lista')
    expect(layout?.supportedAppearances).toEqual(['light', 'dark'])
    expect(layout?.defaultAppearance).toBe('light')
    expect([...(layout?.defaultStackOrder ?? [])].sort()).toEqual(layout?.elements.map((element) => element.id).sort())
  })

  it('reuses existing slots only (no new asset slot) and draws the content image', () => {
    expect(layoutUsesContentImage(layout)).toBe(true)
    expect(layoutUsesContentImage(getTemplateLayout(EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE, 'info'))).toBe(false)
    const slots = layoutAssetSlots(EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE, layout!).map(({ slot }) => slot.id)
    // Completion V1 adds the optional callout on dark paper (paperDark) — still no new slot.
    expect(slots).toEqual(['paperStrip', 'hero', 'tape', 'paperScrap', 'botanicalLeaf', 'botanical', 'archival', 'paperDark'])
  })

  it('content schema: 2..4 items, closed icon set, optional intro/caption', () => {
    expect(DocumentaryCardListContentSchema.safeParse(PACK_A_SLIDE_3).success).toBe(true)
    expect(DocumentaryCardListContentSchema.safeParse({ ...PACK_A_SLIDE_3, items: PACK_A_SLIDE_3.items.slice(0, 1) }).success).toBe(false)
    expect(DocumentaryCardListContentSchema.safeParse({ ...PACK_A_SLIDE_3, items: [...PACK_A_SLIDE_3.items, ...PACK_A_SLIDE_3.items] }).success).toBe(false)
    expect(DocumentaryCardListContentSchema.safeParse({ ...PACK_A_SLIDE_3, items: [{ icon: 'rocket', text: 'x' }, ...PACK_A_SLIDE_3.items] }).success).toBe(false)
    expect(DocumentaryCardListContentSchema.safeParse({ title: 'T', items: PACK_A_SLIDE_3.items }).success).toBe(true)
  })
})

describe('Template-level slide initializer ("Adicionar slide")', () => {
  it('builds a List slide from Template defaults: exact Pack A Slide 3 content, default stack, no overrides', () => {
    const slide = listSlide()
    expect(slide.variant).toBe('list')
    expect(slide.appearance).toBe('light')
    expect(slide.content).toEqual(PACK_A_SLIDE_3)
    expect(slide.elementOrder).toBeUndefined()
    expect(slide.assetOverrides).toBeUndefined()
    expect(slide.primitiveSelection).toEqual({ paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' })
    expect(Object.values(slide.primitiveTransforms).every((transform) => transform.offsetX === 0 && transform.rotation === 0 && transform.scale === 1)).toBe(true)
  })

  it('honours a supported appearance and falls back to the layout default otherwise', () => {
    expect(listSlide('dark').appearance).toBe('dark')
    const cover = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'cover', id: 'slide-9', order: 8, primitiveProjectRef: null })
    expect(cover?.appearance).toBe('dark')
    expect(cover?.primitiveSelection).toEqual({})
  })

  it('refuses a layout the Template does not define (and an unknown template)', () => {
    expect(createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'gallery', id: 's', order: 0, primitiveProjectRef: null })).toBeNull()
    expect(createTemplateSlide({ templateId: 'unknown', layoutId: 'list', id: 's', order: 0, primitiveProjectRef: null })).toBeNull()
  })

  it('is not a clone: an edited slide never leaks into a new one', () => {
    const [cover] = defaultCarouselSlides(PRIMITIVES)
    const edited = { ...cover, content: { ...cover.content, title: 'Editado' }, elementOrder: ['title', 'paper'] }
    const added = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'cover', id: nextSlideId([edited.id]), order: nextSlideOrder([edited]), primitiveProjectRef: PRIMITIVES })
    expect(added?.content.title).toBe('O que são comunidades alternativas?')
    expect(added?.elementOrder).toBeUndefined()
  })

  it('ids are unique and stable; order appends after the last slide', () => {
    expect(nextSlideId(['slide-1', 'slide-2'])).toBe('slide-3')
    expect(nextSlideId(['slide-1', 'slide-7', 'custom'])).toBe('slide-8')
    expect(nextSlideId([])).toBe('slide-1')
    expect(nextSlideOrder([{ order: 0 }, { order: 1 }])).toBe(2)
    expect(nextSlideOrder([{ order: 5 }, { order: 1 }])).toBe(6)
    expect(nextSlideOrder([])).toBe(0)
  })

  it('first-open default is unchanged: cover/dark + info/light, same content as before', () => {
    const slides = defaultCarouselSlides(PRIMITIVES)
    expect(slides.map((slide) => [slide.id, slide.order, slide.variant, slide.appearance])).toEqual([['slide-1', 0, 'cover', 'dark'], ['slide-2', 1, 'info', 'light']])
    expect(slides[1].content.title).toBe('Uma pergunta, duas edições')
  })

  it('a 3-slide collection persists, validates and round-trips', () => {
    const slides = [...defaultCarouselSlides(PRIMITIVES), listSlide('dark')]
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', templateId: DEFAULT_TEMPLATE_ID, slides })
    expect(parsed.success).toBe(true)
    const state = persistedSlideToAuthoringState(slides[2], productContext, 'portrait', DEFAULT_TEMPLATE_ID)
    expect(state.variant).toBe('list')
    expect(state.contentOverride).toEqual(PACK_A_SLIDE_3)
    const back = authoringStateToPersistedSlide(state, 'slide-3', 2, DEFAULT_TEMPLATE_ID)
    expect(back.content).toEqual(slides[2].content)
    expect(back.appearance).toBe('dark')
  })
})

describe('Slide 3 render path', () => {
  const state = persistedSlideToAuthoringState(listSlide(), productContext, 'portrait', DEFAULT_TEMPLATE_ID)

  it('derives a valid List manifest with the collection sequence (3/3) and a content image', () => {
    const manifest = deriveManifestFromState(state, { index: 3, total: 3 })
    expect(manifest.template.variant).toBe('list')
    expect(manifest.sequence).toEqual({ index: 3, total: 3 })
    expect(manifest.assets.hero).toMatchObject({ type: 'fixture' })
    const resolved = resolveStaticRenderManifest({ ...manifest, identity: { snapshot_ref: productContext.identitySnapshot.snapshot_ref, token_profile: 'default' } }, { identitySnapshot: productContext.identitySnapshot })
    expect(resolved.valid).toBe(true)
    expect(deriveElementOrderRequest(state, DEFAULT_TEMPLATE_ID)).toEqual(['archival', 'botanicalLeaf', 'hero', 'tape1', 'botanical', 'callout', 'note', 'tape2', 'paperStrip', 'title'])
  })

  it('DocumentaryCard draws the List layout: title, bold runs, one row per item, caption, sequence', () => {
    const input = documentaryCardFixtures.list45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'list',
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      mode: 'still',
      sequence: { index: 3, total: 3 },
    }))
    expect(markup).toContain('Quem estava fazendo essa pergunta?')
    expect(markup).toContain('<strong style="font-weight:700">Carlos A. P. Tavares</strong>')
    expect(markup).toContain('data-list-items="3"')
    expect(markup).toContain('Revista Planeta, março de 1983, texto “Anarquismo vivo”.')
    expect(markup).toContain('>3/3</div>')
    expect(markup).not.toContain('**')
  })

  it('renderEmphasis only understands **bold**', () => {
    const markup = renderToStaticMarkup(createElement('p', null, renderEmphasis('a **b** c *d* e')))
    expect(markup).toBe('<p><span>a </span><strong style="font-weight:700">b</strong><span> c *d* e</span></p>')
  })

  it('content actions stay inside the List 2..4 bound and drop cleared optional fields', () => {
    const item = { icon: 'dot', text: 'Novo item' }
    let next = authoringReducer(state, { type: 'ADD_CONTENT_ITEM', path: ['items'], item, max: LIST_ITEMS_MAX })
    expect((next.contentOverride as AuthoringListContent).items).toHaveLength(4)
    expect(authoringReducer(next, { type: 'ADD_CONTENT_ITEM', path: ['items'], item, max: LIST_ITEMS_MAX })).toBe(next)
    next = authoringReducer(next, { type: 'REMOVE_CONTENT_ITEM', path: ['items'], index: 3, min: LIST_ITEMS_MIN })
    next = authoringReducer(next, { type: 'REMOVE_CONTENT_ITEM', path: ['items'], index: 2, min: LIST_ITEMS_MIN })
    expect(authoringReducer(next, { type: 'REMOVE_CONTENT_ITEM', path: ['items'], index: 0, min: LIST_ITEMS_MIN })).toBe(next)
    next = authoringReducer(next, { type: 'SET_CONTENT_VALUE', path: ['items', 1, 'icon'], value: 'book' })
    expect((next.contentOverride as AuthoringListContent).items[1]).toEqual({ icon: 'book', text: PACK_A_SLIDE_3.items[1].text })
    next = authoringReducer(next, { type: 'SET_CONTENT_VALUE', path: ['image_caption'], value: '', optional: true })
    expect('image_caption' in next.contentOverride).toBe(false)
    // The edit never leaks into the shared Template example.
    expect(LIST_EXAMPLE_CONTENT.items[1].icon).toBe('pencil')
  })
})

describe('Editor wiring (Adicionar slide, truthful totals)', () => {
  const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx'), 'utf-8')
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'creative', 'static-authoring', 'render', 'route.ts'), 'utf-8')

  it('shows a compact "+" beside the slide navigation, even for a single slide', () => {
    expect(page).toMatch(/aria-label="Adicionar slide"/)
    expect(page).not.toMatch(/isCarousel && slideTotal > 1/)
  })

  it('the dialog shows the Template read-only and offers its Layouts + supported Appearances', () => {
    expect(page).toMatch(/<DialogTitle>Adicionar slide<\/DialogTitle>/)
    expect(page).toMatch(/data-testid="add-slide-template">\{template\.name\}/)
    expect(page).toMatch(/template\.layouts\.map\(\(option\)/)
    expect(page).toMatch(/supportedAppearances \?\? \[\]\)\.map\(\(appearance\)/)
    expect(page).toMatch(/>Cancelar<\/Button>/)
  })

  it('adds through the Template initializer, appends by order and selects the new slide', () => {
    expect(page).toMatch(/createTemplateSlide\(\{\s*\n\s*templateId,\s*\n\s*layoutId: addLayoutId,/)
    expect(page).toMatch(/order: nextSlideOrder\(slides\)/)
    expect(page).toMatch(/setCurrentSlideIndex\(slides\.length\)/)
  })

  it('Voltar ao salvo keeps the selection inside the restored collection (removes an unsaved added slide safely)', () => {
    expect(page).toMatch(/setSlides\(restored\)\s*\n[^\n]*\n\s*setCurrentSlideIndex\(\(index\) => Math\.min\(index, restored\.length - 1\)\)/)
  })

  it('restores Template defaults by the slide layout, never by position', () => {
    expect(page).not.toMatch(/slide\.order === currentSlide\.order/)
    expect(page).toMatch(/layoutId: currentSlide\.state\.variant/)
  })

  it('totals come from the collection; no delete / duplicate / reorder controls', () => {
    expect(page).toMatch(/const slideRef = \{ id: currentSlide\.id, index: currentSlideIndex \+ 1, total: slides\.length \}/)
    expect(page).not.toMatch(/total: 2\b|\/2\b/)
    expect(page).not.toMatch(/Excluir slide|Duplicar slide|Reordenar slides/)
  })

  it('a content-image override binds on every layout that draws one (Cover, Lista)', () => {
    expect(route).toMatch(/heroOverride && layoutUsesContentImage\(layout\)/)
    expect(page).toMatch(/variantUsesContentImage\(state\.variant\) && overrideAssets\.hero/)
  })
})
