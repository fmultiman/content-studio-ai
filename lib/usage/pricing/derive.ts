// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — the ONE derivation of an estimated cost. Pure.
//
//   deriveProviderUsageCost(event, versions)  =  factual provider usage  x  the pricing version that was
//                                                 effective when the execution occurred
//
// Hard rules (each asserted by tests):
//   - usage is never changed: this only READS an event. Provider-reported quantities stay the truth;
//     the result is an ESTIMATED LIST-PRICE EQUIVALENT, never "what the provider charged";
//   - UNKNOWN IS NOT FREE: every case that cannot be priced returns `unavailable` or `ambiguous` with a
//     reason and NO amount. A zero amount is only ever returned for a measured zero quantity;
//   - the price is looked up at the event's `occurred_at` (half-open windows). A later price never reprices
//     an earlier execution, and a missing version is "unavailable", not a nearest-neighbour guess;
//   - a service tier is only used when the event proves it (Gemini `usageMetadata.serviceTier`) or the
//     provider has exactly one tier (Kling). A missing tier on a multi-tier provider is `ambiguous`;
//   - one canonical billable reading per ledger row: Gemini's `totalTokenCount` is never priced, thinking
//     tokens are priced once (as output, as Google's price table says) and cached tokens - a SUBSET of the
//     prompt tokens - are split out of the input line, never added on top of it;
//   - BYOK (`funding: user_byok`) is context, not a price: it is never treated as zero cost, and the user's
//     real invoice (free tier, negotiated, batch...) may differ from the list-price equivalent.

import { fixedToString, multiplyDivide, parseFixed, type Fixed } from './decimal'
import {
  findPricingVersion,
  hasAnyPricingFor,
  type EffectiveFromBasis,
  type PricingCategory,
  type PricingVersion,
} from './registry'

/** What the deriver needs from a ledger row. Built server-side from the row + whitelisted provider_metadata facts. */
export interface ProviderUsageCostInput {
  provider: string
  transport: string
  operation: string
  model: string | null
  /** Provider-native quantity; null = usage unknown. */
  quantity: number | string | null
  unit: string | null
  measurementSource: string
  occurredAt: string
  /** `thoughts` = Gemini thinking tokens. */
  usageCategory?: string | null
  funding?: string | null
  /** Service tier the provider REPORTED for this execution (Gemini `usageMetadata.serviceTier`). */
  serviceTier?: string | null
  /** Gemini `cachedContentTokenCount`: the cached SUBSET of the prompt tokens. */
  cachedInputTokens?: number | null
  /** Gemini `toolUsePromptTokenCount`: billed as input but recorded in no ledger row. */
  toolUsePromptTokens?: number | null
}

export const COST_UNAVAILABLE_REASONS = [
  'usage_unknown',
  'invalid_usage',
  'invalid_timestamp',
  'measurement_not_provider_reported',
  'provider_not_supported',
  'unit_not_priceable',
  // FUTURE-064 Slice D: Gemini output tokens reported WITHOUT a modality breakdown. Never assumed to be image (or text) tokens.
  'output_modality_unattributed',
  'model_unknown',
  'no_pricing_for_model',
  'no_pricing_for_category',
  'pricing_not_effective_at_execution',
  'inconsistent_usage',
  'mixed_currency',
  'pricing_registry_unavailable',
] as const
export type CostUnavailableReason = (typeof COST_UNAVAILABLE_REASONS)[number]

export const COST_AMBIGUOUS_REASONS = ['service_tier_not_proven', 'overlapping_pricing_versions', 'tool_use_tokens_not_priced'] as const
export type CostAmbiguousReason = (typeof COST_AMBIGUOUS_REASONS)[number]

/** Facts that qualify an estimate. The UI maps each code to product language. */
export const COST_ASSUMPTIONS = [
  'list_price_equivalent',
  'paid_tier_list_price',
  'byok_invoice_may_differ',
  'cached_tokens_priced_separately',
  'price_observed_at_source',
  // FUTURE-064 Slice D: the response reported no service tier and the registry prices exactly one (Standard) for this model.
  'service_tier_sole_registry_tier',
] as const
export type CostAssumption = (typeof COST_ASSUMPTIONS)[number]

export interface CostComponent {
  category: PricingCategory
  quantity: string
  amount: string
  pricingVersionId: string
}

export interface CostPricingReference {
  versionIds: string[]
  sourceUrl: string
  sourceLabel: string
  retrievedAt: string
  /** ISO instant the applied price became effective. */
  effectiveFrom: string
  effectiveFromBasis: EffectiveFromBasis
}

export type ProviderUsageCost =
  | {
      status: 'estimated'
      /** Canonical decimal string at 12 fractional digits max (e.g. "0.0042"). Never a float. */
      amount: string
      currency: string
      basis: 'list_price_equivalent'
      /** Proven by the provider's own response, or the provider's only tier - never inferred. */
      serviceTier: string
      pricing: CostPricingReference
      components: CostComponent[]
      assumptions: CostAssumption[]
    }
  | { status: 'unavailable'; reason: CostUnavailableReason }
  | { status: 'ambiguous'; reason: CostAmbiguousReason }

const unavailable = (reason: CostUnavailableReason): ProviderUsageCost => ({ status: 'unavailable', reason })
const ambiguous = (reason: CostAmbiguousReason): ProviderUsageCost => ({ status: 'ambiguous', reason })

// ---------------------------------------------------------------------------
// Provider billing adapters: how a ledger row maps onto the provider's billable categories.
// Only providers with real, evidenced usage semantics appear here. Nano Banana writes no ledger rows.
// ---------------------------------------------------------------------------

interface BillableLine {
  category: PricingCategory
  quantity: Fixed
}

type BillingPlan =
  | { ok: true; lines: BillableLine[]; tier: string | null; paidTierListPrice: boolean }
  | { ok: false; result: ProviderUsageCost }

const GEMINI_TIERS: readonly string[] = ['standard', 'flex', 'priority']

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function planGemini(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  const tier = typeof input.serviceTier === 'string' && GEMINI_TIERS.includes(input.serviceTier) ? input.serviceTier : null
  let lines: BillableLine[]
  if (input.unit === 'input_tokens') {
    const toolUse = countOrNull(input.toolUsePromptTokens)
    // Tool-use prompt tokens are billed as input but sit in no ledger row: pricing only the row would under-count.
    if (toolUse !== null && toolUse > 0) return { ok: false, result: ambiguous('tool_use_tokens_not_priced') }
    const cached = countOrNull(input.cachedInputTokens)
    if (cached !== null && cached > 0) {
      const cachedFixed = parseFixed(cached)!
      if (cachedFixed > quantity) return { ok: false, result: unavailable('inconsistent_usage') }
      // promptTokenCount INCLUDES the cached content: price the remainder as input and the subset as cached input.
      lines = [
        { category: 'input', quantity: quantity - cachedFixed },
        { category: 'cached_input', quantity: cachedFixed },
      ]
    } else {
      lines = [{ category: 'input', quantity }]
    }
  } else if (input.unit === 'output_tokens') {
    lines = [{ category: 'output', quantity }]
  } else if (input.unit === 'tokens' && input.usageCategory === 'thoughts') {
    // Google's table is "Output (including thinking tokens)": one rate. Thinking tokens are priced once, as output.
    lines = [{ category: 'output', quantity }]
  } else if (input.unit === 'tokens' && input.usageCategory === 'image_output') {
    // FUTURE-064 Slice D: IMAGE-modality output tokens are priced ONLY with the image_output version, never with the text/thinking
    // output rate. With no image_output version in the registry this resolves to `no_pricing_for_category`, not to a text price.
    lines = [{ category: 'image_output', quantity }]
  } else if (input.unit === 'tokens' && input.usageCategory === 'output_unattributed') {
    // Approved decision: output the provider did not attribute to a modality stays UNPRICED, even for an image-only request.
    return { ok: false, result: unavailable('output_modality_unattributed') }
  } else {
    return { ok: false, result: unavailable('unit_not_priceable') }
  }
  return { ok: true, lines, tier, paidTierListPrice: true }
}

// OpenAI Chat Completions (Prompt Assistance). `prompt_tokens` INCLUDES the cached subset (split out exactly like
// Gemini); `completion_tokens` already contains any reasoning tokens, and no thinking row is ever written for OpenAI.
// The service tier is proven ONLY by the response's own `service_tier`: "default" is OpenAI's Standard processing;
// flex/priority/scale have no seeded price (so they are unavailable) and an absent tier is ambiguous - never assumed.
const OPENAI_TIER_BY_REPORTED: Record<string, string> = { default: 'standard' }

function planOpenAi(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  // Images edits mix text/image input rates and image output rates. The existing Chat price categories
  // cannot represent that split, so never apply text rates to these quantities, even if a text rate is present.
  if (input.operation === 'image_generation') return { ok: false, result: unavailable('unit_not_priceable') }
  const reported = typeof input.serviceTier === 'string' ? input.serviceTier : null
  const tier = reported === null ? null : (OPENAI_TIER_BY_REPORTED[reported] ?? reported)
  let lines: BillableLine[]
  if (input.unit === 'input_tokens') {
    const cached = countOrNull(input.cachedInputTokens)
    if (cached !== null && cached > 0) {
      const cachedFixed = parseFixed(cached)!
      if (cachedFixed > quantity) return { ok: false, result: unavailable('inconsistent_usage') }
      lines = [
        { category: 'input', quantity: quantity - cachedFixed },
        { category: 'cached_input', quantity: cachedFixed },
      ]
    } else {
      lines = [{ category: 'input', quantity }]
    }
  } else if (input.unit === 'output_tokens') {
    lines = [{ category: 'output', quantity }]
  } else {
    return { ok: false, result: unavailable('unit_not_priceable') }
  }
  return { ok: true, lines, tier, paidTierListPrice: false }
}

function planKling(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  // Only API "units" have a published USD mapping. MCP "credits" (a consumer-plan currency) have none.
  if (input.unit !== 'units') return { ok: false, result: unavailable('unit_not_priceable') }
  return { ok: true, lines: [{ category: 'unit', quantity }], tier: 'standard', paidTierListPrice: false }
}

// FUTURE-064 Slice D — service-tier fallback for Gemini IMAGE generation rows.
//
// A provider-REPORTED tier always wins (and a reported non-Standard tier never receives Standard rates). Only when the response
// reported NO tier at all, Standard is taken when — and only while — the registry prices exactly one tier for the model and that
// tier is Standard: the real-time generateContent path Content Studio uses never requests another tier, and Google lists no other
// tier for these models. The moment a second tier exists for the model, this returns null and the row is ambiguous again.
function soleStandardTier(input: ProviderUsageCostInput, versions: readonly PricingVersion[]): string | null {
  if (input.provider !== 'gemini' || input.operation !== 'image_generation' || !input.model) return null
  if (typeof input.serviceTier === 'string' && input.serviceTier.length > 0) return null // reported (even if unrecognized): never replaced
  const tiers = new Set(versions.filter((v) => v.provider === input.provider && v.model === input.model).map((v) => v.serviceTier))
  return tiers.size === 1 && tiers.has('standard') ? 'standard' : null
}

const ADAPTERS: Record<string, (input: ProviderUsageCostInput, quantity: Fixed) => BillingPlan> = {
  gemini: planGemini,
  openai: planOpenAi,
  kling: planKling,
}

// ---------------------------------------------------------------------------

export function deriveProviderUsageCost(input: ProviderUsageCostInput, versions: readonly PricingVersion[]): ProviderUsageCost {
  if (input.quantity === null || input.unit === null) return unavailable('usage_unknown')
  if (input.measurementSource !== 'provider_reported') return unavailable('measurement_not_provider_reported')
  const adapter = ADAPTERS[input.provider]
  if (!adapter) return unavailable('provider_not_supported')
  if (!input.model) return unavailable('model_unknown')
  const at = Date.parse(input.occurredAt)
  if (Number.isNaN(at)) return unavailable('invalid_timestamp')
  const quantity = parseFixed(input.quantity)
  if (quantity === null) return unavailable('invalid_usage')

  const plan = adapter(input, quantity)
  if (!plan.ok) return plan.result
  if (!hasAnyPricingFor(versions, input.provider, input.model)) return unavailable('no_pricing_for_model')
  let tier = plan.tier
  let soleTierAssumed = false
  if (tier === null) {
    tier = soleStandardTier(input, versions)
    if (tier === null) return ambiguous('service_tier_not_proven')
    soleTierAssumed = true
  }

  const components: CostComponent[] = []
  const used: PricingVersion[] = []
  let total: Fixed = BigInt(0)
  for (const line of plan.lines) {
    const lookup = findPricingVersion(versions, { provider: input.provider, model: input.model, usageCategory: line.category, serviceTier: tier }, at)
    if (lookup.status === 'overlap') return ambiguous('overlapping_pricing_versions')
    if (lookup.status === 'no_match') return unavailable('no_pricing_for_category')
    if (lookup.status === 'not_effective') return unavailable('pricing_not_effective_at_execution')
    const version = lookup.version
    const amount = multiplyDivide(line.quantity, version.priceAmount, version.unitQuantity)
    total += amount
    used.push(version)
    components.push({ category: line.category, quantity: fixedToString(line.quantity), amount: fixedToString(amount), pricingVersionId: version.id })
  }
  if (new Set(used.map((v) => v.currency)).size !== 1) return unavailable('mixed_currency')

  const reference = used.reduce((latest, v) => (v.effectiveFrom > latest.effectiveFrom ? v : latest))
  const assumptions: CostAssumption[] = ['list_price_equivalent']
  if (plan.paidTierListPrice) assumptions.push('paid_tier_list_price')
  if (components.length > 1) assumptions.push('cached_tokens_priced_separately')
  if (used.some((v) => v.effectiveFromBasis !== 'official_effective_date')) assumptions.push('price_observed_at_source')
  if (soleTierAssumed) assumptions.push('service_tier_sole_registry_tier')
  if (input.funding === 'user_byok') assumptions.push('byok_invoice_may_differ')

  return {
    status: 'estimated',
    amount: fixedToString(total),
    currency: used[0].currency,
    basis: 'list_price_equivalent',
    serviceTier: tier,
    pricing: {
      versionIds: used.map((v) => v.id),
      sourceUrl: reference.sourceUrl,
      sourceLabel: reference.sourceLabel,
      retrievedAt: reference.retrievedAt,
      effectiveFrom: new Date(reference.effectiveFrom).toISOString(),
      effectiveFromBasis: reference.effectiveFromBasis,
    },
    components,
    assumptions,
  }
}

// ---------------------------------------------------------------------------
// Ledger row -> deriver input (server side; reads only the closed set of provider_metadata facts it needs).
// ---------------------------------------------------------------------------

export function costInputFromRow(row: Record<string, any>): ProviderUsageCostInput {
  const metadata = row.provider_metadata && typeof row.provider_metadata === 'object' ? row.provider_metadata : {}
  const usage = metadata.usage && typeof metadata.usage === 'object' ? metadata.usage : {}
  return {
    provider: row.provider,
    transport: row.transport,
    operation: row.operation,
    model: row.model ?? null,
    // NUMERIC may arrive as a string; NULL stays NULL (unknown is not zero).
    quantity: row.quantity === null || row.quantity === undefined ? null : row.quantity,
    unit: row.unit ?? null,
    measurementSource: row.measurement_source,
    occurredAt: row.occurred_at,
    usageCategory: typeof metadata.usage_category === 'string' ? metadata.usage_category : null,
    funding: typeof metadata.funding === 'string' ? metadata.funding : null,
    serviceTier: typeof usage.serviceTier === 'string' ? usage.serviceTier : null,
    cachedInputTokens: countOrNull(usage.cachedContentTokenCount),
    toolUsePromptTokens: countOrNull(usage.toolUsePromptTokenCount),
  }
}
