/**
 * Wave 6 — Authoring Preview Proof
 *
 * These types belong to the authoring / UI layer only.
 * They are NOT domain contracts, manifest contracts, or database entities.
 *
 * Separation:
 *  - AuthoringState   → ephemeral UI composite; can derive a StaticRenderManifest
 *  - PreviewTuning    → runtime-only visual overrides; NEVER appears in a manifest
 *
 * The DocumentaryCard component receives tuning through DocumentaryCardPreviewTuning
 * as an optional extension of its existing props contract.
 */

// ── Fixture identifiers ───────────────────────────────────────────────────────

export type AuthoringIdentity = 'a' | 'b'
export type AuthoringVariant = 'cover' | 'info'
export type AuthoringCanvas = 'portrait' | 'reel' // 1080×1350 | 1080×1920
/**
 * Slice 1 — Portal Carousel V1: rendering-style axis, independent of
 * AuthoringVariant. Not a Project Identity selector — identity remains
 * separate context (foundation/expression/governance), never the appearance
 * switch for a slide.
 */
export type AuthoringAppearance = 'light' | 'dark'

// ── Hero asset choices available in the fixture resolver ─────────────────────

export type AuthoringHeroRef =
  | 'fixture:asset:documentary-card:hero-archival-01' // WebP, opaque
  | 'fixture:asset:acme-labs:hero-01'                  // SVG, identity-B default

export interface AuthoringHeroAsset {
  ref: AuthoringHeroRef
  label: string
  mimeType: string
  hasAlpha: boolean
  dimensions: { width: number; height: number }
}

export const AUTHORING_HERO_ASSETS: AuthoringHeroAsset[] = [
  {
    ref: 'fixture:asset:documentary-card:hero-archival-01',
    label: 'Archival photo (WebP)',
    mimeType: 'image/webp',
    hasAlpha: false,
    dimensions: { width: 800, height: 1067 },
  },
  {
    ref: 'fixture:asset:acme-labs:hero-01',
    label: 'Acme Labs hero (SVG)',
    mimeType: 'image/svg+xml',
    hasAlpha: true,
    dimensions: { width: 1080, height: 1920 },
  },
]

// ── Content overrides (partial; only what the UI exposes) ─────────────────────

export interface AuthoringCoverContent {
  eyebrow: string
  title: string
  subtitle: string
  source_line: string
  /** Optional — DocumentaryCardCoverContentSchema requires min(1) when present; omit rather than send ''. */
  detail_note?: string
  /** Brand block label (project name). Filled from the live Project context when absent. */
  brand_label?: string
}

export interface AuthoringFactCard {
  primary: string
  secondary?: string
  tertiary?: string
}

export interface AuthoringInfoContent {
  title: string
  intro: string
  body_blocks: string[] // editable as newline-separated text in the UI
  fact_cards: AuthoringFactCard[]
  source_line: string
  annotation: string
}

export type AuthoringContent = AuthoringCoverContent | AuthoringInfoContent

// ── Preview Tuning — UI-only, never enters a StaticRenderManifest ─────────────

export interface HeroTuning {
  /** px offset, clamped to approximately ±120 */
  offsetX: number
  /** px offset, clamped to approximately ±120 */
  offsetY: number
  /** degrees, clamped to approximately ±4 */
  rotation: number
  /** dimensionless, clamped to 0.9–1.15 */
  scale: number
}

export interface TitleTuning {
  /** px offset, clamped to approximately ±60 */
  offsetX: number
  /** px offset, clamped to approximately ±60 */
  offsetY: number
  /** degrees, clamped to approximately ±2 */
  rotation: number
}

export interface DocumentaryCardPreviewTuning {
  hero: HeroTuning
  title: TitleTuning
  /**
   * Info variant's source/credit line ("Fonte"). Same bounded shape as
   * TitleTuning — no parallel positioning system. Independent of `title`:
   * fixes the Final Authoring Polish V2.1 coupling bug (InfoVariant used to
   * spread the Title's own style object into this element too).
   */
  source: TitleTuning
}

export const DEFAULT_TUNING: DocumentaryCardPreviewTuning = {
  hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
  title: { offsetX: 0, offsetY: 0, rotation: 0 },
  source: { offsetX: 0, offsetY: 0, rotation: 0 },
}

// ── Primitive selection — semantic keys, never signed URLs ────────────────────

/**
 * Phase 2C: selected primitive keys per slot.
 * Values are primitive keys (e.g. 'paper-card-light-01'), NOT library_file IDs,
 * NOT signed URLs, NOT storage paths.
 *
 * undefined means "use template default" (fixture fallback).
 */
export interface AuthoringPrimitiveSelection {
  paper?: string  // primitive key for the paper slot
  tape?: string   // primitive key for the tape slot
}

import {
  DEFAULT_PRIMITIVE_TRANSFORMS,
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
  type PrimitiveTransforms,
} from '@/lib/creative/primitives/transforms'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'

/** Per-slot transform overrides in the authoring layer. */
export interface AuthoringPrimitiveTransforms {
  paper: PrimitiveTransforms
  paperStrip: PrimitiveTransforms
  tape: PrimitiveTransforms
  tape1?: PrimitiveTransforms
  tape2?: PrimitiveTransforms
  tape3?: PrimitiveTransforms
  botanical: PrimitiveTransforms
  pin: PrimitiveTransforms
  /** Creative Editor Template Foundation V1 — Pack B element channels; absent on older rows. */
  paperDark?: PrimitiveTransforms
  botanicalLeaf?: PrimitiveTransforms
  pin2?: PrimitiveTransforms
  archival?: PrimitiveTransforms
  ornament?: PrimitiveTransforms
  note?: PrimitiveTransforms
  card1?: PrimitiveTransforms
}

/** Runtime-only context for product authoring; never persisted as a domain entity. */
export interface AuthoringProductContext {
  projectId: string
  projectName: string
  productionId: string | null
  productionTitle: string | null
  editorialContentId: string
  editorialContentTitle: string
  channelPieceId: string
  channel: string
  format: string
  projectIdentity: ProjectIdentity
  identitySnapshot: VisualTokensSnapshot
  primitiveProjectRef?: string
}

export { DEFAULT_PRIMITIVE_TRANSFORMS, DEFAULT_PRIMITIVE_TRANSFORMS_STATE }
export type { PrimitiveTransforms }

// ── AuthoringState — full ephemeral session state ─────────────────────────────

export interface AuthoringState {
  /**
   * Which fixture configuration is selected. Maps directly to
   * resolveDocumentaryCardFixture() — no second implementation.
   */
  variant: AuthoringVariant
  identity: AuthoringIdentity
  canvas: AuthoringCanvas
  /** hero asset ref override (cover only; undefined uses fixture default) */
  heroRef?: AuthoringHeroRef

  /**
   * Slice 1 — Portal Carousel V1: explicit, independent of variant. cover can
   * be light, info can be dark. Project Identity remains identity context,
   * never the appearance selector.
   */
  appearance: AuthoringAppearance

  /** Content overrides applied on top of the fixture defaults */
  contentOverride: AuthoringContent

  /**
   * Phase 2C: selected primitive keys for the paper and tape slots.
   * Semantic selection — keys only. Resolution to AssetRef happens at
   * preview and render time. NEVER stores signed URLs.
   */
  primitiveSelection: AuthoringPrimitiveSelection

  /**
   * Phase 2C: authoring-layer transforms for primitive slots.
   * These are additional transforms on top of template defaults.
   * NEVER serialised into a StaticRenderManifest directly.
   */
  primitiveTransforms: AuthoringPrimitiveTransforms

  productContext?: AuthoringProductContext

  /**
   * Bounded template-sanctioned position refinement for the title/hero
   * elements. NEVER serialised into a StaticRenderManifest — it travels
   * alongside it as a render request `overrides` field (same mechanism
   * since Wave 6). Creative Editor Static Shell V1 persists this per slide
   * (see PersistedAuthoredSlide.tuning) so refinements survive a reload;
   * before that it was recomputed to DEFAULT_TUNING on every load.
   */
  tuning: DocumentaryCardPreviewTuning

  /**
   * Creative Editor Template Foundation V1 — authored element stack override
   * for THIS slide (paint order, back → front). undefined = the template
   * layout's default stack. Always normalized through
   * lib/creative/templates/element-stack.ts before rendering.
   */
  elementOrder?: string[]

  /** UI-only: which debug panel tabs are open */
  debugPanelOpen: boolean
}
