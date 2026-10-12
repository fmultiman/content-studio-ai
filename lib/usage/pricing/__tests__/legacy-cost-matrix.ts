// FUTURE-064 Slice D — the deterministic matrix of NON-image usage rows whose derived cost must never change.
//
// `legacy-cost-golden.json` was generated ONCE, by the deriver as it was BEFORE the image-pricing change (main 6a1f638), over
// the Production registry state (scripts 061 + 062). The regression test recomputes the same matrix with the current code
// and asserts every entry is identical — against the Production registry AND against the registry the reviewed image
// SQL produces — so historical OpenAI, Gemini text/Review and Kling costs provably do not move.
import type { ProviderUsageCost, ProviderUsageCostInput } from '../derive'

const MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-4o-mini', 'kling-v3', 'gemini-unknown-model']
const UNITS = ['input_tokens', 'output_tokens', 'tokens', 'units', 'credits', 'images']
const TIERS = [null, 'standard', 'flex', 'priority', 'default', 'turbo']
const CATEGORIES = [null, 'thoughts']
const OPERATIONS = ['create', 'improve', 'image_review', 'video_review', 'text_to_video']

export function legacyCostMatrix(): ProviderUsageCostInput[] {
  const rows: ProviderUsageCostInput[] = []
  for (const model of MODELS) {
    const provider = model.startsWith('gpt') ? 'openai' : model.startsWith('kling') ? 'kling' : 'gemini'
    for (const unit of UNITS)
      for (const serviceTier of TIERS)
        for (const usageCategory of CATEGORIES)
          for (const operation of OPERATIONS)
            rows.push({
              provider, transport: provider === 'kling' ? 'rest' : 'api', operation, model, quantity: 1234, unit, measurementSource: 'provider_reported',
              occurredAt: '2026-10-20T12:00:00Z', usageCategory, funding: 'user_byok', serviceTier, cachedInputTokens: 100, toolUsePromptTokens: operation === 'improve' ? 4 : null,
            })
  }
  rows.push(
    { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: null, unit: null, measurementSource: 'unknown', occurredAt: '2026-10-20T12:00:00Z' },
    { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: 5, unit: 'input_tokens', measurementSource: 'estimated', occurredAt: '2026-10-20T12:00:00Z', serviceTier: 'standard' },
    { provider: 'openai', transport: 'api', operation: 'create', model: 'gpt-4o-mini', quantity: 5, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: 'not-a-date', serviceTier: 'default' },
    // a measured ZERO is a real, priceable quantity (distinct from unknown)
    { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: 0, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: '2026-10-20T12:00:00Z', serviceTier: 'standard' },
    // executions before / after the Production price windows start (2026-10-09 / 2026-10-10)
    { provider: 'gemini', transport: 'api', operation: 'create', model: 'gemini-3.5-flash', quantity: 1000, unit: 'input_tokens', measurementSource: 'provider_reported', occurredAt: '2026-10-08T23:59:59Z', serviceTier: 'standard' },
    { provider: 'openai', transport: 'api', operation: 'create', model: 'gpt-4o-mini', quantity: 1000, unit: 'output_tokens', measurementSource: 'provider_reported', occurredAt: '2026-10-09T12:00:00Z', serviceTier: 'default' },
  )
  return rows
}

/** Stable one-line encoding of a cost: status plus the amount (estimated) or the reason (otherwise), and the tier used. */
export function encodeCost(cost: ProviderUsageCost): string {
  if (cost.status === 'estimated') return `estimated:${cost.amount}:${cost.currency}:${cost.serviceTier}:${cost.components.map((c) => `${c.category}=${c.quantity}`).join('+')}`
  return `${cost.status}:${cost.reason}`
}
