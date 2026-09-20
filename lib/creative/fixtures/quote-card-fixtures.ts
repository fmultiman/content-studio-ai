import type { CanvasSpec, IdentitySnapshotRef, TemplateRef } from '@/lib/schemas/creative/primitives'
import type { StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import { resolveStaticRenderManifest, type ResolvedStaticRenderInput } from '@/lib/creative/resolution/resolve-static-render'

export const quoteCardTemplate: TemplateRef = {
  id: 'editorial.quote-card',
  version: '0.1.0',
  variant: 'default',
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

export function quoteCardManifest(canvas: CanvasSpec, identity: IdentitySnapshotRef = identityA): StaticRenderManifest {
  return {
    schema_version: 'static-render.v0',
    manifest_id: `fixture:quote-card:${canvas.height}:${identity.snapshot_ref}`,
    source: { type: 'fixture', ref: 'fixture:quote-card' },
    context: { project_ref: identity === identityB ? 'fixture:project:acme-labs' : 'fixture:project:comunidades-alternativas', production_ref: 'fixture:production:quote-proof' },
    template: quoteCardTemplate,
    canvas,
    identity,
    sequence: { index: 2, total: 4 },
    content: {
      eyebrow: 'A small record',
      quote: 'The work becomes clearer when the questions stay visible.',
      attribution: 'Editorial notebook',
      source_line: 'Shared Creative Rendering · Wave 9A',
    },
    assets: {},
    output: { format: 'png', role: 'fixture' },
    metadata: { fixture: true, not_a_database_record: true },
  }
}

export function resolveQuoteCardFixture(identity: 'a' | 'b' = 'a'): ResolvedStaticRenderInput {
  const result = resolveStaticRenderManifest(quoteCardManifest(canvas45, identity === 'a' ? identityA : identityB))
  if (!result.valid) throw new Error(`Quote card fixture failed to resolve: ${result.errors.map((error) => error.message).join('; ')}`)
  return result.value
}

export const quoteCardTimelinePreview: TimelineManifest = {
  schema_version: 'timeline.v0',
  manifest_id: 'fixture:timeline:quote-card:default-proof-v0',
  context: { project_ref: 'fixture:project:comunidades-alternativas', production_ref: 'fixture:production:quote-proof' },
  specification: { width: canvas916.width, height: canvas916.height, fps: 30, duration_frames: 90 },
  identity: identityA,
  tracks: [{ id: 'visual-main', kind: 'video', order: 0 }],
  segments: [{
    id: 'quote-main',
    track_id: 'visual-main',
    start_frame: 0,
    duration_frames: 90,
    kind: 'template',
    payload: {
      template: quoteCardTemplate,
      content: quoteCardManifest(canvas916).content,
      assets: {},
      sequence: { index: 2, total: 4 },
      motion: { preset: 'fade', intensity: 0.2 },
    },
  }],
  assets: {},
  render_intent: { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' },
}

export const quoteCardIdentityBFixture = quoteCardManifest(canvas45, identityB)
