// Images edits usage is a separate contract from Chat Completions. No prices or token estimates here.
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { recordProviderUsageEvents, type ProviderUsageEventInput } from './provider-usage-recorder'

export type OpenAIImageUsageContext = {
  userId: string; attemptId: string; projectId: string | null; productionId: string | null;
  model: string; size: string; quality: string; funding: string; credentialSource: string;
  inputReferences: unknown[]; providerResponse: 'received' | 'received_rejected';
  rejectedAs?: string | null; responseId?: string | null;
}

const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function extractOpenAIImageUsage(raw: unknown) {
  const usage = object(raw)
  const input = object(usage.input_tokens_details)
  const output = object(usage.output_tokens_details)
  const normalized = {
    inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens), totalTokens: count(usage.total_tokens),
    inputTextTokens: count(input.text_tokens), inputImageTokens: count(input.image_tokens),
    outputTextTokens: count(output.text_tokens), outputImageTokens: count(output.image_tokens),
  }
  return Object.values(normalized).some((value) => value !== null) ? normalized : null
}

export function buildOpenAIImageUsageEvents(context: OpenAIImageUsageContext, raw: unknown): ProviderUsageEventInput[] {
  const usage = extractOpenAIImageUsage(raw)
  const base = {
    userId: context.userId, projectId: context.projectId, productionId: context.productionId,
    provider: 'openai', transport: 'rest', operation: 'image_generation', model: context.model,
    resourceType: 'image_generation_attempt', resourceId: context.attemptId, providerTaskId: context.responseId ?? null,
  }
  const providerMetadata = {
    api: 'openai_images_edits', funding: context.funding, credential_source: context.credentialSource,
    provider_response: context.providerResponse, ...(context.rejectedAs ? { rejected_as: context.rejectedAs } : {}),
    image_generation: { attempt_id: context.attemptId, operation: 'image_to_image', size: context.size, quality: context.quality },
    // The total already includes image input tokens. Details are evidence, never extra rows added to that total.
    usage,
  }
  const events: ProviderUsageEventInput[] = []
  if (usage?.inputTokens !== null && usage?.inputTokens !== undefined) events.push({
    ...base, measurement: { quantity: usage.inputTokens, unit: 'input_tokens', source: 'provider_reported' },
    providerMetadata, idempotencyKey: `openai_image_edit:${context.attemptId}:input_tokens`,
  })
  if (usage?.outputTokens !== null && usage?.outputTokens !== undefined) events.push({
    ...base, measurement: { quantity: usage.outputTokens, unit: 'output_tokens', source: 'provider_reported' },
    providerMetadata, idempotencyKey: `openai_image_edit:${context.attemptId}:output_tokens`,
  })
  // A detail without a reported aggregate remains evidence; never synthesize a total or a zero.
  if (!events.length) events.push({ ...base, measurement: null, providerMetadata, idempotencyKey: `openai_image_edit:${context.attemptId}:unknown` })
  return events
}

export async function accountOpenAIImageEditUsage(context: OpenAIImageUsageContext, raw: unknown) {
  let db: ReturnType<typeof createServiceRoleSupabase>
  try { db = createServiceRoleSupabase() } catch {
    console.error('[openai-image-usage] ledger unavailable', { attemptId: context.attemptId })
    return
  }
  const usage = extractOpenAIImageUsage(raw)
  const events = buildOpenAIImageUsageEvents(context, raw)
  let recorded = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await recordProviderUsageEvents(db, events); recorded = true; break } catch { /* Retry only the ledger write, never the provider. */ }
  }
  if (!recorded) console.error('[openai-image-usage] usage ledger write failed', { attemptId: context.attemptId })
  const completeness = usage?.inputTokens != null && usage?.outputTokens != null ? 'reported' : usage ? 'partial' : 'unknown'
  try {
    const { error } = await db.from('image_generation_attempts').update({ result_metadata: {
      operation: 'image_to_image', inputReferences: context.inputReferences,
      provider_response: { state: context.providerResponse, response_id: context.responseId ?? null, model: context.model,
        ...(context.rejectedAs ? { rejected_as: context.rejectedAs } : {}) },
      usage_accounting: { ledger: recorded ? 'recorded' : 'ledger_failed', rows: events.length, usage: completeness,
        // Keep the normalized facts even on successful recording; detailed image/text inputs are not separate charges.
        reported_usage: usage },
    } }).eq('id', context.attemptId).eq('user_id', context.userId)
    if (error) throw new Error('Accounting metadata unavailable')
  } catch { console.error('[openai-image-usage] attempt accounting mark failed', { attemptId: context.attemptId }) }
}
