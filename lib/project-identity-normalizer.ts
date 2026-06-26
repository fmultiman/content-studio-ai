import { z } from 'zod'
import { ProjectIdentitySchema } from './schemas/project-identity'
import type { ProjectIdentity } from './schemas/project-identity'

// ─── Error ───────────────────────────────────────────────────────────────────

/** Thrown when input is structurally invalid — not merely absent or empty. */
export class ProjectIdentityParseError extends Error {
  readonly issues: z.ZodIssue[]

  constructor(zodError: z.ZodError) {
    super(`ProjectIdentity parse failed: ${zodError.message}`)
    this.name = 'ProjectIdentityParseError'
    this.issues = zodError.issues
  }
}

// ─── Parse (strict) ───────────────────────────────────────────────────────────

/**
 * Parses `input` strictly against `ProjectIdentitySchema`.
 *
 * Throws `ProjectIdentityParseError` on any Zod validation failure.
 * Use this when a malformed identity is a programming error that must surface.
 */
export function parseProjectIdentity(input: unknown): ProjectIdentity {
  const result = ProjectIdentitySchema.safeParse(input)
  if (!result.success) {
    throw new ProjectIdentityParseError(result.error)
  }
  return result.data
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNonNullObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Returns true if the identity has at least one non-empty content field. */
function hasContent(identity: ProjectIdentity): boolean {
  const { foundation, relationship, expression, governance, practice } = identity

  if (foundation?.purpose) return true
  if (relationship?.audience) return true
  if (expression?.visual_identity || expression?.voice) return true
  if (governance?.principles?.length || governance?.restrictions?.length) return true
  if (practice?.generation_preferences?.length) return true

  return false
}

// ─── Normalize (public API) ───────────────────────────────────────────────────

/**
 * Public API for obtaining a ProjectIdentity from untrusted input.
 *
 * Distinguishes between three cases:
 * - Absent / empty → returns `null` (not an error).
 * - Non-object / wrong schema_version / structurally invalid → throws.
 * - Valid → parses, checks for actual content, returns `ProjectIdentity | null`.
 *
 * This function must NOT silently swallow structural errors.
 */
export function normalizeProjectIdentity(input: unknown): ProjectIdentity | null {
  // Legitimate absence: null, undefined, or empty string
  if (input === null || input === undefined || input === '') {
    return null
  }

  // Anything that is not a plain object is a programming error, not absence.
  if (!isNonNullObject(input)) {
    throw new ProjectIdentityParseError(
      new z.ZodError([
        {
          code: z.ZodIssueCode.invalid_type,
          expected: 'object',
          received: typeof input as z.ZodParsedType,
          path: [],
          message: `Expected object, received ${typeof input}`,
        },
      ]),
    )
  }

  // Empty object {} is treated as legitimate absence.
  if (Object.keys(input).length === 0) {
    return null
  }

  // schema_version must be present and must be 1.
  // If the key is missing entirely, surface a parse error (structural problem).
  // If the key is present but wrong (e.g. 2), also throw — version mismatch is
  // not the same as absence and must be visible to the caller.
  const version = (input as Record<string, unknown>).schema_version
  if (version === undefined) {
    throw new ProjectIdentityParseError(
      new z.ZodError([
        {
          code: z.ZodIssueCode.invalid_literal,
          expected: 1,
          received: undefined,
          path: ['schema_version'],
          message: 'schema_version is required and must be 1',
        },
      ]),
    )
  }
  if (version !== 1) {
    throw new ProjectIdentityParseError(
      new z.ZodError([
        {
          code: z.ZodIssueCode.invalid_literal,
          expected: 1,
          received: version,
          path: ['schema_version'],
          message: `Unsupported schema_version: ${version}. Only version 1 is supported.`,
        },
      ]),
    )
  }

  // Full structural validation (trim, dedup, length checks, .strict()).
  const parsed = parseProjectIdentity(input)

  // An identity that passes validation but has no content is treated as absent.
  if (!hasContent(parsed)) {
    return null
  }

  return parsed
}
