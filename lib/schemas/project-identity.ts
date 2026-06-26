import { z } from 'zod'

// ─── Limits ──────────────────────────────────────────────────────────────────
// These constants are exported for use in tests and UI validation.

/** Maximum characters for free-text identity fields (purpose, audience, etc.) */
export const IDENTITY_TEXT_MAX_CHARS = 3000

/** Maximum characters per item in string array fields */
export const IDENTITY_ARRAY_ITEM_MAX_CHARS = 500

/** Maximum number of items in any array field */
export const IDENTITY_ARRAY_MAX_ITEMS = 20

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Optional free-text field: must be non-empty after trim, bounded at top end.
 * Strings of only whitespace are rejected. The trim is applied by Zod before
 * min/max checks so the stored value is always clean.
 */
const optionalText = z
  .string()
  .trim()
  .min(1, 'Must be at least 1 character after trimming')
  .max(IDENTITY_TEXT_MAX_CHARS, `Must be at most ${IDENTITY_TEXT_MAX_CHARS} characters`)
  .optional()

/**
 * Optional array of non-empty strings.
 * Each item is trimmed and must have at least 1 character after trim.
 * Duplicates are removed via Set during the transform step.
 * The array itself is bounded to IDENTITY_ARRAY_MAX_ITEMS.
 */
const optionalStringArray = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Array items must be at least 1 character after trimming')
      .max(IDENTITY_ARRAY_ITEM_MAX_CHARS, `Array items must be at most ${IDENTITY_ARRAY_ITEM_MAX_CHARS} characters`),
  )
  .max(IDENTITY_ARRAY_MAX_ITEMS, `Array must have at most ${IDENTITY_ARRAY_MAX_ITEMS} items`)
  .transform((arr) => [...new Set(arr)])
  .optional()

// ─── Zone Schemas ─────────────────────────────────────────────────────────────

export const ProjectIdentityFoundationSchema = z
  .object({ purpose: optionalText })
  .strict()

export const ProjectIdentityRelationshipSchema = z
  .object({ audience: optionalText })
  .strict()

export const ProjectIdentityExpressionSchema = z
  .object({
    visual_identity: optionalText,
    voice: optionalText,
  })
  .strict()

export const ProjectIdentityGovernanceSchema = z
  .object({
    principles: optionalStringArray,
    restrictions: optionalStringArray,
  })
  .strict()

export const ProjectIdentityPracticeSchema = z
  .object({ generation_preferences: optionalStringArray })
  .strict()

// ─── Root Schema ──────────────────────────────────────────────────────────────

/**
 * Canonical schema for Project Identity V1.
 *
 * - `schema_version` is required and must be exactly 1.
 * - All zones and their fields are optional.
 * - Unknown keys at any level are rejected (.strict()).
 * - The TypeScript type ProjectIdentity is inferred from this schema — no
 *   duplicate interface definitions.
 */
export const ProjectIdentitySchema = z
  .object({
    schema_version: z.literal(1),
    foundation: ProjectIdentityFoundationSchema.optional(),
    relationship: ProjectIdentityRelationshipSchema.optional(),
    expression: ProjectIdentityExpressionSchema.optional(),
    governance: ProjectIdentityGovernanceSchema.optional(),
    practice: ProjectIdentityPracticeSchema.optional(),
  })
  .strict()

// ─── Inferred Type ────────────────────────────────────────────────────────────

/** The canonical Project Identity type — inferred from Zod, never duplicated manually. */
export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>
