import type { ProjectIdentity } from '@/lib/schemas/project-identity'

// ─── Form State ───────────────────────────────────────────────────────────────

/**
 * Form state shape — all strings for easy two-way binding.
 * Array fields are represented as newline-separated strings.
 */
export interface IdentityFormState {
  purpose: string
  audience: string
  visual_identity: string
  voice: string
  principles: string
  restrictions: string
  generation_preferences: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Joins an array with newlines. Undefined or empty array → ''. */
export function arrayToLineString(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return ''
  return arr.join('\n')
}

/** Splits by newline, trims each item, filters out empty strings. */
export function lineStringToArray(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ─── State factories ──────────────────────────────────────────────────────────

/** Returns an IdentityFormState with all fields set to empty strings. */
export function emptyFormState(): IdentityFormState {
  return {
    purpose: '',
    audience: '',
    visual_identity: '',
    voice: '',
    principles: '',
    restrictions: '',
    generation_preferences: '',
  }
}

/**
 * Converts a ProjectIdentity (or null) to an IdentityFormState.
 * null → emptyFormState().
 */
export function identityToFormState(identity: ProjectIdentity | null): IdentityFormState {
  if (identity === null) return emptyFormState()

  return {
    purpose: identity.foundation?.purpose ?? '',
    audience: identity.relationship?.audience ?? '',
    visual_identity: identity.expression?.visual_identity ?? '',
    voice: identity.expression?.voice ?? '',
    principles: arrayToLineString(identity.governance?.principles),
    restrictions: arrayToLineString(identity.governance?.restrictions),
    generation_preferences: arrayToLineString(identity.practice?.generation_preferences),
  }
}

/**
 * Converts a form state to a raw object suitable for passing to
 * `normalizeProjectIdentity`.
 *
 * Rules:
 * - Always includes `schema_version: 1`.
 * - Only includes a zone when at least one of its fields has content.
 * - Within a zone, only includes fields that have content.
 * - For array fields, only includes the field if the resulting array is non-empty.
 * - Never includes `context`, `style_profile`, or `evaluation_mode`.
 */
export function formStateToIdentityInput(state: IdentityFormState): Record<string, unknown> {
  const result: Record<string, unknown> = { schema_version: 1 }

  // Foundation zone
  const purposeTrimmed = state.purpose.trim()
  if (purposeTrimmed) {
    result.foundation = { purpose: purposeTrimmed }
  }

  // Relationship zone
  const audienceTrimmed = state.audience.trim()
  if (audienceTrimmed) {
    result.relationship = { audience: audienceTrimmed }
  }

  // Expression zone
  const visualTrimmed = state.visual_identity.trim()
  const voiceTrimmed = state.voice.trim()
  if (visualTrimmed || voiceTrimmed) {
    const expression: Record<string, string> = {}
    if (visualTrimmed) expression.visual_identity = visualTrimmed
    if (voiceTrimmed) expression.voice = voiceTrimmed
    result.expression = expression
  }

  // Governance zone
  const principlesArr = lineStringToArray(state.principles)
  const restrictionsArr = lineStringToArray(state.restrictions)
  if (principlesArr.length > 0 || restrictionsArr.length > 0) {
    const governance: Record<string, string[]> = {}
    if (principlesArr.length > 0) governance.principles = principlesArr
    if (restrictionsArr.length > 0) governance.restrictions = restrictionsArr
    result.governance = governance
  }

  // Practice zone
  const prefsArr = lineStringToArray(state.generation_preferences)
  if (prefsArr.length > 0) {
    result.practice = { generation_preferences: prefsArr }
  }

  return result
}
