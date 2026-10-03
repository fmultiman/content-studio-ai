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
  CAPABILITY_EXCEPTION_EXPLANATIONS, ELEMENT_CLASS_BASELINE, SEMANTIC_EXCEPTION_REASONS, SEMANTIC_FIXED_EXCEPTIONS, TRANSFORM_FIELDS, elementClassOf, resolveElementCapabilities, transformBindingFor,
  type ElementCapability, type ElementClass, type TransformField,
} from '../element-capabilities'
import { hasLayoutOwnedAuthoredWork } from '../layout-switch'
import { authoringReducer, type AuthoringAction } from '../reducer'
import { authoringRenderOverridesSchema, authoringRenderRequestSchema } from '../render-request'
import { DEFAULT_TUNING } from '../types'
import type { AuthoringProductContext, AuthoringState } from '../types'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE, getTemplateLayout, layoutAssetSlots, type TemplateElementDefinition } from '@/lib/creative/templates/template-definitions'
import { resolveElementStack } from '@/lib/creative/templates/element-stack'
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

  // Phrases that describe an IMPLEMENTATION state, never a Template meaning. They can never justify an exception.
  const IMPLEMENTATION_EXCUSES = /deferred|not (yet )?(implemented|wired|supported)|no (authored )?(state|position) (exists )?yet|does not (exist|support|wire)|doesn't|currently|current code|forgot|unwired|todo|limitation|for now|later slice/i

  it('3. every exception is a SEMANTIC relationship, with evidence in the Template layout (never an implementation state)', () => {
    const exceptions = ALL_ELEMENTS.filter(({ definition }) => resolveElementCapabilities(definition).exception)
    expect(exceptions.length).toBeGreaterThan(0)
    for (const { layoutId, definition } of exceptions) {
      const resolved = resolveElementCapabilities(definition)
      const where = `${layoutId}.${definition.id}`
      expect(SEMANTIC_EXCEPTION_REASONS, where).toContain(resolved.exception!.reason)
      // An exception removes the spatial baseline only — visibility is never omitted.
      expect(resolved.capabilities, where).toMatchObject({ visibility: true, position: false, scale: false, rotation: false, opacity: false })
      // Evidence from the Template: the Element follows an owner that exists in the SAME layout, that owner is itself spatial, and the
      // layout paints the follower directly against it (text ON its paper, frame UNDER its image, pins ABOVE their map, links UNDER their cards).
      expect(definition.control.type, `${where} is a follows Element (the Template has no other kind of exception)`).toBe('follows')
      if (definition.control.type !== 'follows') continue
      const owner = layoutOf(layoutId).elements.find((element) => element.id === (definition.control as { parent: string }).parent)
      expect(owner, `${where} owner exists`).toBeDefined()
      expect(['transform', 'tuning'], `${where} owner is spatial, not itself an exception`).toContain(owner!.control.type)
      const placement = definition.stackPlacement
      const anchor = typeof placement === 'object' ? ('above' in placement ? placement.above : placement.below) : undefined
      expect(anchor, `${where} is painted against its owner`).toBe(owner!.id)
    }
    // Every explanation is a meaning, not an excuse; every reason is on the semantic list.
    for (const [reason, explanation] of Object.entries(CAPABILITY_EXCEPTION_EXPLANATIONS)) {
      expect(SEMANTIC_EXCEPTION_REASONS).toContain(reason)
      expect(explanation, reason).not.toMatch(IMPLEMENTATION_EXCUSES)
      expect(explanation.length).toBeGreaterThan(30)
    }
    for (const [id, entry] of Object.entries(SEMANTIC_FIXED_EXCEPTIONS)) {
      expect(SEMANTIC_EXCEPTION_REASONS, id).toContain(entry.reason)
      expect(entry.reason, id).not.toBe('follows-owner')
      expect(entry.evidence, id).not.toMatch(IMPLEMENTATION_EXCUSES)
      expect(ALL_ELEMENTS.some(({ definition }) => definition.id === id && definition.control.type === 'fixed'), `${id} is a real fixed Element`).toBe(true)
    }
  })

  it('3b. the audit outcome (18 former `fixed` Elements, all implementation gaps): NO Template Element is "fixed" any more — every former fixed unit has an authored placement, so no implementation gap lives on as an exception', () => {
    expect(ALL_ELEMENTS.filter(({ definition }) => definition.control.type === 'fixed')).toEqual([])
    expect(Object.keys(SEMANTIC_FIXED_EXCEPTIONS)).toEqual([])
    // The `follows` set is exactly the units whose place IS another unit's place.
    expect(ALL_ELEMENTS.filter(({ definition }) => definition.control.type === 'follows').map(({ layoutId, definition }) => `${layoutId}.${definition.id}`).sort()).toEqual([
      'closing.inviteText', 'cover.noteText', 'grid.ideasText', 'info.card1Text', 'info.card2Text', 'info.introText', 'list.calloutText', 'list.heroFrame', 'list.noteText',
      'map.mapPins', 'map.noteText', 'network.calloutText', 'network.cardsText', 'network.links', 'quote.calloutText', 'quote.heroFrame', 'quote.quoteText',
    ].sort())
  })

  it('3c. an implementation gap can never silently become an exception: it is a reported, failing gap', () => {
    // A fixed unit (any class) with no semantic entry omits the baseline WITHOUT an exception → missingBaseline reports it.
    const fixedImage = resolveElementCapabilities({ id: 'someNewFixedImage', kind: 'image', assetSlot: 'hero', control: { type: 'fixed' } })
    expect(fixedImage.exception).toBeNull()
    expect(fixedImage.missingBaseline).toEqual(expect.arrayContaining(['position', 'scale', 'rotation', 'opacity']))
    const fixedText = resolveElementCapabilities({ id: 'someNewFixedText', kind: 'text', control: { type: 'fixed' } })
    expect(fixedText.exception).toBeNull()
    expect(fixedText.missingBaseline).toEqual(expect.arrayContaining(['position', 'rotation']))
    const fixedShape = resolveElementCapabilities({ id: 'someNewFixedRule', kind: 'shape', control: { type: 'fixed' } })
    expect(fixedShape.missingBaseline).toEqual(expect.arrayContaining(['position', 'scale', 'rotation', 'opacity']))
    // A source that cannot store a baseline field is reported the same way (class baseline enforcement is not bypassable by wiring).
    expect(resolveElementCapabilities({ id: 'someLogoOnATitleSource', kind: 'image', assetSlot: 'logo', control: { type: 'tuning', group: 'title' } }).missingBaseline).toEqual(expect.arrayContaining(['scale', 'opacity']))
    expect(resolveElementCapabilities({ id: 'someMaterialOnAHeroSource', kind: 'material', assetSlot: 'tape', control: { type: 'tuning', group: 'intro' } }).missingBaseline).toEqual(expect.arrayContaining(['scale', 'opacity']))
    // The excuse filter itself catches the phrases the audit rejected.
    for (const excuse of ['deferred until per-block position exists', 'not implemented yet', 'fixed in the current code', 'the component does not support it', 'currently unwired']) expect(excuse).toMatch(IMPLEMENTATION_EXCUSES)
    // …and a registered exception can only name a semantic reason (a different reason is a type error and fails here at runtime too).
    expect(SEMANTIC_EXCEPTION_REASONS).toEqual(['follows-owner', 'derived-geometry', 'compound-relationship'])
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
    // CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1 — hard bounds govern authored state; soft bounds govern slider UI.
    expect(TUNING_BOUNDS.hero.scale).toEqual({ min: 0.1, max: 5 })
    expect(TUNING_BOUNDS.title.offsetX).toEqual({ min: -300, max: 300 })
    expect(transformBindingFor({ type: 'transform', key: 'tape1' })!.fields.scale).toMatchObject({ min: 0.5, max: 2, step: 0.01, hardMin: 0.1, hardMax: 5 })
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
    expect(transformBindingFor(definitionOf('cover', 'hero').control)!.fields.scale).toMatchObject({ min: 0.5, max: 2, step: 0.01, hardMin: 0.1, hardMax: 5 })
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
    // CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1: text groups have hard position bounds ±300.
    for (const group of ['title', 'source', 'kicker', 'intro'] as const) expect(TUNING_BOUNDS[group].offsetX).toEqual({ min: -300, max: 300 })
    expect(transformBindingFor({ type: 'tuning', group: 'title' })!.fields.rotation).toMatchObject({ min: -2, max: 2, step: 0.1, hardMin: -15, hardMax: 15 })
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

describe('exception audit — the 18 formerly "fixed" Elements (14 text blocks, 3 visuals, 1 follower) are real, rendered, authored placements', () => {
  /** Content that makes every optional unit of a layout exist, so each Element has something to paint. */
  const FULL: Record<string, Record<string, unknown>> = {
    info: { intro: 'Chamada do info', annotation: 'Anotação do info', source_line: 'Fonte do info' },
    list: { intro: 'Introdução da lista', image_caption: 'Legenda', callout: 'Destaque' },
    grid: { intro: 'Introdução da grade' },
    map: { intro: 'Introdução do mapa', places_more: 'e outros', note: 'Nota do mapa' },
    network: { kicker: 'Chamada da rede', intro: 'Introdução da rede' },
    quote: { intro: 'Introdução da citação', bullets: ['Tópico um', 'Tópico dois'], callout: 'Destaque' },
    closing: { cta_title: 'Convite', cta_text: 'Texto', contact: 'a@b.org', tagline: 'Frase final', items: [{ icon: 'leaf', label: 'Item um' }, { icon: 'leaf', label: 'Item dois' }] },
  }
  const full = (layoutId: LayoutId): AuthoringState => ({ ...slide(layoutId), contentOverride: { ...(slide(layoutId).contentOverride as object), ...FULL[layoutId] } as never })
  const toggle = (state: AuthoringState, id: string) => authoringReducer(state, { type: 'TOGGLE_ELEMENT_VISIBILITY', id })

  /** The worker path: authored state -> frozen snapshot -> claim-time binding props -> the same DocumentaryCard. */
  function finalRenderFor(state: AuthoringState): string {
    const input = resolvePreviewInput(state)
    const snapshot = parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(buildStaticRenderExecutionSnapshot({
      manifest: { ...input.manifest, sequence: { index: 1, total: 3 } }, identitySnapshot: productContext.identitySnapshot, overrides: deriveTuningOverrides(state), templateId: TEMPLATE.id,
      hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id), slide: null,
    }))))
    if (!snapshot.ok) throw new Error('snapshot did not parse')
    const binding = resolveTemplateBinding('editorial.documentary-card')!
    const props = binding.createProps({
      variant: state.variant, appearance: state.appearance, content: input.manifest.content, assets: input.resolvedAssets as never, tokens: input.tokens, canvas: input.manifest.canvas,
      sequence: { index: 1, total: 3 }, primitiveTransforms: derivePrimitiveTransformsRequest(state), templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, TEMPLATE.id),
    } as never, { mode: 'still', overrides: snapshot.snapshot.overrides })
    return renderToStaticMarkup(createElement(DocumentaryCard, props as never))
  }
  /** Same as `render`, but with the content the layout needs to paint every unit. */
  const renderFull = (state: AuthoringState) => render(state)

  // [layout, element, tuning group] — text Elements positioned through the existing bounded tuning shape.
  const TEXT_ELEMENTS: [LayoutId, string, string][] = [
    ['info', 'bodyText', 'body'], ['info', 'annotation', 'annotation'], ['list', 'intro', 'intro'], ['list', 'items', 'items'], ['grid', 'intro', 'intro'],
    ['map', 'intro', 'intro'], ['map', 'legend', 'legend'], ['network', 'kicker', 'kicker'], ['network', 'intro', 'intro'], ['quote', 'intro', 'intro'],
    ['quote', 'bullets', 'bullets'], ['closing', 'body', 'body'], ['closing', 'items', 'items'], ['closing', 'tagline', 'tagline'],
  ]

  it.each(TEXT_ELEMENTS)('%s.%s: Posição X/Y + Rotação (tuning.%s) reach the Preview and the final render; untouched = unchanged', (layoutId, elementId, group) => {
    const resolved = caps(layoutId, elementId)
    expect(resolved.exception).toBeNull()
    expect(resolved.missingBaseline).toEqual([])
    expect(resolved.capabilities).toMatchObject({ visibility: true, position: true, rotation: true })
    expect(definitionOf(layoutId, elementId).control).toEqual({ type: 'tuning', group })
    const base = full(layoutId)
    const moved = edit(edit(base, layoutId, elementId, 'offsetX', 11), layoutId, elementId, 'rotation', 1)
    expect(moved.tuning[group as 'intro']).toEqual({ offsetX: 11, offsetY: 0, rotation: 1 })
    // The Canvas moves exactly this Element: one painted unit carries the authored transform, and the untouched slide has none.
    const html = renderFull(moved)
    expect((html.match(/translate\(11px, 0px\) rotate\(1deg\)/g) ?? []).length, 'moved exactly one unit').toBe(1)
    expect(renderFull(base)).not.toContain('translate(11px')
    // Preview ≡ the worker path (frozen snapshot -> binding -> renderer).
    expect(finalRenderFor(moved)).toBe(html)
    // Restaurar elemento removes the optional group; the slide serializes and renders like a never-adjusted one.
    const reset = resetElement(moved, layoutId, elementId)
    expect(reset.tuning).toEqual(base.tuning)
    expect(renderFull(reset)).toBe(renderFull(base))
    expect(authoringStateToPersistedSlide(reset, 's', 0).tuning).toEqual(authoringStateToPersistedSlide(base, 's', 0).tuning)
    // Saved -> reloaded keeps it; a layout switch drops it (layout-owned).
    const reloaded = persistedSlideToAuthoringState(JSON.parse(JSON.stringify(authoringStateToPersistedSlide(moved, 's', 0))), productContext, 'portrait')
    expect(reloaded.tuning).toEqual(moved.tuning)
    const other = layoutId === 'cover' ? 'info' : 'cover'
    expect(authoringReducer(moved, { type: 'SET_VARIANT', variant: other }).tuning).toEqual(slide(other).tuning)
  })

  it('info: Faixa da chamada (owner) + Chamada (follows it) and Aba da marca are full material transforms; the text printed on the banner moves WITH it', () => {
    expect(definitionOf('info', 'introBanner').control).toEqual({ type: 'transform', key: 'introBanner' })
    expect(definitionOf('info', 'introText').control).toEqual({ type: 'follows', parent: 'introBanner' })
    expect(definitionOf('info', 'brandTab').control).toEqual({ type: 'transform', key: 'brandTab' })
    for (const id of ['introBanner', 'brandTab']) expect(caps('info', id).capabilities).toEqual({ visibility: true, position: true, scale: true, rotation: true, opacity: true, assetReplace: true })
    const base = full('info')
    const authored = edit(edit(base, 'info', 'introBanner', 'scale', 1.2), 'info', 'introBanner', 'opacity', 0.5)
    const html = renderFull(authored)
    // The banner and the text printed on it carry the SAME authored transform (each painted unit keeps its own z-index).
    const z = resolveElementStack(TEMPLATE.id, 'info', undefined).zIndex
    for (const id of ['introBanner', 'introText']) {
      const tag = new RegExp(`<div[^>]*style="[^"]*z-index:${z[id]}(?:;|")[^"]*"[^>]*>`).exec(html)?.[0] ?? ''
      expect(tag, id).toContain('scale(1.2)')
      expect(tag, id).toMatch(/opacity:0.5/)
    }
    expect(tagOf(html, 'data-element="Aba da marca"')).not.toContain('scale(1.2)')
    const tab = renderFull(edit(base, 'info', 'brandTab', 'offsetX', 9))
    expect(tagOf(tab, 'data-element="Aba da marca"')).toContain('translate(9px, 0px)')
    expect(tagOf(tab, 'data-element="Faixa da chamada"')).not.toContain('translate(9px')
    // Visibility stays independent: hiding the banner leaves its text, as for every follower.
    expect(renderFull(toggle(authored, 'introBanner'))).toContain('data-element="Chamada"')
    expect(renderFull(resetElement(authored, 'info', 'introBanner'))).toBe(renderFull(base))
    expect(finalRenderFor(authored)).toBe(html)
  })

  it('closing: Linha pontilhada is a procedural visual with the full baseline (its 0.7 look stays the Template default)', () => {
    expect(caps('closing', 'divider').capabilities).toEqual({ visibility: true, position: true, scale: true, rotation: true, opacity: true, assetReplace: false })
    const base = full('closing')
    const divider = (html: string) => /<div aria-hidden="true" style="([^"]*border-top:2px dotted[^"]*)"/.exec(html)?.[1] ?? ''
    expect(divider(renderFull(base))).toContain('opacity:0.7')
    expect(divider(renderFull(base))).not.toContain('transform')
    const authored = edit(edit(edit(base, 'closing', 'divider', 'opacity', 0.5), 'closing', 'divider', 'scale', 1.1), 'closing', 'divider', 'offsetY', 8)
    const html = renderFull(authored)
    expect(divider(html)).toContain('opacity:0.35')
    expect(divider(html)).toContain('translate(0px, 8px) rotate(0deg) scale(1.1)')
    expect(renderFull(resetElement(authored, 'closing', 'divider'))).toBe(renderFull(base))
    expect(authoringStateToPersistedSlide(authored, 's', 0).primitiveTransforms.divider).toEqual({ offsetX: 0, offsetY: 8, rotation: 0, scale: 1.1, opacity: 0.5 })
    expect(PersistedAuthoredSlideSchema.safeParse(JSON.parse(JSON.stringify(authoringStateToPersistedSlide(authored, 's', 0)))).success).toBe(true)
    expect(authoringRenderRequestSchema.safeParse({ manifest: resolvePreviewInput(authored).manifest, primitiveTransforms: derivePrimitiveTransformsRequest(authored), templateId: TEMPLATE.id }).success).toBe(true)
    expect(finalRenderFor(authored)).toBe(html)
  })

  it('a slide saved before these fields existed still loads and renders exactly as before; the new groups keep the text bounds', () => {
    for (const layoutId of ['info', 'list', 'closing'] as const) {
      const persisted = JSON.parse(JSON.stringify(authoringStateToPersistedSlide(full(layoutId), 's', 0)))
      for (const key of ['introBanner', 'brandTab', 'divider']) delete persisted.primitiveTransforms[key]
      expect(PersistedAuthoredSlideSchema.safeParse(persisted).success, layoutId).toBe(true)
      expect(renderFull(persistedSlideToAuthoringState(persisted, productContext, 'portrait')), layoutId).toBe(renderFull(full(layoutId)))
    }
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, items: { offsetX: 301, offsetY: 0, rotation: 0 } } }).success).toBe(false)
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, items: { offsetX: 61, offsetY: 0, rotation: 0 } } }).success).toBe(true)
    expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, tagline: { offsetX: 60, offsetY: -60, rotation: 2 } } }).success).toBe(true)
  })
})
