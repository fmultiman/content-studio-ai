/**
 * CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1 — Template Elements get their controls from a CLASS baseline (plus safe extras
 * and explicit, reasoned exceptions), not from whichever controls a component happened to wire.
 *
 * (1) capability model: every Element resolves through a class; baseline appears consistently; exceptions are deliberate; nothing persists;
 * (2) Logo da marca: Size + Opacity through the existing `brand` tuning, preview/render reflect it, reset, asset replacement, one Element;
 * (3) visual baseline: representative classes; no fake resource controls;
 * (4) Text safety; (5) reset / persistence / layout switch.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PersistedAuthoredSlideSchema, authoringStateToPersistedSlide, createTemplateSlide, persistedSlideToAuthoringState } from '../carousel-state'
import { deriveHiddenElementsRequest, derivePrimitiveTransformsRequest, deriveTuningOverrides, resolvePreviewInput, TUNING_BOUNDS } from '../authoring-state'
import {
  CAPABILITY_EXCEPTION_EXPLANATIONS, ELEMENT_CLASS_BASELINE, FIXED_ELEMENT_EXCEPTIONS, TRANSFORM_FIELDS, elementClassOf, resolveElementCapabilities, transformBindingFor,
  type ElementCapability, type ElementClass, type TransformField,
} from '../element-capabilities'
import { hasLayoutOwnedAuthoredWork } from '../layout-switch'
import { authoringReducer, type AuthoringAction } from '../reducer'
import { authoringRenderOverridesSchema, authoringRenderRequestSchema } from '../render-request'
import { DEFAULT_TUNING } from '../types'
import type { AuthoringProductContext, AuthoringState } from '../types'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout, layoutAssetSlots, type TemplateElementDefinition } from '@/lib/creative/templates/template-definitions'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'
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

const LAYOUT_IDS = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'] as const
type LayoutId = typeof LAYOUT_IDS[number]
const layoutOf = (id: string) => getTemplateLayout(TEMPLATE, id)!
const slide = (layoutId: LayoutId): AuthoringState => persistedSlideToAuthoringState(
  createTemplateSlide({ templateId: TEMPLATE.id, layoutId, appearance: layoutOf(layoutId).defaultAppearance, id: 's', order: 0, primitiveProjectRef: productContext.primitiveProjectRef ?? null })!, productContext, 'portrait',
)
const definitionOf = (layoutId: LayoutId, elementId: string): TemplateElementDefinition => layoutOf(layoutId).elements.find((element) => element.id === elementId)!
const caps = (layoutId: LayoutId, elementId: string) => resolveElementCapabilities(definitionOf(layoutId, elementId))

/** What the Inspector would dispatch for ONE field of an Element, applied through the real reducer. */
function edit(state: AuthoringState, layoutId: LayoutId, elementId: string, field: TransformField, value: number): AuthoringState {
  const binding = transformBindingFor(definitionOf(layoutId, elementId).control)!
  return authoringReducer(state, binding.write(state, field, value))
}
const resetElement = (state: AuthoringState, layoutId: LayoutId, elementId: string) => authoringReducer(state, transformBindingFor(definitionOf(layoutId, elementId).control)!.reset(state))

function render(state: AuthoringState, extras: { logo?: boolean } = {}): string {
  const input = resolvePreviewInput(state)
  const resolvedAssets = extras.logo ? { ...input.resolvedAssets, logo: { ref: 'logo', source: 'library_file', path: 'p', url: 'https://example.test/complete-wordmark.png', mime_type: 'image/png', fit: 'contain' } } : input.resolvedAssets
  const props = documentaryCardPropsFromResolvedInput(
    { ...input, resolvedAssets: resolvedAssets as typeof input.resolvedAssets, manifest: { ...input.manifest, sequence: { index: 1, total: 3 } } },
    'still', undefined, state.tuning, undefined, derivePrimitiveTransformsRequest(state),
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id) },
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}
/** The style attribute of the box that directly wraps the complete logo (the Element's own painted unit). */
const logoBoxStyle = (html: string) => /<div style="([^"]*)"><div aria-label="Project brand mark"/.exec(html)?.[1] ?? ''
const tagOf = (html: string, attribute: string) => new RegExp(`<div[^>]*${attribute}[^>]*>`).exec(html)?.[0] ?? ''

const ALL_ELEMENTS = LAYOUT_IDS.flatMap((layoutId) => layoutOf(layoutId).elements.map((definition) => ({ layoutId, definition })))

describe('capability model — class baseline, exceptions and the registry', () => {
  it('1. every audited Template Element resolves through an explicit class and a capability path', () => {
    expect(ALL_ELEMENTS.length).toBeGreaterThan(80)
    for (const { layoutId, definition } of ALL_ELEMENTS) {
      const resolved = resolveElementCapabilities(definition)
      expect(Object.keys(ELEMENT_CLASS_BASELINE), `${layoutId}.${definition.id}`).toContain(resolved.elementClass)
      expect(resolved.elementClass).toBe(elementClassOf(definition))
      expect(resolved.capabilities.visibility, `${layoutId}.${definition.id} visibility`).toBe(true)
    }
  })

  it('classes follow the Template identity, never a per-Element list', () => {
    expect(caps('cover', 'brandLogo').elementClass).toBe('brandAsset')
    expect(caps('cover', 'hero').elementClass).toBe('contentImage')
    expect(caps('list', 'hero').elementClass).toBe('contentImage')
    expect(caps('cover', 'tape1').elementClass).toBe('decorativeAsset')
    expect(caps('info', 'paperDark').elementClass).toBe('decorativeAsset')
    expect(caps('map', 'map').elementClass).toBe('proceduralVisual')
    expect(caps('list', 'heroFrame').elementClass).toBe('proceduralVisual')
    expect(caps('cover', 'title').elementClass).toBe('text')
    expect(caps('info', 'bodyText').elementClass).toBe('text')
  })

  it('2. the class baseline appears consistently: no Element lacks a baseline capability without a documented exception', () => {
    for (const { layoutId, definition } of ALL_ELEMENTS) {
      const resolved = resolveElementCapabilities(definition)
      expect(resolved.missingBaseline, `${layoutId}.${definition.id} (${resolved.elementClass})`).toEqual([])
      if (resolved.exception) continue
      for (const capability of ELEMENT_CLASS_BASELINE[resolved.elementClass]) expect(resolved.capabilities[capability], `${layoutId}.${definition.id}.${capability}`).toBe(true)
    }
    // …and the same class gives the same set wherever it appears.
    const byClass = new Map<ElementClass, Set<string>>()
    for (const { definition } of ALL_ELEMENTS) {
      const resolved = resolveElementCapabilities(definition)
      if (resolved.exception) continue
      if (resolved.elementClass === 'text') continue // text extras (a transform channel) are checked in the Text section
      const signature = JSON.stringify(Object.entries(resolved.capabilities))
      byClass.set(resolved.elementClass, (byClass.get(resolved.elementClass) ?? new Set()).add(signature))
    }
    for (const [elementClass, signatures] of byClass) expect(signatures.size, `${elementClass} has one capability set`).toBe(1)
  })

  it('3. exceptions are deliberate metadata: a follows Element names its owner rule, a fixed one has a written reason — omission by wiring is a reported gap', () => {
    for (const { layoutId, definition } of ALL_ELEMENTS) {
      const resolved = resolveElementCapabilities(definition)
      if (definition.control.type === 'follows') expect(resolved.exception?.reason, `${layoutId}.${definition.id}`).toBe('follows-owner')
      else if (definition.control.type === 'fixed') {
        expect(FIXED_ELEMENT_EXCEPTIONS[definition.id], `${layoutId}.${definition.id} needs a written reason`).toBeDefined()
        expect(resolved.exception?.explanation.length).toBeGreaterThan(20)
      } else expect(resolved.exception, `${layoutId}.${definition.id}`).toBeNull()
      if (resolved.exception) {
        // An exception removes the spatial baseline only — visibility is never omitted.
        expect(resolved.capabilities).toMatchObject({ visibility: true, position: false, scale: false, rotation: false, opacity: false })
      }
    }
    // Every written reason names a real fixed Element (no stale entries) and a defined explanation.
    const fixedIds = new Set(ALL_ELEMENTS.filter(({ definition }) => definition.control.type === 'fixed').map(({ definition }) => definition.id))
    for (const [id, reason] of Object.entries(FIXED_ELEMENT_EXCEPTIONS)) {
      expect(fixedIds.has(id), `${id} is a fixed Element`).toBe(true)
      expect(CAPABILITY_EXCEPTION_EXPLANATIONS[reason]).toBeTruthy()
    }
    // A fixed Element WITHOUT a reason is not silently accepted: the resolver reports the omitted baseline.
    const unreasoned = resolveElementCapabilities({ id: 'someNewFixedImage', kind: 'image', assetSlot: 'hero', control: { type: 'fixed' } })
    expect(unreasoned.exception).toBeNull()
    expect(unreasoned.missingBaseline).toEqual(expect.arrayContaining(['position', 'scale', 'rotation', 'opacity']))
    // A source that cannot store a baseline field is reported the same way (no silent gap).
    expect(resolveElementCapabilities({ id: 'someTextWithTitleSource', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'title' } }).missingBaseline).toEqual(expect.arrayContaining(['scale', 'opacity']))
  })

  it('no control is offered that the Element\'s authored source cannot store (preview and render honour every capability)', () => {
    const fieldsOf: Record<'position' | 'scale' | 'rotation' | 'opacity', TransformField[]> = { position: ['offsetX', 'offsetY'], scale: ['scale'], rotation: ['rotation'], opacity: ['opacity'] }
    for (const { layoutId, definition } of ALL_ELEMENTS) {
      const resolved = resolveElementCapabilities(definition)
      const binding = transformBindingFor(definition.control)
      for (const capability of ['position', 'scale', 'rotation', 'opacity'] as const) {
        if (!resolved.capabilities[capability]) continue
        expect(binding, `${layoutId}.${definition.id}`).not.toBeNull()
        for (const field of fieldsOf[capability]) expect(binding!.fields[field], `${layoutId}.${definition.id}.${field}`).toBeDefined()
      }
      // Resource controls only for Elements that really have a file behind them.
      expect(resolved.capabilities.assetReplace, `${layoutId}.${definition.id} assetReplace`).toBe(Boolean(definition.assetSlot))
    }
  })

  it('4. capability metadata never persists into AuthoringState or the persisted slide', () => {
    let state = slide('cover')
    const before = JSON.stringify(state)
    for (const { definition } of ALL_ELEMENTS) resolveElementCapabilities(definition)
    expect(JSON.stringify(state)).toBe(before)
    state = edit(state, 'cover', 'brandLogo', 'scale', 1.5)
    const serialized = JSON.stringify(authoringStateToPersistedSlide(state, 's', 0)) + JSON.stringify(state)
    for (const forbidden of ['capabilit', 'elementClass', 'brandAsset', 'missingBaseline', 'follows-owner']) expect(serialized).not.toContain(forbidden)
    expect(Object.keys(authoringStateToPersistedSlide(state, 's', 0)).sort()).toEqual(Object.keys(authoringStateToPersistedSlide(slide('cover'), 's', 0)).sort())
  })

  it('5. existing extra safe capabilities are not removed (the baseline is a floor)', () => {
    // A text Element stored in a material transform channel keeps Size and Opacity.
    expect(caps('grid', 'tiles').capabilities).toMatchObject({ position: true, rotation: true, scale: true, opacity: true, assetReplace: false })
    // The Hero keeps its Escala; every material keeps all five transform fields.
    expect(caps('cover', 'hero').capabilities).toMatchObject({ position: true, rotation: true, scale: true, opacity: true })
    for (const { definition } of ALL_ELEMENTS.filter(({ definition }) => definition.control.type === 'transform')) {
      expect(transformBindingFor(definition.control)!.fields, definition.id).toMatchObject(Object.fromEntries(TRANSFORM_FIELDS.map((field) => [field, expect.any(Object)])))
    }
    // Every existing authored range is unchanged (range policy is a later slice).
    expect(TUNING_BOUNDS.hero.scale).toEqual({ min: 0.9, max: 1.15 })
    expect(TUNING_BOUNDS.title.offsetX).toEqual({ min: -60, max: 60 })
    expect(transformBindingFor({ type: 'transform', key: 'tape1' })!.fields.scale).toEqual({ min: 0.5, max: 2, step: 0.01 })
  })
})

describe('Logo da marca — the real-smoke case', () => {
  const LOGO_LAYOUTS = ['cover', 'info', 'list', 'closing'] as const

  it('6-7. Logo da marca is a brandAsset exposing Size/Scale (and the rest of the visual baseline) in EVERY layout that has it', () => {
    for (const layoutId of LOGO_LAYOUTS) {
      const resolved = caps(layoutId, 'brandLogo')
      expect(resolved.elementClass, layoutId).toBe('brandAsset')
      expect(resolved.exception, layoutId).toBeNull()
      expect(resolved.capabilities, layoutId).toEqual({ visibility: true, position: true, scale: true, rotation: true, opacity: true, assetReplace: true })
      expect(definitionOf(layoutId, 'brandLogo').control).toEqual({ type: 'tuning', group: 'brand' })
    }
    expect(ALL_ELEMENTS.filter(({ definition }) => definition.assetSlot === 'logo').map(({ layoutId }) => layoutId).sort()).toEqual([...LOGO_LAYOUTS].sort())
  })

  it('8. changing Logo scale updates the existing authored truth (`tuning.brand`), nothing else', () => {
    const before = slide('cover')
    const after = edit(before, 'cover', 'brandLogo', 'scale', 1.8)
    expect(after.tuning.brand).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1.8 })
    expect(after.tuning.hero).toEqual(before.tuning.hero)
    expect(after.primitiveTransforms).toEqual(before.primitiveTransforms)
    expect(after.hiddenElements).toEqual(before.hiddenElements)
    expect(after.elementOrder).toEqual(before.elementOrder)
    expect(transformBindingFor(definitionOf('cover', 'brandLogo').control)!.read(after).scale).toBe(1.8)
    expect(transformBindingFor(definitionOf('cover', 'brandLogo').control)!.read(before).scale).toBe(1)
  })

  it('9. the Canvas preview reflects Size and Opacity of the complete logo in every layout; an untouched logo paints exactly as before', () => {
    const cover = render(slide('cover'), { logo: true })
    // Untouched: the legacy Cover placement, no Size/Opacity artefacts.
    expect(logoBoxStyle(cover)).toContain('transform:translate(0px, 0px) rotate(0deg)')
    expect(logoBoxStyle(cover)).not.toContain('scale(')
    // Scaled: grows from its bottom-left anchor (the signature sits on the bottom margin).
    const scaled = render(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2), { logo: true })
    expect(logoBoxStyle(scaled)).toContain('rotate(0deg) translate(0px, -118px) scale(2)')
    const faded = render(edit(slide('cover'), 'cover', 'brandLogo', 'opacity', 0.4), { logo: true })
    expect(logoBoxStyle(faded)).toContain('opacity:0.4')
    for (const layoutId of ['info', 'list', 'closing'] as const) {
      expect(logoBoxStyle(render(slide(layoutId), { logo: true })), `${layoutId} untouched`).not.toContain('scale(')
      const html = render(edit(edit(slide(layoutId), layoutId, 'brandLogo', 'scale', 1.5), layoutId, 'brandLogo', 'opacity', 0.5), { logo: true })
      expect(logoBoxStyle(html), layoutId).toContain('scale(1.5)')
      expect(logoBoxStyle(html), layoutId).toContain('opacity:0.5')
    }
    // Scaling is the logo's own: the rest of the slide is byte-identical.
    expect(scaled.replace(logoBoxStyle(scaled), '')).toBe(cover.replace(logoBoxStyle(cover), ''))
  })

  it('10. Restaurar elemento restores the Template default and leaves no stale authored value behind', () => {
    const authored = edit(edit(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2.4), 'cover', 'brandLogo', 'opacity', 0.3), 'cover', 'brandLogo', 'offsetX', 12)
    const reset = resetElement(authored, 'cover', 'brandLogo')
    expect(reset.tuning).toEqual(slide('cover').tuning)
    expect(reset.tuning).not.toHaveProperty('brand')
    expect(deriveTuningOverrides(reset)).toBeUndefined()
    expect(authoringStateToPersistedSlide(reset, 's', 0).tuning).toEqual(authoringStateToPersistedSlide(slide('cover'), 's', 0).tuning)
    expect(render(reset, { logo: true })).toBe(render(slide('cover'), { logo: true }))
  })

  it('11. replacing the logo asset keeps the capability and the author\'s Size; no transform is silently reset', () => {
    const scaled = edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2)
    const replaced = authoringReducer(scaled, { type: 'SET_ASSET_OVERRIDE', slot: 'logo', libraryFileId: '22222222-2222-4222-8222-222222222222' })
    expect(replaced.assetOverrides?.logo).toEqual({ libraryFileId: '22222222-2222-4222-8222-222222222222' })
    expect(replaced.tuning.brand?.scale).toBe(2)
    expect(caps('cover', 'brandLogo').capabilities).toMatchObject({ scale: true, assetReplace: true })
    expect(logoBoxStyle(render(replaced, { logo: true }))).toContain('scale(2)')
    // …and the replaced logo can still be adapted further.
    expect(edit(replaced, 'cover', 'brandLogo', 'scale', 2.6).tuning.brand?.scale).toBe(2.6)
    // "Usar padrão" restores the Template ASSET only, never the author's Size.
    expect(authoringReducer(replaced, { type: 'USE_TEMPLATE_DEFAULT_ASSET', slot: 'logo' }).tuning.brand?.scale).toBe(2)
  })

  it('12-13. the complete logo stays ONE Element; no Nome da marca Element or text comes back', () => {
    for (const layoutId of LAYOUT_IDS) {
      const ids = layoutOf(layoutId).elements.map((element) => element.id)
      expect(ids.filter((id) => id.startsWith('brand')).length, layoutId).toBeLessThanOrEqual(layoutId === 'info' ? 2 : 1)
      expect(ids).not.toContain('brandName')
      expect(ids).not.toContain('brand')
    }
    const scaled = render(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2.5), { logo: true })
    expect((scaled.match(/aria-label="Project brand mark"/g) ?? []).length).toBe(1)
    expect(scaled).not.toContain('Portal Comunidades Alternativas')
    expect(layoutAssetSlots(TEMPLATE, layoutOf('cover')).find(({ slot }) => slot.id === 'logo')!.elements.map((element) => element.id)).toEqual(['brandLogo'])
  })

  it('Size is bounded by the persistence schemas exactly like the UI range (no value the render request would reject)', () => {
    const { scale } = TUNING_BOUNDS.brand
    const tuning = (value: number) => ({ documentaryCard: { ...DEFAULT_TUNING, brand: { offsetX: 0, offsetY: 0, rotation: 0, scale: value } } })
    expect(authoringRenderOverridesSchema.safeParse(tuning(scale.max)).success).toBe(true)
    expect(authoringRenderOverridesSchema.safeParse(tuning(scale.min)).success).toBe(true)
    expect(authoringRenderOverridesSchema.safeParse(tuning(scale.max + 0.01)).success).toBe(false)
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, brand: { offsetX: 0, offsetY: 0, rotation: 0, opacity: 1.2 } } }).success).toBe(false)
    expect(PersistedAuthoredSlideSchema.safeParse({ ...authoringStateToPersistedSlide(slide('cover'), 's', 0), tuning: { ...DEFAULT_TUNING, brand: { offsetX: 0, offsetY: 0, rotation: 0, scale: scale.max + 1 } } }).success).toBe(false)
  })
})

describe('visual baseline — representative classes', () => {
  const REPRESENTATIVES: [LayoutId, string, ElementClass][] = [
    ['cover', 'hero', 'contentImage'], ['cover', 'brandLogo', 'brandAsset'], ['cover', 'tape1', 'decorativeAsset'], ['info', 'paperDark', 'decorativeAsset'], ['map', 'map', 'proceduralVisual'],
  ]

  it.each(REPRESENTATIVES)('14-18. %s.%s (%s): visibility, X/Y, Size, Rotation and Opacity exist and are stored in the Element\'s existing source', (layoutId, elementId, elementClass) => {
    const resolved = caps(layoutId, elementId)
    expect(resolved.elementClass).toBe(elementClass)
    expect(resolved.capabilities).toMatchObject({ visibility: true, position: true, scale: true, rotation: true, opacity: true })
    const binding = transformBindingFor(definitionOf(layoutId, elementId).control)!
    let state = slide(layoutId)
    for (const [field, value] of [['offsetX', 5], ['offsetY', -7], ['rotation', 1], ['scale', 1.1], ['opacity', 0.6]] as const) {
      state = edit(state, layoutId, elementId, field, value)
      expect(binding.read(state)[field], `${elementId}.${field}`).toBe(value)
    }
    expect(resetElement(state, layoutId, elementId).tuning).toEqual(slide(layoutId).tuning)
    expect(resetElement(state, layoutId, elementId).primitiveTransforms).toEqual(slide(layoutId).primitiveTransforms)
  })

  it('Opacity of the content image (Hero) is authored in `tuning.hero.opacity` and reaches the Canvas; absent = opaque; Escala keeps its existing range', () => {
    const untouched = render(slide('cover'))
    expect(tagOf(untouched, 'aria-label="Imagem principal"')).not.toContain('opacity')
    const faded = render(edit(slide('cover'), 'cover', 'hero', 'opacity', 0.4))
    expect(tagOf(faded, 'aria-label="Imagem principal"')).toContain('opacity:0.4')
    expect(transformBindingFor(definitionOf('cover', 'hero').control)!.fields.scale).toEqual({ min: 0.9, max: 1.15, step: 0.01 })
    // Lista / Citação: the frame under the image follows the image's opacity (it is the same plate).
    const listFaded = render(edit(slide('list'), 'list', 'hero', 'opacity', 0.5))
    expect(tagOf(listFaded, 'data-element="Moldura"')).toContain('opacity:0.5')
    expect(tagOf(listFaded, 'aria-label="Imagem do documento"')).toContain('opacity:0.5')
  })

  it('a procedural visual and a material keep honouring Opacity and Escala through their transform channel in the Canvas', () => {
    const map = render(edit(edit(slide('map'), 'map', 'map', 'opacity', 0.5), 'map', 'map', 'scale', 1.2))
    expect(tagOf(map, 'data-element="Mapa do Brasil"')).toMatch(/opacity:0\.5/)
    expect(tagOf(map, 'data-element="Mapa do Brasil"')).toContain('scale(1.2)')
    const tape = render(edit(slide('cover'), 'cover', 'tape1', 'opacity', 0.5))
    expect(tagOf(tape, 'data-element="Fita da imagem"')).toMatch(/opacity:0\.5/)
  })

  it('19. a procedural visual gains no fake Asset/Library control: no slot, no replace capability', () => {
    for (const { layoutId, definition } of ALL_ELEMENTS.filter(({ definition }) => definition.kind === 'shape')) {
      expect(caps(layoutId, definition.id).capabilities.assetReplace, `${layoutId}.${definition.id}`).toBe(false)
      expect(definition.assetSlot).toBeUndefined()
    }
    expect(layoutAssetSlots(TEMPLATE, layoutOf('map')).flatMap(({ elements }) => elements.map((element) => element.id))).not.toContain('map')
  })

  it('20. image / brand / material keep truthful resource controls (replaceable, backed by a real slot)', () => {
    for (const { layoutId, definition } of ALL_ELEMENTS.filter(({ definition }) => ['image', 'material'].includes(definition.kind))) {
      expect(caps(layoutId, definition.id).capabilities.assetReplace, `${layoutId}.${definition.id}`).toBe(true)
      expect(definition.assetSlot, `${layoutId}.${definition.id}`).toBeDefined()
    }
  })

  it('the old per-element drift is gone: the same class exposes the same controls in every layout', () => {
    const signature = (layoutId: LayoutId, id: string) => JSON.stringify(caps(layoutId, id).capabilities)
    expect(signature('info', 'brandLogo')).toBe(signature('cover', 'brandLogo'))
    expect(signature('list', 'hero')).toBe(signature('cover', 'hero'))
    expect(signature('closing', 'brandLogo')).toBe(signature('cover', 'brandLogo'))
  })
})

describe('Text safety — the baseline is a floor, typography and Estilos are untouched', () => {
  const TEXT = ALL_ELEMENTS.filter(({ definition }) => definition.kind === 'text')

  it('21. Text baseline is coherent: spatial Text offers position + rotation, and never a resource control', () => {
    expect(ELEMENT_CLASS_BASELINE.text).toEqual(['visibility', 'position', 'rotation'])
    for (const { layoutId, definition } of TEXT) {
      const resolved = resolveElementCapabilities(definition)
      expect(resolved.capabilities.assetReplace, `${layoutId}.${definition.id}`).toBe(false) // 24. no meaningless image/resource controls
      expect(resolved.missingBaseline).toEqual([])
      if (definition.control.type === 'tuning') expect(resolved.capabilities, `${layoutId}.${definition.id}`).toMatchObject({ position: true, rotation: true, scale: false, opacity: false })
    }
  })

  it('23. existing supported Text transforms are not removed', () => {
    for (const [layoutId, id] of [['cover', 'title'], ['cover', 'kicker'], ['cover', 'intro'], ['cover', 'source'], ['info', 'title'], ['info', 'source'], ['list', 'title']] as const) {
      expect(caps(layoutId, id).capabilities, `${layoutId}.${id}`).toMatchObject({ position: true, rotation: true })
      expect(Object.keys(transformBindingFor(definitionOf(layoutId, id).control)!.fields).sort()).toEqual(['offsetX', 'offsetY', 'rotation'])
    }
    // Existing ranges of the Text groups are exactly what they were.
    for (const group of ['title', 'source', 'kicker', 'intro'] as const) expect(TUNING_BOUNDS[group].offsetX).toEqual({ min: -60, max: 60 })
    expect(transformBindingFor({ type: 'tuning', group: 'title' })!.fields.rotation).toEqual({ min: -2, max: 2, step: 0.1 })
  })

  it('22/25. typography behaviour is unchanged: the capability model does not read or write typography/Estilos state', () => {
    let state = slide('cover')
    state = authoringReducer(state, { type: 'SET_TYPOGRAPHY_OVERRIDE', elementId: 'title', patch: { fontSizePx: 70 } })
    const typography = state.typography
    state = edit(edit(state, 'cover', 'title', 'offsetX', 10), 'cover', 'brandLogo', 'scale', 2)
    expect(state.typography).toEqual(typography)
    expect(deriveTuningOverrides(state)?.typography).toEqual({ title: { fontSizePx: 70 } })
    expect(Object.keys(resolveElementCapabilities(definitionOf('cover', 'title')).capabilities).sort()).toEqual(['assetReplace', 'opacity', 'position', 'rotation', 'scale', 'visibility'])
    // The Title's Entrelinha is not a placement field: it is stored by Estilos, never offered by the placement binding.
    expect(Object.keys(transformBindingFor(definitionOf('cover', 'title').control)!.fields)).not.toContain('lineHeight')
  })
})

describe('reset, persistence and layout switch', () => {
  it('26. a newly exposed field resets through the same Restaurar elemento, leaving no stale persisted state', () => {
    const authored = edit(edit(slide('cover'), 'cover', 'hero', 'opacity', 0.5), 'cover', 'hero', 'offsetX', 20)
    expect(authoringStateToPersistedSlide(authored, 's', 0).tuning?.hero).toEqual({ offsetX: 20, offsetY: 0, rotation: 0, scale: 1, opacity: 0.5 })
    const reset = resetElement(authored, 'cover', 'hero')
    expect(reset.tuning.hero).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 })
    expect(authoringStateToPersistedSlide(reset, 's', 0).tuning).toEqual(authoringStateToPersistedSlide(slide('cover'), 's', 0).tuning)
  })

  it('save / reload / render request / frozen snapshot carry the new fields; a legacy row loads and renders unchanged', () => {
    const state = edit(edit(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 1.7), 'cover', 'brandLogo', 'opacity', 0.8), 'cover', 'hero', 'opacity', 0.9)
    const persisted = JSON.parse(JSON.stringify(authoringStateToPersistedSlide(state, 's', 0)))
    expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    const reloaded = persistedSlideToAuthoringState(persisted, productContext, 'portrait')
    expect(reloaded.tuning).toEqual(state.tuning)
    expect(render(reloaded, { logo: true })).toBe(render(state, { logo: true }))
    const overrides = deriveTuningOverrides(state)!
    const request = { manifest: resolvePreviewInput(state).manifest, overrides, templateId: TEMPLATE.id }
    expect(authoringRenderRequestSchema.safeParse(request).success).toBe(true)
    const snapshot = buildStaticRenderExecutionSnapshot({ manifest: request.manifest, identitySnapshot: productContext.identitySnapshot, overrides, templateId: TEMPLATE.id, slide: null })
    const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.snapshot.overrides?.documentaryCard?.brand).toEqual({ offsetX: 0, offsetY: 0, rotation: 0, scale: 1.7, opacity: 0.8 })
      expect(parsed.snapshot.overrides?.documentaryCard?.hero?.opacity).toBe(0.9)
    }
    // A snapshot/row written before the new fields (brand = position only) is still valid and paints the legacy placement.
    const legacyTuning = { ...DEFAULT_TUNING, brand: { offsetX: 20, offsetY: 0, rotation: 0 } }
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: legacyTuning }).success).toBe(true)
    expect(logoBoxStyle(render({ ...slide('cover'), tuning: legacyTuning }, { logo: true }))).toContain('transform:translate(20px, 0px) rotate(0deg)')
    expect(logoBoxStyle(render({ ...slide('cover'), tuning: legacyTuning }, { logo: true }))).not.toContain('scale(')
  })

  it('27. layout switch resets the newly exposed Layout-owned state (Logo Size/Opacity, Hero Opacity) — it never leaks into the next Template layout', () => {
    const cover = edit(edit(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2), 'cover', 'brandLogo', 'opacity', 0.5), 'cover', 'hero', 'opacity', 0.5)
    expect(hasLayoutOwnedAuthoredWork(cover)).toBe(true)
    for (const target of ['info', 'list', 'closing', 'quote'] as const) {
      const next = authoringReducer(cover, { type: 'SET_VARIANT', variant: target })
      expect(next.tuning, target).toEqual(slide(target).tuning)
      expect(next.tuning).not.toHaveProperty('brand')
      expect(next.tuning.hero).not.toHaveProperty('opacity')
      expect(logoBoxStyle(render(next, { logo: true })), target).not.toContain('scale(')
    }
    // 29. …and back: nothing resurfaces.
    const back = authoringReducer(authoringReducer(cover, { type: 'SET_VARIANT', variant: 'info' }), { type: 'SET_VARIANT', variant: 'cover' })
    expect(back.tuning).toEqual(slide('cover').tuning)
    // The same holds for state authored on a layout whose Logo used to be fixed.
    const info = edit(slide('info'), 'info', 'brandLogo', 'scale', 2)
    expect(authoringReducer(info, { type: 'SET_VARIANT', variant: 'closing' }).tuning).toEqual(slide('closing').tuning)
  })

  it('28. Custom Elements are preserved across the switch', () => {
    const cover = authoringReducer(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2), { type: 'SET_CUSTOM_ELEMENTS', elements: [CUSTOM] })
    expect(authoringReducer(cover, { type: 'SET_VARIANT', variant: 'list' }).elements).toEqual([CUSTOM])
  })

  it('anatomy / Camadas / selection are not touched by capability changes: paint order and hidden ids stay as authored', () => {
    const base = authoringReducer(slide('cover'), { type: 'SET_ELEMENT_ORDER', order: [...layoutOf('cover').defaultStackOrder].reverse() })
    const hidden = authoringReducer(base, { type: 'TOGGLE_ELEMENT_VISIBILITY', id: 'tape1' })
    const after = edit(edit(hidden, 'cover', 'brandLogo', 'scale', 2), 'cover', 'hero', 'opacity', 0.3)
    expect(after.elementOrder).toEqual(hidden.elementOrder)
    expect(after.hiddenElements).toEqual(hidden.hiddenElements)
    const actions: AuthoringAction[] = [transformBindingFor(definitionOf('cover', 'brandLogo').control)!.write(slide('cover'), 'scale', 2)]
    expect(actions.every((action) => action.type === 'SET_TUNING')).toBe(true)
  })

  it('every Template Element\'s binding agrees with TRANSFORM_FIELDS (no stray field name)', () => {
    for (const { definition } of ALL_ELEMENTS) {
      const binding = transformBindingFor(definition.control)
      if (!binding) continue
      for (const field of Object.keys(binding.fields)) expect(TRANSFORM_FIELDS as readonly string[]).toContain(field)
    }
    const capabilityNames: ElementCapability[] = ['visibility', 'position', 'scale', 'rotation', 'opacity', 'assetReplace']
    expect(Object.keys(caps('cover', 'hero').capabilities).sort()).toEqual([...capabilityNames].sort())
  })
})

describe('36. Preview and final render consume the same authored truth (frozen snapshot → worker binding → renderer)', () => {
  /** The worker path: authored state → frozen snapshot overrides → claim-time binding props → the same DocumentaryCard. */
  function finalRender(state: AuthoringState, extras: { logo?: boolean } = {}): string {
    const input = resolvePreviewInput(state)
    const resolvedAssets = extras.logo ? { ...input.resolvedAssets, logo: { ref: 'logo', source: 'library_file', path: 'p', url: 'https://example.test/complete-wordmark.png', mime_type: 'image/png', fit: 'contain' } } : input.resolvedAssets
    const overrides = deriveTuningOverrides(state)
    const snapshot = buildStaticRenderExecutionSnapshot({
      manifest: { ...input.manifest, sequence: { index: 1, total: 3 } }, identitySnapshot: productContext.identitySnapshot, overrides, templateId: TEMPLATE.id,
      hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id), slide: null,
    })
    const parsed = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot)))
    if (!parsed.ok) throw new Error('snapshot did not parse')
    const binding = resolveTemplateBinding('editorial.documentary-card')!
    const props = binding.createProps(
      {
        variant: state.variant, appearance: state.appearance, content: input.manifest.content, assets: resolvedAssets as never, tokens: input.tokens, canvas: input.manifest.canvas,
        sequence: { index: 1, total: 3 }, primitiveTransforms: derivePrimitiveTransformsRequest(state), templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id),
      } as never,
      { mode: 'still', overrides: parsed.snapshot.overrides },
    )
    return renderToStaticMarkup(createElement(DocumentaryCard, props as never))
  }

  it('complete Logo da marca with a non-default Size: the final render is byte-identical to the Preview', () => {
    const state = edit(edit(slide('cover'), 'cover', 'brandLogo', 'scale', 2.4), 'cover', 'brandLogo', 'opacity', 0.7)
    expect(logoBoxStyle(finalRender(state, { logo: true }))).toContain('scale(2.4)')
    expect(finalRender(state, { logo: true })).toBe(render(state, { logo: true }))
    for (const layoutId of ['info', 'list', 'closing'] as const) {
      const other = edit(slide(layoutId), layoutId, 'brandLogo', 'scale', 1.6)
      expect(finalRender(other, { logo: true }), layoutId).toBe(render(other, { logo: true }))
    }
  })

  it('a procedural visual with a non-default Opacity, and an image visual with a non-default transform, render identically in Preview and final', () => {
    const procedural = edit(edit(slide('map'), 'map', 'map', 'opacity', 0.35), 'map', 'map', 'scale', 1.15)
    expect(finalRender(procedural)).toBe(render(procedural))
    expect(tagOf(finalRender(procedural), 'data-element="Mapa do Brasil"')).toContain('opacity:0.35')
    const image = edit(edit(edit(slide('cover'), 'cover', 'hero', 'opacity', 0.55), 'cover', 'hero', 'scale', 1.1), 'cover', 'hero', 'offsetX', 30)
    expect(finalRender(image)).toBe(render(image))
    expect(tagOf(finalRender(image), 'aria-label="Imagem principal"')).toContain('opacity:0.55')
    expect(tagOf(finalRender(image), 'aria-label="Imagem principal"')).toContain('translate(30px, 0px)')
  })

  it('RENDERER/WORKER impact is exactly the already-bundled renderer files: the Editor-only capability registry never enters the worker export', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const exportList = readFileSync(join(process.cwd(), 'infra', 'render-worker-runtime', 'export.mjs'), 'utf-8')
    expect(exportList).not.toContain('element-capabilities')
    expect(exportList).toContain('components/creative/documentary-card/primitives.tsx')
    for (const file of ['components/creative/documentary-card/primitives.tsx', 'components/creative/documentary-card/CoverVariant.tsx', 'components/creative/documentary-card/InfoVariant.tsx', 'components/creative/documentary-card/ListVariant.tsx', 'components/creative/documentary-card/ClosingVariant.tsx', 'lib/creative/templates/template-definitions.ts']) {
      expect(readFileSync(join(process.cwd(), ...file.split('/')), 'utf-8'), file).not.toMatch(/element-capabilities/)
    }
  })
})
