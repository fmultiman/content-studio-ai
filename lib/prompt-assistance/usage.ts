import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { InvalidUsageEventError, recordProviderUsageEvents, type ProviderUsageEventInput } from '@/lib/usage/provider-usage-recorder'
import type { PromptAssistanceUsage, PromptAssistanceWorkflow } from './contract'

// Server-only. The provider usage ledger has no user INSERT policy, so the authenticated route hands this module the
// verified user id and it writes with the service-role client. Only numeric provider-reported facts and
// capability metadata are stored — never prompt, Identity or provider-response text.
//
// Event-cardinality contract (FUTURE-054, same model as the Gemini Review integration):
//   - ONE provider execution = ONE logical set of rows sharing one provider request id, one row per provider-native
//     billable dimension: input_tokens, output_tokens and — Gemini only, when the provider reported a non-zero
//     number — thinking tokens (unit `tokens`, usage_category `thoughts`). Two rows per usual request, never 1:1;
//   - the dimensions are never merged: Gemini `candidatesTokenCount` excludes thoughts and `totalTokenCount` is
//     never stored as a row, so nothing is counted twice; OpenAI `completion_tokens` already contains any reasoning
//     tokens, so none is added;
//   - a response with no usable usage records ONE unknown event (null quantity): unknown is not zero;
//   - idempotency keys are `prompt_assistance:{providerRequestId}:{input|output|thoughts|unknown}` and the whole set
//     is written in ONE statement (all rows or none, duplicates ignored via the unique key);
//   - reported descriptors that decide the price (service tier, cached subset, tool-use tokens) travel in
//     provider_metadata.usage exactly as reported and only when reported — a tier is never inferred.

export type PromptAssistanceUsageContext = {
  userId: string
  projectId: string | null
  productionId: string | null
  provider: string
  model: string
  operation: string
  /** `ProviderExecutionResult.executionMode` of the credential that paid for the call. */
  funding: string
  /** Optional validated analytics label. Never read for billing, authorization or ownership. */
  workflow?: PromptAssistanceWorkflow
  usage: PromptAssistanceUsage | null
}

export const promptAssistanceUsageKey = (invocation: string, category: 'input' | 'output' | 'thoughts' | 'unknown') =>
  `prompt_assistance:${invocation}:${category}`

function descriptors(usage: PromptAssistanceUsage | null): Record<string, unknown> {
  if (!usage) return {}
  const detail: Record<string, unknown> = {}
  if (typeof usage.cachedInputTokens === 'number') detail.cachedContentTokenCount = usage.cachedInputTokens
  if (typeof usage.toolUsePromptTokens === 'number') detail.toolUsePromptTokenCount = usage.toolUsePromptTokens
  if (typeof usage.totalTokens === 'number') detail.totalTokenCount = usage.totalTokens
  if (typeof usage.serviceTier === 'string' && usage.serviceTier) detail.serviceTier = usage.serviceTier
  return Object.keys(detail).length ? { usage: detail } : {}
}

/** The ledger events for ONE Prompt Assistance provider execution. Pure. */
export function promptAssistanceUsageEvents(context: PromptAssistanceUsageContext, invocationId: string = crypto.randomUUID()): ProviderUsageEventInput[] {
  const usage = context.usage
  const invocation = usage?.providerRequestId ?? invocationId
  const base = {
    userId: context.userId,
    projectId: context.projectId,
    productionId: context.productionId,
    provider: context.provider,
    transport: 'api',
    operation: context.operation,
    model: context.model,
    resourceType: 'prompt_assistance',
    providerTaskId: usage?.providerRequestId ?? null,
  }
  const metadata = {
    media_type: 'image',
    operation: context.operation,
    api: context.provider === 'gemini' ? 'gemini_generate_content' : 'openai_chat_completions',
    funding: context.funding,
    ...(context.workflow ? { workflow: context.workflow } : {}),
    ...descriptors(usage),
  }
  const events: ProviderUsageEventInput[] = []
  if (typeof usage?.inputTokens === 'number') {
    events.push({ ...base, measurement: { quantity: usage.inputTokens, unit: 'input_tokens', source: 'provider_reported' }, providerMetadata: metadata, idempotencyKey: promptAssistanceUsageKey(invocation, 'input') })
  }
  if (typeof usage?.outputTokens === 'number') {
    events.push({ ...base, measurement: { quantity: usage.outputTokens, unit: 'output_tokens', source: 'provider_reported' }, providerMetadata: metadata, idempotencyKey: promptAssistanceUsageKey(invocation, 'output') })
  }
  // Thinking tokens are billed as output but reported separately; kept separate. A reported 0 adds no row.
  if (typeof usage?.thoughtsTokens === 'number' && usage.thoughtsTokens > 0) {
    events.push({ ...base, measurement: { quantity: usage.thoughtsTokens, unit: 'tokens', source: 'provider_reported' }, providerMetadata: { ...metadata, usage_category: 'thoughts' }, idempotencyKey: promptAssistanceUsageKey(invocation, 'thoughts') })
  }
  if (!events.length) {
    events.push({ ...base, measurement: null, providerMetadata: metadata, idempotencyKey: promptAssistanceUsageKey(invocation, 'unknown') })
  }
  return events
}

/**
 * Appends the rows in ONE statement. Best-effort like the other recorders: one retry of the LEDGER write, errors logged
 * by class only, never thrown, and it can never cause the provider to be called again.
 */
export async function recordPromptAssistanceUsage(context: PromptAssistanceUsageContext, db?: SupabaseClient): Promise<boolean> {
  const events = promptAssistanceUsageEvents(context)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await recordProviderUsageEvents(db ?? createServiceRoleSupabase(), events)
      return true
    } catch (error) {
      if (error instanceof InvalidUsageEventError) {
        console.error('[prompt-assistance] rejected usage event:', error.name)
        return false
      }
      // otherwise fall through to the single retry of the LEDGER write
    }
  }
  console.error('[prompt-assistance] usage ledger write failed')
  return false
}
