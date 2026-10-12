// FUTURE-064 Slice B — the one client-safe catalog of image models selectable in /imagens and Settings.
//
// Three DISTINCT providers, never collapsed:
//   openai       OpenAI GPT Image models
//   gemini       Google's official Gemini API ("Nano Banana"), aliases from the server registry
//   nanobanana   NanoBananaAPI.ai — a THIRD-PARTY service, not Google. Legacy, kept selectable.
//
// Persisted selector values are exactly these ids (<= 20 chars: user_settings.default_image_model and
// image_drafts.selected_model are varchar(20)). A value that is not listed is UNKNOWN: it is surfaced and blocks
// generation; it is never mapped to another model or provider. Pure module (no env, no I/O).
import { GEMINI_IMAGE_ALIASES, resolveGeminiImageModel, type GeminiImageAlias } from '@/lib/providers/gemini/image-models'

export type { GeminiImageAlias }
// Re-exported so client components import the catalog only (the Gemini server registry stays an implementation detail).
export { GEMINI_IMAGE_DEFAULT_ASPECT_RATIO } from '@/lib/providers/gemini/image-models'

export const OPENAI_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'] as const
export type OpenAIImageModel = (typeof OPENAI_IMAGE_MODELS)[number]

export const NANOBANANA_IMAGE_MODELS = ['nanobanana-v1', 'nanobanana-v2'] as const
export type NanoBananaImageModel = (typeof NANOBANANA_IMAGE_MODELS)[number]

export type ImageModel = OpenAIImageModel | GeminiImageAlias | NanoBananaImageModel
export type ImageProvider = 'openai' | 'gemini' | 'nanobanana'

export const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-2'

export const IMAGE_PROVIDER_LABELS: Record<ImageProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini (oficial)',
  nanobanana: 'NanoBananaAPI.ai (terceiros — legado)',
}

export const NANOBANANA_THIRD_PARTY_LABEL = 'NanoBananaAPI.ai (terceiros — legado)'

export const IMAGE_MODEL_LABELS: Record<ImageModel, string> = {
  'gpt-image-2': 'GPT Image 2',
  'gpt-image-1.5': 'GPT Image 1.5',
  'gpt-image-1': 'GPT Image 1',
  'gpt-image-1-mini': 'GPT Image 1 Mini',
  'gemini-nb-2.1': resolveGeminiImageModel('gemini-nb-2.1')!.label,
  'gemini-nb-lite': resolveGeminiImageModel('gemini-nb-lite')!.label,
  'nanobanana-v1': 'NanoBananaAPI.ai V1 (terceiros — legado)',
  'nanobanana-v2': 'NanoBananaAPI.ai V2 (terceiros — legado)',
}

export const ALL_IMAGE_MODELS: readonly ImageModel[] = [...OPENAI_IMAGE_MODELS, ...GEMINI_IMAGE_ALIASES, ...NANOBANANA_IMAGE_MODELS]

/** Strict: exact catalog ids only. Case variants, whitespace, official Google ids, prototype keys and non-strings are `null`. */
export function parseImageModel(value: unknown): ImageModel | null {
  return typeof value === 'string' && (ALL_IMAGE_MODELS as readonly string[]).includes(value) ? (value as ImageModel) : null
}

export function imageModelProvider(model: ImageModel): ImageProvider {
  if ((OPENAI_IMAGE_MODELS as readonly string[]).includes(model)) return 'openai'
  if ((NANOBANANA_IMAGE_MODELS as readonly string[]).includes(model)) return 'nanobanana'
  return 'gemini'
}

export const isGeminiImageModel = (model: ImageModel): model is GeminiImageAlias => imageModelProvider(model) === 'gemini'

/**
 * Historical values the product itself used to write for the OpenAI default. They are read-mapped (never written back):
 * Settings already shows `openai` as GPT Image 2, so /imagens must agree.
 */
const LEGACY_STORED_MODEL_ALIASES: Readonly<Record<string, ImageModel>> = Object.freeze({ openai: 'gpt-image-2' })

export type StoredImageModel =
  | { kind: 'absent' }
  | { kind: 'model'; model: ImageModel }
  | { kind: 'unknown'; raw: string }

/**
 * Interprets a persisted selector (Settings default, saved Session or draft). Absent (null/undefined/empty) means "nothing
 * was saved" and callers keep the existing default. A non-empty value that is neither a catalog id nor a known legacy alias
 * is `unknown`: the caller must surface it and require an explicit choice, and must NOT rewrite the stored value.
 */
export function interpretStoredImageModel(raw: unknown): StoredImageModel {
  if (raw === null || raw === undefined || raw === '') return { kind: 'absent' }
  const model = parseImageModel(raw)
  if (model) return { kind: 'model', model }
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_STORED_MODEL_ALIASES, raw)) {
    return { kind: 'model', model: LEGACY_STORED_MODEL_ALIASES[raw] }
  }
  return { kind: 'unknown', raw: typeof raw === 'string' ? raw : String(raw) }
}
