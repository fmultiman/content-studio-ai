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
  if (env[VEO_VIDEO_GENERATION_FLAG] !== VEO_VIDEO_GENERATION_FLAG_VALUE) return false
  const canary = veoCanaryUserIds(env)
  if (canary === null) return true
  return typeof userId === 'string' && canary.includes(userId.trim().toLowerCase())
}
