/**
 * Local authoring -> render boundary.
 *
 * This is deliberately a runtime/request contract, not a neutral creative
 * schema or persisted domain entity. The manifest remains pure; ephemeral
 * visual tuning travels beside it only while the dev render is running.
 */
import { z } from 'zod'
import { StaticRenderManifestSchema } from '@/lib/schemas/creative/static-render'
import type { DocumentaryCardPreviewTuning } from './types'

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

export const documentaryCardPreviewTuningSchema = z.object({
  hero: heroTuningSchema,
  title: titleTuningSchema,
}).strict()

export const authoringRenderOverridesSchema = z.object({
  documentaryCard: documentaryCardPreviewTuningSchema.optional(),
}).strict()

export const authoringRenderRequestSchema = z.object({
  manifest: StaticRenderManifestSchema,
  overrides: authoringRenderOverridesSchema.optional(),
}).strict()

export type AuthoringRenderOverrides = {
  documentaryCard?: DocumentaryCardPreviewTuning
}

export type AuthoringRenderRequest = {
  manifest: z.infer<typeof StaticRenderManifestSchema>
  overrides?: AuthoringRenderOverrides
}

export function parseAuthoringRenderRequest(input: unknown): AuthoringRenderRequest {
  return authoringRenderRequestSchema.parse(input)
}
