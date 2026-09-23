/**
 * Static Render Worker V1 — authoritative, signed-URL-free STATIC render
 * execution snapshot.
 *
 * Sibling of `build-snapshot.ts` (video). Deliberately a separate contract:
 * a static still is `StaticRenderManifest -> renderStill -> PNG`, never a
 * TimelineManifest. Only the execution plane (table, claim, lease, worker,
 * storage) is shared with video — the media contracts are not merged.
 *
 * The snapshot is FROZEN at enqueue (`render_executions.input_snapshot`) from
 * the authoring state the user had when clicking "Gerar PNG" — including
 * unsaved local edits. It never rereads persisted authoring state later, so
 * editing the slide while the render is queued/running cannot change it.
 *
 * It contains no signed URL and no storage path: primitive materials travel
 * as semantic keys (`primitiveSelection`), resolved to fresh presigned URLs
 * only at claim time from ownership-scoped LibraryFile rows.
 *
 * No Supabase, S3, Remotion or React here — pure shape + validation.
 */
import { z } from 'zod'
import { StaticRenderManifestSchema, type StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import { VisualTokensSnapshotSchema, type VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import {
  authoringRenderOverridesSchema,
  primitiveSelectionSchema,
  primitiveTransformsBySlotSchema,
  type AuthoringRenderOverrides,
  type PrimitiveSelectionRequest,
  type PrimitiveTransformsRequest,
} from '@/lib/creative/authoring/render-request'

const FrozenPrimitiveAssetSchema = z.object({
  libraryFileId: z.string().uuid(),
  mimeType: z.literal('image/png'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  checksum: z.string().min(1),
  version: z.string().min(1),
}).strict()

export type FrozenPrimitiveAsset = z.infer<typeof FrozenPrimitiveAssetSchema>
export type FrozenPrimitiveAssets = { paper?: FrozenPrimitiveAsset; tape?: FrozenPrimitiveAsset }

export const STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION = 'static-render-execution-snapshot.v0' as const

/**
 * Which authored slide produced this execution. Output metadata only — used
 * to bind the result back to the originating slide in the UI (switching
 * slides while a render runs must never rebind it). Not an authoring source
 * of truth.
 */
export const StaticRenderSlideRefSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    index: z.number().int().min(1).max(100),
    total: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((slide) => slide.index <= slide.total, { message: 'slide.index must be <= slide.total' })

export type StaticRenderSlideRef = z.infer<typeof StaticRenderSlideRefSchema>

export const StaticRenderExecutionSnapshotSchema = z
  .object({
    schema_version: z.literal(STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION),
    kind: z.literal('static_still'),
    manifest: StaticRenderManifestSchema,
    identitySnapshot: VisualTokensSnapshotSchema,
    overrides: authoringRenderOverridesSchema.optional(),
    primitiveSelection: primitiveSelectionSchema.optional(),
    primitiveAssets: z.object({ paper: FrozenPrimitiveAssetSchema.optional(), tape: FrozenPrimitiveAssetSchema.optional() }).strict().optional(),
    primitiveTransforms: primitiveTransformsBySlotSchema.optional(),
    slide: StaticRenderSlideRefSchema.nullable(),
    output: z
      .object({
        format: z.literal('png'),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()

export type StaticRenderExecutionSnapshot = {
  schema_version: typeof STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION
  kind: 'static_still'
  manifest: StaticRenderManifest
  identitySnapshot: VisualTokensSnapshot
  overrides?: AuthoringRenderOverrides
  primitiveSelection?: PrimitiveSelectionRequest
  primitiveAssets?: FrozenPrimitiveAssets
  primitiveTransforms?: PrimitiveTransformsRequest
  slide: StaticRenderSlideRef | null
  output: { format: 'png'; width: number; height: number }
}

export function buildStaticRenderExecutionSnapshot(input: {
  manifest: StaticRenderManifest
  identitySnapshot: VisualTokensSnapshot
  overrides?: AuthoringRenderOverrides
  primitiveSelection?: PrimitiveSelectionRequest
  primitiveAssets?: FrozenPrimitiveAssets
  primitiveTransforms?: PrimitiveTransformsRequest
  slide: StaticRenderSlideRef | null
}): StaticRenderExecutionSnapshot {
  // Deep-clone through JSON so the frozen snapshot can never alias a caller
  // object that is later mutated (the request body, or a test fixture).
  const frozen = JSON.parse(JSON.stringify({
    schema_version: STATIC_RENDER_EXECUTION_SNAPSHOT_SCHEMA_VERSION,
    kind: 'static_still',
    manifest: input.manifest,
    identitySnapshot: input.identitySnapshot,
    ...(input.overrides ? { overrides: input.overrides } : {}),
    ...(input.primitiveSelection ? { primitiveSelection: input.primitiveSelection } : {}),
    ...(input.primitiveAssets ? { primitiveAssets: input.primitiveAssets } : {}),
    ...(input.primitiveTransforms ? { primitiveTransforms: input.primitiveTransforms } : {}),
    slide: input.slide,
    output: { format: 'png', width: input.manifest.canvas.width, height: input.manifest.canvas.height },
  })) as StaticRenderExecutionSnapshot
  return frozen
}

export type ParseStaticSnapshotResult =
  | { ok: true; snapshot: StaticRenderExecutionSnapshot }
  | { ok: false; code: 'INVALID_STATIC_SNAPSHOT'; message: string }

export function parseStaticRenderExecutionSnapshot(raw: unknown): ParseStaticSnapshotResult {
  const parsed = StaticRenderExecutionSnapshotSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      code: 'INVALID_STATIC_SNAPSHOT',
      message: `Static render snapshot failed validation${first ? ` at ${first.path.join('.') || '(root)'}: ${first.message}` : '.'}`.slice(0, 500),
    }
  }
  return { ok: true, snapshot: parsed.data as StaticRenderExecutionSnapshot }
}

const FORBIDDEN_SNAPSHOT_SUBSTRINGS = ['X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Expires', 's3.multihuman.com.br', 'minio:9000'] as const

/** Same defense-in-depth guard as the video snapshot: never persist a signed URL/storage host. */
export function assertStaticSnapshotHasNoSignedUrl(snapshot: StaticRenderExecutionSnapshot): void {
  const serialized = JSON.stringify(snapshot)
  for (const forbidden of FORBIDDEN_SNAPSHOT_SUBSTRINGS) {
    if (serialized.includes(forbidden)) {
      throw new Error(`static render execution snapshot must never contain a signed URL or storage host (found "${forbidden}")`)
    }
  }
}
