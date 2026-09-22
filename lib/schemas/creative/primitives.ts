import { z } from 'zod'

// ─── Wave 2 — Neutral Schemas ───────────────────────────────────────────────
//
// Shared primitives for the Creative Rendering Layer: CanvasSpec, TemplateRef,
// IdentitySnapshotRef, AssetRef, VisualTokensSnapshot, MotionSpec,
// TransitionSpec, SequenceContext.
//
// These contracts describe intent and structure. They MUST NOT know about
// any renderer. Do not import remotion, @remotion/*, react, next, or
// @/lib/supabase/** here — see lib/schemas/creative/__tests__/isolation.test.ts.

// ─── Identifiers ─────────────────────────────────────────────────────────────

export const RefSchema = z.string().trim().min(1)

export const SchemaVersionSchema = z.string().trim().min(1)

export const TemplateVersionSchema = z.string().trim().min(1)

// ─── CanvasSpec ──────────────────────────────────────────────────────────────

export const CanvasSpecSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    unit: z.literal('px'),
  })
  .strict()

export type CanvasSpec = z.infer<typeof CanvasSpecSchema>

// ─── TemplateRef ─────────────────────────────────────────────────────────────
//
// Invariant: TemplateRef.id never identifies a Project implicitly. Variant
// does not create a new template identity — scope + id + version does.

export const TemplateScopeSchema = z.enum(['system', 'project'])

export const TemplateRefSchema = z
  .object({
    id: z.string().trim().min(1),
    version: TemplateVersionSchema,
    variant: z.string().trim().min(1).optional(),
    scope: TemplateScopeSchema,
  })
  .strict()

export type TemplateRef = z.infer<typeof TemplateRefSchema>

// ─── IdentitySnapshotRef ─────────────────────────────────────────────────────
//
// A pointer to the resolved visual identity used by a render. Not required to
// be a database row in V0 — may resolve to a fixture or an in-memory struct.

export const IdentitySnapshotRefSchema = z
  .object({
    snapshot_ref: RefSchema,
    token_profile: z.string().trim().min(1).optional(),
  })
  .strict()

export type IdentitySnapshotRef = z.infer<typeof IdentitySnapshotRefSchema>

// ─── FocalPoint ──────────────────────────────────────────────────────────────
//
// Normalized coordinates: 0,0 = top-left, 0.5,0.5 = center, 1,1 = bottom-right.

export const FocalPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()

export type FocalPoint = z.infer<typeof FocalPointSchema>

// ─── AssetRef ────────────────────────────────────────────────────────────────
//
// V0 deliberately has no `role` field (hero/evidence/decoration/...). The
// Visual Primitive Library and asset provenance are future work — until that
// infrastructure exists, asset semantics stay derived from the template slot
// that consumes the asset, not from a global contract field.

export const AssetTypeSchema = z.enum([
  'library_file',
  'image',
  'production_artifact',
  'external',
  'fixture',
])

export const AssetFitSchema = z.enum(['cover', 'contain', 'fill'])

export const AssetRefSchema = z
  .object({
    type: AssetTypeSchema,
    ref: RefSchema,

    version: z.string().trim().min(1).optional(),
    checksum: z.string().trim().min(1).optional(),

    fit: AssetFitSchema.optional(),
    focal_point: FocalPointSchema.optional(),

    alt: z.string().trim().min(1).optional(),
  })
  .strict()

export type AssetRef = z.infer<typeof AssetRefSchema>

// ─── VisualTokensSnapshot ────────────────────────────────────────────────────
//
// Compiled operational output for a template. Font family/weight and brand
// come from here; font-size, line-height, and layout stay in the template.

export const FontStyleSchema = z.enum(['normal', 'italic'])

export const TypographyRoleSchema = z
  .object({
    family: z.string().trim().min(1),
    weight: z.number().int().min(100).max(900),
    style: FontStyleSchema.default('normal'),

    letter_spacing_em: z.number().optional(),
    text_transform: z.enum(['none', 'uppercase', 'lowercase']).optional(),
  })
  .strict()

export type TypographyRole = z.infer<typeof TypographyRoleSchema>

export const ColorTokenSchema = z.string().trim().min(1)

export const SafeAreaSchema = z
  .object({
    top: z.number().nonnegative(),
    right: z.number().nonnegative(),
    bottom: z.number().nonnegative(),
    left: z.number().nonnegative(),
    unit: z.literal('px'),
  })
  .strict()

export const SpacingTokensSchema = z
  .object({
    unit: z.number().positive(),
    default_gap: z.number().nonnegative().optional(),
    safe_area: SafeAreaSchema.optional(),
  })
  .strict()

export const BrandTokensSchema = z
  .object({
    logo_asset_ref: RefSchema.optional(),
    mark_asset_ref: RefSchema.optional(),
  })
  .strict()

export const VisualTokensSnapshotSchema = z
  .object({
    schema_version: z.literal('visual-tokens.v0'),
    snapshot_ref: RefSchema,

    typography: z
      .object({
        display: TypographyRoleSchema,
        body: TypographyRoleSchema,
        label: TypographyRoleSchema.optional(),
      })
      .strict(),

    colors: z
      .object({
        background: ColorTokenSchema,
        foreground: ColorTokenSchema,
        muted: ColorTokenSchema.optional(),
        accent: ColorTokenSchema.optional(),
      })
      .strict(),

    spacing: SpacingTokensSchema,

    brand: BrandTokensSchema.optional(),
  })
  .strict()

export type VisualTokensSnapshot = z.infer<typeof VisualTokensSnapshotSchema>

// ─── MotionSpec / TransitionSpec ─────────────────────────────────────────────
//
// V0 uses short semantic presets, not keyframes, easing functions, or any
// renderer-specific animation AST. The template/adapter translates a preset
// into concrete frame-based motion.

export const MotionPresetSchema = z.enum(['none', 'fade', 'slow_push', 'slow_pan', 'rise', 'reveal'])

export const MotionDirectionSchema = z.enum(['up', 'down', 'left', 'right'])

export const MotionSpecSchema = z
  .object({
    preset: MotionPresetSchema,
    intensity: z.number().min(0).max(1).optional(),
    direction: MotionDirectionSchema.optional(),
  })
  .strict()

export type MotionSpec = z.infer<typeof MotionSpecSchema>

export const TransitionPresetSchema = z.enum(['cut', 'crossfade', 'fade_through'])

export const TransitionSpecSchema = z
  .object({
    preset: TransitionPresetSchema,
    duration_frames: z.number().int().positive().optional(),
  })
  .strict()

export type TransitionSpec = z.infer<typeof TransitionSpecSchema>

// ─── SequenceContext ─────────────────────────────────────────────────────────
//
// Decision C7 (Wave 2): sequence is the semantic position of a piece within a
// series (e.g. slide 3 of 10) — authoring/channel context, never editorial
// content and never appearance. How "3/10" is drawn (capsule, torn-paper tag,
// no marker at all) belongs to the template/style layer, not this contract.
// Optional wherever it appears (StaticRenderManifest, TemplateSegment).

export const SequenceContextSchema = z
  .object({
    index: z.number().int().positive(),
    total: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.index <= value.total, {
    message: 'sequence.index must be less than or equal to sequence.total',
    path: ['index'],
  })

export type SequenceContext = z.infer<typeof SequenceContextSchema>

// ─── Output formats ──────────────────────────────────────────────────────────

export const StaticOutputFormatSchema = z.enum(['png', 'jpeg', 'webp'])

export const VideoContainerSchema = z.enum(['mp4', 'webm', 'mov'])

// ─── ContentBindings ─────────────────────────────────────────────────────────
//
// The core contract never knows the shape of a given template's content. It
// only confirms a serializable object exists; the template's own content
// schema (e.g. DocumentaryCardCoverContentSchema) validates it in a second
// stage once the Template Registry can resolve a TemplateRef (Wave 3).

export const ContentBindingsSchema = z.record(z.string(), z.unknown())

export type ContentBindings = z.infer<typeof ContentBindingsSchema>
