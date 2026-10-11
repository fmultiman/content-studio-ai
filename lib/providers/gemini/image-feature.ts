// FUTURE-064 Slice A — release switch for official Gemini image generation. SERVER ONLY.
//
// The route ships DISABLED. It is enabled only by an operator setting this exact acknowledgement string in the
// deployment environment at the later release gate (after Slice B and an authorized paid smoke). A boolean-ish value
// ("1", "true") is rejected on purpose, so a stray variable cannot turn paid execution on. This is independent of,
// and additional to, the FUTURE-050 execution policy (Preview/local/unknown runtimes stay blocked either way).

export const GEMINI_IMAGE_GENERATION_FLAG = 'CONTENT_STUDIO_GEMINI_IMAGE_GENERATION'
export const GEMINI_IMAGE_GENERATION_FLAG_VALUE = 'enabled'
export const GEMINI_IMAGE_GENERATION_DISABLED_CODE = 'GEMINI_IMAGE_GENERATION_DISABLED'

export function isGeminiImageGenerationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[GEMINI_IMAGE_GENERATION_FLAG] === GEMINI_IMAGE_GENERATION_FLAG_VALUE
}
