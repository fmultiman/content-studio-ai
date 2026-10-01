/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the optional LOCAL typography override of an Element:
 *
 *   effective default (Identity role / Template size)  →  optional local { fontFamily?, fontSizePx? }
 *
 * Covers: registry capability, pure helpers, reducer, save/reload (no migration), the single canonical line-height
 * source, Layout-owned reset (Custom Elements untouched), the render request / frozen snapshot, the renderer
 * (default parity + override), the worker's font declaration, and Free/Custom Text (additive, Video-inert).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { FreeStage } from '@/components/creative/free/free-stage'
import {
  PersistedAuthoredSlideSchema, authoringStateToPersistedSlide, createTemplateSlide, persistedSlideToAuthoringState,
} from '../carousel-state'
import {
  defaultContentForVariant, deriveHiddenElementsRequest, derivePrimitiveTransformsRequest, deriveTuningOverrides, deriveTypographyOverrides, resolvePreviewInput, setTuningField,
} from '../authoring-state'
import { hasLayoutOwnedAuthoredWork } from '../layout-switch'
import { authoringReducer } from '../reducer'
import { authoringRenderOverridesSchema } from '../render-request'
import { normalizeTypographyOverrides, patchTypographyOverride, resetTypographyOverride, sanitizeTypographyOverride } from '../typography-overrides'
import type { AuthoringProductContext, AuthoringState } from '../types'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, elementLocalTypography, getTemplateLayout, type TemplateLayoutDefinition } from '@/lib/creative/templates/template-definitions'
import { RUNTIME_FONT_FAMILIES, RUNTIME_FONT_REGISTRY, runtimeFontFaceCss, withOverrideFonts, type ResolvedTypography } from '@/lib/creative/typography/resolve-typography'
import { addFreeTextElement, deriveFreeSegment, freeElements, updateFreeElement, validateFreeCompositionShape } from '@/lib/creative/video-editor/free-composition'
import { FreeSegmentPayloadSchema } from '@/lib/schemas/creative/timeline'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import type { FreeSceneComposition, FreeSceneElement, FreeTextElement } from '@/lib/types'

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
const CUSTOM_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOM: FreeSceneElement = { id: CUSTOM_ID, kind: 'text', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, text: 'Custom', typography: 'body', color: 'foreground', align: 'left', size: 'small' }

const LAYOUT_IDS = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'] as const
type LayoutId = typeof LAYOUT_IDS[number]
const layoutOf = (id: string): TemplateLayoutDefinition => getTemplateLayout(TEMPLATE, id)!

/** Content that makes every optional text of a layout exist, so every text Element has something to paint. */
function fullContent(layoutId: LayoutId): Record<string, unknown> {
  const base = defaultContentForVariant(layoutId, 'a') as unknown as Record<string, unknown>
  switch (layoutId) {
    case 'cover': return { ...base, eyebrow: 'Memória viva', subtitle: 'Introdução do cover', source_line: 'Fonte do cover', detail_note: 'Nota da edição: texto da nota', brand_label: 'Portal Comunidades Alternativas' }
    case 'info': return { ...base, intro: 'Chamada do info', annotation: 'Anotação do info', source_line: 'Fonte do info', title: 'Uma pergunta, duas edições' }
    case 'list': return { ...base, intro: 'Introdução da lista', image_caption: 'Legenda da imagem', callout: 'Destaque da lista' }
    case 'grid': return { ...base, intro: 'Introdução da grade' }
    case 'map': return { ...base, intro: 'Introdução do mapa' }
    case 'network': return { ...base, kicker: 'Chamada da rede', intro: 'Introdução da rede' }
    case 'quote': return { ...base, intro: 'Introdução da citação' }
    case 'closing': return { ...base, tagline: 'Frase final' }
  }
}

const baseState = (layoutId: LayoutId, appearance?: 'light' | 'dark'): AuthoringState => {
  const state = persistedSlideToAuthoringState(createTemplateSlide({ templateId: TEMPLATE.id, layoutId, appearance, id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait')
  return { ...state, contentOverride: fullContent(layoutId) as never }
}

function render(state: AuthoringState): string {
  const input = resolvePreviewInput(state)
  const props = documentaryCardPropsFromResolvedInput(
    { ...input, manifest: { ...input.manifest, sequence: { index: 2, total: 5 } } },
    'still', undefined, state.tuning, undefined, derivePrimitiveTransformsRequest(state),
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) },
    deriveTypographyOverrides(state, TEMPLATE.id),
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}

const setOverride = (state: AuthoringState, elementId: string, patch: { fontFamily?: (typeof RUNTIME_FONT_FAMILIES)[number] | null; fontSizePx?: number | null }) =>
  authoringReducer(state, { type: 'SET_TYPOGRAPHY_OVERRIDE', elementId, patch })

/** Every Template text Element that declares the capability, per layout. */
const SUPPORTED: Record<LayoutId, string[]> = {
  cover: ['title', 'kicker', 'intro', 'source'],
  info: ['title', 'source'],
  list: ['title', 'intro'],
  grid: ['title', 'intro'],
  map: ['title', 'intro'],
  network: ['title', 'kicker', 'intro'],
  quote: ['title', 'intro'],
  closing: ['title'],
}

describe('registry capability (what a text Element honestly accepts)', () => {
  it.each(LAYOUT_IDS)('%s: exactly the single-style text Elements declare local typography', (layoutId) => {
    const layout = layoutOf(layoutId)
    const declared = layout.elements.filter((element) => element.typography?.local).map((element) => element.id)
    expect(declared.sort()).toEqual([...SUPPORTED[layoutId]].sort())
    for (const element of layout.elements.filter((candidate) => candidate.typography?.local)) expect(element.kind).toBe('text')
  })

  it('every Template Title takes a local font; the Info Title (two lines, two sizes) is family-only', () => {
    for (const id of LAYOUT_IDS) expect(elementLocalTypography(layoutOf(id), 'title')).not.toBeNull()
    expect(elementLocalTypography(layoutOf('info'), 'title')).toEqual({ role: 'display' })
    expect(elementLocalTypography(layoutOf('cover'), 'title')).toEqual({ role: 'display', fontSizePx: 62 })
  })

  it('composite text blocks and non-text Elements take none (no fake controls)', () => {
    expect(elementLocalTypography(layoutOf('cover'), 'noteText')).toBeNull()
    expect(elementLocalTypography(layoutOf('cover'), 'brandName')).toBeNull()
    expect(elementLocalTypography(layoutOf('list'), 'items')).toBeNull()
    expect(elementLocalTypography(layoutOf('cover'), 'hero')).toBeNull()
    expect(elementLocalTypography(layoutOf('cover'), 'note')).toBeNull()
    expect(elementLocalTypography(layoutOf('cover'), 'heroFrame')).toBeNull()
    expect(elementLocalTypography(layoutOf('cover'), 'does-not-exist')).toBeNull()
  })
})

describe('pure override helpers', () => {
  it('only a supported registry family is accepted (never an arbitrary string); sizes are whole px, bounded', () => {
    expect(sanitizeTypographyOverride({ fontFamily: 'Comic Sans MS' })).toBeUndefined()
    expect(sanitizeTypographyOverride({ fontFamily: 'Space Grotesk', fontSizePx: 53.4 })).toEqual({ fontFamily: 'Space Grotesk', fontSizePx: 53 })
    expect(sanitizeTypographyOverride({ fontSizePx: 9999 })).toEqual({ fontSizePx: 400 })
    expect(sanitizeTypographyOverride({ fontSizePx: 1 })).toEqual({ fontSizePx: 8 })
    expect(sanitizeTypographyOverride({ fontSizePx: Number.NaN })).toBeUndefined()
    expect(sanitizeTypographyOverride({ lineHeight: 1.5 })).toBeUndefined()
    expect(sanitizeTypographyOverride('x')).toBeUndefined()
  })

  it('patch merges one field at a time; null removes it; an empty override is removed, never kept', () => {
    let map = patchTypographyOverride(undefined, 'title', { fontSizePx: 53 })
    expect(map).toEqual({ title: { fontSizePx: 53 } })
    map = patchTypographyOverride(map, 'title', { fontFamily: 'Inter' })
    expect(map).toEqual({ title: { fontSizePx: 53, fontFamily: 'Inter' } })
    map = patchTypographyOverride(map, 'title', { fontSizePx: null })
    expect(map).toEqual({ title: { fontFamily: 'Inter' } })
    expect(patchTypographyOverride(map, 'title', { fontFamily: null })).toBeUndefined()
    expect(resetTypographyOverride({ title: { fontSizePx: 40 }, intro: { fontSizePx: 30 } }, 'title')).toEqual({ intro: { fontSizePx: 30 } })
    expect(resetTypographyOverride({ title: { fontSizePx: 40 } }, 'title')).toBeUndefined()
    expect(resetTypographyOverride(undefined, 'title')).toBeUndefined()
  })

  it('normalize keeps only what the Layout can honour (size dropped where the Element is composite; unknown / unsupported ids dropped)', () => {
    const raw = { title: { fontFamily: 'Inter', fontSizePx: 50 }, noteText: { fontSizePx: 30 }, nope: { fontSizePx: 30 }, source: { fontFamily: 'Arial' } }
    expect(normalizeTypographyOverrides(layoutOf('info'), raw)).toEqual({ title: { fontFamily: 'Inter' } })
    expect(normalizeTypographyOverrides(layoutOf('cover'), raw)).toEqual({ title: { fontFamily: 'Inter', fontSizePx: 50 } })
    expect(normalizeTypographyOverrides(layoutOf('cover'), {})).toBeUndefined()
    expect(normalizeTypographyOverrides(layoutOf('cover'), undefined)).toBeUndefined()
  })
})

describe('reducer, dirty state, save/reload (migration: none)', () => {
  const persist = (state: AuthoringState) => JSON.stringify(authoringStateToPersistedSlide(state, 's', 0, TEMPLATE.id))

  it('a style edit changes the persisted state (dirty); the field is absent again after "Usar padrão"', () => {
    const before = baseState('cover')
    const edited = setOverride(before, 'title', { fontSizePx: 53 })
    expect(edited.typography).toEqual({ title: { fontSizePx: 53 } })
    expect(persist(edited)).not.toBe(persist(before))
    const reset = authoringReducer(edited, { type: 'RESET_TYPOGRAPHY_OVERRIDE', elementId: 'title' })
    expect(reset).not.toHaveProperty('typography')
    expect(persist(reset)).toBe(persist(before))
  })

  it('selection is UI-only: it is not part of the authored state, so selecting never changes the persisted slide', () => {
    const state = baseState('cover')
    const selected = { ...state }
    expect(persist(selected)).toBe(persist(state))
    expect(Object.keys(authoringStateToPersistedSlide(state, 's', 0, TEMPLATE.id))).not.toContain('selectedTarget')
  })

  it('an unchanged patch keeps the same state reference (no spurious dirty)', () => {
    const edited = setOverride(baseState('cover'), 'title', { fontSizePx: 53 })
    expect(setOverride(edited, 'title', { fontSizePx: 53 })).toBe(edited)
    expect(authoringReducer(baseState('cover'), { type: 'RESET_TYPOGRAPHY_OVERRIDE', elementId: 'title' }).typography).toBeUndefined()
  })

  it('save → reload preserves the overrides; the selection is not persisted', () => {
    const edited = setOverride(setOverride(baseState('cover'), 'title', { fontSizePx: 53, fontFamily: 'Space Grotesk' }), 'intro', { fontFamily: 'Inter' })
    const persisted = PersistedAuthoredSlideSchema.parse(JSON.parse(persist(edited)))
    expect(persisted.typography).toEqual({ title: { fontFamily: 'Space Grotesk', fontSizePx: 53 }, intro: { fontFamily: 'Inter' } })
    const reloaded = persistedSlideToAuthoringState(persisted, productContext, 'portrait', TEMPLATE.id)
    expect(reloaded.typography).toEqual(edited.typography)
  })

  it('a legacy slide (no typography field) loads without it and renders exactly as before — no migration', () => {
    const legacy = JSON.parse(persist(baseState('cover')))
    expect(legacy).not.toHaveProperty('typography')
    const state = persistedSlideToAuthoringState(PersistedAuthoredSlideSchema.parse(legacy), productContext, 'portrait', TEMPLATE.id)
    expect(state).not.toHaveProperty('typography')
    expect(deriveTypographyOverrides(state, TEMPLATE.id)).toBeUndefined()
    expect(deriveTuningOverrides(state, TEMPLATE.id)).toBeUndefined()
  })

  it('a persisted override a Layout cannot honour (or with an unsupported font) is dropped on load, never rendered', () => {
    const slide = { ...JSON.parse(persist(baseState('cover'))), typography: { title: { fontFamily: 'Comic Sans MS', fontSizePx: 50 }, noteText: { fontSizePx: 30 } } }
    const state = persistedSlideToAuthoringState(PersistedAuthoredSlideSchema.parse(slide), productContext, 'portrait', TEMPLATE.id)
    expect(state.typography).toEqual({ title: { fontSizePx: 50 } })
  })
})

describe('line-height has ONE canonical authored source', () => {
  it('a local override has no lineHeight; the Title Entrelinha stays tuning.title.lineHeight', () => {
    const edited = setOverride(baseState('cover'), 'title', { fontSizePx: 40, ...({ lineHeight: 1.4 } as object) })
    expect(edited.typography?.title).toEqual({ fontSizePx: 40 })
    expect(authoringRenderOverridesSchema.safeParse({ typography: { title: { lineHeight: 1.3 } } }).success).toBe(false)
    const tuned = authoringReducer(edited, { type: 'SET_TUNING', tuning: setTuningField(edited.tuning, 'title', 'lineHeight', 1.25) })
    expect(tuned.tuning.title.lineHeight).toBe(1.25)
    const html = render(tuned)
    expect(html).toContain('line-height:1.25')
    expect(html).toContain('font-size:40px')
  })

  it('Entrelinha and the local size are independent edits of independent fields', () => {
    const state = baseState('cover')
    const withSize = setOverride(state, 'title', { fontSizePx: 40 })
    expect(render(withSize)).toContain('line-height:1.02')
    expect(withSize.tuning.title.lineHeight).toBeUndefined()
  })
})

describe('Layout switch: typography is Layout-owned; Custom Elements keep their own style', () => {
  it('Cover → Info drops the Cover overrides (and is reported as Layout-owned work); Custom text keeps font/size', () => {
    const custom: FreeSceneElement = { ...(CUSTOM as FreeTextElement), font_family: 'Inter', font_size_px: 61 }
    const cover = { ...setOverride(baseState('cover'), 'title', { fontSizePx: 53 }), elements: [custom] }
    expect(hasLayoutOwnedAuthoredWork(cover, TEMPLATE.id)).toBe(true)
    const info = authoringReducer(cover, { type: 'SET_VARIANT', variant: 'info', templateId: TEMPLATE.id })
    expect(info.variant).toBe('info')
    expect(info).not.toHaveProperty('typography')
    expect(info.elements).toEqual([custom])
  })
})

describe('render request and frozen snapshot', () => {
  it('the override request is the active Layout\'s honoured overrides only; absent when none (legacy request unchanged)', () => {
    const base = baseState('cover')
    expect(deriveTuningOverrides(base, TEMPLATE.id)).toBeUndefined()
    const edited = setOverride(setOverride(base, 'title', { fontSizePx: 53 }), 'kicker', { fontFamily: 'Inter' })
    expect(deriveTuningOverrides(edited, TEMPLATE.id)).toEqual({ typography: { title: { fontSizePx: 53 }, kicker: { fontFamily: 'Inter' } } })
  })

  it('the schema accepts supported families and rejects arbitrary fonts, huge sizes and unknown keys', () => {
    expect(authoringRenderOverridesSchema.safeParse({ typography: { title: { fontFamily: 'Space Grotesk', fontSizePx: 53 } } }).success).toBe(true)
    expect(authoringRenderOverridesSchema.safeParse({ typography: { title: { fontFamily: 'Papyrus' } } }).success).toBe(false)
    expect(authoringRenderOverridesSchema.safeParse({ typography: { title: { fontSizePx: 4000 } } }).success).toBe(false)
    expect(authoringRenderOverridesSchema.safeParse({ typography: { title: { color: 'red' } } }).success).toBe(false)
  })

  it('the authored typography is frozen into the snapshot and survives parse (what the worker reads)', () => {
    const state = setOverride(baseState('cover'), 'title', { fontSizePx: 53, fontFamily: 'Inter' })
    const input = resolvePreviewInput(state)
    const snapshot = buildStaticRenderExecutionSnapshot({
      manifest: input.manifest, identitySnapshot: productContext.identitySnapshot!, overrides: deriveTuningOverrides(state, TEMPLATE.id),
      templateId: TEMPLATE.id, slide: null,
    } as never)
    const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.snapshot.overrides?.typography).toEqual({ title: { fontFamily: 'Inter', fontSizePx: 53 } })
  })
})

describe.each(LAYOUT_IDS)('%s — renderer', (layoutId) => {
  const state = baseState(layoutId)
  const scale = 1080 / 1080

  it.each(SUPPORTED[layoutId])('%s: an override equal to the effective default is byte-identical to no override (legacy parity; registry default = renderer constant)', (elementId) => {
    const capability = elementLocalTypography(layoutOf(layoutId), elementId)!
    const identity = capability.role === 'display' ? 'Fraunces' : 'Source Sans 3'
    const legacy = render(state)
    // The size equals the Template default: the markup cannot change.
    if (capability.fontSizePx !== undefined) expect(render(setOverride(state, elementId, { fontSizePx: capability.fontSizePx }))).toBe(legacy)
    // The family equals the Identity family of the Element's role (label falls back to body): the markup cannot change.
    if (capability.role !== 'label') expect(render(setOverride(state, elementId, { fontFamily: identity as 'Fraunces' }))).toBe(legacy)
  })

  it.each(SUPPORTED[layoutId])('%s: a different family / an arbitrary px size reaches the painted element', (elementId) => {
    const capability = elementLocalTypography(layoutOf(layoutId), elementId)!
    const legacy = render(state)
    const withFamily = render(setOverride(state, elementId, { fontFamily: 'Space Grotesk' }))
    expect(withFamily).not.toBe(legacy)
    expect(withFamily).toContain('font-family:Space Grotesk')
    if (capability.fontSizePx !== undefined) {
      const withSize = render(setOverride(state, elementId, { fontSizePx: 53 }))
      expect(withSize).not.toBe(legacy)
      expect(withSize).toContain(`font-size:${53 * scale}px`)
      // Reset returns the default markup exactly.
      expect(render(authoringReducer(setOverride(state, elementId, { fontSizePx: 53 }), { type: 'RESET_TYPOGRAPHY_OVERRIDE', elementId }))).toBe(legacy)
    }
  })

  it('an override of one Element never restyles another', () => {
    const [first, second] = SUPPORTED[layoutId]
    if (!second) return
    const onlyFirst = render(setOverride(state, first, { fontFamily: 'Space Grotesk' }))
    const both = render(setOverride(setOverride(state, first, { fontFamily: 'Space Grotesk' }), second, { fontFamily: 'Space Grotesk' }))
    expect(both).not.toBe(onlyFirst)
    expect(both.split('font-family:Space Grotesk').length).toBeGreaterThan(onlyFirst.split('font-family:Space Grotesk').length)
  })
})

describe('the renderer scales the px size with the canvas, like every other Template measure', () => {
  it('a 540px-wide canvas paints half the reference size', () => {
    const state = setOverride(baseState('cover'), 'title', { fontSizePx: 60 })
    const input = resolvePreviewInput(state)
    const half = { ...input, manifest: { ...input.manifest, canvas: { ...input.manifest.canvas, width: 540, height: 675 } } }
    const props = documentaryCardPropsFromResolvedInput(half, 'still', undefined, state.tuning, undefined, undefined, { templateId: TEMPLATE.id }, deriveTypographyOverrides(state, TEMPLATE.id))
    expect(renderToStaticMarkup(createElement(DocumentaryCard, props))).toContain('font-size:30px')
  })
})

describe('font registry: one supported list, real faces, worker declaration', () => {
  const stubTypography = { display: {}, body: {}, cssText: '@font-face{font-family:"Fraunces";}' } as unknown as ResolvedTypography

  it('the supported families are exactly the runtime registry (no second list)', () => {
    expect([...RUNTIME_FONT_FAMILIES]).toEqual(Object.keys(RUNTIME_FONT_REGISTRY))
    expect(RUNTIME_FONT_FAMILIES).toContain('Fraunces')
  })

  it('the editor declares every registry face from the same files the worker uses', () => {
    const css = runtimeFontFaceCss(RUNTIME_FONT_FAMILIES)
    for (const family of RUNTIME_FONT_FAMILIES) {
      expect(css).toContain(`font-family:"${family}"`)
      for (const file of Object.values(RUNTIME_FONT_REGISTRY[family].files)) expect(css).toContain(`url(${file})`)
    }
    expect(css).not.toContain('/public/')
    expect(runtimeFontFaceCss(['Inter'], { publicPrefix: true })).toContain('/public/creative-fonts/inter-400.woff2')
  })

  it('the worker declares and awaits the faces of the families picked locally; no override = the same object (legacy)', () => {
    expect(withOverrideFonts(stubTypography, undefined)).toBe(stubTypography)
    expect(withOverrideFonts(stubTypography, {})).toBe(stubTypography)
    expect(withOverrideFonts(stubTypography, { title: { fontSizePx: 40 } } as never)).toBe(stubTypography)
    const out = withOverrideFonts(stubTypography, { title: { fontFamily: 'Space Grotesk' }, intro: { fontFamily: 'Inter' }, kicker: { fontFamily: 'Inter' } })
    expect(out).not.toBe(stubTypography)
    expect(out.cssText.startsWith(stubTypography.cssText)).toBe(true)
    expect(out.cssText).toContain('font-family:"Space Grotesk"')
    expect(out.cssText).toContain('/public/creative-fonts/inter-600.woff2')
    expect(out.extra?.map((role) => `${role.family}:${role.weight}`).sort()).toEqual(['Inter:400', 'Inter:600', 'Space Grotesk:700'])
  })

  it('an unsupported family is never declared', () => {
    expect(withOverrideFonts(stubTypography, { title: { fontFamily: 'Papyrus' } })).toBe(stubTypography)
  })
})

describe('Free / Custom Text: explicit family + px size (additive, Video-inert)', () => {
  const host = (elements: FreeSceneElement[]) => ({ id: 'slide-1', composition: { kind: 'free', elements } as FreeSceneComposition })

  it('a legacy preset-only text keeps its exact appearance (no explicit fields written or read)', () => {
    const element = freeElements(host([CUSTOM]))[0] as FreeTextElement
    expect(element).not.toHaveProperty('font_family')
    expect(element).not.toHaveProperty('font_size_px')
    const stage = renderToStaticMarkup(createElement(FreeStage, { elements: deriveFreeSegment({ kind: 'free', elements: [CUSTOM] }).payload.elements, width: 1080, height: 1350, tokens: STAGE_TOKENS, imageUrl: () => undefined, ImageComponent: () => null }))
    expect(stage).toContain('font-size:37.8')
    expect(stage).toContain('font-family:Source Sans 3')
  })

  it('numeric size wins; a preset afterwards returns to the preset deterministically; Usar padrão clears both fields', () => {
    let scene = host([CUSTOM])
    scene = updateFreeElement(scene, CUSTOM_ID, { font_size_px: 53 })
    expect((freeElements(scene)[0] as FreeTextElement).font_size_px).toBe(53)
    expect((freeElements(scene)[0] as FreeTextElement).size).toBe('small')
    scene = updateFreeElement(scene, CUSTOM_ID, { size: 'medium', font_size_px: null })
    expect(freeElements(scene)[0]).not.toHaveProperty('font_size_px')
    expect((freeElements(scene)[0] as FreeTextElement).size).toBe('medium')
    scene = updateFreeElement(scene, CUSTOM_ID, { font_family: 'Inter', font_size_px: 70 })
    scene = updateFreeElement(scene, CUSTOM_ID, { font_family: null, font_size_px: null })
    const element = freeElements(scene)[0]
    expect(element).not.toHaveProperty('font_family')
    expect(element).not.toHaveProperty('font_size_px')
    expect((element as FreeTextElement).size).toBe('medium')
  })

  it('a size is whole px and bounded; an arbitrary family is ignored', () => {
    let scene = updateFreeElement(host([CUSTOM]), CUSTOM_ID, { font_size_px: 53.6 })
    expect((freeElements(scene)[0] as FreeTextElement).font_size_px).toBe(54)
    scene = updateFreeElement(scene, CUSTOM_ID, { font_size_px: 100000 })
    expect((freeElements(scene)[0] as FreeTextElement).font_size_px).toBe(400)
    scene = updateFreeElement(scene, CUSTOM_ID, { font_family: 'Papyrus' as never })
    expect(freeElements(scene)[0]).not.toHaveProperty('font_family')
  })

  it('the write boundary accepts supported families / sizes and rejects the rest; legacy compositions still validate', () => {
    expect(validateFreeCompositionShape({ kind: 'free', elements: [CUSTOM] }).ok).toBe(true)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...CUSTOM, font_family: 'Inter', font_size_px: 53 }] }).ok).toBe(true)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...CUSTOM, font_family: 'Papyrus' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...CUSTOM, font_size_px: 3 }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...CUSTOM, font_size_px: 'big' }] }).ok).toBe(false)
  })

  it('the neutral segment carries the explicit fields only when authored, and the (shared) schema accepts both shapes', () => {
    const legacy = deriveFreeSegment({ kind: 'free', elements: [CUSTOM] }).payload
    expect(legacy.elements[0]).not.toHaveProperty('font_family')
    expect(FreeSegmentPayloadSchema.safeParse(legacy).success).toBe(true)
    const authored = deriveFreeSegment({ kind: 'free', elements: [{ ...CUSTOM, font_family: 'Inter', font_size_px: 53 } as FreeTextElement] }).payload
    expect(authored.elements[0]).toMatchObject({ font_family: 'Inter', font_size_px: 53 })
    expect(FreeSegmentPayloadSchema.safeParse(authored).success).toBe(true)
    expect(FreeSegmentPayloadSchema.safeParse({ elements: [{ ...authored.elements[0], font_family: 'Papyrus' }] }).success).toBe(false)
  })

  it('the shared stage paints the explicit family and a px size scaled by the stage shorter side (1080 reference)', () => {
    const payload = deriveFreeSegment({ kind: 'free', elements: [{ ...CUSTOM, font_family: 'Space Grotesk', font_size_px: 53 } as FreeTextElement] }).payload
    const at = (width: number, height: number) => renderToStaticMarkup(createElement(FreeStage, { elements: payload.elements, width, height, tokens: STAGE_TOKENS, imageUrl: () => undefined, ImageComponent: () => null }))
    expect(at(1080, 1350)).toContain('font-family:Space Grotesk')
    expect(at(1080, 1350)).toContain('font-size:53px')
    expect(at(540, 675)).toContain('font-size:26.5px')
  })

  it('addFreeTextElement stays preset-only (Video authoring unchanged)', () => {
    const added = freeElements(addFreeTextElement({ id: 'scene', composition: { kind: 'free', elements: [] } as FreeSceneComposition }, CUSTOM_ID))[0]
    expect(added).not.toHaveProperty('font_family')
    expect(added).not.toHaveProperty('font_size_px')
  })
})

const STAGE_TOKENS = {
  colors: { background: '#ffffff', foreground: '#111111' },
  typography: { display: { family: 'Fraunces', weight: 700 }, body: { family: 'Source Sans 3', weight: 400 } },
}
