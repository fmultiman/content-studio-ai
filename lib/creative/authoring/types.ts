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
  detail_note: string
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
}

export const DEFAULT_TUNING: DocumentaryCardPreviewTuning = {
  hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
  title: { offsetX: 0, offsetY: 0, rotation: 0 },
}

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

  /** Content overrides applied on top of the fixture defaults */
  contentOverride: AuthoringContent

  /**
   * Preview-only visual tuning.
   * NEVER serialised into a StaticRenderManifest.
   */
  tuning: DocumentaryCardPreviewTuning

  /** UI-only: which debug panel tabs are open */
  debugPanelOpen: boolean
}
