/**
 * Wave 6 — Authoring state factory and manifest boundary.
 *
 * Key boundary:
 *  - deriveManifest()    → produces a StaticRenderManifest from the persistable fields only
 *  - PreviewTuning       → excluded; never reaches the manifest
 */

import type { CanvasSpec } from '@/lib/schemas/creative/primitives'
import type { StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import { resolveDocumentaryCardFixture, documentaryCardTemplate } from '@/lib/creative/fixtures/documentary-card-fixtures'
import type { ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import {
  type AuthoringCanvas,
  type AuthoringCoverContent,
  type AuthoringIdentity,
  type AuthoringInfoContent,
  type AuthoringState,
  type AuthoringVariant,
  DEFAULT_TUNING,
} from './types'

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
): AuthoringState {
  return {
    variant,
    identity,
    canvas,
    heroRef: undefined,
    contentOverride: defaultContentForVariant(variant, identity),
    tuning: DEFAULT_TUNING,
    debugPanelOpen: false,
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
  return {
    ...base,
    manifest: {
      ...base.manifest,
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
export function deriveManifestFromState(state: AuthoringState): StaticRenderManifest {
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

  return {
    schema_version: 'static-render.v0',
    manifest_id: `authoring:draft:${state.variant}:${canvasSpec.height}:${state.identity}`,
    source: { type: 'fixture' as const, ref: 'fixture:documentary-card' },
    context: {
      project_ref: state.identity === 'b' ? 'fixture:project:acme-labs' : 'fixture:project:comunidades-alternativas',
      production_ref: state.identity === 'b' ? 'fixture:production:launch-week' : 'fixture:production:terra-una',
    },
    template: { ...documentaryCardTemplate, variant: state.variant },
    canvas: canvasSpec,
    identity: identityRef,
    sequence: { index: 1, total: 10 },
    content: state.contentOverride as unknown as Record<string, unknown>,
    assets,
    output: { format: 'png' as const, role: 'fixture' as const },
    metadata: { fixture: true, not_a_database_record: true, notes: 'authoring-draft: visual overrides excluded' },
  }
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
