import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { IDENTITY_DISPLAY_FONT_FAMILIES } from '@/lib/schemas/project-identity'

// ─── Form State ───────────────────────────────────────────────────────────────

/**
 * Form state shape — all strings for easy two-way binding.
 * Array fields are represented as newline-separated strings.
 *
 * PROJECT_IDENTITY_VISUAL_TOKENS_V1: visuals fields added — hex color strings
 * and font family name strings (constrained to IDENTITY_*_FONT_FAMILIES).
 */
export interface IdentityFormState {
  purpose: string
  audience: string
  visual_identity: string
  voice: string
  principles: string
  restrictions: string
  generation_preferences: string
  // Visuals zone
  color_background: string
  color_foreground: string
  color_accent: string
  color_muted: string
  display_font: string
  body_font: string
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

/**
 * Returns true if the value is a valid CSS hex color string (#RGB or #RRGGBB).
 * Case-insensitive.
 */
export function isValidHexColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value.trim())
}

/**
 * Returns true if the font family name is in the allowed registry.
 */
export function isAllowedFontFamily(value: string): boolean {
  return IDENTITY_DISPLAY_FONT_FAMILIES.includes(value)
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
    color_background: '',
    color_foreground: '',
    color_accent: '',
    color_muted: '',
    display_font: '',
    body_font: '',
  }
}

/**
 * Converts a ProjectIdentity (or null) to an IdentityFormState.
 * null → emptyFormState().
 */
export function identityToFormState(identity: ProjectIdentity | null): IdentityFormState {
  if (identity === null) return emptyFormState()

  const visuals = identity.visuals
  return {
    purpose: identity.foundation?.purpose ?? '',
    audience: identity.relationship?.audience ?? '',
    visual_identity: identity.expression?.visual_identity ?? '',
    voice: identity.expression?.voice ?? '',
    principles: arrayToLineString(identity.governance?.principles),
    restrictions: arrayToLineString(identity.governance?.restrictions),
    generation_preferences: arrayToLineString(identity.practice?.generation_preferences),
    // Visuals zone — empty string means "not set" (use defaults)
    color_background: visuals?.colors?.background ?? '',
    color_foreground: visuals?.colors?.foreground ?? '',
    color_accent: visuals?.colors?.accent ?? '',
    color_muted: visuals?.colors?.muted ?? '',
    display_font: visuals?.typography?.display_font ?? '',
    body_font: visuals?.typography?.body_font ?? '',
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
 * - For color/font fields: validates format; invalid values are silently omitted
 *   (the save would succeed but those values would not persist).
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

  // Visuals zone — only include valid values
  const bg = state.color_background.trim()
  const fg = state.color_foreground.trim()
  const ac = state.color_accent.trim()
  const mu = state.color_muted.trim()
  const df = state.display_font.trim()
  const bf = state.body_font.trim()

  const colors: Record<string, string> = {}
  if (bg && isValidHexColor(bg)) colors.background = bg
  if (fg && isValidHexColor(fg)) colors.foreground = fg
  if (ac && isValidHexColor(ac)) colors.accent = ac
  if (mu && isValidHexColor(mu)) colors.muted = mu

  const typography: Record<string, string> = {}
  if (df && isAllowedFontFamily(df)) typography.display_font = df
  if (bf && isAllowedFontFamily(bf)) typography.body_font = bf

  const hasColors = Object.keys(colors).length > 0
  const hasTypography = Object.keys(typography).length > 0
  if (hasColors || hasTypography) {
    const visuals: Record<string, unknown> = {}
    if (hasColors) visuals.colors = colors
    if (hasTypography) visuals.typography = typography
    result.visuals = visuals
  }

  return result
}
