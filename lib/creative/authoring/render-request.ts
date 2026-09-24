/**
 * Local authoring -> render boundary.
 *
 * This is deliberately a runtime/request contract, not a neutral creative
 * schema or persisted domain entity. The manifest remains pure; ephemeral
 * visual tuning travels beside it only while the dev render is running.
 *
 * Phase 2C: adds primitiveSelection to carry the semantic primitive keys
 * from the authoring layer to the render script. The render script resolves
 * these keys to live S3 URLs before passing them to the renderer.
 * Neutral manifests (StaticRenderManifest) do NOT carry PrimitiveRef.
 */
import { z } from 'zod'
import { StaticRenderManifestSchema } from '@/lib/schemas/creative/static-render'
import { VisualTokensSnapshotSchema, type VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import type { DocumentaryCardPreviewTuning } from './types'
import type { PrimitiveTransforms, PrimitiveTransformSlot } from '@/lib/creative/primitives/transforms'
import { AUTHORING_ASSET_SLOT_IDS, isRegisteredTemplateId, type AuthoringAssetSlotId } from '@/lib/creative/templates/template-definitions'
import { MAX_ELEMENT_ORDER_LENGTH } from '@/lib/creative/templates/element-stack'

const heroTuningSchema = z.object({
  offsetX: z.number().finite().min(-120).max(120),
  offsetY: z.number().finite().min(-120).max(120),
  rotation: z.number().finite().min(-4).max(4),
  scale: z.number().finite().min(0.9).max(1.15),
}).strict()

const titleTuningSchema = z.object({
  offsetX: z.number().finite().min(-60).max(60),
  offsetY: z.number().finite().min(-60).max(60),
  rotation: z.number().finite().min(-2).max(2),
}).strict()

// Same bounded shape as title — Info variant's independent source/credit line.
const sourceTuningSchema = titleTuningSchema

export const documentaryCardPreviewTuningSchema = z.object({
  hero: heroTuningSchema,
  title: titleTuningSchema,
  source: sourceTuningSchema,
}).strict()

export const authoringRenderOverridesSchema = z.object({
  documentaryCard: documentaryCardPreviewTuningSchema.optional(),
}).strict()

/**
 * Phase 2C: semantic primitive selection passed alongside the manifest.
 * Keys are primitive keys (e.g. 'paper-card-light-01'), never signed URLs.
 * projectRef identifies the catalog to look up the keys in.
 */
export const primitiveSelectionSchema = z.object({
  projectRef: z.string().min(1),
  paper: z.string().min(1).optional(),
  tape: z.string().min(1).optional(),
}).strict()

const primitiveTransformsSchema = z.object({
  offsetX: z.number().finite().min(-120).max(120),
  offsetY: z.number().finite().min(-120).max(120),
  rotation: z.number().finite().min(-15).max(15),
  scale: z.number().finite().min(0.5).max(2),
  opacity: z.number().finite().min(0).max(1),
}).strict()

export const primitiveTransformsBySlotSchema = z.object({
  paper: primitiveTransformsSchema.optional(),
  paperStrip: primitiveTransformsSchema.optional(),
  tape: primitiveTransformsSchema.optional(),
  tape1: primitiveTransformsSchema.optional(),
  tape2: primitiveTransformsSchema.optional(),
  tape3: primitiveTransformsSchema.optional(),
  botanical: primitiveTransformsSchema.optional(),
  pin: primitiveTransformsSchema.optional(),
  paperDark: primitiveTransformsSchema.optional(),
  botanicalLeaf: primitiveTransformsSchema.optional(),
  pin2: primitiveTransformsSchema.optional(),
  archival: primitiveTransformsSchema.optional(),
  ornament: primitiveTransformsSchema.optional(),
  note: primitiveTransformsSchema.optional(),
  card1: primitiveTransformsSchema.optional(),
}).strict()

/** Template Foundation V1: which registered Template authored this slide (renderer identity stays manifest.template). */
export const templateIdSchema = z.string().trim().min(1).refine(isRegisteredTemplateId, { message: 'templateId is not a registered template' })

/** Authoring Usability Completion V1: slot -> Project LibraryFile (identity only), validated + frozen server-side. */
export const assetOverridesRequestSchema = z.record(
  z.enum(AUTHORING_ASSET_SLOT_IDS as [AuthoringAssetSlotId, ...AuthoringAssetSlotId[]]),
  z.object({ libraryFileId: z.string().uuid() }).strict(),
)

/** Template Foundation V1: element stack, paint order back -> front. Normalized server-side before freezing. */
export const elementOrderSchema = z.array(z.string().trim().min(1).max(64)).max(MAX_ELEMENT_ORDER_LENGTH)

export const authoringRenderRequestSchema = z.object({
  manifest: StaticRenderManifestSchema,
  overrides: authoringRenderOverridesSchema.optional(),
  /** Phase 2C: primitive selection (semantic keys, resolved server-side) */
  primitiveSelection: primitiveSelectionSchema.optional(),
  primitiveTransforms: primitiveTransformsBySlotSchema.optional(),
  templateId: templateIdSchema.optional(),
  elementOrder: elementOrderSchema.optional(),
  assetOverrides: assetOverridesRequestSchema.optional(),
  context: z.object({
    projectId: z.string().min(1),
    editorialContentId: z.string().min(1),
    channelPieceId: z.string().min(1),
  }).strict().optional(),
  identitySnapshot: VisualTokensSnapshotSchema.optional(),
}).strict()

export type AuthoringRenderOverrides = {
  documentaryCard?: DocumentaryCardPreviewTuning
}

export type PrimitiveSelectionRequest = {
  projectRef: string
  paper?: string
  tape?: string
}

export type PrimitiveTransformsRequest = Partial<Record<PrimitiveTransformSlot, PrimitiveTransforms>>

export type AuthoringRenderRequest = {
  manifest: z.infer<typeof StaticRenderManifestSchema>
  overrides?: AuthoringRenderOverrides
  primitiveSelection?: PrimitiveSelectionRequest
  primitiveTransforms?: PrimitiveTransformsRequest
  templateId?: string
  elementOrder?: string[]
  assetOverrides?: Partial<Record<AuthoringAssetSlotId, { libraryFileId: string }>>
  context?: { projectId: string; editorialContentId: string; channelPieceId: string }
  identitySnapshot?: VisualTokensSnapshot
}

export function parseAuthoringRenderRequest(input: unknown): AuthoringRenderRequest {
  return authoringRenderRequestSchema.parse(input)
}
