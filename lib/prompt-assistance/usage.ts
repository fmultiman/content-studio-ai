import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { recordProviderUsageEvent } from '@/lib/usage/provider-usage-recorder'
import type { UsageMeasurement } from '@/lib/usage/provider-usage'
import type { PromptAssistanceUsage } from './contract'

// Server-only. the provider usage ledger has no user INSERT policy, so the authenticated route hands this module the
// verified user id and it writes with the service-role client. Only numeric provider-reported facts and
// capability metadata are stored — never prompt, Identity or provider-response text.
function usageMeasurement(quantity: number | null, unit: 'input_tokens' | 'output_tokens'): UsageMeasurement | null {
  return quantity === null ? null : { quantity, unit, source: 'provider_reported' }
}

export async function recordPromptAssistanceUsage(input: {
  userId: string
  projectId: string | null
  productionId: string | null
  provider: string
  model: string
  operation: string
  usage: PromptAssistanceUsage | null
}) {
  const invocation = input.usage?.providerRequestId ?? crypto.randomUUID()
  const common = {
    userId: input.userId,
    projectId: input.projectId,
    productionId: input.productionId,
    provider: input.provider,
    transport: 'api',
    operation: input.operation,
    model: input.model,
    resourceType: 'prompt_assistance',
    providerTaskId: input.usage?.providerRequestId ?? null,
    providerMetadata: { media_type: 'image', operation: input.operation },
  }
  const events = [
    { quantity: input.usage?.inputTokens ?? null, unit: 'input_tokens' as const, suffix: 'input' },
    { quantity: input.usage?.outputTokens ?? null, unit: 'output_tokens' as const, suffix: 'output' },
  ].filter((entry) => entry.quantity !== null)

  try {
    const db = createServiceRoleSupabase()
    if (events.length === 0) {
      await recordProviderUsageEvent(db, {
        ...common,
        measurement: null,
        idempotencyKey: `prompt_assistance:${invocation}:unknown`,
      })
      return
    }
    for (const event of events) {
      await recordProviderUsageEvent(db, {
        ...common,
        measurement: usageMeasurement(event.quantity, event.unit),
        idempotencyKey: `prompt_assistance:${invocation}:${event.suffix}`,
      })
    }
  } catch (error) {
    console.error('[prompt-assistance] usage ledger write failed:', error instanceof Error ? error.name : 'unknown')
  }
}
