/**
 * Phase 2I-B2 — claim-time runtime input resolution.
 *
 * At claim time a frozen snapshot (schema_version + manifest + identitySnapshot)
 * is retrieved from the `render_executions.input_snapshot` column and converted
 * into a live `ResolvedTimelineInput` with fresh presigned LibraryFile URLs.
 *
 * The critical invariant is:
 *   The frozen manifest is used as-is — later VideoDraft edits cannot affect
 *   an already-claimed execution. Only the LibraryFile asset URLs are freshly
 *   presigned, because presigned URLs expire and must not be persisted.
 *
 * Dependency chain (mirrors prepareVideoDraftTimeline but driven by snapshot):
 *
 *   frozen manifest  (from input_snapshot.manifest)
 *     → resolveTimelineManifest()           — Zod + semantic validation
 *     → prepareTimelineLibraryFileAssets()  — fresh presigned URLs
 *     → patchResolvedTimelineAssets()       — merge into ResolvedTimelineInput
 *
 * prepareVideoDraftTimeline is NOT reused here because it re-derives the
 * manifest from the current VideoDraft — exactly what we must NOT do. We
 * start from the frozen manifest instead.
 *
 * SSRF note: LibraryFile storage paths are loaded from the database (not
 * from the browser-authored snapshot). The snapshot carries only
 * library_file UUIDs as asset refs; real paths come from DB lookups that
 * enforce project-scoped ownership. No browser-supplied URL ever reaches
 * the presigning call.
 */

import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { TimelineManifest } from '@/lib/schemas/creative/timeline'
import type { LibraryFile } from '@/lib/types'
import type { ResolvedTimelineInput } from '@/lib/creative/resolution/resolve-timeline'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import {
  prepareTimelineLibraryFileAssets,
  patchManifestAssets,
  patchResolvedTimelineAssets,
  type LibraryFileLookup,
} from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import type { ProductAssetAdapterContext } from '@/lib/creative/integration/library-file-adapter'
import {
  RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  type RenderExecutionInputSnapshot,
} from './build-snapshot'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RuntimeResolutionInput = {
  /** The JSONB value from `render_executions.input_snapshot`. */
  rawSnapshot: unknown
  /** Project-scoped, active LibraryFile records (loaded by the caller with ownership checks). */
  libraryFiles: LibraryFile[]
  /** Caller-supplied S3 presigning function — keeps this module storage-agnostic. */
  createPresignedReadUrl: (path: string) => Promise<string | null>
}

export type RuntimeResolutionSuccess = {
  ok: true
  resolvedInput: ResolvedTimelineInput
  /** The identity tokens from the snapshot, for worker logging / tracing. */
  identitySnapshot: VisualTokensSnapshot
  manifest: TimelineManifest
  /** Non-fatal asset warnings that do not block rendering. */
  warnings: string[] | null
}

export type RuntimeResolutionFailure = {
  ok: false
  code: string
  message: string
}

export type RuntimeResolutionResult = RuntimeResolutionSuccess | RuntimeResolutionFailure

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function parseAndValidateSnapshot(rawSnapshot: unknown): RenderExecutionInputSnapshot | null {
  if (
    typeof rawSnapshot !== 'object' ||
    rawSnapshot === null ||
    (rawSnapshot as Record<string, unknown>).schema_version !==
      RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION
  ) {
    return null
  }
  const snap = rawSnapshot as Record<string, unknown>
  if (
    typeof snap.manifest !== 'object' ||
    snap.manifest === null ||
    typeof snap.identitySnapshot !== 'object' ||
    snap.identitySnapshot === null
  ) {
    return null
  }
  return rawSnapshot as RenderExecutionInputSnapshot
}

/**
 * Resolves a frozen execution snapshot into a live ResolvedTimelineInput
 * with fresh presigned asset URLs.
 *
 * Failures are returned (not thrown) so the caller can record them via the
 * fail API rather than letting the exception propagate uncaught.
 */
export async function resolveRuntimeInput(
  input: RuntimeResolutionInput,
): Promise<RuntimeResolutionResult> {
  // 1. Parse and validate the snapshot shape.
  const snapshot = parseAndValidateSnapshot(input.rawSnapshot)
  if (!snapshot) {
    return {
      ok: false,
      code: 'SNAPSHOT_SCHEMA_INVALID',
      message: `input_snapshot does not match expected schema version "${RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION}" or is structurally invalid.`,
    }
  }

  // 2. Validate the frozen manifest with the neutral timeline resolver,
  //    passing the snapshot's identitySnapshot as override so real project refs
  //    (project:{id}:snapshot) are not rejected by the fixture-only registry.
  //    This mirrors the same override pattern resolveStaticRenderManifest uses.
  const resolved = resolveTimelineManifest(snapshot.manifest, {
    identitySnapshot: snapshot.identitySnapshot,
  })
  if (!resolved.valid) {
    const messages = resolved.errors.map((e) => e.message).join('; ')
    return {
      ok: false,
      code: 'SNAPSHOT_MANIFEST_INVALID',
      message: `Frozen manifest failed structural validation: ${messages}`,
    }
  }

  // 3. Build a project-scoped LibraryFile lookup from the caller-supplied records.
  //    The LibraryFiles were loaded by the caller with:
  //      - project_id scoping (ownership)
  //      - deleted_at IS NULL filtering
  //    so we trust them to be authoritative without re-checking those predicates.
  const fileIndex = new Map<string, LibraryFile>(input.libraryFiles.map((f) => [f.id, f]))
  const lookupLibraryFile: LibraryFileLookup = (ref) => fileIndex.get(ref)

  const assetContext: ProductAssetAdapterContext = {
    createPresignedReadUrl: input.createPresignedReadUrl,
  }

  // 4. Freshly resolve presigned URLs from the frozen manifest's asset refs.
  //    This is the ONLY step that produces new signed URLs — they are returned
  //    to the worker in memory and never persisted back to input_snapshot.
  const prepared = await prepareTimelineLibraryFileAssets(
    snapshot.manifest,
    lookupLibraryFile,
    assetContext,
  )

  // 5. Patch the resolved input with live URLs.
  const resolvedInput = patchManifestAssets(patchResolvedTimelineAssets(resolved.value, prepared.resolvedAssets), prepared.resolvedManifestAssets)

  // The identity tokens were already set correctly by resolveTimelineManifest
  // via the identitySnapshot override — no additional override needed.

  return {
    ok: true,
    resolvedInput,
    identitySnapshot: snapshot.identitySnapshot,
    manifest: snapshot.manifest,
    warnings: prepared.diagnostics.length > 0
      ? prepared.diagnostics.map((d) => `${d.code}: ${d.message}`)
      : null,
  }
}
