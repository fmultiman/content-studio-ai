import type { AssetRef, CanvasSpec, IdentitySnapshotRef, TemplateRef } from '../primitives'
import type { StaticRenderManifest } from '../static-render'
import type { TimelineManifest } from '../timeline'

// Shared fixtures for lib/schemas/creative/__tests__/**. Not a test file
// itself (does not match the *.test.ts glob).
//
// Two fixtures per manifest type: one labeled "portal" (mirrors
// PORTAL_DOCUMENTARY_CARD_FIXTURE_V0.json / EDITORIAL_DOCUMENTARY_CARD_
// FIXTURES_V0.md), and one fully neutral second project — proving the core
// schemas carry zero Portal-specific coupling, per EDITORIAL_DOCUMENTARY_
// CARD_FIXTURES_V0.md §49 (Fixture C is mandatory before closing the spike).

export const portalCanvas: CanvasSpec = { width: 1080, height: 1350, unit: 'px' }

export const portalTemplateRef: TemplateRef = {
  id: 'editorial.documentary-card',
  version: '0.1.0',
  variant: 'cover',
  scope: 'system',
}

export const portalIdentity: IdentitySnapshotRef = {
  snapshot_ref: 'fixture:identity:comunidades-alternativas:v1',
  token_profile: 'default',
}

export const portalHeroAsset: AssetRef = {
  type: 'fixture',
  ref: 'fixture:asset:terra-una:documentary-photo-01',
  fit: 'cover',
  focal_point: { x: 0.5, y: 0.42 },
}

export const validPortalStaticRenderManifest: StaticRenderManifest = {
  schema_version: 'static-render.v0',
  manifest_id: 'fixture:comunidades-alternativas:terra-una:cover:01',
  source: { type: 'fixture', ref: 'fixture:channel-piece:terra-una-carousel' },
  context: {
    project_ref: 'fixture:project:comunidades-alternativas',
    production_ref: 'fixture:production:terra-una-instagram',
  },
  template: portalTemplateRef,
  canvas: portalCanvas,
  identity: portalIdentity,
  sequence: { index: 1, total: 10 },
  content: {
    eyebrow: 'Comunidade em foco',
    title: 'Terra Una',
    subtitle: 'Memórias, práticas e caminhos de uma experiência comunitária',
    source_line: 'Portal Comunidades Alternativas',
  },
  assets: { hero: portalHeroAsset },
  output: { format: 'png', role: 'carousel_item', quality_profile: 'social-high' },
  metadata: { fixture: true, not_a_database_record: true },
}

// Neutral second-project fixture — different palette/content/hero, proving
// the manifest carries no hidden dependency on the Portal.
export const validNeutralStaticRenderManifest: StaticRenderManifest = {
  schema_version: 'static-render.v0',
  manifest_id: 'fixture:acme-labs:launch-week:cover:01',
  source: { type: 'fixture', ref: 'fixture:channel-piece:launch-week-carousel' },
  context: {
    project_ref: 'fixture:project:acme-labs',
    production_ref: 'fixture:production:launch-week',
  },
  template: {
    id: 'editorial.documentary-card',
    version: '0.1.0',
    variant: 'cover',
    scope: 'system',
  },
  canvas: { width: 1080, height: 1920, unit: 'px' },
  identity: { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' },
  content: {
    eyebrow: 'Product update',
    title: 'Shipping Launch Week',
  },
  assets: {
    hero: { type: 'fixture', ref: 'fixture:asset:acme-labs:hero-01', fit: 'cover' },
  },
  output: { format: 'jpeg', role: 'carousel_item' },
  metadata: { fixture: true },
}

export const validPortalTimelineManifest: TimelineManifest = {
  schema_version: 'timeline.v0',
  manifest_id: 'fixture:timeline:documentary-card:01',
  context: {
    project_ref: 'fixture:project:comunidades-alternativas',
    production_ref: 'fixture:production:terra-una-reel',
    // video_work_ref intentionally omitted — decision C2, VideoWork does not
    // exist in the product yet.
  },
  specification: { width: 1080, height: 1920, fps: 30, duration_frames: 180 },
  identity: portalIdentity,
  tracks: [{ id: 'visual-main', kind: 'video', order: 0 }],
  segments: [
    {
      id: 'segment-01',
      track_id: 'visual-main',
      start_frame: 0,
      duration_frames: 180,
      kind: 'template',
      payload: {
        template: portalTemplateRef,
        content: { eyebrow: 'Comunidade em foco', title: 'Terra Una' },
        assets: { hero: portalHeroAsset },
        sequence: { index: 1, total: 10 },
        motion: { preset: 'slow_push', intensity: 0.35 },
      },
    },
  ],
  assets: {},
  render_intent: { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' },
}

export const validNeutralTimelineManifest: TimelineManifest = {
  schema_version: 'timeline.v0',
  manifest_id: 'fixture:timeline:acme-labs:01',
  context: {
    project_ref: 'fixture:project:acme-labs',
    production_ref: 'fixture:production:launch-week',
  },
  specification: { width: 1080, height: 1920, fps: 30, duration_frames: 150 },
  identity: { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' },
  tracks: [{ id: 'main', kind: 'video', order: 0 }],
  segments: [
    {
      id: 'seg-01',
      track_id: 'main',
      start_frame: 0,
      duration_frames: 150,
      kind: 'template',
      payload: {
        template: { id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', scope: 'system' },
        content: { title: 'Shipping Launch Week' },
        assets: { hero: { type: 'fixture', ref: 'fixture:asset:acme-labs:hero-01' } },
        motion: { preset: 'fade' },
      },
    },
  ],
  assets: {},
  render_intent: { purpose: 'preview', container: 'mp4', audio: false },
}
