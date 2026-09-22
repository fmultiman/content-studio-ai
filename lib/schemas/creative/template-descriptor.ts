import { z } from 'zod'
import { CanvasSpecSchema, MotionPresetSchema, TemplateScopeSchema, TemplateVersionSchema } from './primitives'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// TemplateDescriptor V0: what the (not-yet-built, Wave 3) Template Registry
// resolves a TemplateRef into. Declares capability and requirements; never
// carries pixels, component paths, or renderer-specific ids.
// `component_key` is an opaque lookup key for the Registry — manifests never
// see an import path.

export const TemplateIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)

export const TemplateModeSchema = z.enum(['still', 'video'])

export const TemplateVariantIdSchema = z.string().trim().min(1)

export const CanvasSupportSchema = z.discriminatedUnion('strategy', [
  z
    .object({
      strategy: z.literal('fixed'),
      size: CanvasSpecSchema,
    })
    .strict(),

  z
    .object({
      strategy: z.literal('declared_sizes'),
      sizes: z.array(CanvasSpecSchema).min(1),
    })
    .strict(),

  z
    .object({
      strategy: z.literal('fluid'),
      min_width: z.number().int().positive().optional(),
      min_height: z.number().int().positive().optional(),
      max_width: z.number().int().positive().optional(),
      max_height: z.number().int().positive().optional(),
    })
    .strict(),
])

export type CanvasSupport = z.infer<typeof CanvasSupportSchema>

// The Descriptor registers resolvable schema keys, never serialized Zod.
export const TemplateSchemaRefsSchema = z
  .object({
    content: z.string().trim().min(1),
    assets: z.string().trim().min(1),
  })
  .strict()

export const TemplateCapabilitiesSchema = z
  .object({
    motion_presets: z.array(MotionPresetSchema).default(['none']),
    supports_transparency: z.boolean().default(false),
  })
  .strict()

export const IdentityTokenPathSchema = z.string().trim().min(1)

export const IdentityRequirementsSchema = z.array(IdentityTokenPathSchema)

export const OverflowPolicySchema = z.enum([
  'reject',
  'truncate',
  'fit_within_range',
  'alternate_variant',
  'human_review',
])

export const TemplateTextPolicySchema = z
  .object({
    default_overflow_policy: OverflowPolicySchema,
  })
  .strict()

export const ComponentKeySchema = z.string().trim().min(1)

export const TemplateDescriptorSchema = z
  .object({
    id: TemplateIdSchema,
    version: TemplateVersionSchema,
    scope: TemplateScopeSchema,

    label: z.string().trim().min(1),

    supported_modes: z.array(TemplateModeSchema).min(1),
    variants: z.array(TemplateVariantIdSchema).min(1),

    canvas_support: CanvasSupportSchema,

    schemas: TemplateSchemaRefsSchema,
    capabilities: TemplateCapabilitiesSchema,

    identity_requirements: IdentityRequirementsSchema.default([]),

    text_policy: TemplateTextPolicySchema.optional(),

    component_key: ComponentKeySchema,
  })
  .strict()

export type TemplateDescriptor = z.infer<typeof TemplateDescriptorSchema>
