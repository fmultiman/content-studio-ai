/**
 * Phase 2I-B1 — authoritative, signed-URL-free render execution snapshot.
 *
 * Pure domain -> neutral-schema conversion, reusing the existing Phase 2G-A/
 * 2H-C boundary exactly as built: `deriveVideoSceneAssetBindings` (persisted
 * VideoScene.library_file_id -> transient AssetRef) and
 * `adaptVideoDraftToTimelineManifest` (VideoDraft -> TimelineManifest). Both
 * are unmodified imports, not reimplemented here.
 *
 * Deliberately does NOT call `prepareVideoDraftTimeline` (lib/creative/
 * integration/prepare-video-draft-timeline.ts) or `prepareTimelineLibraryFileAssets`
 * -- those additionally resolve real, presigned LibraryFile URLs, which must
 * never be persisted (see PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §6/§7).
 * This module stops at the manifest-producing half only; real asset URL
 * resolution belongs to a later, claim-time step (2I-B2), not to snapshot
 * creation.
 *
 * No Supabase, S3, Remotion, React, filesystem, or network code belongs
 * here -- same boundary discipline as `video-draft-to-timeline.ts` itself.
 */
import type { VideoDraft } from '@/lib/types'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import { deriveVideoSceneAssetBindings } from '@/lib/video-scene-assets'
import {
  adaptVideoDraftToTimelineManifest,
  type AdapterDiagnostic,
} from '@/lib/creative/timeline-adapter/video-draft-to-timeline'

/** Bumped only if this wrapper shape itself changes -- independent of `manifest.schema_version`. */
export const RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION = 'render-execution-snapshot.v0'

/**
 * The exact JSONB shape persisted to `render_executions.input_snapshot`.
 *
 * `identitySnapshot` is carried alongside the manifest (not only referenced
 * by `manifest.identity.snapshot_ref`) because the current neutral timeline
 * resolver (`resolveTimelineManifest` -> `resolveIdentitySnapshot`) only
 * looks up a closed, fixture-backed registry (lib/creative/identity/
 * fixtures.ts) by that ref -- it has no override parameter the way the
 * Static resolver's `resolveStaticRenderManifest(input, { identitySnapshot })`
 * already does. A real Project's identity ref
 * (`project:{projectId}:snapshot`, from `adaptProjectIdentityToVisualTokens`)
 * would therefore fail that fixture-only lookup. Carrying the resolved
 * tokens alongside the manifest here — mirroring the Static resolver's own
 * established `identitySnapshot` override pattern — keeps this snapshot
 * reproducible by a future claim-time step without requiring any change to
 * the timeline resolver in this phase. See
 * PHASE_2I_B1_RENDER_EXECUTION_PERSISTENCE.md "Deviations from B0" for the
 * full reasoning.
 */
export type RenderExecutionInputSnapshot = {
  schema_version: typeof RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION
  manifest: TimelineManifest
  identitySnapshot: VisualTokensSnapshot
}

export type BuildRenderExecutionSnapshotInput = {
  draft: Pick<VideoDraft, 'id' | 'project_id' | 'production_id' | 'scenes'>
  /** Caller-supplied (real Project identity, adapted server-side) -- never fetched here. */
  identitySnapshot: VisualTokensSnapshot
}

export type BuildRenderExecutionSnapshotResult = {
  snapshot: RenderExecutionInputSnapshot
  diagnostics: AdapterDiagnostic[]
}

export function buildRenderExecutionSnapshot(
  input: BuildRenderExecutionSnapshotInput,
): BuildRenderExecutionSnapshotResult {
  const sceneAssets = deriveVideoSceneAssetBindings(input.draft.scenes)
  const identity = {
    snapshot_ref: input.identitySnapshot.snapshot_ref,
    token_profile: 'default',
  }

  const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({
    draft: input.draft,
    identity,
    sceneAssets,
  })

  return {
    snapshot: {
      schema_version: RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
      manifest,
      identitySnapshot: input.identitySnapshot,
    },
    diagnostics,
  }
}

/**
 * Defense-in-depth assertion, not the primary safety mechanism (the primary
 * mechanism is that nothing in this module's own dependency chain ever
 * calls `createPresignedReadUrl`/`prepareTimelineLibraryFileAssets` in the
 * first place). Scans the serialized snapshot for the concrete substrings a
 * signed URL or storage credential would contain, so a future accidental
 * change to this module (or its dependencies) that starts leaking one gets
 * caught immediately rather than silently persisted.
 */
const FORBIDDEN_SNAPSHOT_SUBSTRINGS = [
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Expires',
  's3.multihuman.com.br',
  'minio:9000',
] as const

export function assertSnapshotHasNoSignedUrl(snapshot: RenderExecutionInputSnapshot): void {
  const serialized = JSON.stringify(snapshot)
  for (const forbidden of FORBIDDEN_SNAPSHOT_SUBSTRINGS) {
    if (serialized.includes(forbidden)) {
      throw new Error(`render execution snapshot must never contain a signed URL or storage host (found "${forbidden}")`)
    }
  }
}
