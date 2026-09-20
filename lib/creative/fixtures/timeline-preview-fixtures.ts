import type { TimelineManifest } from '@/lib/schemas/creative/timeline'

/** Wave 7 canonical neutral fixtures. They contain no Remotion concepts. */
export const documentaryCardTimelinePreview: TimelineManifest = {
  schema_version: 'timeline.v0',
  manifest_id: 'fixture:timeline:documentary-card:cover-a:preview-v0',
  context: {
    project_ref: 'fixture:project:comunidades-alternativas',
    production_ref: 'fixture:production:terra-una-reel',
  },
  specification: { width: 1080, height: 1920, fps: 30, duration_frames: 180 },
  identity: { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' },
  tracks: [{ id: 'visual-main', kind: 'video', order: 0 }],
  segments: [{
    id: 'cover-main',
    track_id: 'visual-main',
    start_frame: 0,
    duration_frames: 180,
    kind: 'template',
    payload: {
      template: { id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', scope: 'system' },
      content: {
        eyebrow: 'Memória viva • Livros',
        title: 'O que são comunidades alternativas?',
        subtitle: 'Uma pergunta lançada num país em transição, enquanto outras formas de viver tentavam ganhar mais espaço.',
        source_line: 'Publicado originalmente em 1983.',
        detail_note: 'Edição apresentada: Nova Cultural / Brasiliense, 1985.',
      },
      assets: { hero: { type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01', fit: 'cover' } },
      sequence: { index: 1, total: 10 },
      motion: { preset: 'slow_push', intensity: 0.35 },
    },
  }],
  assets: {},
  render_intent: { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' },
}

/** A separate project/identity proves fade travels through the same adapter. */
export const documentaryCardFadeTimelinePreview: TimelineManifest = {
  schema_version: 'timeline.v0',
  manifest_id: 'fixture:timeline:documentary-card:cover-b-fade:preview-v0',
  context: {
    project_ref: 'fixture:project:acme-labs',
    production_ref: 'fixture:production:launch-week',
  },
  specification: { width: 1080, height: 1920, fps: 30, duration_frames: 180 },
  identity: { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' },
  tracks: [{ id: 'visual-main', kind: 'video', order: 0 }],
  segments: [{
    id: 'cover-fade',
    track_id: 'visual-main',
    start_frame: 0,
    duration_frames: 180,
    kind: 'template',
    payload: {
      template: { id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', scope: 'system' },
      content: {
        eyebrow: 'Product notes',
        title: 'Shipping a calmer launch',
        subtitle: 'A small record of the decisions behind this release.',
      },
      assets: { hero: { type: 'fixture', ref: 'fixture:asset:acme-labs:hero-01', fit: 'cover' } },
      sequence: { index: 1, total: 10 },
      motion: { preset: 'fade', intensity: 0.2 },
    },
  }],
  assets: {},
  render_intent: { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' },
}
