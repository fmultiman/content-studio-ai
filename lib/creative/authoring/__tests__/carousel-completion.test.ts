/**
 * Portal Carousel Completion V1 — Slides 4–10: the five new layouts (Grade,
 * Mapa, Rede, Citação, Encerramento), Lista's callout, the 10-slide collection
 * and the contracts that keep Slides 1–3 unchanged.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import { BRAZIL_UFS } from '@/components/creative/documentary-card/brazil-uf-geometry'
import { gridColumns } from '@/components/creative/documentary-card/GridVariant'
import { projectUf } from '@/components/creative/documentary-card/MapVariant'
import { networkLayout, networkLinks, networkRows } from '@/components/creative/documentary-card/NetworkVariant'
import { DOCUMENTARY_CARD_VARIANTS } from '@/components/creative/documentary-card/types'
import {
  AUTHORING_VARIANTS,
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
  variantUsesContentImage,
  type AuthoringProductContext,
  type AuthoringVariant,
  type PersistedAuthoredSlide,
} from '@/lib/creative/authoring'
import { LAYOUT_CONTENT_FIELDS, type ContentFieldDescriptor } from '@/lib/creative/authoring/layout-content-fields'
import { documentaryCardFixtures } from '@/lib/creative/fixtures/documentary-card-fixtures'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { listTemplates } from '@/lib/creative/templates/registry'
import {
  CLOSING_EXAMPLE_CONTENT,
  GRID_EXAMPLE_CONTENT,
  LIST_EXAMPLE_CONTENT,
  MAP_EXAMPLE_CONTENT,
  NETWORK_EXAMPLE_CONTENT,
  QUOTE_EXAMPLE_CONTENT,
} from '@/lib/creative/templates/layout-examples'
import {
  AUTHORING_ASSET_SLOT_IDS,
  DEFAULT_TEMPLATE_ID,
  EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE,
  getTemplateLayout,
  layoutUsesContentImage,
} from '@/lib/creative/templates/template-definitions'
import {
  BRAZIL_UF_CODES,
  DocumentaryCardClosingContentSchema,
  DocumentaryCardGridContentSchema,
  DocumentaryCardListContentSchema,
  DocumentaryCardMapContentSchema,
  DocumentaryCardNetworkContentSchema,
  DocumentaryCardQuoteContentSchema,
} from '@/lib/schemas/creative/documentary-card'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'

const PRIMITIVES = 'project:portal-comunidades-alternativas'
const productContext = {
  projectId: 'project-1', projectName: 'Portal Comunidades Alternativas', productionId: null, productionTitle: null,
  editorialContentId: 'ec-1', editorialContentTitle: 'O que são comunidades alternativas?', channelPieceId: 'cp-1',
  channel: 'instagram', format: 'carousel', projectIdentity: {}, identitySnapshot: documentaryCardFixtures.cover45.tokens,
  primitiveProjectRef: PRIMITIVES,
} as unknown as AuthoringProductContext

const NEW_LAYOUTS = [
  { id: 'grid', label: 'Grade', appearance: 'light', schema: DocumentaryCardGridContentSchema, example: GRID_EXAMPLE_CONTENT, hero: false },
  { id: 'map', label: 'Mapa', appearance: 'light', schema: DocumentaryCardMapContentSchema, example: MAP_EXAMPLE_CONTENT, hero: false },
  { id: 'network', label: 'Rede', appearance: 'dark', schema: DocumentaryCardNetworkContentSchema, example: NETWORK_EXAMPLE_CONTENT, hero: false },
  { id: 'quote', label: 'Citação', appearance: 'light', schema: DocumentaryCardQuoteContentSchema, example: QUOTE_EXAMPLE_CONTENT, hero: true },
  { id: 'closing', label: 'Encerramento', appearance: 'dark', schema: DocumentaryCardClosingContentSchema, example: CLOSING_EXAMPLE_CONTENT, hero: false },
] as const

/** Pack A Slides 4–5 as authored in the carousel (Lista reuse, not Template defaults). */
const SLIDE_4 = {
  title: 'Até a ficha catalográfica fala',
  intro: 'A própria catalogação da obra mostra os campos pelos quais aquele fenômeno era lido em meados dos anos 1980.',
  items: [{ icon: 'dot', text: 'ANARQUISMO' }, { icon: 'dot', text: 'GRUPOS SOCIAIS' }, { icon: 'dot', text: 'MARGINALIDADE SOCIAL' }, { icon: 'dot', text: 'COMUNIDADES ALTERNATIVAS – SOCIOLOGIA' }],
}
const SLIDE_5 = {
  title: 'Alternativa a quê?',
  intro: 'O livro nasce em um tempo marcado por ameaças globais e críticas profundas à sociedade industrial.',
  items: [{ icon: 'nuclear', text: 'ameaça nuclear e corrida armamentista' }, { icon: 'globe', text: 'crise ambiental' }, { icon: 'factory', text: 'crítica à sociedade industrial' }, { icon: 'cart', text: 'consumismo e alienação' }],
  callout: 'A questão não era apenas como morar junto. Era como experimentar outras formas de vida diante de uma civilização percebida como destrutiva.',
}

/** The real 10-slide collection: Slides 1–2 default, 3–10 grown through the Template initializer. */
function tenSlides(): PersistedAuthoredSlide[] {
  const slides = defaultCarouselSlides(PRIMITIVES)
  const plan: [AuthoringVariant, 'light' | 'dark', object?][] = [
    ['list', 'light'], ['list', 'light', SLIDE_4], ['list', 'dark', SLIDE_5], ['grid', 'light'], ['map', 'light'], ['network', 'dark'], ['quote', 'light'], ['closing', 'dark'],
  ]
  for (const [layoutId, appearance, content] of plan) {
    const created = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId, appearance, id: nextSlideId(slides.map((slide) => slide.id)), order: nextSlideOrder(slides), primitiveProjectRef: PRIMITIVES })
    if (!created) throw new Error(`missing layout ${layoutId}`)
    slides.push(content ? { ...created, content: structuredClone(content) as Record<string, unknown> } : created)
  }
  return slides
}

describe('Template registry — Completion V1 layouts', () => {
  it('the template, the renderer registry, the authoring types and the card dispatch agree on 8 layouts', () => {
    const ids = TEMPLATE.layouts.map((layout) => layout.id)
    expect(ids).toEqual(['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'])
    expect([...AUTHORING_VARIANTS]).toEqual(ids)
    expect([...DOCUMENTARY_CARD_VARIANTS]).toEqual(ids)
    expect(listTemplates().find((descriptor) => descriptor.id === 'editorial.documentary-card')?.variants).toEqual(ids)
  })

  it.each(NEW_LAYOUTS)('$label: label, appearances, default stack covering exactly its elements', ({ id, label, appearance }) => {
    const layout = getTemplateLayout(TEMPLATE, id)!
    expect(layout.label).toBe(label)
    expect([...layout.supportedAppearances].sort()).toEqual(['dark', 'light'])
    expect(layout.defaultAppearance).toBe(appearance)
    expect([...layout.defaultStackOrder].sort()).toEqual(layout.elements.map((element) => element.id).sort())
    expect(new Set(layout.elements.map((element) => element.id)).size).toBe(layout.elements.length)
  })

  it('adds no Asset Slot: every element slot is an existing template slot (or the content image)', () => {
    expect(AUTHORING_ASSET_SLOT_IDS).toHaveLength(11)
    for (const layout of TEMPLATE.layouts) {
      for (const element of layout.elements) {
        if (element.assetSlot) expect(AUTHORING_ASSET_SLOT_IDS).toContain(element.assetSlot)
      }
    }
  })

  it('content image: Cover, Lista and Citação draw it — registry and authoring agree', () => {
    for (const variant of AUTHORING_VARIANTS) {
      expect(layoutUsesContentImage(getTemplateLayout(TEMPLATE, variant))).toBe(variantUsesContentImage(variant))
    }
    expect(AUTHORING_VARIANTS.filter(variantUsesContentImage)).toEqual(['cover', 'list', 'quote'])
  })

  it('grouped content is one authored element per group (tiles, map, cards) — never per item', () => {
    expect(getTemplateLayout(TEMPLATE, 'grid')!.elements.map((element) => element.id)).toContain('tiles')
    expect(getTemplateLayout(TEMPLATE, 'map')!.elements.map((element) => element.id)).toContain('map')
    expect(getTemplateLayout(TEMPLATE, 'network')!.elements.map((element) => element.id)).toContain('cards')
    for (const layout of TEMPLATE.layouts) expect(layout.elements.length).toBeLessThanOrEqual(14)
  })
})

describe('Content schemas — exact Pack A examples and bounds', () => {
  it.each(NEW_LAYOUTS)('$label example (Pack A reference slide) is valid content', ({ schema, example }) => {
    expect(schema.safeParse(example).success).toBe(true)
  })

  it('Lista accepts Slides 4 and 5 (markers; four icon rows + callout)', () => {
    expect(DocumentaryCardListContentSchema.safeParse(SLIDE_4).success).toBe(true)
    expect(DocumentaryCardListContentSchema.safeParse(SLIDE_5).success).toBe(true)
    expect(DocumentaryCardListContentSchema.safeParse(LIST_EXAMPLE_CONTENT).success).toBe(true)
  })

  it('rejects content outside each layout contract', () => {
    expect(DocumentaryCardGridContentSchema.safeParse({ ...GRID_EXAMPLE_CONTENT, tiles: GRID_EXAMPLE_CONTENT.tiles.slice(0, 1) }).success).toBe(false)
    expect(DocumentaryCardGridContentSchema.safeParse({ ...GRID_EXAMPLE_CONTENT, tiles: [...GRID_EXAMPLE_CONTENT.tiles, GRID_EXAMPLE_CONTENT.tiles[0]] }).success).toBe(false)
    expect(DocumentaryCardMapContentSchema.safeParse({ ...MAP_EXAMPLE_CONTENT, places: [{ name: 'X', uf: 'XX' }] }).success).toBe(false)
    expect(DocumentaryCardNetworkContentSchema.safeParse({ ...NETWORK_EXAMPLE_CONTENT, nodes: NETWORK_EXAMPLE_CONTENT.nodes.slice(0, 2) }).success).toBe(false)
    expect(DocumentaryCardNetworkContentSchema.safeParse({ ...NETWORK_EXAMPLE_CONTENT, nodes: [...NETWORK_EXAMPLE_CONTENT.nodes, { title: 'X' }] }).success).toBe(false)
    const { quote: _quote, ...noQuote } = QUOTE_EXAMPLE_CONTENT
    void _quote
    expect(DocumentaryCardQuoteContentSchema.safeParse(noQuote).success).toBe(false)
    expect(DocumentaryCardClosingContentSchema.safeParse({ ...CLOSING_EXAMPLE_CONTENT, body: [] }).success).toBe(false)
    expect(DocumentaryCardGridContentSchema.safeParse({ ...GRID_EXAMPLE_CONTENT, extra: 1 }).success).toBe(false)
  })

  it('the map UF enum and the IBGE geometry cover the same 27 federative units', () => {
    expect([...BRAZIL_UF_CODES].sort()).toEqual([...BRAZIL_UFS].sort())
    expect(BRAZIL_UF_CODES).toHaveLength(27)
  })

  it('Content tab descriptors never produce invalid content: their new items/values are valid', () => {
    const examples: Record<string, object> = { list: LIST_EXAMPLE_CONTENT, grid: GRID_EXAMPLE_CONTENT, map: MAP_EXAMPLE_CONTENT, network: NETWORK_EXAMPLE_CONTENT, quote: QUOTE_EXAMPLE_CONTENT, closing: CLOSING_EXAMPLE_CONTENT }
    const schemas: Record<string, { safeParse: (value: unknown) => { success: boolean } }> = { list: DocumentaryCardListContentSchema, grid: DocumentaryCardGridContentSchema, map: DocumentaryCardMapContentSchema, network: DocumentaryCardNetworkContentSchema, quote: DocumentaryCardQuoteContentSchema, closing: DocumentaryCardClosingContentSchema }
    expect(Object.keys(LAYOUT_CONTENT_FIELDS).sort()).toEqual(Object.keys(examples).sort())
    for (const [variant, fields] of Object.entries(LAYOUT_CONTENT_FIELDS) as [string, readonly ContentFieldDescriptor[]][]) {
      for (const field of fields) {
        const base = structuredClone(examples[variant]) as Record<string, unknown>
        if (field.kind === 'items' || field.kind === 'strings') {
          const current = (base[field.key] as unknown[] | undefined) ?? []
          const next = current.length < field.max ? [...current, field.newItem] : current
          expect(schemas[variant].safeParse({ ...base, [field.key]: next }).success, `${variant}.${field.key}`).toBe(true)
        }
        if (field.kind === 'group') expect(schemas[variant].safeParse({ ...base, [field.key]: field.newValue }).success, `${variant}.${field.key}`).toBe(true)
      }
    }
  })
})

describe('Layout initialization (Adicionar slide)', () => {
  it.each(NEW_LAYOUTS)('$label starts from its Template example, default appearance, default stack', ({ id, appearance, example }) => {
    const slide = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: id, id: 'slide-9', order: 8, primitiveProjectRef: PRIMITIVES })!
    expect(slide.variant).toBe(id)
    expect(slide.appearance).toBe(appearance)
    expect(slide.content).toEqual(example)
    expect(slide.elementOrder).toBeUndefined()
    expect(slide.assetOverrides).toBeUndefined()
  })

  it('a new slide never aliases the shared Template example', () => {
    const slide = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'network', id: 'slide-8', order: 7, primitiveProjectRef: null })!
    ;(slide.content.nodes as { title: string }[])[0].title = 'Mudado'
    expect(NETWORK_EXAMPLE_CONTENT.nodes[0].title).toBe('Planeta')
  })

  it('Encerramento takes the brand label from the live Project name, like Cover', () => {
    const slide = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'closing', id: 'slide-10', order: 9, primitiveProjectRef: null })!
    const state = persistedSlideToAuthoringState(slide, productContext, 'portrait', DEFAULT_TEMPLATE_ID)
    expect((state.contentOverride as { brand_label?: string }).brand_label).toBe('Portal Comunidades Alternativas')
  })

  it('Restaurar padrão resolves by the slide layout for every layout, never by position', () => {
    const slides = tenSlides()
    for (const slide of slides) {
      const restored = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: slide.variant, id: slide.id, order: slide.order, primitiveProjectRef: PRIMITIVES })!
      expect(restored.variant).toBe(slide.variant)
      expect(restored.id).toBe(slide.id)
      expect(restored.order).toBe(slide.order)
    }
    // Slide 4 (Lista at position 4) restores to the Lista example, not to anything positional.
    const restored4 = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: slides[3].variant, id: 'slide-4', order: 3, primitiveProjectRef: PRIMITIVES })!
    expect(restored4.content).toEqual(LIST_EXAMPLE_CONTENT)
  })
})

describe('The 10-slide collection', () => {
  const slides = tenSlides()

  it('has stable unique ids slide-1..slide-10, deterministic orders and the intended layouts', () => {
    expect(slides.map((slide) => slide.id)).toEqual(Array.from({ length: 10 }, (_, index) => `slide-${index + 1}`))
    expect(slides.map((slide) => slide.order)).toEqual(Array.from({ length: 10 }, (_, index) => index))
    expect(slides.map((slide) => slide.variant)).toEqual(['cover', 'info', 'list', 'list', 'list', 'grid', 'map', 'network', 'quote', 'closing'])
    expect(slides.map((slide) => slide.appearance)).toEqual(['dark', 'light', 'light', 'light', 'dark', 'light', 'light', 'dark', 'light', 'dark'])
  })

  it('persists as one valid state and every slide round-trips', () => {
    expect(StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', templateId: DEFAULT_TEMPLATE_ID, slides }).success).toBe(true)
    for (const slide of slides) {
      const state = persistedSlideToAuthoringState(slide, productContext, 'portrait', DEFAULT_TEMPLATE_ID)
      const back = authoringStateToPersistedSlide(state, slide.id, slide.order, DEFAULT_TEMPLATE_ID)
      expect(back.variant).toBe(slide.variant)
      expect(back.content).toMatchObject(slide.content)
    }
  })

  it('every slide derives a valid manifest with its truthful sequence (n/10) and freezes it in the snapshot', () => {
    slides.forEach((slide, index) => {
      const state = persistedSlideToAuthoringState(slide, productContext, 'portrait', DEFAULT_TEMPLATE_ID)
      const manifest = { ...deriveManifestFromState(state, { index: index + 1, total: slides.length }), identity: { snapshot_ref: productContext.identitySnapshot.snapshot_ref, token_profile: 'default' as const } }
      expect(manifest.sequence).toEqual({ index: index + 1, total: 10 })
      const resolved = resolveStaticRenderManifest(manifest, { identitySnapshot: productContext.identitySnapshot })
      expect(resolved.valid, `slide ${index + 1}`).toBe(true)
      const snapshot = buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: productContext.identitySnapshot, templateId: DEFAULT_TEMPLATE_ID, elementOrder: deriveElementOrderRequest(state, DEFAULT_TEMPLATE_ID), slide: { id: slide.id, index: index + 1, total: 10 } })
      const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
      expect(parsed.ok).toBe(true)
      expect(snapshot.slide).toEqual({ id: slide.id, index: index + 1, total: 10 })
      expect(snapshot.manifest.template.variant).toBe(slide.variant)
    })
  })

  it('slides are isolated: editing Slide 4 changes nothing on Slide 5', () => {
    const state4 = persistedSlideToAuthoringState(slides[3], productContext, 'portrait', DEFAULT_TEMPLATE_ID)
    const state5 = persistedSlideToAuthoringState(slides[4], productContext, 'portrait', DEFAULT_TEMPLATE_ID)
    const edited = authoringReducer(state4, { type: 'SET_CONTENT_VALUE', path: ['items', 0, 'text'], value: 'EDITADO' })
    expect((edited.contentOverride as typeof SLIDE_4).items[0].text).toBe('EDITADO')
    expect((state5.contentOverride as typeof SLIDE_5).items[0].text).toBe('ameaça nuclear e corrida armamentista')
    expect(SLIDE_4.items[0].text).toBe('ANARQUISMO')
  })

  it('Slides 1–3 are unchanged: first-open defaults and the Slide 3 example', () => {
    expect(defaultCarouselSlides(PRIMITIVES).map((slide) => [slide.id, slide.variant, slide.appearance, slide.content.title])).toEqual([
      ['slide-1', 'cover', 'dark', 'O que são comunidades alternativas?'],
      ['slide-2', 'info', 'light', 'Uma pergunta, duas edições'],
    ])
    expect(slides[2].content).toEqual(LIST_EXAMPLE_CONTENT)
    expect(LIST_EXAMPLE_CONTENT.title).toBe('Quem estava fazendo essa pergunta?')
  })
})

describe('Renderer — layout dispatch and geometry', () => {
  const render = (fixture: (typeof documentaryCardFixtures)[keyof typeof documentaryCardFixtures], variant: string, sequence = { index: 6, total: 10 }) => renderToStaticMarkup(createElement(DocumentaryCard, {
    variant: variant as never, content: fixture.manifest.content as never, assets: fixture.resolvedAssets, tokens: fixture.tokens, canvas: fixture.manifest.canvas, mode: 'still', sequence,
  }))

  it.each([
    ['grid', 'grid45', ['rurais', 'religiosas/místicas', 'Ideias que atravessavam muitas delas:', 'busca de autossuficiência']],
    ['map', 'map45', ['Comunicampo (MT)', 'Tribo da Terra (RS)', 'e muitas outras…', 'Base cartográfica: IBGE', 'data-map-places="10"']],
    ['network', 'network45', ['Antes da internet, uma rede de informação', 'Boletim dos Sarvas', 'rock e costumes']],
    ['quote', 'quote45', ['Isso não diminui o valor do livro. Muda a forma de lê-lo.', 'conflitos internos e alta rotatividade', 'aria-label="Imagem"']],
    ['closing', 'closing45', ['memoria@comunidadesalternativas.com.br', 'fotografias e cartas', 'Memória • Conhecimento • Conexão']],
  ] as const)('%s dispatches to its own component and draws its content', (variant, fixture, needles) => {
    const markup = render(documentaryCardFixtures[fixture], variant)
    expect(markup).toContain(`aria-label="Editorial documentary card ${variant}"`)
    for (const needle of needles) expect(markup).toContain(needle)
    expect(markup).toContain('>6/10</div>')
  })

  it('Lista draws the optional callout only when present (Slide 5), never an empty caption paper', () => {
    const base = documentaryCardFixtures.list45
    const withCallout = renderToStaticMarkup(createElement(DocumentaryCard, { variant: 'list', content: SLIDE_5 as never, assets: base.resolvedAssets, tokens: base.tokens, canvas: base.manifest.canvas, mode: 'still' }))
    expect(withCallout).toContain('aria-label="Caixa de destaque"')
    expect(withCallout).not.toContain('aria-label="Papel da legenda"')
    const slide3 = render(base, 'list', { index: 3, total: 10 })
    expect(slide3).toContain('aria-label="Papel da legenda"')
    expect(slide3).not.toContain('aria-label="Caixa de destaque"')
  })

  it('grid columns, network rows/links and UF projection are deterministic', () => {
    expect([2, 3, 4, 5, 6].map(gridColumns)).toEqual([2, 3, 2, 3, 3])
    expect(networkRows(9)).toEqual([3, 2, 4])
    const boxes = networkLayout(9, 612, 1024)
    expect(boxes).toHaveLength(9)
    expect(boxes.every((box) => box.left >= 60 && box.left + box.width <= 1020 && box.top >= 612 && box.top + box.height <= 1024)).toBe(true)
    expect(networkLinks(boxes).length).toBeGreaterThanOrEqual(8)
    const sp = projectUf('SP', 630)
    const mt = projectUf('MT', 630)
    const rs = projectUf('RS', 630)
    expect(sp.left).toBeGreaterThan(mt.left)
    expect(rs.top).toBeGreaterThan(sp.top)
    expect(projectUf('SP', 630, 1)).not.toEqual(sp)
  })
})

describe('Editor navigation with 10 slides', () => {
  const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'projetos', '[id]', 'conteudos', '[editorialContentId]', 'channel-pieces', '[channelPieceId]', 'editar-visual', 'page.tsx'), 'utf-8')
  it('the slide navigation wraps instead of running off a phone-width viewport', () => {
    expect(page).toMatch(/className="flex max-w-full flex-wrap items-center justify-center gap-1" role="group" aria-label="Slides"/)
  })
})

describe('Worker runtime export covers every layout', () => {
  const exportScript = readFileSync(join(process.cwd(), 'infra', 'render-worker-runtime', 'export.mjs'), 'utf-8')
  it.each(['ListVariant', 'GridVariant', 'MapVariant', 'NetworkVariant', 'QuoteVariant', 'ClosingVariant', 'layout-kit', 'icons', 'brazil-uf-geometry'])('%s is exported to the VPS runtime', (file) => {
    expect(exportScript).toMatch(new RegExp(`components/creative/documentary-card/${file}\\.tsx?'`))
  })
})
