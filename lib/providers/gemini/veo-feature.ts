// VEO_KLING_FIRST_LAST_FRAME_V1 — release switch for official Google Veo video generation. SERVER ONLY.
//
// Veo ships DISABLED, exactly like the Gemini image route did (FUTURE-064): the connection is listed and its controls are
// visible, but it cannot start a generation until an operator sets this exact acknowledgement string in the Production
// deployment environment after the owner-authorized paid canary. A boolean-ish value ("1", "true") is rejected on
// purpose, so a stray variable cannot turn paid execution on. This is independent of, and additional to, the FUTURE-050
// execution policy (Preview / local / unknown runtimes stay blocked either way).

export const VEO_VIDEO_GENERATION_FLAG = 'CONTENT_STUDIO_VEO_VIDEO_GENERATION'
export const VEO_VIDEO_GENERATION_FLAG_VALUE = 'enabled'

export function isVeoVideoGenerationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[VEO_VIDEO_GENERATION_FLAG] === VEO_VIDEO_GENERATION_FLAG_VALUE
}
