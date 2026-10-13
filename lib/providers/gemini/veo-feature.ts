// VEO_KLING_FIRST_LAST_FRAME_V1 — release switch for official Google Veo video generation. SERVER ONLY.
//
// Veo ships DISABLED, exactly like the Gemini image route did (FUTURE-064): the connection is listed and its controls are
// visible, but it cannot start a generation until an operator sets this exact acknowledgement string in the Production
// deployment environment after the owner-authorized paid canary. A boolean-ish value ("1", "true") is rejected on
// purpose, so a stray variable cannot turn paid execution on. This is independent of, and additional to, the FUTURE-050
// execution policy (Preview / local / unknown runtimes stay blocked either way).

export const VEO_VIDEO_GENERATION_FLAG = 'CONTENT_STUDIO_VEO_VIDEO_GENERATION'
export const VEO_VIDEO_GENERATION_FLAG_VALUE = 'enabled'
/**
 * CONTROLLED CANARY. The release switch above is GLOBAL to the deployment: on its own it enables Veo for every user who has
 * a Gemini key. When this variable is set (comma-separated user ids), Veo is enabled ONLY for those users, and an
 * unidentified caller is refused (fail closed). Unset/empty = no restriction beyond the switch (the general release).
 */
export const VEO_CANARY_USER_IDS = 'CONTENT_STUDIO_VEO_CANARY_USER_IDS'

type Env = Record<string, string | undefined>

export function veoCanaryUserIds(env: Env = process.env): string[] | null {
  const raw = env[VEO_CANARY_USER_IDS]
  if (typeof raw !== 'string' || raw.trim() === '') return null
  return raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
}

/** Whether Veo may start a generation for THIS user in this runtime (switch AND, when configured, the canary allowlist). */
export function isVeoVideoGenerationEnabled(env: Env = process.env, userId?: string | null): boolean {
  return describeVeoAvailability(env, userId) === 'available'
}

/**
 * Why Veo is (not) available to this user - the three truths the UI/operator must be able to tell apart:
 *   available          the switch is on and the user is allowed (no allowlist configured = every authenticated user with
 *                      their own valid Gemini BYOK connection, exactly as for any other provider);
 *   switch_off         the release switch is absent or not the acknowledgement value;
 *   canary_restricted  the switch is on but an explicit allowlist does not include this user.
 */
export type VeoAvailability = 'available' | 'switch_off' | 'canary_restricted'

/**
 * The switch value is compared after trimming surrounding whitespace and one pair of matching quotes: the dashboards and
 * `vercel env` happily store `"enabled"` or `enabled\n` when a value is pasted. "1", "true", "ENABLED" and the like are
 * still rejected on purpose (an acknowledgement string, not a boolean).
 */
function switchValue(raw: string | undefined): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  return /^(["'])(.*)\1$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed
}

export function describeVeoAvailability(env: Env = process.env, userId?: string | null): VeoAvailability {
  if (switchValue(env[VEO_VIDEO_GENERATION_FLAG]) !== VEO_VIDEO_GENERATION_FLAG_VALUE) return 'switch_off'
  const canary = veoCanaryUserIds(env)
  if (canary === null) return 'available'
  return typeof userId === 'string' && canary.includes(userId.trim().toLowerCase()) ? 'available' : 'canary_restricted'
}
