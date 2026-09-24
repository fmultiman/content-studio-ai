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
} from './types'
import { defaultContentForVariant, TUNING_BOUNDS } from './authoring-state'
import { PRIMITIVE_TRANSFORM_SLOTS } from '@/lib/creative/primitives/transforms'
import {
  DEFAULT_TEMPLATE_ID,
  getTemplateDefinition,
  getTemplateLayout,
  isRegisteredTemplateId,
} from '@/lib/creative/templates/template-definitions'
import { MAX_ELEMENT_ORDER_LENGTH, normalizeElementOrder } from '@/lib/creative/templates/element-stack'

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
  })
  .strict()

const titleTuningSchema = z
  .object({
    offsetX: z.number().finite().min(TUNING_BOUNDS.title.offsetX.min).max(TUNING_BOUNDS.title.offsetX.max),
    offsetY: z.number().finite().min(TUNING_BOUNDS.title.offsetY.min).max(TUNING_BOUNDS.title.offsetY.max),
    rotation: z.number().finite().min(TUNING_BOUNDS.title.rotation.min).max(TUNING_BOUNDS.title.rotation.max),
  })
  .strict()

const tuningSchema = z
  .object({
    hero: heroTuningSchema,
    title: titleTuningSchema,
    // Optional, not required: rows persisted before Final Authoring Polish
    // V2.1 have `tuning.hero`/`tuning.title` but no `tuning.source` at all.
    // Absence means "template default", read back as DEFAULT_TUNING.source.
    source: titleTuningSchema.optional(),
  })
  .strict()

// Content stays opaque here, exactly like StaticRenderManifest's own
// ContentBindingsSchema — the per-variant shape (cover vs info) is validated
// where it already is, by the template registry at render time, not by this
// persistence boundary.
const persistedSlideContentSchema = z.record(z.string(), z.unknown())

export const PersistedAuthoredSlideSchema = z
  .object({
    id: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    variant: z.enum(['cover', 'info']),
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
  })
  .strict()

export type PersistedAuthoredSlide = z.infer<typeof PersistedAuthoredSlideSchema>

export const StaticAuthoringStateSchema = z
  .object({
    schemaVersion: z.literal(STATIC_AUTHORING_STATE_SCHEMA_VERSION),
    channelPieceId: z.string().trim().min(1),
    // Creative Editor Template Foundation V1 — the Template this carousel is
    // authored with (carousel root, not per slide). Optional on write for
    // older clients (persisted as the default); an unknown id is rejected.
    templateId: z.string().trim().min(1).refine(isRegisteredTemplateId, { message: 'templateId is not a registered template' }).optional(),
    slides: z.array(PersistedAuthoredSlideSchema).min(1),
  })
  .strict()
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
export function sortedSlides(slides: readonly PersistedAuthoredSlide[]): PersistedAuthoredSlide[] {
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
    tuning: { hero: { ...state.tuning.hero }, title: { ...state.tuning.title }, source: { ...state.tuning.source } },
    // Only an authored override is persisted; absence keeps following the template default.
    ...(state.elementOrder && layout ? { elementOrder: normalizeElementOrder(layout, state.elementOrder) } : {}),
  }
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
    // Cover's brand block label is the live Project name when the slide has
    // none yet (rows authored before brand_label existed) — derived, like the
    // rest of productContext, never a second source of truth for the name.
    contentOverride: slide.variant === 'cover' && !(content as { brand_label?: string }).brand_label && productContext.projectName
      ? { ...content, brand_label: productContext.projectName } as AuthoringContent
      : content,
    primitiveSelection: { ...slide.primitiveSelection } as AuthoringPrimitiveSelection,
    primitiveTransforms: completeTransforms(slide.primitiveTransforms as Partial<AuthoringPrimitiveTransforms>),
    ...(slide.elementOrder && layout ? { elementOrder: normalizeElementOrder(layout, slide.elementOrder) } : {}),
    productContext,
    // Absent on rows persisted before tuning existed — defaults to no
    // adjustment, identical to how those slides always rendered. `source`
    // is independently defaulted: rows persisted before Final Authoring
    // Polish V2.1 have `tuning.hero`/`tuning.title` but no `tuning.source`.
    tuning: slide.tuning
      ? { hero: { ...slide.tuning.hero }, title: { ...slide.tuning.title }, source: { ...(slide.tuning.source ?? DEFAULT_TUNING.source) } }
      : { hero: { ...DEFAULT_TUNING.hero }, title: { ...DEFAULT_TUNING.title }, source: { ...DEFAULT_TUNING.source } },
    debugPanelOpen: false,
  }
}

/**
 * The Slice 1 acceptance default: slide 1 = cover/dark, slide 2 = info/light —
 * matching Pack B slides 1–2 exactly (see PORTAL_CAROUSEL_V1_FACTUAL_REENTRY.md
 * §5, §13). Used only the first time a carousel ChannelPiece is opened with no
 * persisted state yet.
 */
export function defaultCarouselSlides(primitiveProjectRef: string | null): PersistedAuthoredSlide[] {
  const primitiveSelection: AuthoringPrimitiveSelection = primitiveProjectRef
    ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' }
    : {}
  const slideDefaults = (variant: AuthoringVariant, id: string, order: number, appearance: AuthoringAppearance): PersistedAuthoredSlide => ({
    id,
    order,
    variant,
    appearance,
    content: defaultContentForVariant(variant, 'a') as unknown as Record<string, unknown>,
    primitiveSelection: { ...primitiveSelection },
    primitiveTransforms: completeTransforms(DEFAULT_PRIMITIVE_TRANSFORMS_STATE),
    tuning: { hero: { ...DEFAULT_TUNING.hero }, title: { ...DEFAULT_TUNING.title } },
  })
  return [
    slideDefaults('cover', 'slide-1', 0, 'dark'),
    slideDefaults('info', 'slide-2', 1, 'light'),
  ]
}
