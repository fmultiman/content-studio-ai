/**
 * Wave 6 — Authoring state factory and manifest boundary.
 *
 * Key boundary:
 *  - deriveManifest()    → produces a StaticRenderManifest from the persistable fields only
 *  - PreviewTuning       → excluded; never reaches the manifest
 */

import type { CanvasSpec, SequenceContext } from '@/lib/schemas/creative/primitives'
import type { StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import { resolveDocumentaryCardFixture, documentaryCardTemplate } from '@/lib/creative/fixtures/documentary-card-fixtures'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import type { PrimitiveSelectionRequest, PrimitiveTransformsRequest } from './render-request'
import { PORTAL_PROJECT_REF } from '@/lib/creative/primitives/discovery'
import {
  type AuthoringAppearance,
  type AuthoringCanvas,
  type AuthoringContent,
  type AuthoringCoverContent,
  type AuthoringIdentity,
  type AuthoringInfoContent,
  type AuthoringPrimitiveSelection,
  type AuthoringState,
  type AuthoringVariant,
  type PrimitiveTransforms,
  DEFAULT_TUNING,
  DEFAULT_PRIMITIVE_TRANSFORMS,
  DEFAULT_PRIMITIVE_TRANSFORMS_STATE,
} from './types'

/** Legacy per-variant default, preserved so every pre-Slice-1 caller renders identically. */
export function defaultAppearanceForVariant(variant: AuthoringVariant): AuthoringAppearance {
  return variant === 'cover' ? 'dark' : 'light'
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

export function canvasSpecFromAuthoring(canvas: AuthoringCanvas): CanvasSpec {
  return canvas === 'portrait'
    ? { width: 1080, height: 1350, unit: 'px' }
    : { width: 1080, height: 1920, unit: 'px' }
}

// ── Default content per variant and identity ──────────────────────────────────

function defaultCoverContent(identity: AuthoringIdentity): AuthoringCoverContent {
  if (identity === 'b') {
    return {
      eyebrow: 'Product notes',
      title: 'Shipping a calmer launch',
      subtitle: 'A small record of the decisions behind this release.',
      source_line: '',
      detail_note: '',
    }
  }
  return {
    eyebrow: 'Memória viva • Livros',
    title: 'O que são comunidades alternativas?',
    subtitle: 'Uma pergunta lançada num país em transição, enquanto outras formas de viver tentavam ganhar mais espaço.',
    source_line: 'Publicado originalmente em 1983.',
    detail_note: 'Edição apresentada: Nova Cultural / Brasiliense, 1985.',
  }
}

function defaultInfoContent(): AuthoringInfoContent {
  return {
    title: 'Uma pergunta, duas edições',
    intro: 'Pequenos registros também guardam grandes histórias.',
    body_blocks: [
      'Há registro de uma edição Brasiliense de 1983, na Coleção Primeiros Passos nº 108.',
      'O exemplar apresentado aqui é a edição Nova Cultural / Brasiliense, de 1985, identificada como nº 58 da coleção.',
    ],
    fact_cards: [
      { primary: '1983', secondary: 'ed. Brasiliense', tertiary: 'nº 108' },
      { primary: '1985', secondary: 'ed. Nova Cultural / Brasiliense', tertiary: 'nº 58' },
    ],
    source_line: 'Coleção Primeiros Passos',
    annotation: 'duas edições, outros caminhos',
  }
}

export function defaultContentForVariant(
  variant: AuthoringVariant,
  identity: AuthoringIdentity,
): AuthoringCoverContent | AuthoringInfoContent {
  return variant === 'cover' ? defaultCoverContent(identity) : defaultInfoContent()
}

// ── Initial state factory ─────────────────────────────────────────────────────

export function createInitialAuthoringState(
  variant: AuthoringVariant = 'cover',
  identity: AuthoringIdentity = 'a',
  canvas: AuthoringCanvas = 'portrait',
  appearance: AuthoringAppearance = defaultAppearanceForVariant(variant),
): AuthoringState {
  return {
    variant,
    identity,
    canvas,
    heroRef: undefined,
    appearance,
    contentOverride: defaultContentForVariant(variant, identity),
    primitiveSelection: {
      paper: 'paper-card-light-01',
      tape: 'tape-kraft-short-01',
    },
    primitiveTransforms: { ...DEFAULT_PRIMITIVE_TRANSFORMS_STATE },
    tuning: DEFAULT_TUNING,
    debugPanelOpen: false,
  }
}

/**
 * Builds the existing ephemeral state from a real product context.
 * Slice 1 — Portal Carousel V1: variant/appearance are now real parameters
 * instead of being hardcoded to 'cover' — the single-card non-carousel call
 * site simply omits them and keeps getting a cover/dark slide, unchanged.
 */
export function createContextualAuthoringState(
  context: NonNullable<AuthoringState['productContext']>,
  canvas: AuthoringCanvas,
  content: AuthoringContent,
  primitiveSelection: AuthoringPrimitiveSelection = {},
  variant: AuthoringVariant = 'cover',
  appearance: AuthoringAppearance = defaultAppearanceForVariant(variant),
): AuthoringState {
  return {
    ...createInitialAuthoringState(variant, 'a', canvas, appearance),
    contentOverride: content,
    primitiveSelection,
    productContext: context,
  }
}

// ── Resolve the preview input from authoring state ────────────────────────────
// Uses the SAME resolveDocumentaryCardFixture path as the Wave 5 render.

export function resolvePreviewInput(state: AuthoringState): ResolvedStaticRenderInput {
  const canvasSpec = canvasSpecFromAuthoring(state.canvas)
  // Start from the fixture to get the base identity/asset resolution
  const base = resolveDocumentaryCardFixture({
    variant: state.variant,
    identity: state.identity,
    canvas: canvasSpec,
  })

  // Apply content overrides: replace manifest content with authoring edits.
  // This keeps the resolution layer in place — we patch the manifest's content
  // field rather than bypassing the resolver entirely.
  if (state.productContext) {
    return {
      ...base,
      tokens: state.productContext.identitySnapshot,
      manifest: {
        ...base.manifest,
        manifest_id: `channel-piece:${state.productContext.channelPieceId}:authoring`,
        source: { type: 'channel_piece', ref: state.productContext.channelPieceId },
        context: {
          project_ref: state.productContext.projectId,
          ...(state.productContext.productionId ? { production_ref: state.productContext.productionId } : {}),
        },
        template: { ...base.manifest.template, variant: state.variant, appearance: state.appearance },
        identity: { snapshot_ref: state.productContext.identitySnapshot.snapshot_ref, token_profile: 'default' },
        content: state.contentOverride as unknown as Record<string, unknown>,
        metadata: { source_verification_required_before_publication: true, locale: 'pt-BR', notes: 'contextual static authoring draft' },
      },
    } as ResolvedStaticRenderInput
  }

  return {
    ...base,
    manifest: {
      ...base.manifest,
      template: { ...base.manifest.template, variant: state.variant, appearance: state.appearance },
      content: state.contentOverride as unknown as Record<string, unknown>,
      // Hero ref override: swap the resolved asset if a custom ref is chosen
      assets: state.heroRef
        ? { ...base.manifest.assets, hero: { type: 'fixture' as const, ref: state.heroRef, fit: 'cover' as const } }
        : base.manifest.assets,
    },
  } as ResolvedStaticRenderInput
}

// ── Manifest boundary: derive a StaticRenderManifest (tuning excluded) ────────
/**
 * Produces a StaticRenderManifest from the persistable fields of AuthoringState.
 * PreviewTuning, debugPanelOpen and other ephemeral UI state are deliberately
 * excluded — they are not part of any manifest contract.
 */
/**
 * @param sequenceOverride Slice 1 — Portal Carousel V1: lets a caller managing
 * an ordered slide collection (e.g. a 2-slide carousel) report the slide's
 * real position/count instead of the single-card default of {index:1,total:1}.
 */
export function deriveManifestFromState(state: AuthoringState, sequenceOverride?: SequenceContext): StaticRenderManifest {
  const canvasSpec = canvasSpecFromAuthoring(state.canvas)
  const identityRef = state.identity === 'a'
    ? { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' as const }
    : { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' as const }

  const heroAsset = state.heroRef
    ? { type: 'fixture' as const, ref: state.heroRef, fit: 'cover' as const }
    : state.variant === 'cover'
      ? {
          type: 'fixture' as const,
          ref: state.identity === 'b'
            ? 'fixture:asset:acme-labs:hero-01'
            : 'fixture:asset:documentary-card:hero-archival-01',
          fit: 'cover' as const,
        }
      : undefined

  const assets = {
    ...(heroAsset ? { hero: heroAsset } : {}),
    ...(state.identity !== 'b'
      ? { logo: { type: 'fixture' as const, ref: 'fixture:asset:comunidades-alternativas:logo-v1', fit: 'contain' as const } }
      : {}),
  }

  if (state.productContext) {
    return {
      schema_version: 'static-render.v0',
      manifest_id: `channel-piece:${state.productContext.channelPieceId}:authoring`,
      source: { type: 'channel_piece', ref: state.productContext.channelPieceId },
      context: {
        project_ref: state.productContext.projectId,
        ...(state.productContext.productionId ? { production_ref: state.productContext.productionId } : {}),
      },
      template: { ...documentaryCardTemplate, variant: state.variant, appearance: state.appearance },
      canvas: canvasSpec,
      identity: { snapshot_ref: state.productContext.identitySnapshot.snapshot_ref, token_profile: 'default' },
      sequence: sequenceOverride ?? { index: 1, total: 1 },
      content: state.contentOverride as unknown as Record<string, unknown>,
      assets,
      output: { format: 'png', role: 'channel_piece' },
      metadata: { source_verification_required_before_publication: true, locale: 'pt-BR', notes: 'contextual static authoring draft' },
    }
  }

  return {
    schema_version: 'static-render.v0',
    manifest_id: `authoring:draft:${state.variant}:${canvasSpec.height}:${state.identity}`,
    source: { type: 'fixture' as const, ref: 'fixture:documentary-card' },
    context: {
      project_ref: state.identity === 'b' ? 'fixture:project:acme-labs' : 'fixture:project:comunidades-alternativas',
      production_ref: state.identity === 'b' ? 'fixture:production:launch-week' : 'fixture:production:terra-una',
    },
    template: { ...documentaryCardTemplate, variant: state.variant, appearance: state.appearance },
    canvas: canvasSpec,
    identity: identityRef,
    sequence: sequenceOverride ?? { index: 1, total: 10 },
    content: state.contentOverride as unknown as Record<string, unknown>,
    assets,
    output: { format: 'png' as const, role: 'fixture' as const },
    metadata: { fixture: true, not_a_database_record: true, notes: 'authoring-draft: visual overrides excluded' },
  }
}

// ── Phase 2C: derive primitive selection for render request ───────────────────

/**
 * Map identity to a project ref for primitive catalog lookup.
 * Only identity 'a' (Portal Comunidades Alternativas) has a real project-scoped
 * primitive catalog. Identity 'b' has no project primitive catalog in V0.
 */
export function projectRefForIdentity(identity: AuthoringIdentity): string | null {
  if (identity === 'a') return PORTAL_PROJECT_REF
  return null
}

/**
 * Derives the PrimitiveSelectionRequest to include in the render request.
 * Returns undefined when identity has no primitive catalog or no primitives are selected.
 *
 * Phase 2C: neutral manifests do NOT carry PrimitiveRef.
 * Primitive selection travels beside the manifest in the render request.
 */
export function derivePrimitiveSelectionRequest(state: AuthoringState): PrimitiveSelectionRequest | undefined {
  const projectRef = state.productContext?.primitiveProjectRef ?? projectRefForIdentity(state.identity)
  if (!projectRef) return undefined

  const { paper, tape } = state.primitiveSelection
  if (!paper && !tape) return undefined

  return {
    projectRef,
    ...(paper ? { paper } : {}),
    ...(tape ? { tape } : {}),
  }
}

/** Returns only non-default transforms; absence means template defaults. */
export function derivePrimitiveTransformsRequest(state: AuthoringState): PrimitiveTransformsRequest | undefined {
  const isDefault = (transform: PrimitiveTransforms) => Object.keys(DEFAULT_PRIMITIVE_TRANSFORMS).every((key) => {
    const field = key as keyof PrimitiveTransforms
    return transform[field] === DEFAULT_PRIMITIVE_TRANSFORMS[field]
  })
  const primitiveTransforms = Object.fromEntries(
    (['paper', 'paperStrip', 'tape', 'botanical', 'pin'] as const)
      .filter((slot) => !isDefault(state.primitiveTransforms[slot]))
      .map((slot) => [slot, state.primitiveTransforms[slot]]),
  ) as PrimitiveTransformsRequest

  return primitiveTransforms && Object.keys(primitiveTransforms).length > 0 ? primitiveTransforms : undefined
}

// ── Tuning bounds ─────────────────────────────────────────────────────────────

export const TUNING_BOUNDS = {
  hero: {
    offsetX: { min: -120, max: 120 },
    offsetY: { min: -120, max: 120 },
    rotation: { min: -4, max: 4 },
    scale: { min: 0.9, max: 1.15 },
  },
  title: {
    offsetX: { min: -60, max: 60 },
    offsetY: { min: -60, max: 60 },
    rotation: { min: -2, max: 2 },
  },
} as const

export function clampTuningValue(
  group: 'hero' | 'title',
  field: string,
  value: number,
): number {
  const bounds = TUNING_BOUNDS[group] as Record<string, { min: number; max: number }>
  const bound = bounds[field]
  if (!bound) return value
  return Math.min(bound.max, Math.max(bound.min, value))
}
