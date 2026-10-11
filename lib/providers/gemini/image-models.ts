// FUTURE-064 Slice A — closed registry of the official Google Gemini ("Nano Banana") image models Content Studio
// may call. SERVER-SIDE source of truth: the browser sends a short selector alias, the server resolves it here.
//
// Rules:
//   * The registry is closed. An alias that is not listed is a validation error, never a default, and never
//     becomes another Gemini model, OpenAI, or the third-party NanoBananaAPI.ai provider.
//   * Aliases are <= 20 characters so they fit the current varchar(20) selector columns
//     (user_settings.default_image_model, image_drafts.selected_model). The official Google ids are longer.
//   * Official ids come from https://ai.google.dev/gemini-api/docs/models (verified 2026-10-11). `gemini-2.5-flash-image`
//     (deprecated, shutdown 2026-10-02), Pro and `gemini-3.1-flash-image` are intentionally NOT V1 models.
//   * No price lives here. Pricing is a migration-governed registry (provider_pricing_versions); image output has no
//     price rows yet, so cost is never computed from this file.

export const GEMINI_IMAGE_PROVIDER = 'gemini' as const

export type GeminiImageAlias = 'gemini-nb-2.1' | 'gemini-nb-lite'

export type GeminiImageModel = {
  /** Persisted selector value and Attempt/image `model` (<= 20 characters). */
  alias: GeminiImageAlias
  /** Official Google model id, sent to the Gemini API. */
  providerModel: string
  /** pt-BR label for the later UI slice. */
  label: string
}

const REGISTRY: ReadonlyArray<GeminiImageModel> = Object.freeze([
  Object.freeze({ alias: 'gemini-nb-2.1', providerModel: 'gemini-nano-banana-2.1', label: 'Google Gemini · Nano Banana 2.1 (oficial)' }),
  Object.freeze({ alias: 'gemini-nb-lite', providerModel: 'gemini-3.1-flash-lite-image', label: 'Google Gemini · Nano Banana 2 Lite (oficial)' }),
])

export const GEMINI_IMAGE_ALIASES: ReadonlyArray<GeminiImageAlias> = REGISTRY.map((entry) => entry.alias)

/** Aspect ratios documented for the Gemini image models (generationConfig.imageConfig.aspectRatio). */
export const GEMINI_IMAGE_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
export type GeminiImageAspectRatio = (typeof GEMINI_IMAGE_ASPECT_RATIOS)[number]
export const GEMINI_IMAGE_DEFAULT_ASPECT_RATIO: GeminiImageAspectRatio = '1:1'

/** V1 generates 1K images only (imageConfig.imageSize, upper-case K as Google requires). Not client-selectable. */
export const GEMINI_IMAGE_SIZE = '1K' as const

/** Exact lookup. Anything that is not an own, listed alias (prototype keys, case variants, whitespace) is rejected. */
export function resolveGeminiImageModel(alias: unknown): GeminiImageModel | null {
  if (typeof alias !== 'string') return null
  return REGISTRY.find((entry) => entry.alias === alias) ?? null
}

export function isGeminiImageAspectRatio(value: unknown): value is GeminiImageAspectRatio {
  return typeof value === 'string' && (GEMINI_IMAGE_ASPECT_RATIOS as readonly string[]).includes(value)
}

/** True for a persisted selector value that belongs to this provider (used by later UI slices). */
export function isGeminiImageAlias(value: unknown): value is GeminiImageAlias {
  return resolveGeminiImageModel(value) !== null
}
