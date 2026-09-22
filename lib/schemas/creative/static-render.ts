import { z } from 'zod'
import {
  AssetRefSchema,
  CanvasSpecSchema,
  ContentBindingsSchema,
  IdentitySnapshotRefSchema,
  RefSchema,
  SequenceContextSchema,
  StaticOutputFormatSchema,
  TemplateRefSchema,
} from './primitives'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// StaticRenderManifest V0: a renderer-neutral, versioned contract for
// composing a single visual output (carousel slide, feed post, cover,
// thumbnail, quote card...) from structured content, compiled identity,
// assets, and a template. It has no timeline and is never a VideoWork.
//
// `content` is intentionally opaque here (ContentBindingsSchema) — the core
// schema never knows what "editorial.documentary-card" needs. A second
// validation stage (Wave 3's Template Registry) resolves the TemplateRef and
// validates `content`/`assets` against that template's own schema.

export const StaticRenderSourceTypeSchema = z.enum([
  'channel_piece',
  'editorial_content',
  'production',
  'manual',
  'fixture',
])

export const StaticRenderSourceSchema = z
  .object({
    type: StaticRenderSourceTypeSchema,
    ref: RefSchema.optional(),
  })
  .strict()

export type StaticRenderSource = z.infer<typeof StaticRenderSourceSchema>

// project_ref is required — identity and asset resolution depend on the
// Project even in V0, where both are still fixture-backed.
export const StaticRenderContextSchema = z
  .object({
    project_ref: RefSchema,
    production_ref: RefSchema.optional(),
  })
  .strict()

export type StaticRenderContext = z.infer<typeof StaticRenderContextSchema>

export const StaticRenderOutputSchema = z
  .object({
    format: StaticOutputFormatSchema,
    role: z.string().trim().min(1).optional(),
    quality_profile: z.string().trim().min(1).optional(),
    transparent: z.boolean().optional(),
  })
  .strict()

export type StaticRenderOutput = z.infer<typeof StaticRenderOutputSchema>

// Controlled metadata surface — never an escape hatch for layout or renderer
// configuration.
export const StaticRenderMetadataSchema = z
  .object({
    fixture: z.boolean().optional(),
    fixture_purpose: z.string().trim().min(1).optional(),
    not_a_database_record: z.boolean().optional(),
    source_verification_required_before_publication: z.boolean().optional(),
    locale: z.string().trim().min(1).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()

export type StaticRenderMetadata = z.infer<typeof StaticRenderMetadataSchema>

export const StaticRenderManifestSchema = z
  .object({
    schema_version: z.literal('static-render.v0'),
    manifest_id: RefSchema,

    source: StaticRenderSourceSchema,
    context: StaticRenderContextSchema,

    template: TemplateRefSchema,
    canvas: CanvasSpecSchema,

    identity: IdentitySnapshotRefSchema,

    // Decision C7 (Wave 2): sequence is optional context, never content or
    // appearance. See primitives.ts for the full rationale.
    sequence: SequenceContextSchema.optional(),

    content: ContentBindingsSchema,
    assets: z.record(z.string().trim().min(1), AssetRefSchema),

    output: StaticRenderOutputSchema,

    metadata: StaticRenderMetadataSchema.optional(),
  })
  .strict()

export type StaticRenderManifest = z.infer<typeof StaticRenderManifestSchema>
