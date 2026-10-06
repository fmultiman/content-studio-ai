// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Bounded Gemini Review model registry. Stable model IDs and declared input
// modalities live here (not scattered through product code); the active model
// is chosen by configuration and must be a registry member. This is not live
// model discovery: changing the supported set later is a one-file change.
//
// Model codes verified against Google's published model pages
// (ai.google.dev/gemini-api/docs/models) on 2026-10-06; both accept text, image
// and video input and support structured output. No live call was made.

import type { ReviewExecutionCapability } from '@/lib/reviews/execution-provider'
import { ReviewProviderError } from '@/lib/reviews/execution-provider'

export type GeminiReviewModel = {
  id: string
  label: string
  capabilities: ReadonlySet<ReviewExecutionCapability>
}

export const GEMINI_REVIEW_MODELS: readonly GeminiReviewModel[] = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', capabilities: new Set<ReviewExecutionCapability>(['image_review', 'video_review']) },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', capabilities: new Set<ReviewExecutionCapability>(['image_review', 'video_review']) },
]

export const GEMINI_REVIEW_DEFAULT_MODEL = 'gemini-3.5-flash'

export function resolveGeminiReviewModelId() {
  return process.env.GEMINI_REVIEW_MODEL?.trim() || GEMINI_REVIEW_DEFAULT_MODEL
}

export function findGeminiReviewModel(id: string) {
  return GEMINI_REVIEW_MODELS.find((model) => model.id === id) ?? null
}

/** Rejects a model that is not registered or lacks the capability — before any upload or paid call. */
export function assertGeminiModelSupports(modelId: string, capability: ReviewExecutionCapability): GeminiReviewModel {
  const model = findGeminiReviewModel(modelId)
  if (!model) throw new ReviewProviderError('unsupported_model', `Gemini model ${modelId} is not a registered Review model.`)
  if (!model.capabilities.has(capability)) {
    throw new ReviewProviderError('unsupported_capability', `Gemini model ${modelId} does not support ${capability}.`)
  }
  return model
}
