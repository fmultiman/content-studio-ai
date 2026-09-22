import React from 'react'
import { Composition, registerRoot, type CalculateMetadataFunction } from 'remotion'
import { TimelineComposition, type TimelineCompositionProps } from '@/remotion/timeline/TimelineComposition'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'

/**
 * Phase 2I-A1 — isolated VPS render-worker Remotion root.
 *
 * This is a thin, purpose-built entry for the render-worker package. It is
 * NOT a copy of remotion/Root.tsx: that file also registers SpikeComposition,
 * the DocumentaryCard still compositions, and a fixture-driven
 * TimelineManifestPreview composition for the Content Studio's own local
 * authoring/spike surfaces — none of which the isolated MP4 worker needs.
 * This root registers exactly one composition, `TimelineManifestVideo` (the
 * same id `scripts/creative/render-timeline-manifest.ts` already selects),
 * reusing the SAME `TimelineComposition` component the product renderer
 * already renders through. No render logic is duplicated here — only the
 * registration surface is narrowed. Every import uses the repo's existing
 * `@/...` alias (never a relative path) so this file resolves identically
 * whether it sits in the main repo checkout (for typecheck/lint) or is
 * copied to the worker's flattened `dist/content-studio/` tree by
 * `export.mjs` (for the actual VPS bundle), as long as that tree's webpack
 * `resolve.alias['@']` points at its own root — exactly the pattern
 * `render-timeline-manifest.ts` already uses.
 *
 * `defaultProps` below exists only to satisfy Remotion's Composition typing
 * and to give `calculateMetadata` something to compute against; it is a
 * minimal, structurally-valid placeholder, never a real render input. The
 * worker HTTP endpoint (server.mjs) always calls
 * `selectComposition`/`renderMedia` with an explicit real
 * `inputProps.resolvedInput`, which fully overrides this default — the same
 * pattern already proven by every real MP4 produced in this repo.
 */
const placeholderResolvedInput = {
  manifest: {
    schema_version: 'timeline.v0',
    manifest_id: 'placeholder:worker-boot',
    context: { project_ref: 'placeholder:project', production_ref: 'placeholder:production' },
    specification: { width: 1080, height: 1920, fps: 30, duration_frames: 1 },
    identity: { snapshot_ref: 'placeholder:identity', token_profile: 'default' },
    tracks: [],
    segments: [],
    assets: {},
    render_intent: { purpose: 'preview', container: 'mp4', audio: false, captions: 'none' },
  },
  tokens: {
    colors: { background: '#0b1020', foreground: '#f3ead8' },
    typography: {
      display: { family: 'Fraunces', weight: 700, style: 'normal' },
      body: { family: 'Source Sans 3', weight: 400, style: 'normal' },
    },
    spacing: {},
  },
  typography: { display: { family: 'Fraunces' }, body: { family: 'Source Sans 3' }, cssText: '' },
  resolvedAssets: {},
  resolvedTemplateSegments: [],
  diagnostics: [],
} as unknown as ResolvedTimelineInput

const calculateTimelineMetadata: CalculateMetadataFunction<TimelineCompositionProps> = ({ props }) => ({
  durationInFrames: props.resolvedInput.manifest.specification.duration_frames,
  fps: props.resolvedInput.manifest.specification.fps,
  width: props.resolvedInput.manifest.specification.width,
  height: props.resolvedInput.manifest.specification.height,
})

export const WorkerRoot: React.FC = () => (
  <Composition
    id="TimelineManifestVideo"
    component={TimelineComposition}
    defaultProps={{ resolvedInput: placeholderResolvedInput }}
    durationInFrames={1}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={calculateTimelineMetadata}
  />
)

registerRoot(WorkerRoot)
