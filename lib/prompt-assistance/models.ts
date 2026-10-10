import { GEMINI_REVIEW_MODELS } from '@/lib/providers/gemini/review-models'
import type { PromptAssistanceProvider } from './contract'

export type PromptAssistanceModel = {
  provider: PromptAssistanceProvider
  id: string
  label: string
}

// gpt-4o-mini is the explicit V1 default because it is already the current
// server-side text model used by translation and scene assistance. The legacy
// image route's gpt-3.5-turbo remains supported for compatibility.
export const PROMPT_ASSISTANCE_MODELS: readonly PromptAssistanceModel[] = [
  { provider: 'openai', id: 'gpt-4o-mini', label: 'OpenAI · GPT-4o mini' },
  { provider: 'openai', id: 'gpt-3.5-turbo', label: 'OpenAI · GPT-3.5 Turbo' },
  ...GEMINI_REVIEW_MODELS.map((model) => ({ provider: 'gemini' as const, id: model.id, label: `Gemini · ${model.label.replace('Gemini ', '')}` })),
]

export const DEFAULT_PROMPT_ASSISTANCE_MODEL = PROMPT_ASSISTANCE_MODELS[0]

export function findPromptAssistanceModel(provider: string, model: string): PromptAssistanceModel | null {
  return PROMPT_ASSISTANCE_MODELS.find((entry) => entry.provider === provider && entry.id === model) ?? null
}

export function isPromptAssistanceModel(value: unknown): value is PromptAssistanceModel {
  return !!value && typeof value === 'object' && 'provider' in value && 'id' in value
    && !!findPromptAssistanceModel(String((value as { provider: unknown }).provider), String((value as { id: unknown }).id))
}
