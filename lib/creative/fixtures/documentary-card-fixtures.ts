import type { CanvasSpec, IdentitySnapshotRef, TemplateRef } from '@/lib/schemas/creative/primitives'
import type { StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import { resolveStaticRenderManifest, type ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'
import {
  CLOSING_EXAMPLE_CONTENT, GRID_EXAMPLE_CONTENT, LIST_EXAMPLE_CONTENT, MAP_EXAMPLE_CONTENT, NETWORK_EXAMPLE_CONTENT, QUOTE_EXAMPLE_CONTENT, cloneExample,
} from '@/lib/creative/templates/layout-examples'

export const documentaryCardTemplate: TemplateRef = {
  id: 'editorial.documentary-card',
  version: '0.1.0',
  variant: 'cover',
  scope: 'system',
}

const identityA: IdentitySnapshotRef = {
  snapshot_ref: 'fixture:identity:comunidades-alternativas:v1',
  token_profile: 'default',
}

const identityB: IdentitySnapshotRef = {
  snapshot_ref: 'fixture:identity:acme-labs:v1',
  token_profile: 'default',
}

const canvas45: CanvasSpec = { width: 1080, height: 1350, unit: 'px' }
const canvas916: CanvasSpec = { width: 1080, height: 1920, unit: 'px' }

function coverManifest(canvas: CanvasSpec, identity: IdentitySnapshotRef, neutral = false): StaticRenderManifest {
  return {
    schema_version: 'static-render.v0',
    manifest_id: `fixture:documentary-card:${neutral ? 'neutral' : 'cover'}:${canvas.height}`,
    source: { type: 'fixture', ref: 'fixture:documentary-card' },
    context: {
      project_ref: neutral ? 'fixture:project:acme-labs' : 'fixture:project:comunidades-alternativas',
      production_ref: neutral ? 'fixture:production:launch-week' : 'fixture:production:terra-una',
    },
    template: { ...documentaryCardTemplate, variant: 'cover' },
    canvas,
    identity,
    sequence: { index: 1, total: 10 },
    content: neutral
      ? { eyebrow: 'Product notes', title: 'Shipping a calmer launch', subtitle: 'A small record of the decisions behind this release.' }
      : {
          eyebrow: 'Memória viva • Livros',
          title: 'O que são comunidades alternativas?',
          subtitle: 'Uma pergunta lançada num país em transição, enquanto outras formas de viver tentavam ganhar mais espaço.',
          source_line: 'Publicado originalmente em 1983.',
          detail_note: 'Edição apresentada: Nova Cultural / Brasiliense, 1985.',
        },
    assets: neutral
      ? { hero: { type: 'fixture', ref: 'fixture:asset:acme-labs:hero-01', fit: 'cover' } }
      : {
          hero: {
            type: 'fixture',
            ref: 'fixture:asset:documentary-card:hero-archival-01',
            fit: 'cover',
            focal_point: { x: 0.5, y: 0.42 },
          },
          logo: { type: 'fixture', ref: 'fixture:asset:comunidades-alternativas:logo-v1', fit: 'contain' },
        },
    output: { format: 'png', role: 'fixture' },
    metadata: { fixture: true, not_a_database_record: true },
  }
}

function infoManifest(canvas: CanvasSpec, identity: IdentitySnapshotRef): StaticRenderManifest {
  return {
    schema_version: 'static-render.v0',
    manifest_id: `fixture:documentary-card:info:${canvas.height}`,
    source: { type: 'fixture', ref: 'fixture:documentary-card' },
    context: {
      project_ref: 'fixture:project:comunidades-alternativas',
      production_ref: 'fixture:production:terra-una',
    },
    template: { ...documentaryCardTemplate, variant: 'info' },
    canvas,
    identity,
    sequence: { index: 2, total: 10 },
    content: {
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
    },
    assets: { logo: { type: 'fixture', ref: 'fixture:asset:comunidades-alternativas:logo-v1', fit: 'contain' } },
    output: { format: 'png', role: 'fixture' },
    metadata: { fixture: true, not_a_database_record: true },
  }
}

/**
 * Layouts reconstructed from Pack A (Lista, Grade, Mapa, Rede, Citação,
 * Encerramento) — their Template example content; layouts that draw a content
 * image get the template's example image until a Project file replaces it.
 */
type ExampleVariant = 'list' | 'grid' | 'map' | 'network' | 'quote' | 'closing'
const EXAMPLES: Record<ExampleVariant, { content: object; sequence: number; hero: boolean }> = {
  list: { content: LIST_EXAMPLE_CONTENT, sequence: 3, hero: true },
  grid: { content: GRID_EXAMPLE_CONTENT, sequence: 6, hero: false },
  map: { content: MAP_EXAMPLE_CONTENT, sequence: 7, hero: false },
  network: { content: NETWORK_EXAMPLE_CONTENT, sequence: 8, hero: false },
  quote: { content: QUOTE_EXAMPLE_CONTENT, sequence: 9, hero: true },
  closing: { content: CLOSING_EXAMPLE_CONTENT, sequence: 10, hero: false },
}

function exampleManifest(variant: ExampleVariant, canvas: CanvasSpec, identity: IdentitySnapshotRef): StaticRenderManifest {
  const example = EXAMPLES[variant]
  return {
    schema_version: 'static-render.v0',
    manifest_id: `fixture:documentary-card:${variant}:${canvas.height}`,
    source: { type: 'fixture', ref: 'fixture:documentary-card' },
    context: {
      project_ref: 'fixture:project:comunidades-alternativas',
      production_ref: 'fixture:production:terra-una',
    },
    template: { ...documentaryCardTemplate, variant },
    canvas,
    identity,
    sequence: { index: example.sequence, total: 10 },
    content: cloneExample(example.content) as Record<string, unknown>,
    assets: {
      ...(example.hero ? { hero: { type: 'fixture' as const, ref: 'fixture:asset:documentary-card:hero-archival-01', fit: 'cover' as const } } : {}),
      logo: { type: 'fixture', ref: 'fixture:asset:comunidades-alternativas:logo-v1', fit: 'contain' },
    },
    output: { format: 'png', role: 'fixture' },
    metadata: { fixture: true, not_a_database_record: true },
  }
}

export type DocumentaryCardFixtureOptions = {
  variant: 'cover' | 'info' | ExampleVariant
  canvas: CanvasSpec
  identity: 'a' | 'b'
}

export function resolveDocumentaryCardFixture(options: DocumentaryCardFixtureOptions): ResolvedStaticRenderInput {
  const identity = options.identity === 'a' ? identityA : identityB
  const manifest = options.variant === 'cover'
    ? coverManifest(options.canvas, identity, options.identity === 'b')
    : options.variant === 'info'
      ? infoManifest(options.canvas, identity)
      : exampleManifest(options.variant, options.canvas, identity)
  const result = resolveStaticRenderManifest(manifest)
  if (!result.valid) throw new Error(`Documentary card fixture failed to resolve: ${result.errors.map((error) => error.message).join('; ')}`)
  return result.value
}

export const documentaryCardFixtures = {
  cover45: resolveDocumentaryCardFixture({ variant: 'cover', canvas: canvas45, identity: 'a' }),
  info45: resolveDocumentaryCardFixture({ variant: 'info', canvas: canvas45, identity: 'a' }),
  list45: resolveDocumentaryCardFixture({ variant: 'list', canvas: canvas45, identity: 'a' }),
  grid45: resolveDocumentaryCardFixture({ variant: 'grid', canvas: canvas45, identity: 'a' }),
  map45: resolveDocumentaryCardFixture({ variant: 'map', canvas: canvas45, identity: 'a' }),
  network45: resolveDocumentaryCardFixture({ variant: 'network', canvas: canvas45, identity: 'a' }),
  quote45: resolveDocumentaryCardFixture({ variant: 'quote', canvas: canvas45, identity: 'a' }),
  closing45: resolveDocumentaryCardFixture({ variant: 'closing', canvas: canvas45, identity: 'a' }),
  cover916: resolveDocumentaryCardFixture({ variant: 'cover', canvas: canvas916, identity: 'a' }),
  coverNeutral45: resolveDocumentaryCardFixture({ variant: 'cover', canvas: canvas45, identity: 'b' }),
} as const
