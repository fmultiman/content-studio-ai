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
 *  - PreviewTuning (dev-only, never enters a manifest, never persisted);
 *  - signed URLs, rendered PNG bytes, or any other transient preview state.
 *
 * One row per ChannelPiece holds an ORDERED collection of slides. A
 * single-slide static ChannelPiece and a multi-slide carousel use the exact
 * same shape — only the UI decides whether to expose navigation, and only
 * carousel-format ChannelPieces in this slice actually call load/save.
 */
import { z } from 'zod'
import {
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
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
import { defaultContentForVariant } from './authoring-state'

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
    botanical: primitiveTransformValueSchema,
    pin: primitiveTransformValueSchema,
  })
  .strict()

const primitiveSelectionSchema = z
  .object({
    paper: z.string().trim().min(1).optional(),
    tape: z.string().trim().min(1).optional(),
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
  })
  .strict()

export type PersistedAuthoredSlide = z.infer<typeof PersistedAuthoredSlideSchema>

export const StaticAuthoringStateSchema = z
  .object({
    schemaVersion: z.literal(STATIC_AUTHORING_STATE_SCHEMA_VERSION),
    channelPieceId: z.string().trim().min(1),
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

export function authoringStateToPersistedSlide(state: AuthoringState, id: string, order: number): PersistedAuthoredSlide {
  return {
    id,
    order,
    variant: state.variant,
    appearance: state.appearance,
    content: state.contentOverride as unknown as Record<string, unknown>,
    primitiveSelection: { ...state.primitiveSelection },
    primitiveTransforms: {
      paper: { ...state.primitiveTransforms.paper },
      paperStrip: { ...state.primitiveTransforms.paperStrip },
      tape: { ...state.primitiveTransforms.tape },
      botanical: { ...state.primitiveTransforms.botanical },
      pin: { ...state.primitiveTransforms.pin },
    },
    ...(state.heroRef ? { heroRef: state.heroRef } : {}),
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
): AuthoringState {
  return {
    variant: slide.variant,
    identity: 'a',
    canvas,
    heroRef: slide.heroRef as AuthoringHeroRef | undefined,
    appearance: slide.appearance,
    contentOverride: slide.content as unknown as AuthoringContent,
    primitiveSelection: { ...slide.primitiveSelection } as AuthoringPrimitiveSelection,
    primitiveTransforms: {
      paper: { ...slide.primitiveTransforms.paper },
      paperStrip: { ...slide.primitiveTransforms.paperStrip },
      tape: { ...slide.primitiveTransforms.tape },
      botanical: { ...slide.primitiveTransforms.botanical },
      pin: { ...slide.primitiveTransforms.pin },
    } as AuthoringPrimitiveTransforms,
    productContext,
    tuning: { hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }, title: { offsetX: 0, offsetY: 0, rotation: 0 } },
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
    primitiveTransforms: {
      paper: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE.paper },
      paperStrip: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE.paperStrip },
      tape: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE.tape },
      botanical: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE.botanical },
      pin: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE.pin },
    },
  })
  return [
    slideDefaults('cover', 'slide-1', 0, 'dark'),
    slideDefaults('info', 'slide-2', 1, 'light'),
  ]
}
