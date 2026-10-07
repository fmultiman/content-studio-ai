// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1 — SERVER ONLY.
//
// Turns the usage the official Gemini API reported for ONE generateContent execution of a Review into
// usage-ledger rows. Shared by Image and Video Review: the provider boundary
// (`ReviewExecutionResponse.usage`, or `ReviewProviderError.usage` for a received-but-rejected response)
// is the one factual place the numbers exist.
//
// Rules (each is asserted by tests):
//   - one real generateContent execution = one logical set of rows, keyed by the Review id. A Review row IS one
//     provider execution (a replay never reaches the provider; stale recovery never calls it), so
//     `gemini_review:{reviewId}:{category}` + the ledger's UNIQUE idempotency key makes a second write a no-op;
//   - provider-native categories stay separate rows: input_tokens (promptTokenCount, which includes cached
//     content), output_tokens (candidatesTokenCount, which excludes thoughts) and thinking tokens
//     (unit `tokens` + usage_category `thoughts`). They are never added into one fake total;
//   - descriptive facts (cached tokens, per-modality split, tool-use tokens, total, service tier) travel in
//     provider_metadata exactly as reported;
//   - a response with no usable usage records ONE unknown event (null quantity): unknown is not zero;
//   - funding is the truthful execution mode (`user_byok`): provider usage is NOT Content Studio spend, and no
//     price is computed (the ledger has no cost column and Gemini's price depends on dimensions the response does
//     not report, e.g. free vs paid tier);
//   - recording is best-effort like the video generation recorder: ONE retry of the LEDGER write, errors logged by
//     class only, never thrown, and it can never cause the provider to be called again.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractGeminiUsage, type GeminiUsage } from '@/lib/providers/gemini/usage'
import { InvalidUsageEventError, recordProviderUsageEvents, type ProviderUsageEventInput } from './provider-usage-recorder'

export type GeminiReviewUsageContext = {
  userId: string
  reviewId: string
  mediaType: 'image' | 'video'
  projectId: string | null
  productionId: string | null
  artifactId: string
  model: string
  /** `ProviderExecutionResult.executionMode` of the credential that paid for the call. */
  funding: string
  credentialSource: string
  /** The provider's own response id, when it sent one. */
  providerRequestId?: string | null
  /** `received` = the response was accepted; `received_rejected` = it arrived with usage but was not a usable Review. */
  providerResponse: 'received' | 'received_rejected'
}

export const geminiReviewUsageKey = (reviewId: string, category: 'input_tokens' | 'output_tokens' | 'thoughts_tokens' | 'unknown') =>
  `gemini_review:${reviewId}:${category}`

function metadataFor(context: GeminiReviewUsageContext, usage: GeminiUsage | null): Record<string, unknown> {
  const detail: Record<string, unknown> = {}
  if (usage) {
    if (usage.cachedContentTokens !== null) detail.cachedContentTokenCount = usage.cachedContentTokens
    if (usage.toolUsePromptTokens !== null) detail.toolUsePromptTokenCount = usage.toolUsePromptTokens
    if (usage.totalTokens !== null) detail.totalTokenCount = usage.totalTokens
    if (usage.serviceTier) detail.serviceTier = usage.serviceTier
    if (usage.promptTokensDetails.length) detail.promptTokensDetails = usage.promptTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens }))
    if (usage.candidatesTokensDetails.length) detail.candidatesTokensDetails = usage.candidatesTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens }))
  }
  return {
    api: 'gemini_generate_content',
    funding: context.funding,
    credential_source: context.credentialSource,
    provider_response: context.providerResponse,
    review: { id: context.reviewId, media_type: context.mediaType, artifact_id: context.artifactId },
    ...(Object.keys(detail).length ? { usage: detail } : {}),
  }
}

/** The ledger events for one Gemini Review execution. Pure. */
export function geminiReviewUsageEvents(context: GeminiReviewUsageContext, rawUsage: unknown): ProviderUsageEventInput[] {
  const usage = extractGeminiUsage(rawUsage)
  const base = {
    userId: context.userId,
    projectId: context.projectId,
    productionId: context.productionId,
    provider: 'gemini',
    transport: 'rest',
    operation: context.mediaType === 'video' ? 'video_review' : 'image_review',
    model: context.model,
    resourceType: 'media_review',
    resourceId: context.reviewId,
    providerTaskId: context.providerRequestId ?? null,
  }
  const metadata = metadataFor(context, usage)
  const events: ProviderUsageEventInput[] = []
  if (usage?.promptTokens != null) {
    events.push({ ...base, measurement: { quantity: usage.promptTokens, unit: 'input_tokens', source: 'provider_reported' }, providerMetadata: metadata, idempotencyKey: geminiReviewUsageKey(context.reviewId, 'input_tokens') })
  }
  if (usage?.candidatesTokens != null) {
    events.push({ ...base, measurement: { quantity: usage.candidatesTokens, unit: 'output_tokens', source: 'provider_reported' }, providerMetadata: metadata, idempotencyKey: geminiReviewUsageKey(context.reviewId, 'output_tokens') })
  }
  // Thinking tokens are billed by Google as output but reported separately; kept separate here. A reported 0 adds no row.
  if (usage?.thoughtsTokens != null && usage.thoughtsTokens > 0) {
    events.push({ ...base, measurement: { quantity: usage.thoughtsTokens, unit: 'tokens', source: 'provider_reported' }, providerMetadata: { ...metadata, usage_category: 'thoughts' }, idempotencyKey: geminiReviewUsageKey(context.reviewId, 'thoughts_tokens') })
  }
  if (!events.length) {
    events.push({ ...base, measurement: null, providerMetadata: metadata, idempotencyKey: geminiReviewUsageKey(context.reviewId, 'unknown') })
  }
  return events
}

/**
 * Appends the rows in ONE statement (all or nothing; duplicates ignored via the unique idempotency key).
 * Never throws. Returns whether the ledger holds the rows afterwards.
 */
export async function recordGeminiReviewUsage(db: SupabaseClient, context: GeminiReviewUsageContext, rawUsage: unknown): Promise<boolean> {
  const events = geminiReviewUsageEvents(context, rawUsage)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await recordProviderUsageEvents(db, events)
      return true
    } catch (error) {
      if (error instanceof InvalidUsageEventError) {
        console.error('[usage-ledger] rejected gemini review event:', error.name)
        return false
      }
      // otherwise fall through to the single retry of the LEDGER write
    }
  }
  console.error('[usage-ledger] gemini review usage write failed', { reviewId: context.reviewId, mediaType: context.mediaType })
  return false
}
