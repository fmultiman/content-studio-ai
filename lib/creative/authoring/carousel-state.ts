/**
 * Slice 1 — Portal Carousel V1: persisted static-authoring state for a
 * ChannelPiece.
 *
 * Architecture boundary (see docs/architecture/MEDIA_PRODUCTION_ARCHITECTURE_V1.md
 * and docs/productization/creative-rendering/PORTAL_CAROUSEL_V1_FACTUAL_REENTRY.md):
 *   authored slide state → render → generated PNG → optional save → LibraryFile / ChannelPieceMedia
 *
 * This module owns only the FIRST step. It never becomes the render output,
 * a LibraryFile, or a ChannelPieceMedia row. It does not persist:
 *  - productContext (Project/Production/EditorialContent/ChannelPiece/Identity
 *    are re-derived fresh from the live context on every load — that is
 *    already correct and cheap, see AuthoringProductContext's own comment);
 *  - signed URLs, rendered PNG bytes, or any other transient preview state.
 *
 * Creative Editor Static Shell V1 adds `tuning` (bounded X/Y/rotation/scale
 * refinement of the template-defined title and hero elements) to the
 * persisted contract. This reuses PreviewTuning's existing shape and the
 * existing render `overrides` channel (authoringRenderOverridesSchema) —
 * it does NOT enter the neutral StaticRenderManifest itself, matching the
 * boundary PreviewTuning always had; what changes is that it now survives a
 * reload and is sent with the render request instead of always defaulting.
 *
 * One row per ChannelPiece holds an ORDERED collection of slides. A
 * single-slide static ChannelPiece and a multi-slide carousel use the exact
 * same shape — only the UI decides whether to expose navigation, and only
 * carousel-format ChannelPieces in this slice actually call load/save.
 */
import { z } from 'zod'
import {
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
  DEFAULT_PRIMITIVE_TRANSFORMS,
  DEFAULT_TUNING,
  type AuthoringAppearance,
  type AuthoringCanvas,
  type AuthoringContent,
  type AuthoringHeroRef,
  type AuthoringPrimitiveSelection,
  type AuthoringPrimitiveTransforms,
  type AuthoringProductContext,
  type AuthoringState,
  type AuthoringVariant,
  AUTHORING_VARIANTS,
} from './types'
import { defaultContentForVariant, TUNING_BOUNDS, variantHasBrandLabel } from './authoring-state'
import { PRIMITIVE_TRANSFORM_SLOTS } from '@/lib/creative/primitives/transforms'
import {
  AUTHORING_ASSET_SLOT_IDS,
  DEFAULT_TEMPLATE_ID,
  getTemplateDefinition,
  getTemplateLayout,
  isRegisteredTemplateId,
  type AuthoringAssetSlotId,
} from '@/lib/creative/templates/template-definitions'
import { MAX_ELEMENT_ORDER_LENGTH, normalizeElementOrder, normalizeHiddenElements } from '@/lib/creative/templates/element-stack'
import { normalizeTypographyOverrides } from './typography-overrides'
import { validateFreeCompositionShape } from '@/lib/creative/video-editor/free-composition'
import type { FreeSceneComposition } from '@/lib/types'


export const STATIC_AUTHORING_STATE_SCHEMA_VERSION = 'static-authoring-state.v1' as const

const primitiveTransformValueSchema = z
  .object({
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    rotation: z.number().finite(),
    scale: z.number().finite(),
    opacity: z.number().finite().min(0).max(1),
  })
  .strict()

const primitiveTransformsBySlotSchema = z
  .object({
    paper: primitiveTransformValueSchema,
    paperStrip: primitiveTransformValueSchema,
    tape: primitiveTransformValueSchema,
    tape1: primitiveTransformValueSchema.optional(),
    tape2: primitiveTransformValueSchema.optional(),
    tape3: primitiveTransformValueSchema.optional(),
    botanical: primitiveTransformValueSchema,
    pin: primitiveTransformValueSchema,
    // Creative Editor Template Foundation V1 — Pack B element channels.
    // Optional: rows persisted before them read back as template defaults.
    paperDark: primitiveTransformValueSchema.optional(),
    botanicalLeaf: primitiveTransformValueSchema.optional(),
    pin2: primitiveTransformValueSchema.optional(),
    archival: primitiveTransformValueSchema.optional(),
    ornament: primitiveTransformValueSchema.optional(),
    note: primitiveTransformValueSchema.optional(),
    card1: primitiveTransformValueSchema.optional(),
  })
  .strict()

const primitiveSelectionSchema = z
  .object({
    paper: z.string().trim().min(1).optional(),
    tape: z.string().trim().min(1).optional(),
  })
  .strict()

// Bounded template-sanctioned position refinement for the title/hero
// elements — same bounds as TUNING_BOUNDS (authoring-state.ts), so a
// persisted value is always exactly what the UI could have produced.
const heroTuningSchema = z
  .object({
    offsetX: z.number().finite().min(TUNING_BOUNDS.hero.offsetX.min).max(TUNING_BOUNDS.hero.offsetX.max),
    offsetY: z.number().finite().min(TUNING_BOUNDS.hero.offsetY.min).max(TUNING_BOUNDS.hero.offsetY.max),
    rotation: z.number().finite().min(TUNING_BOUNDS.hero.rotation.min).max(TUNING_BOUNDS.hero.rotation.max),
    scale: z.number().finite().min(TUNING_BOUNDS.hero.scale.min).max(TUNING_BOUNDS.hero.scale.max),
    // LEGACY toggle (COVER_ELEMENT_COMPLETENESS_V1), read-only: migrated to a hidden 'heroFrame' Element on load, never written.
    frame: z.boolean().optional(),
    // CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1: optional; absent = fully opaque.
    opacity: z.number().finite().min(TUNING_BOUNDS.hero.opacity.min).max(TUNING_BOUNDS.hero.opacity.max).optional(),
  })
  .strict()

const positionTuningSchema = z
  .object({
    offsetX: z.number().finite().min(TUNING_BOUNDS.title.offsetX.min).max(TUNING_BOUNDS.title.offsetX.max),
    offsetY: z.number().finite().min(TUNING_BOUNDS.title.offsetY.min).max(TUNING_BOUNDS.title.offsetY.max),
    rotation: z.number().finite().min(TUNING_BOUNDS.title.rotation.min).max(TUNING_BOUNDS.title.rotation.max),
  })
  .strict()

// CREATIVE_EDITOR_ELEMENT_BASELINE_CAPABILITIES_V1: the Logo da marca also carries the visual baseline's optional Size and Opacity.
const brandTuningSchema = positionTuningSchema.extend({
  scale: z.number().finite().min(TUNING_BOUNDS.brand.scale.min).max(TUNING_BOUNDS.brand.scale.max).optional(),
  opacity: z.number().finite().min(TUNING_BOUNDS.brand.opacity.min).max(TUNING_BOUNDS.brand.opacity.max).optional(),
}).strict()

// Static Detail Polish V1: the title also carries an optional "Entrelinha"
// override (absent on every row persisted before it = Template default).
const titleTuningSchema = positionTuningSchema.extend({
  lineHeight: z.number().finite().min(TUNING_BOUNDS.title.lineHeight.min).max(TUNING_BOUNDS.title.lineHeight.max).optional(),
}).strict()

const tuningSchema = z
  .object({
    hero: heroTuningSchema,
    title: titleTuningSchema,
    // Optional, not required: rows persisted before Final Authoring Polish
    // V2.1 have `tuning.hero`/`tuning.title` but no `tuning.source` at all.
    // Absence means "template default", read back as DEFAULT_TUNING.source.
    source: positionTuningSchema.optional(),
    // COVER_ELEMENT_COMPLETENESS_V1: Cover's Chamada / Introdução / Assinatura positions. Absent = Template position.
    kicker: positionTuningSchema.optional(),
    intro: positionTuningSchema.optional(),
    brand: brandTuningSchema.optional(),
  })
  .strict()

export const AssetOverridesSchema = z.record(
  z.enum(AUTHORING_ASSET_SLOT_IDS as [AuthoringAssetSlotId, ...AuthoringAssetSlotId[]]),
  z.object({ libraryFileId: z.string().uuid() }).strict(),
)

// Content stays opaque here, exactly like StaticRenderManifest's own
// ContentBindingsSchema — the per-variant shape (cover vs info) is validated
// where it already is, by the template registry at render time, not by this
// persistence boundary.
const persistedSlideContentSchema = z.record(z.string(), z.unknown())

export const PersistedAuthoredSlideSchema = z
  .object({
    id: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    // Template layout id (editorial-documentary-collage-v1). 'list' — Portal
    // Carousel Growth V1; 'grid'…'closing' — Portal Carousel Completion V1.
    variant: z.enum(AUTHORING_VARIANTS),
    appearance: z.enum(['light', 'dark']),
    content: persistedSlideContentSchema,
    primitiveSelection: primitiveSelectionSchema,
    primitiveTransforms: primitiveTransformsBySlotSchema,
    heroRef: z.string().trim().min(1).optional(),
    // Optional, not required: rows persisted before Creative Editor Static
    // Shell V1 have no `tuning` at all. Absence means "template default",
    // read back as DEFAULT_TUNING — no migration/backfill needed.
    tuning: tuningSchema.optional(),
    // Creative Editor Template Foundation V1 — authored element stack (paint
    // order, back -> front) for THIS slide only. Absent = template default.
    // Unknown/duplicate ids are tolerated here and normalized on read.
    elementOrder: z.array(z.string().trim().min(1).max(64)).max(MAX_ELEMENT_ORDER_LENGTH).optional(),
    // Authoring Usability Completion V1 — Project LibraryFile per slot
    // (identity only). Absent = Project primitive / Template default.
    assetOverrides: AssetOverridesSchema.optional(),
    // Static Detail Polish V1 ??" hidden template element ids (Camadas eye).
    // Absent = every element visible; unknown ids are normalized away on read.
    hiddenElements: z.array(z.string().trim().min(1).max(64)).max(MAX_ELEMENT_ORDER_LENGTH).optional(),
    // CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — optional local typography per Template text Element.
    // Read leniently and sanitized against the Layout on load (absent = every default; no migration).
    typography: z.record(z.string().trim().min(1).max(64), z.object({ fontFamily: z.string().max(64).optional(), fontSizePx: z.number().finite().optional() })).optional(),
    // STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 ??" Custom Text/Image elements added by author.
    elements: z.custom<FreeSceneComposition['elements']>((value) => {
      if (value === undefined) return true
      if (!Array.isArray(value)) return false
      return validateFreeCompositionShape({ kind: 'free', elements: value }).ok
    }, { message: 'invalid free elements' }).optional(),
  })
  .strict()

export type PersistedAuthoredSlide = z.infer<typeof PersistedAuthoredSlideSchema>

/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — a FREE slide: no Template,
 * no layout, no slots. Its `composition` is exactly the free composition a Video
 * Scene carries (`{ kind: 'free', elements }`), validated by the same strict
 * write-boundary check. Explicit by construction: a Template slide can never
 * have a `composition` key (its schema is strict), so the two never overlap.
 */
export const PersistedFreeSlideSchema = z
  .object({
    id: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    composition: z.custom<FreeSceneComposition>((value) => validateFreeCompositionShape(value).ok, { message: 'invalid free composition' }),
  })
  .strict()

export type PersistedFreeSlide = z.infer<typeof PersistedFreeSlideSchema>
export type PersistedStaticSlide = PersistedAuthoredSlide | PersistedFreeSlide

export function isPersistedFreeSlide(slide: PersistedStaticSlide): slide is PersistedFreeSlide {
  return 'composition' in slide
}

export const StaticAuthoringStateSchema = z
  .object({
    schemaVersion: z.literal(STATIC_AUTHORING_STATE_SCHEMA_VERSION),
    channelPieceId: z.string().trim().min(1),
    // Creative Editor Template Foundation V1 — the Template this carousel is
    // authored with (carousel root, not per slide). Optional on write for
    // older clients (persisted as the default); an unknown id is rejected.
    templateId: z.string().trim().min(1).refine(isRegisteredTemplateId, { message: 'templateId is not a registered template' }).optional(),
    // CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — the EXPLICIT free mode
    // (never inferred from an absent templateId, which older clients omit for
    // the default Template). Collection-level, like templateId.
    composition: z.literal('free').optional(),
    slides: z.array(z.union([PersistedAuthoredSlideSchema, PersistedFreeSlideSchema])).min(1),
  })
  .strict()
  .refine(
    (value) => value.composition === 'free'
      ? value.templateId === undefined && value.slides.every((slide) => 'composition' in slide)
      : value.slides.every((slide) => !('composition' in slide)),
    { message: 'a static composition is either all-free (no templateId) or all-Template', path: ['slides'] },
  )
  .refine(
    (value) => new Set(value.slides.map((slide) => slide.id)).size === value.slides.length,
    { message: 'slide ids must be unique within a static authoring state', path: ['slides'] },
  )
  .refine(
    (value) => new Set(value.slides.map((slide) => slide.order)).size === value.slides.length,
    { message: 'slide order values must be unique within a static authoring state', path: ['slides'] },
  )

export type StaticAuthoringStateContract = z.infer<typeof StaticAuthoringStateSchema>

/** Sorted by `order` — the persisted field is the source of truth for sequence, never array position alone. */
export function sortedSlides<T extends { order: number }>(slides: readonly T[]): T[] {
  return [...slides].sort((a, b) => a.order - b.order)
}

// ── AuthoringState <-> PersistedAuthoredSlide ─────────────────────────────────

/** Every transform channel, each defaulted — a persisted slide always carries the full set. */
function completeTransforms(transforms: Partial<AuthoringPrimitiveTransforms>): AuthoringPrimitiveTransforms {
  return Object.fromEntries(
    PRIMITIVE_TRANSFORM_SLOTS.map((slot) => [slot, { ...(transforms[slot] ?? DEFAULT_PRIMITIVE_TRANSFORMS) }]),
  ) as unknown as AuthoringPrimitiveTransforms
}

function layoutFor(templateId: string, variant: AuthoringVariant) {
  const template = getTemplateDefinition(templateId) ?? getTemplateDefinition(DEFAULT_TEMPLATE_ID)
  return template ? getTemplateLayout(template, variant) : null
}

/** Persist only overrides the Layout can honour (Layout-owned); an empty map is absent. */
function typographyEntry(layout: ReturnType<typeof layoutFor>, raw: unknown): { typography: NonNullable<AuthoringState['typography']> } | Record<string, never> {
  const typography = normalizeTypographyOverrides(layout, raw)
  return typography ? { typography } : {}
}

export function authoringStateToPersistedSlide(state: AuthoringState, id: string, order: number, templateId: string = DEFAULT_TEMPLATE_ID): PersistedAuthoredSlide {
  const layout = layoutFor(templateId, state.variant)
  return {
    id,
    order,
    variant: state.variant,
    appearance: state.appearance,
    content: state.contentOverride as unknown as Record<string, unknown>,
    primitiveSelection: { ...state.primitiveSelection },
    primitiveTransforms: completeTransforms(state.primitiveTransforms),
    ...(state.heroRef ? { heroRef: state.heroRef } : {}),
    tuning: {
      hero: { ...state.tuning.hero }, title: { ...state.tuning.title }, source: { ...state.tuning.source },
      // Only an authored optional group is persisted; absence keeps following the Template position.
      ...(state.tuning.kicker ? { kicker: { ...state.tuning.kicker } } : {}),
      ...(state.tuning.intro ? { intro: { ...state.tuning.intro } } : {}),
      ...(state.tuning.brand ? { brand: { ...state.tuning.brand } } : {}),
    },
    // Only an authored override is persisted; absence keeps following the template default.
    ...(state.elementOrder && layout ? { elementOrder: normalizeElementOrder(layout, state.elementOrder) } : {}),
    ...(state.assetOverrides && Object.keys(state.assetOverrides).length > 0 ? { assetOverrides: copyOverrides(state.assetOverrides) } : {}),
    ...hiddenEntry(layout, state.hiddenElements),
    ...typographyEntry(layout, state.typography),
    ...(state.elements && state.elements.length > 0 ? { elements: [...state.elements] } : {}),
  }
}

/** The legacy Hero `frame` toggle is migrated to a hidden 'heroFrame' Element; the stored tuning no longer carries it. */
function withoutLegacyFrame<T extends { frame?: boolean }>(hero: T): Omit<T, 'frame'> {
  const { frame: _legacy, ...rest } = hero
  void _legacy
  return rest
}

/** Only a non-empty, layout-normalized hidden list is persisted; absence = all visible. */
function hiddenEntry(layout: ReturnType<typeof layoutFor>, hidden: readonly string[] | undefined): { hiddenElements?: string[] } {
  const normalized = layout ? normalizeHiddenElements(layout, hidden) : []
  return normalized.length > 0 ? { hiddenElements: normalized } : {}
}

function copyOverrides(overrides: NonNullable<AuthoringState['assetOverrides']>): NonNullable<AuthoringState['assetOverrides']> {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value?.libraryFileId).map(([slot, value]) => [slot, { libraryFileId: (value as { libraryFileId: string }).libraryFileId }]))
}

/**
 * Rebuilds an AuthoringState for one slide. `identity` stays the fixed 'a'
 * the real product path has always used — it is a dev-fixture concept
 * unrelated to `appearance`, and `productContext.identitySnapshot` (re-derived
 * fresh, never persisted) is what actually feeds the render, not this field.
 */
export function persistedSlideToAuthoringState(
  slide: PersistedAuthoredSlide,
  productContext: AuthoringProductContext,
  canvas: AuthoringCanvas,
  templateId: string = DEFAULT_TEMPLATE_ID,
): AuthoringState {
  const layout = layoutFor(templateId, slide.variant)
  const content = slide.content as unknown as AuthoringContent
  return {
    variant: slide.variant,
    identity: 'a',
    canvas,
    heroRef: slide.heroRef as AuthoringHeroRef | undefined,
    appearance: slide.appearance,
    // The brand block label (Cover, Encerramento) is the live Project name when the slide has
    // none yet (rows authored before brand_label existed) — derived, like the
    // rest of productContext, never a second source of truth for the name.
    contentOverride: variantHasBrandLabel(slide.variant) && !(content as { brand_label?: string }).brand_label && productContext.projectName
      ? { ...content, brand_label: productContext.projectName } as AuthoringContent
      : content,
    primitiveSelection: { ...slide.primitiveSelection } as AuthoringPrimitiveSelection,
    primitiveTransforms: completeTransforms(slide.primitiveTransforms as Partial<AuthoringPrimitiveTransforms>),
    ...(slide.elementOrder && layout ? { elementOrder: normalizeElementOrder(layout, slide.elementOrder) } : {}),
    ...(slide.assetOverrides && Object.keys(slide.assetOverrides).length > 0 ? { assetOverrides: copyOverrides(slide.assetOverrides) } : {}),
    // A slide saved with the old Hero frame toggle off keeps that look as a hidden 'heroFrame' Element.
    ...hiddenEntry(layout, slide.tuning?.hero?.frame === false ? [...(slide.hiddenElements ?? []), 'heroFrame'] : slide.hiddenElements),
    ...typographyEntry(layout, slide.typography),
    ...(slide.elements && slide.elements.length > 0 ? { elements: [...slide.elements] } : {}),
    productContext,
    // Absent on rows persisted before tuning existed — defaults to no
    // adjustment, identical to how those slides always rendered. `source`
    // is independently defaulted: rows persisted before Final Authoring
    // Polish V2.1 have `tuning.hero`/`tuning.title` but no `tuning.source`.
    tuning: slide.tuning
      ? {
        hero: withoutLegacyFrame(slide.tuning.hero), title: { ...slide.tuning.title }, source: { ...(slide.tuning.source ?? DEFAULT_TUNING.source) },
        ...(slide.tuning.kicker ? { kicker: { ...slide.tuning.kicker } } : {}),
        ...(slide.tuning.intro ? { intro: { ...slide.tuning.intro } } : {}),
        ...(slide.tuning.brand ? { brand: { ...slide.tuning.brand } } : {}),
      }
      : { hero: { ...DEFAULT_TUNING.hero }, title: { ...DEFAULT_TUNING.title }, source: { ...DEFAULT_TUNING.source } },
    debugPanelOpen: false,
  }
}

// ── Template-level slide initializer (Portal Carousel Growth V1) ──────────────

export type TemplateSlideOptions = {
  templateId: string
  layoutId: string
  /** Must be one the layout supports; absent/unsupported → the layout's default appearance. */
  appearance?: AuthoringAppearance
  id: string
  order: number
  primitiveProjectRef: string | null
}

/**
 * A brand-new slide built ONLY from the Template: the layout's example
 * content, the Project paper/tape primitives (when the Project has a
 * catalog) else the Template's default assets, neutral transforms/tuning, and
 * NO elementOrder / assetOverrides — so it follows the layout's default stack
 * and default slot resources. Never a clone of another slide. Returns null
 * for a layout the Template does not define.
 */
export function createTemplateSlide(options: TemplateSlideOptions): PersistedAuthoredSlide | null {
  const template = getTemplateDefinition(options.templateId)
  const layout = template ? getTemplateLayout(template, options.layoutId) : null
  if (!template || !layout) return null
  const variant = layout.id as AuthoringVariant
  const appearance = options.appearance && (layout.supportedAppearances as readonly string[]).includes(options.appearance)
    ? options.appearance
    : layout.defaultAppearance
  const primitiveSelection: AuthoringPrimitiveSelection = options.primitiveProjectRef
    ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' }
    : {}
  return {
    id: options.id,
    order: options.order,
    variant,
    appearance,
    content: defaultContentForVariant(variant, 'a') as unknown as Record<string, unknown>,
    primitiveSelection,
    primitiveTransforms: completeTransforms(DEFAULT_PRIMITIVE_TRANSFORMS_STATE),
    tuning: { hero: { ...DEFAULT_TUNING.hero }, title: { ...DEFAULT_TUNING.title } },
  }
}

/** A slide id unused by `existingIds`: `slide-<n>` past the highest numbered one (stable; never reuses an existing id). */
export function nextSlideId(existingIds: readonly string[]): string {
  const taken = new Set(existingIds)
  let next = existingIds.reduce((max, id) => {
    const match = /^slide-(\d+)$/.exec(id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  while (taken.has(`slide-${next}`)) next += 1
  return `slide-${next}`
}

/** Appended slides go after the last one by `order` (the persisted sequence source of truth). */
export function nextSlideOrder(slides: readonly { order: number }[]): number {
  return slides.reduce((max, slide) => Math.max(max, slide.order), -1) + 1
}

/**
 * The Slice 1 acceptance default: slide 1 = cover/dark, slide 2 = info/light —
 * matching Pack B slides 1–2 exactly (see PORTAL_CAROUSEL_V1_FACTUAL_REENTRY.md
 * §5, §13). Used only the first time a carousel ChannelPiece is opened with no
 * persisted state yet. Built through the same Template-level initializer as
 * "Adicionar slide"; more slides are added by the author, never assumed here.
 */
export function defaultCarouselSlides(primitiveProjectRef: string | null, templateId: string = DEFAULT_TEMPLATE_ID): PersistedAuthoredSlide[] {
  return [
    createTemplateSlide({ templateId, layoutId: 'cover', appearance: 'dark', id: 'slide-1', order: 0, primitiveProjectRef }),
    createTemplateSlide({ templateId, layoutId: 'info', appearance: 'light', id: 'slide-2', order: 1, primitiveProjectRef }),
  ].filter((slide): slide is PersistedAuthoredSlide => Boolean(slide))
}
