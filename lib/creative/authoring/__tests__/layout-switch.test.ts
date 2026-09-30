/**
 * STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1 — Template Layout A → B is ONE
 * deterministic replacement: Layout-owned state resets to the target's own
 * baseline, the Custom Element overlay (composition-instance state) survives,
 * nothing is mapped between layouts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PersistedAuthoredSlideSchema, StaticAuthoringStateSchema, authoringStateToPersistedSlide, createTemplateSlide, defaultCarouselSlides, persistedSlideToAuthoringState,
} from '../carousel-state'
import { defaultContentForVariant } from '../authoring-state'
import { hasLayoutOwnedAuthoredWork, replaceTemplateLayout } from '../layout-switch'
import { authoringReducer } from '../reducer'
import { DEFAULT_PRIMITIVE_TRANSFORMS, AUTHORING_VARIANTS } from '../types'
import type { AuthoringProductContext, AuthoringState, AuthoringVariant } from '../types'
import type { FreeSceneElement } from '@/lib/types'

const productContext: AuthoringProductContext = {
  projectId: 'project-1',
  projectName: 'Portal Comunidades Alternativas',
  productionId: null,
  productionTitle: null,
  editorialContentId: 'ec-1',
  editorialContentTitle: 'Carrossel',
  channelPieceId: 'cp-1',
  channel: 'instagram',
  format: 'carousel',
  primitiveProjectRef: 'project:portal-comunidades-alternativas',
  projectIdentity: { schema_version: 1 } as AuthoringProductContext['projectIdentity'],
  identitySnapshot: {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'project:project-1:snapshot',
    typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } },
    colors: { background: '#F6F0E4', foreground: '#16352F' },
    spacing: { unit: 8 },
  },
}

const REF = 'project:portal-comunidades-alternativas'
const TEXT: FreeSceneElement = { id: '11111111-1111-4111-8111-111111111111', kind: 'text', box: { x: 0.12, y: 0.07, width: 0.7, height: 0.2 }, text: 'Meu texto', typography: 'display', color: 'accent', align: 'center', size: 'large' }
const IMAGE: FreeSceneElement = { id: '22222222-2222-4222-8222-222222222222', kind: 'image', box: { x: 0.16, y: 0.45, width: 0.55, height: 0.28 }, library_file_id: '33333333-3333-4333-8333-333333333333', fit: 'contain' }

function freshState(layoutId: AuthoringVariant = 'cover', appearance?: 'light' | 'dark'): AuthoringState {
  const slide = createTemplateSlide({ templateId: 'editorial-documentary-collage-v1', layoutId, appearance, id: 'slide-1', order: 0, primitiveProjectRef: REF })!
  return persistedSlideToAuthoringState(slide, productContext, 'portrait')
}

/** A Cover with real Layout-owned authoring on every Layout-owned field, plus a Custom overlay. */
function authoredCover(): AuthoringState {
  let state = freshState('cover', 'dark')
  state = authoringReducer(state, { type: 'SET_COVER_FIELD', field: 'title', value: 'Meu título de capa' })
  state = authoringReducer(state, { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'note', field: 'offsetX', value: 40 })
  state = authoringReducer(state, { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'tape1', field: 'rotation', value: 6 })
  state = authoringReducer(state, { type: 'SET_TUNING', tuning: { ...state.tuning, title: { offsetX: 12, offsetY: -8, rotation: 1, lineHeight: 1.2 }, hero: { offsetX: 30, offsetY: 5, rotation: 2, scale: 1.1 } } })
  state = authoringReducer(state, { type: 'TOGGLE_ELEMENT_VISIBILITY', id: 'tape1' })
  state = authoringReducer(state, { type: 'TOGGLE_ELEMENT_VISIBILITY', id: 'note' })
  state = authoringReducer(state, { type: 'SET_ELEMENT_ORDER', order: [...state.elementOrder ?? ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper', 'title']].reverse() })
  state = authoringReducer(state, { type: 'SET_ASSET_OVERRIDE', slot: 'hero', libraryFileId: 'lib-hero' })
  state = authoringReducer(state, { type: 'SET_ASSET_OVERRIDE', slot: 'tape', libraryFileId: 'lib-tape' })
  state = authoringReducer(state, { type: 'SET_PRIMITIVE_PAPER', key: 'paper-card-dark-01' })
  state = authoringReducer(state, { type: 'SET_HERO_REF', ref: 'documentary-card:hero-archival-01' as never })
  state = authoringReducer(state, { type: 'SET_CUSTOM_ELEMENTS', elements: [TEXT, IMAGE] })
  return state
}

const allDefaultTransforms = (state: AuthoringState) => Object.values(state.primitiveTransforms).every((value) => JSON.stringify(value) === JSON.stringify(DEFAULT_PRIMITIVE_TRANSFORMS))

describe('replaceTemplateLayout: Layout-owned state resets', () => {
  const info = () => authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'info' })

  it('the fixture really carries authored Layout-owned state before the switch', () => {
    const cover = authoredCover()
    expect(allDefaultTransforms(cover)).toBe(false)
    expect(cover.hiddenElements).toEqual(['tape1', 'note'])
    expect(cover.elementOrder).toBeDefined()
    expect(cover.assetOverrides).toMatchObject({ hero: { libraryFileId: 'lib-hero' }, tape: { libraryFileId: 'lib-tape' } })
  })

  it('1. no stale Template transforms or tuning survive', () => {
    const next = info()
    expect(allDefaultTransforms(next)).toBe(true)
    expect(next.tuning).toEqual(freshState('info').tuning)
    expect(next.tuning.title.lineHeight).toBeUndefined()
  })

  it('2. no stale hidden Template Element ids survive', () => {
    expect(info().hiddenElements).toBeUndefined()
  })

  it('3. no stale paint order survives (the target follows its own default stack)', () => {
    expect(info().elementOrder).toBeUndefined()
  })

  it('4. no Layout-specific asset override, hero ref or Project paper choice survives', () => {
    const next = info()
    expect(next.assetOverrides).toBeUndefined()
    expect(next.heroRef).toBeUndefined()
    expect(next.primitiveSelection).toEqual(freshState('info').primitiveSelection)
  })

  it('5. the target Layout starts from its own baseline, identical to a freshly added slide', () => {
    const next = info()
    const fresh = freshState('info', 'dark')
    expect(next.variant).toBe('info')
    expect(next.contentOverride).toEqual(fresh.contentOverride)
    expect(next.contentOverride).toEqual(defaultContentForVariant('info', 'a'))
    expect(next.primitiveSelection).toEqual(fresh.primitiveSelection)
    expect(next.primitiveTransforms).toEqual(fresh.primitiveTransforms)
  })

  it('6. no content is mapped between layouts', () => {
    const next = info()
    expect(JSON.stringify(next.contentOverride)).not.toContain('Meu título de capa')
    const toList = authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'list' })
    expect(JSON.stringify(toList.contentOverride)).not.toContain('Meu título de capa')
    expect(toList.contentOverride).toEqual(defaultContentForVariant('list', 'a'))
  })

  it('a layout with a brand label derives it from the live Project name exactly like a reload', () => {
    const closing = authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'closing' })
    expect((closing.contentOverride as { brand_label?: string }).brand_label).toBe('Portal Comunidades Alternativas')
  })
})

describe('replaceTemplateLayout: the Custom overlay is composition-instance state', () => {
  it('7-10. Custom Text and Image survive unchanged: content, LibraryFile binding, geometry and overlay order', () => {
    const next = authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'grid' })
    expect(next.elements).toEqual([TEXT, IMAGE])
    expect(next.elements?.[0]).toMatchObject({ text: 'Meu texto', color: 'accent', box: TEXT.box })
    expect(next.elements?.[1]).toMatchObject({ library_file_id: '33333333-3333-4333-8333-333333333333', box: IMAGE.box })
  })

  it('canvas, identity, productContext and UI-only state are preserved', () => {
    const before = authoredCover()
    const next = authoringReducer(before, { type: 'SET_VARIANT', variant: 'map' })
    expect(next.canvas).toBe(before.canvas)
    expect(next.identity).toBe(before.identity)
    expect(next.productContext).toBe(before.productContext)
    expect(next.debugPanelOpen).toBe(before.debugPanelOpen)
  })

  it('a slide with no Custom Elements gains none', () => {
    expect(authoringReducer(freshState('cover'), { type: 'SET_VARIANT', variant: 'info' }).elements).toBeUndefined()
  })
})

describe('replaceTemplateLayout: Appearance follows the factual contract', () => {
  it('11. kept when the target Layout supports it', () => {
    expect(authoringReducer(freshState('cover', 'dark'), { type: 'SET_VARIANT', variant: 'info' }).appearance).toBe('dark')
    expect(authoringReducer(freshState('info', 'light'), { type: 'SET_VARIANT', variant: 'cover' }).appearance).toBe('light')
  })

  it('11. falls back to the target default when it does not support the current one (no mapping invented)', () => {
    const odd = { ...freshState('cover'), appearance: 'sepia' as never }
    expect(replaceTemplateLayout(odd, 'info').appearance).toBe('light')
    expect(replaceTemplateLayout(odd, 'closing').appearance).toBe('dark')
  })
})

describe('replaceTemplateLayout: determinism and no-ops', () => {
  it('13. exactly one deterministic replacement: same input, same output; A → B → A is a fresh A', () => {
    const cover = authoredCover()
    const once = authoringReducer(cover, { type: 'SET_VARIANT', variant: 'info' })
    expect(authoringReducer(cover, { type: 'SET_VARIANT', variant: 'info' })).toEqual(once)
    const back = authoringReducer(once, { type: 'SET_VARIANT', variant: 'cover' })
    expect(back.contentOverride).toEqual(freshState('cover', 'dark').contentOverride)
    expect(allDefaultTransforms(back)).toBe(true)
    expect(back.elements).toEqual([TEXT, IMAGE])
  })

  it('re-selecting the current Layout, or a Layout the Template does not define, is a no-op (same reference)', () => {
    const cover = authoredCover()
    expect(authoringReducer(cover, { type: 'SET_VARIANT', variant: 'cover' })).toBe(cover)
    expect(replaceTemplateLayout(cover, 'nope' as never)).toBe(cover)
    expect(replaceTemplateLayout(cover, 'info', 'unregistered-template')).toBe(cover)
  })

  it('every Layout pair yields the target baseline with the overlay intact', () => {
    for (const from of AUTHORING_VARIANTS) {
      for (const to of AUTHORING_VARIANTS) {
        if (from === to) continue
        const start = authoringReducer({ ...freshState(from), elements: [TEXT] }, { type: 'SET_TUNING', tuning: { ...freshState(from).tuning, title: { offsetX: 5, offsetY: 5, rotation: 1 } } })
        const next = authoringReducer(start, { type: 'SET_VARIANT', variant: to })
        expect(next.variant).toBe(to)
        expect(next.tuning).toEqual(freshState(to).tuning)
        expect(next.contentOverride).toEqual(freshState(to).contentOverride)
        expect(next.elements).toEqual([TEXT])
      }
    }
  })

  it('the switched slide round-trips through persistence as exactly what was authored (no Layout-owned residue)', () => {
    const next = authoringReducer(authoredCover(), { type: 'SET_VARIANT', variant: 'info' })
    const persisted = authoringStateToPersistedSlide(next, 'slide-1', 0)
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    expect(persisted).toMatchObject({ variant: 'info', appearance: 'dark' })
    for (const key of ['assetOverrides', 'hiddenElements', 'elementOrder', 'heroRef']) expect(persisted).not.toHaveProperty(key)
    expect(persisted.elements).toEqual([TEXT, IMAGE])
    const reloaded = persistedSlideToAuthoringState(JSON.parse(JSON.stringify(persisted)), productContext, 'portrait')
    expect(reloaded.contentOverride).toEqual(next.contentOverride)
    expect(reloaded.tuning).toEqual(next.tuning)
    expect(reloaded.primitiveTransforms).toEqual(next.primitiveTransforms)
    expect(reloaded.elements).toEqual([TEXT, IMAGE])
  })
})

describe('hasLayoutOwnedAuthoredWork (when the switch needs a confirmation)', () => {
  it('a pristine slide has none: no confirmation is needed', () => {
    for (const layout of AUTHORING_VARIANTS) expect(hasLayoutOwnedAuthoredWork(freshState(layout))).toBe(false)
  })

  it('a Custom Element alone is NOT Layout-owned work (it survives the switch)', () => {
    expect(hasLayoutOwnedAuthoredWork({ ...freshState('cover'), elements: [TEXT, IMAGE] })).toBe(false)
  })

  const cases: [string, (state: AuthoringState) => AuthoringState][] = [
    ['edited content', (s) => authoringReducer(s, { type: 'SET_COVER_FIELD', field: 'title', value: 'outro' })],
    ['an Element transform', (s) => authoringReducer(s, { type: 'SET_PRIMITIVE_TRANSFORM', slot: 'note', field: 'scale', value: 1.2 })],
    ['tuning', (s) => authoringReducer(s, { type: 'SET_TUNING', tuning: { ...s.tuning, hero: { ...s.tuning.hero, offsetX: 10 } } })],
    ['a hidden Element', (s) => authoringReducer(s, { type: 'TOGGLE_ELEMENT_VISIBILITY', id: 'tape2' })],
    ['a paint order', (s) => authoringReducer(s, { type: 'SET_ELEMENT_ORDER', order: ['title', 'paper', 'hero', 'tape1', 'note', 'tape2', 'botanical', 'botanicalLeaf', 'archival', 'ornament'] })],
    ['an asset override', (s) => authoringReducer(s, { type: 'SET_ASSET_OVERRIDE', slot: 'tape', libraryFileId: 'lib' })],
    ['a hero ref', (s) => authoringReducer(s, { type: 'SET_HERO_REF', ref: 'x' as never })],
    ['a Project paper choice', (s) => authoringReducer(s, { type: 'SET_PRIMITIVE_PAPER', key: 'paper-card-dark-01' })],
  ]
  for (const [name, edit] of cases) {
    it(`${name} is Layout-owned work: confirmation required`, () => {
      expect(hasLayoutOwnedAuthoredWork(edit(freshState('cover')))).toBe(true)
    })
  }

  it('restoring the default paint order alone is not work', () => {
    const cover = freshState('cover')
    const state = authoringReducer(authoringReducer(cover, { type: 'SET_ELEMENT_ORDER', order: ['ornament', 'archival', 'botanicalLeaf', 'hero', 'botanical', 'tape1', 'note', 'tape2', 'paper', 'title'] }), { type: 'SET_VARIANT', variant: 'cover' })
    expect(hasLayoutOwnedAuthoredWork(state)).toBe(false)
  })
})

describe('legacy state and contracts', () => {
  it('15. an existing 10-slide Documentary carousel stays readable and every slide can switch Layout', () => {
    const layouts: AuthoringVariant[] = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing', 'list', 'info']
    const slides = layouts.map((layoutId, index) => {
      const slide = createTemplateSlide({ templateId: 'editorial-documentary-collage-v1', layoutId, id: `slide-${index + 1}`, order: index, primitiveProjectRef: REF })!
      // Legacy rows carry no tuning.source and no optional authored keys.
      return { ...slide, tuning: { hero: slide.tuning!.hero, title: slide.tuning!.title } }
    })
    const state = { schemaVersion: 'static-authoring-state.v1', channelPieceId: 'cp-1', slides }
    expect(StaticAuthoringStateSchema.safeParse(state).success).toBe(true)
    for (const slide of slides) {
      const loaded = persistedSlideToAuthoringState(slide, productContext, 'portrait')
      const target: AuthoringVariant = slide.variant === 'cover' ? 'closing' : 'cover'
      const switched = authoringReducer(loaded, { type: 'SET_VARIANT', variant: target })
      expect(PersistedAuthoredSlideSchema.safeParse(authoringStateToPersistedSlide(switched, slide.id, slide.order)).success).toBe(true)
    }
  })

  it('14. FREE ↔ TEMPLATE semantics are untouched: the switch operation is Template-only and never reaches Free code', () => {
    const source = readFileSync(join(process.cwd(), 'lib/creative/authoring/layout-switch.ts'), 'utf8')
    expect(source).not.toMatch(/free-static|composition: 'free'|enterFree|enterTemplate|video-editor/)
  })

  it('18. no render or worker contract change: the worker export does not carry the switch module and the render request schema is untouched', () => {
    const exportScript = readFileSync(join(process.cwd(), 'infra/render-worker-runtime/export.mjs'), 'utf8')
    expect(exportScript).not.toContain('layout-switch')
    expect(exportScript).not.toContain('template-anatomy')
    expect(readFileSync(join(process.cwd(), 'lib/creative/authoring/layout-switch.ts'), 'utf8')).not.toMatch(/render-request|documentary-card\//)
  })
})
