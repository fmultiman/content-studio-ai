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
/**
 * Template layout ids of editorial-documentary-collage-v1: 'list' (Portal
 * Carousel Growth V1); 'grid' | 'map' | 'network' | 'quote' | 'closing'
 * (Portal Carousel Completion V1).
 */
export type AuthoringVariant = 'cover' | 'info' | 'list' | 'grid' | 'map' | 'network' | 'quote' | 'closing'
export const AUTHORING_VARIANTS = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing'] as const satisfies readonly AuthoringVariant[]
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

/** The shared closed icon set (DOCUMENTARY_CARD_ICONS). */
export type AuthoringListIcon = DocumentaryCardIcon

export interface AuthoringListItem {
  icon: AuthoringListIcon
  /** May mark emphasis with **double asterisks** (bold only). */
  text: string
}

/** Layout "Lista" (DocumentaryCardListContentSchema): 2..4 items. */
export interface AuthoringListContent {
  title: string
  intro?: string
  items: AuthoringListItem[]
  image_caption?: string
  /** Completion V1: optional closing callout. */
  callout?: string
}

/** Completion V1 layouts: the authoring shape IS the validated content contract. */
export type AuthoringGridContent = DocumentaryCardGridContent
export type AuthoringMapContent = DocumentaryCardMapContent
export type AuthoringNetworkContent = DocumentaryCardNetworkContent
export type AuthoringQuoteContent = DocumentaryCardQuoteContent
export type AuthoringClosingContent = DocumentaryCardClosingContent

export type AuthoringContent =
  | AuthoringCoverContent
  | AuthoringInfoContent
  | AuthoringListContent
  | AuthoringGridContent
  | AuthoringMapContent
  | AuthoringNetworkContent
  | AuthoringQuoteContent
  | AuthoringClosingContent

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
  /**
   * LEGACY (COVER_ELEMENT_COMPLETENESS_V1 toggle): the Hero's frame is its own Element now ('heroFrame', visibility
   * in `hiddenElements`). `frame: false` is only ever READ — slides saved with it are migrated to a hidden
   * 'heroFrame' on load, and the renderer still honours it so an old frozen snapshot paints as it did.
   */
  frame?: boolean
}

export interface TitleTuning {
  /** px offset, clamped to approximately ±60 */
  offsetX: number
  /** px offset, clamped to approximately ±60 */
  offsetY: number
  /** degrees, clamped to approximately ±2 */
  rotation: number
  /**
   * Static Detail Polish V1 — "Entrelinha" override (title only). Absent =
   * the Template layout's default line-height; bounded by TITLE_LINE_HEIGHT_BOUNDS.
   */
  lineHeight?: number
}

/** COVER_ELEMENT_COMPLETENESS_V1 — bounded X/Y/rotation of a text/brand Element (TitleTuning without line-height). */
export interface PositionTuning {
  offsetX: number
  offsetY: number
  rotation: number
}

export const DEFAULT_POSITION_TUNING: PositionTuning = { offsetX: 0, offsetY: 0, rotation: 0 }

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
  /**
   * COVER_ELEMENT_COMPLETENESS_V1 — Cover's Chamada / Introdução / Assinatura. OPTIONAL: absent
   * (every slide authored before) means the Template position; a reset removes the key.
   */
  kicker?: PositionTuning
  intro?: PositionTuning
  brand?: PositionTuning
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
import type {
  DocumentaryCardClosingContent,
  DocumentaryCardGridContent,
  DocumentaryCardIcon,
  DocumentaryCardMapContent,
  DocumentaryCardNetworkContent,
  DocumentaryCardQuoteContent,
} from '@/lib/schemas/creative/documentary-card'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { AuthoringAssetSlotId } from '@/lib/creative/templates/template-definitions'

/** A Project LibraryFile chosen for a slot (identity only). */
export interface AuthoringAssetOverride {
  libraryFileId: string
}
export type AuthoringAssetOverrides = Partial<Record<AuthoringAssetSlotId, AuthoringAssetOverride>>

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

  /**
   * Authoring Usability Completion V1 — slot -> Project LibraryFile chosen in
   * Assets ("Trocar"). Covers template material slots AND the content image
   * ('hero'). Absent slot = the Project primitive (paper/tape catalog) or the
   * Template default. Identity only (LibraryFile id): never a URL or path.
   */
  assetOverrides?: AuthoringAssetOverrides

  /**
   * Static Detail Polish V1 ?" template element ids this slide hides (Camadas
   * eye). Authored state: persisted, rendered, frozen in render snapshots.
   * A hidden element keeps its stack place, transform and tuning. Absent or
   * empty = every element visible (the Template default).
   */
  hiddenElements?: string[]

  /**
   * STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 ?" Custom Text/Image elements added by
   * the author, rendered spatially above the Template base.
   */
  elements?: import('@/lib/types').FreeSceneElement[]

  /** UI-only: which debug panel tabs are open */
  debugPanelOpen: boolean
}
