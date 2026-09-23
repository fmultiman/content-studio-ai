/**
 * Slice 1 — Portal Carousel V1: persisted static-authoring state contract.
 *
 * Verifies:
 * - defaultCarouselSlides produces the Pack B acceptance shape (cover/dark, info/light)
 * - the persisted contract validates a real 2-slide carousel and rejects malformed input
 * - AuthoringState <-> PersistedAuthoredSlide round-trips without loss
 * - editing one slide's derived record never mutates another slide's
 * - sequence.index/total derive from the real slide collection, not a hardcoded 10
 */
import { describe, expect, it } from 'vitest'
import {
  StaticAuthoringStateSchema,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION,
  authoringStateToPersistedSlide,
  defaultCarouselSlides,
  persistedSlideToAuthoringState,
  sortedSlides,
} from '../carousel-state'
import { createContextualAuthoringState, deriveManifestFromState } from '../authoring-state'
import type { AuthoringCoverContent, AuthoringInfoContent, AuthoringProductContext } from '../types'

const productContext: AuthoringProductContext = {
  projectId: 'project-1',
  projectName: 'Portal Comunidades Alternativas',
  productionId: null,
  productionTitle: null,
  editorialContentId: 'ec-1',
  editorialContentTitle: 'Carrossel de teste',
  channelPieceId: 'cp-1',
  channel: 'instagram',
  format: 'carousel',
  projectIdentity: { schema_version: 1 } as AuthoringProductContext['projectIdentity'],
  identitySnapshot: {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'project:project-1:snapshot',
    typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } },
    colors: { background: '#F6F0E4', foreground: '#16352F' },
    spacing: { unit: 8 },
  },
}

describe('defaultCarouselSlides', () => {
  it('produces exactly slide 1 = cover/dark and slide 2 = info/light (Pack B acceptance shape)', () => {
    const slides = defaultCarouselSlides('project:portal-comunidades-alternativas')
    expect(slides).toHaveLength(2)
    expect(slides[0]).toMatchObject({ id: 'slide-1', order: 0, variant: 'cover', appearance: 'dark' })
    expect(slides[1]).toMatchObject({ id: 'slide-2', order: 1, variant: 'info', appearance: 'light' })
  })

  it('seeds primitive selection only when a project primitive catalog exists', () => {
    const withCatalog = defaultCarouselSlides('project:portal-comunidades-alternativas')
    expect(withCatalog[0].primitiveSelection).toEqual({ paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' })

    const withoutCatalog = defaultCarouselSlides(null)
    expect(withoutCatalog[0].primitiveSelection).toEqual({})
  })

  it('validates against StaticAuthoringStateSchema as a real 2-slide carousel record', () => {
    const slides = defaultCarouselSlides('project:portal-comunidades-alternativas')
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', slides })
    expect(parsed.success).toBe(true)
  })
})

describe('StaticAuthoringStateSchema', () => {
  it('rejects an empty slides array', () => {
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', slides: [] })
    expect(parsed.success).toBe(false)
  })

  it('rejects duplicate slide ids', () => {
    const slides = defaultCarouselSlides(null)
    const duplicated = [slides[0], { ...slides[1], id: slides[0].id }]
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', slides: duplicated })
    expect(parsed.success).toBe(false)
  })

  it('rejects duplicate order values', () => {
    const slides = defaultCarouselSlides(null)
    const duplicated = [slides[0], { ...slides[1], order: slides[0].order }]
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', slides: duplicated })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown schemaVersion', () => {
    const slides = defaultCarouselSlides(null)
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: 'static-authoring-state.v99', channelPieceId: 'cp-1', slides })
    expect(parsed.success).toBe(false)
  })

  it('rejects a slide missing a required field', () => {
    const [slide] = defaultCarouselSlides(null)
    const { appearance: _appearance, ...withoutAppearance } = slide
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: 'cp-1', slides: [withoutAppearance] })
    expect(parsed.success).toBe(false)
  })
})

describe('sortedSlides', () => {
  it('orders by the persisted `order` field, not array position', () => {
    const slides = defaultCarouselSlides(null)
    const shuffled = [slides[1], slides[0]]
    const sorted = sortedSlides(shuffled)
    expect(sorted.map((slide) => slide.id)).toEqual(['slide-1', 'slide-2'])
  })
})

describe('AuthoringState <-> PersistedAuthoredSlide round-trip', () => {
  it('preserves variant, appearance, content, primitive selection and transforms through a full round-trip', () => {
    const canvas = 'portrait' as const
    const content: AuthoringCoverContent = { eyebrow: 'Memória viva', title: 'Título editado', subtitle: 'Subtítulo editado', source_line: 'Fonte', detail_note: 'Nota' }
    const state = createContextualAuthoringState(productContext, canvas, content, { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' }, 'cover', 'light')
    const persisted = authoringStateToPersistedSlide(state, 'slide-1', 0)
    expect(persisted.variant).toBe('cover')
    expect(persisted.appearance).toBe('light')
    expect(persisted.content).toEqual(content)

    const reconstructed = persistedSlideToAuthoringState(persisted, productContext, canvas)
    expect(reconstructed.variant).toBe('cover')
    expect(reconstructed.appearance).toBe('light')
    expect(reconstructed.contentOverride).toEqual(content)
    expect(reconstructed.primitiveSelection).toEqual({ paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' })
    expect(reconstructed.primitiveTransforms).toEqual(state.primitiveTransforms)
  })

  it('reconstructs an info/dark slide independently of the cover/light default', () => {
    const canvas = 'portrait' as const
    const content: AuthoringInfoContent = { title: 'Info título', intro: 'Intro', body_blocks: ['Bloco 1'], fact_cards: [{ primary: '1' }], source_line: 'Fonte', annotation: 'Nota' }
    const state = createContextualAuthoringState(productContext, canvas, content, {}, 'info', 'dark')
    const persisted = authoringStateToPersistedSlide(state, 'slide-2', 1)
    expect(persisted.variant).toBe('info')
    expect(persisted.appearance).toBe('dark')

    const reconstructed = persistedSlideToAuthoringState(persisted, productContext, canvas)
    expect(reconstructed.variant).toBe('info')
    expect(reconstructed.appearance).toBe('dark')
    expect((reconstructed.contentOverride as AuthoringInfoContent).intro).toBe('Intro')
  })

  it('editing one slide does not mutate the persisted record of another slide', () => {
    const canvas = 'portrait' as const
    const [slide1Default, slide2Default] = defaultCarouselSlides(null)
    const state1 = persistedSlideToAuthoringState(slide1Default, productContext, canvas)
    const state2 = persistedSlideToAuthoringState(slide2Default, productContext, canvas)

    // Edit slide 1's content, appearance AND a primitive transform — the kind
    // of nested-object mutation most likely to accidentally share a reference
    // with another slide if the reducer/conversion ever stopped copying.
    const editedState1: typeof state1 = {
      ...state1,
      contentOverride: { ...(state1.contentOverride as AuthoringCoverContent), title: 'Slide 1 editado' },
      appearance: 'light',
      primitiveTransforms: { ...state1.primitiveTransforms, paper: { ...state1.primitiveTransforms.paper, rotation: 42 } },
    }
    const persisted1 = authoringStateToPersistedSlide(editedState1, 'slide-1', 0)
    const persisted2 = authoringStateToPersistedSlide(state2, 'slide-2', 1)

    expect(persisted1.appearance).toBe('light')
    expect(persisted1.primitiveTransforms.paper.rotation).toBe(42)
    // Slide 2 keeps its own untouched defaults — slide 1's edits never leaked in.
    expect(persisted2.appearance).toBe(slide2Default.appearance)
    expect(persisted2.primitiveTransforms.paper.rotation).toBe(0)
    expect((persisted2.content as unknown as AuthoringInfoContent).title).toBe((slide2Default.content as unknown as AuthoringInfoContent).title)
    expect(persisted1.content).not.toEqual(persisted2.content)
  })
})

describe('sequence derives from the real slide collection', () => {
  it('reflects 1/2 and 2/2 for a real 2-slide carousel instead of the fixture default of 1/10', () => {
    const canvas = 'portrait' as const
    const [slide1, slide2] = defaultCarouselSlides(null)
    const state1 = persistedSlideToAuthoringState(slide1, productContext, canvas)
    const state2 = persistedSlideToAuthoringState(slide2, productContext, canvas)

    const manifest1 = deriveManifestFromState(state1, { index: 1, total: 2 })
    const manifest2 = deriveManifestFromState(state2, { index: 2, total: 2 })
    expect(manifest1.sequence).toEqual({ index: 1, total: 2 })
    expect(manifest2.sequence).toEqual({ index: 2, total: 2 })
  })

  it('keeps the single-card default of {index:1,total:1} when no override is supplied', () => {
    const canvas = 'portrait' as const
    const state = createContextualAuthoringState(productContext, canvas, { title: 'x' } as unknown as AuthoringCoverContent)
    expect(deriveManifestFromState(state).sequence).toEqual({ index: 1, total: 1 })
  })
})
