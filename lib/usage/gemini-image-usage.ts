// FUTURE-064 Slice C — usage accounting for official Gemini image generation. SERVER ONLY.
//
// Turns the `usageMetadata` Google reported for ONE generateContent image execution (already normalized by
// `extractGeminiUsage` and returned by lib/providers/gemini/image-client.ts) into usage-ledger rows linked to the
// canonical image Attempt. Nothing here prices anything: the ledger has no cost column, image output has no pricing
// version (Slice D owns that), and cost is derived on read from usage x the registry.
//
// Rules (each asserted by tests):
//   - ONE provider execution = ONE logical set of rows, keyed by the Attempt id:
//       gemini_image:{attemptId}:{input_tokens|image_output_tokens|text_output_tokens|output_unattributed_tokens|
//                                 thoughts_tokens|unknown}
//     written in ONE statement (all rows or none) with the ledger's UNIQUE idempotency key and ON CONFLICT DO NOTHING, so a
//     replay, a retry of the recorder or two concurrent writers can never double-count. No database change is needed;
//   - provider-native dimensions stay separate rows and are never merged or converted:
//       input_tokens          promptTokenCount (includes cached content)
//       image output tokens   candidatesTokensDetails[IMAGE]  -> unit `tokens`, usage_category `image_output`
//       text output tokens    candidatesTokensDetails[TEXT]   -> unit `output_tokens`
//       thinking tokens       thoughtsTokenCount              -> unit `tokens`, usage_category `thoughts`
//       unattributed output   positive candidatesTokenCount minus ALL reported candidate modality counts
//                              -> unit `tokens`, usage_category `output_unattributed`
//     IMAGE output tokens are deliberately NOT the `output_tokens` unit: that unit is priced at the ordinary text-output
//     rate by the cost deriver. A `tokens` row with an image/unattributed category is "not priceable" until Slice D adds
//     an image-output price dimension, so image tokens can never be billed at a text rate by accident;
//   - NOTHING is estimated: a row exists only for a number Google sent. No tokens are inferred from image size or count,
//     no zero is invented for a missing field (a reported 0 adds no row), and a response with no usable usage records ONE
//     unknown event (null quantity). Modalities other than IMAGE/TEXT stay in provider_metadata, not in a priced row;
//   - provider work Content Studio cannot prove (network failure, timeout, HTTP error status, unreadable body) writes no
//     row: there is no provider response to read. The Attempt keeps its `failure_details.outcome_unknown`;
//   - funding is the truthful execution mode (`user_byok`): provider usage is NOT Content Studio spend;
//   - recording is best-effort like the other recorders (one retry of the LEDGER write, class-only logs, never throws,
//     never calls the provider) and its outcome is classified and persisted on the Attempt (`result_metadata`) so a failed
//     ledger write is visible and reconcilable, never silently treated as accounted.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import type { GeminiModalityTokens, GeminiUsage } from '@/lib/providers/gemini/usage'
import { InvalidUsageEventError, recordProviderUsageEvents, type ProviderUsageEventInput } from './provider-usage-recorder'

export const GEMINI_IMAGE_USAGE_OPERATION = 'image_generation'
export const GEMINI_IMAGE_USAGE_RESOURCE_TYPE = 'image_generation_attempt'

export type GeminiImageUsageKeyCategory =
  | 'input_tokens'
  | 'image_output_tokens'
  | 'text_output_tokens'
  | 'output_unattributed_tokens'
  | 'thoughts_tokens'
  | 'unknown'

export const geminiImageUsageKey = (attemptId: string, category: GeminiImageUsageKeyCategory) => `gemini_image:${attemptId}:${category}`

export type GeminiImageUsageContext = {
  userId: string
  /** The canonical image Attempt: the one accounting identity of this execution. */
  attemptId: string
  projectId: string | null
  productionId: string | null
  /** Internal selector alias (e.g. gemini-nb-2.1). */
  modelAlias: string
  /** Official Google model id: the key pricing will be looked up by. */
  providerModel: string
  aspectRatio: string
  imageSize: string
  /** `ProviderExecutionResult.executionMode` of the credential that paid for the call. */
  funding: string
  credentialSource: string
  /** `received` = a usable image came back; `received_rejected` = Google answered but no image could be kept. */
  providerResponse: 'received' | 'received_rejected'
  /** The typed reason when `received_rejected` (content_blocked, no_image, invalid_image...). */
  rejectedAs?: string | null
  responseId?: string | null
  modelVersion?: string | null
}

export type GeminiImageUsageCompleteness = 'reported' | 'partial' | 'unknown'
export type GeminiImageOutputAttribution = 'by_modality' | 'by_modality_incomplete' | 'unattributed' | 'none'

const sumModality = (details: GeminiModalityTokens[], modality: GeminiModalityTokens['modality']) =>
  details.filter((d) => d.modality === modality).reduce((total, d) => total + d.tokens, 0)

const sumCandidateModalities = (usage: GeminiUsage) => usage.candidateModalityTokens === undefined
  ? usage.candidatesTokensDetails.reduce((total, d) => total + d.tokens, 0)
  : usage.candidateModalityTokens

/** How much of the usage Google actually reported (informational; the rows are the truth). */
export function describeGeminiImageUsage(usage: GeminiUsage | null): { completeness: GeminiImageUsageCompleteness; attribution: GeminiImageOutputAttribution } {
  if (!usage) return { completeness: 'unknown', attribution: 'none' }
  const details = usage.candidatesTokensDetails
  const hasOutput = usage.candidatesTokens !== null || details.length > 0
  let attribution: GeminiImageOutputAttribution = 'none'
  if (details.length) {
    const attributed = sumCandidateModalities(usage)
    attribution = usage.candidatesTokens !== null && attributed !== usage.candidatesTokens ? 'by_modality_incomplete' : 'by_modality'
  } else if (usage.candidatesTokens !== null) {
    attribution = 'unattributed'
  }
  const imageOutputKnown = sumModality(details, 'IMAGE') > 0
  return { completeness: usage.promptTokens !== null && hasOutput && (imageOutputKnown || attribution === 'unattributed') ? 'reported' : 'partial', attribution }
}

function usageDescriptors(usage: GeminiUsage | null): Record<string, unknown> {
  if (!usage) return {}
  const detail: Record<string, unknown> = {}
  // Internal numeric evidence preserves counts for unrecognized modalities (and null overflow), without copying their strings.
  detail.candidateModalityTokens = sumCandidateModalities(usage)
  if (usage.cachedContentTokens !== null) detail.cachedContentTokenCount = usage.cachedContentTokens
  if (usage.toolUsePromptTokens !== null) detail.toolUsePromptTokenCount = usage.toolUsePromptTokens
  if (usage.totalTokens !== null) detail.totalTokenCount = usage.totalTokens
  if (usage.thoughtsTokens !== null) detail.thoughtsTokenCount = usage.thoughtsTokens
  if (usage.candidatesTokens !== null) detail.candidatesTokenCount = usage.candidatesTokens
  if (usage.serviceTier) detail.serviceTier = usage.serviceTier
  if (usage.promptTokensDetails.length) detail.promptTokensDetails = usage.promptTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens }))
  if (usage.candidatesTokensDetails.length) detail.candidatesTokensDetails = usage.candidatesTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens }))
  return Object.keys(detail).length ? { usage: detail } : {}
}

/** The ledger events for ONE Gemini image execution. Pure. */
export function geminiImageUsageEvents(context: GeminiImageUsageContext, usage: GeminiUsage | null): ProviderUsageEventInput[] {
  const { completeness, attribution } = describeGeminiImageUsage(usage)
  const base = {
    userId: context.userId,
    projectId: context.projectId,
    productionId: context.productionId,
    provider: 'gemini',
    transport: 'rest',
    operation: GEMINI_IMAGE_USAGE_OPERATION,
    // The official id: pricing is looked up by it. The internal alias travels in provider_metadata.
    model: context.providerModel,
    resourceType: GEMINI_IMAGE_USAGE_RESOURCE_TYPE,
    resourceId: context.attemptId,
    providerTaskId: context.responseId ?? null,
  }
  const metadata: Record<string, unknown> = {
    api: 'gemini_generate_content',
    funding: context.funding,
    credential_source: context.credentialSource,
    provider_response: context.providerResponse,
    ...(context.rejectedAs ? { rejected_as: context.rejectedAs } : {}),
    image_generation: {
      attempt_id: context.attemptId,
      model_alias: context.modelAlias,
      provider_model: context.providerModel,
      ...(context.modelVersion ? { model_version: context.modelVersion } : {}),
      aspect_ratio: context.aspectRatio,
      image_size: context.imageSize,
      response_modalities: ['IMAGE'],
      usage_completeness: completeness,
      output_attribution: attribution,
    },
    ...usageDescriptors(usage),
  }
  const row = (category: GeminiImageUsageKeyCategory, unit: 'input_tokens' | 'output_tokens' | 'tokens', quantity: number, usageCategory?: string): ProviderUsageEventInput => ({
    ...base,
    measurement: { quantity, unit, source: 'provider_reported' },
    providerMetadata: usageCategory ? { ...metadata, usage_category: usageCategory } : metadata,
    idempotencyKey: geminiImageUsageKey(context.attemptId, category),
  })

  const events: ProviderUsageEventInput[] = []
  if (usage?.promptTokens != null) events.push(row('input_tokens', 'input_tokens', usage.promptTokens))

  const details = usage?.candidatesTokensDetails ?? []
  if (details.length) {
    const image = sumModality(details, 'IMAGE')
    const text = sumModality(details, 'TEXT')
    // IMAGE output tokens are their own dimension: never the plain output_tokens unit (that is priced as text output).
    if (Number.isSafeInteger(image) && image > 0) events.push(row('image_output_tokens', 'tokens', image, 'image_output'))
    if (Number.isSafeInteger(text) && text > 0) events.push(row('text_output_tokens', 'output_tokens', text))
  }
  if (usage?.candidatesTokens != null) {
    const attributed = sumCandidateModalities(usage)
    // Thoughts are reported separately and are NEVER subtracted from candidates. Missing totals and inconsistent
    // (over-attributed / unsafe) counts cannot prove a positive remainder: preserve reported rows, invent nothing.
    if (attributed !== null && Number.isSafeInteger(attributed) && usage.candidatesTokens > attributed) {
      events.push(row('output_unattributed_tokens', 'tokens', usage.candidatesTokens - attributed, 'output_unattributed'))
    }
  }
  // Thinking tokens are billed as output but reported separately; kept separate. A reported 0 adds no row.
  if (usage?.thoughtsTokens != null && usage.thoughtsTokens > 0) events.push(row('thoughts_tokens', 'tokens', usage.thoughtsTokens, 'thoughts'))

  if (!events.length) {
    events.push({ ...base, measurement: null, providerMetadata: metadata, idempotencyKey: geminiImageUsageKey(context.attemptId, 'unknown') })
  }
  return events
}

export type GeminiImageUsageAccounting = {
  /** `recorded` = the ledger holds the rows. `ledger_failed` = the store rejected the write twice. `ledger_rejected` = the event was malformed. */
  ledger: 'recorded' | 'ledger_failed' | 'ledger_rejected'
  rows: number
  /** True when the rows are a single unknown-usage event (Google reported nothing usable). */
  usageUnknown: boolean
  completeness: GeminiImageUsageCompleteness
}

/**
 * Appends the rows in ONE statement (all or nothing; duplicates ignored via the unique idempotency key). Never throws.
 */
export async function recordGeminiImageUsage(context: GeminiImageUsageContext, usage: GeminiUsage | null, db?: SupabaseClient): Promise<GeminiImageUsageAccounting> {
  const events = geminiImageUsageEvents(context, usage)
  const usageUnknown = events.length === 1 && events[0].measurement == null
  const { completeness } = describeGeminiImageUsage(usage)
  const outcome = (ledger: GeminiImageUsageAccounting['ledger']): GeminiImageUsageAccounting => ({ ledger, rows: events.length, usageUnknown, completeness })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await recordProviderUsageEvents(db ?? createServiceRoleSupabase(), events)
      return outcome('recorded')
    } catch (error) {
      if (error instanceof InvalidUsageEventError) {
        console.error('[gemini-image-usage] rejected usage event:', error.name)
        return outcome('ledger_rejected')
      }
      // otherwise fall through to the single retry of the LEDGER write
    }
  }
  console.error('[gemini-image-usage] usage ledger write failed', { attemptId: context.attemptId })
  return outcome('ledger_failed')
}

/**
 * Persists how the usage of this execution was accounted on the Attempt (`result_metadata`, a lifecycle column the
 * immutability guard does not freeze). When the ledger did NOT take the rows, the normalized numbers Google reported are
 * kept here so the gap is visible and reconcilable without calling the provider again. Best-effort: never throws.
 */
export async function markGeminiImageAttemptAccounting(
  context: GeminiImageUsageContext,
  accounting: GeminiImageUsageAccounting,
  usage: GeminiUsage | null,
  db?: SupabaseClient,
): Promise<boolean> {
  const { attribution } = describeGeminiImageUsage(usage)
  const resultMetadata = {
    provider_response: {
      state: context.providerResponse,
      ...(context.rejectedAs ? { rejected_as: context.rejectedAs } : {}),
      response_id: context.responseId ?? null,
      provider_model: context.providerModel,
      model_alias: context.modelAlias,
    },
    usage_accounting: {
      ledger: accounting.ledger,
      rows: accounting.rows,
      usage: accounting.usageUnknown ? 'unknown' : accounting.completeness,
      output_attribution: attribution,
      ...(accounting.ledger !== 'recorded' && usage ? { reported_usage: usageDescriptorsForSnapshot(usage) } : {}),
    },
  }
  try {
    const { error } = await (db ?? createServiceRoleSupabase())
      .from('image_generation_attempts')
      .update({ result_metadata: resultMetadata })
      .eq('id', context.attemptId)
      .eq('user_id', context.userId)
    if (error) throw new Error('attempt accounting write failed')
    return true
  } catch {
    console.error('[gemini-image-usage] attempt accounting mark failed', { attemptId: context.attemptId })
    return false
  }
}

function usageDescriptorsForSnapshot(usage: GeminiUsage) {
  return {
    promptTokens: usage.promptTokens,
    cachedContentTokens: usage.cachedContentTokens,
    candidatesTokens: usage.candidatesTokens,
    candidateModalityTokens: sumCandidateModalities(usage),
    thoughtsTokens: usage.thoughtsTokens,
    toolUsePromptTokens: usage.toolUsePromptTokens,
    totalTokens: usage.totalTokens,
    serviceTier: usage.serviceTier,
    promptTokensDetails: usage.promptTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens })),
    candidatesTokensDetails: usage.candidatesTokensDetails.map((d) => ({ modality: d.modality, tokenCount: d.tokens })),
  }
}

/** Records the ledger rows, then marks the Attempt. Never throws; returns the classified ledger outcome. */
export async function accountGeminiImageUsage(context: GeminiImageUsageContext, usage: GeminiUsage | null, db?: SupabaseClient): Promise<GeminiImageUsageAccounting> {
  const accounting = await recordGeminiImageUsage(context, usage, db)
  await markGeminiImageAttemptAccounting(context, accounting, usage, db)
  return accounting
}
