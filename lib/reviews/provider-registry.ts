// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Review execution-provider registry. Selection is decided by SERVER code only
// (never a client field). OpenAI remains the default Image Review provider;
// nothing here switches existing Reviews to Gemini.

import { createGeminiReviewProvider } from '@/lib/providers/gemini/review-provider'
import { assertGeminiModelSupports, resolveGeminiReviewModelId } from '@/lib/providers/gemini/review-models'
import { ReviewProviderError, capabilityForMedia, isReviewProviderId, type ReviewExecutionProvider, type ReviewMediaKind, type ReviewProviderId } from './execution-provider'
import { createOpenAiReviewProvider, resolveOpenAiReviewModel } from './providers/openai'

export const DEFAULT_REVIEW_PROVIDER_ID: ReviewProviderId = 'openai'

export type ReviewProviderOverrides = Partial<Record<ReviewProviderId, ReviewExecutionProvider>>

export function getReviewExecutionProvider(providerId: string, overrides: ReviewProviderOverrides = {}): ReviewExecutionProvider {
  if (!isReviewProviderId(providerId)) throw new ReviewProviderError('unsupported_capability', `Unsupported Review provider: ${providerId}.`)
  const override = overrides[providerId]
  if (override) return override
  return providerId === 'gemini' ? createGeminiReviewProvider() : createOpenAiReviewProvider()
}

/** Configured model for a provider. Gemini models must be members of the registry. */
export function resolveReviewModelId(providerId: ReviewProviderId): string {
  return providerId === 'gemini' ? resolveGeminiReviewModelId() : resolveOpenAiReviewModel()
}

/**
 * Registry-level capability guard: rejects an unsupported provider/model/media
 * combination before credentials are used for a paid call.
 */
export function assertProviderModelSupportsMedia(provider: Pick<ReviewExecutionProvider, 'providerId' | 'capabilities'>, model: string, kind: ReviewMediaKind) {
  const capability = capabilityForMedia(kind)
  if (!provider.capabilities.has(capability)) {
    throw new ReviewProviderError('unsupported_capability', `Provider ${provider.providerId} does not support ${kind} review.`)
  }
  if (provider.providerId === 'gemini') assertGeminiModelSupports(model, capability)
}
