// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — the ONE derivation of an estimated cost. Pure.
//
//   deriveProviderUsageCost(event, versions)  =  factual provider usage  x  the pricing version that was
//                                                 effective when the execution occurred
//
// Hard rules (each asserted by tests):
//   - usage is never changed: this only READS an event. Provider-reported quantities stay the truth;
//     the result is an ESTIMATED LIST-PRICE EQUIVALENT, never "what the provider charged";
//   - PROVIDER_COST_ATTRIBUTION_V1: only a provider_reported quantity is priced, with ONE audited exception - Google Veo seconds,
//     which the provider never reports and Content Studio derives from the delivered request (labelled `usage_derived_from_request`);
//     every other derived / estimated / balance-delta quantity stays unpriced. For the kinds enrolled in `simulationEligible`
//     (OpenAI Images, Veo) an execution that predates the first known price is never given a period estimate: it is a clearly
//     separate `simulated` figure at the earliest known (current) price. Every other, previously approved pricing stays strict;
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
  /** OpenAI Images `usage.input_tokens_details` / `output_tokens_details`: the modality split of the aggregate this row carries. */
  inputTextTokens?: number | null
  inputImageTokens?: number | null
  outputTextTokens?: number | null
  outputImageTokens?: number | null
  /** Video: the non-secret request facts stored with the row (`provider_metadata.request`): what Google bills per second depends on them. */
  requestResolution?: string | null
  requestDurationSeconds?: number | null
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
  // PROVIDER_COST_ATTRIBUTION_V1: OpenAI image input tokens reported without a text / image split; a video row without its resolution.
  'input_modality_unattributed',
  'resolution_unknown',
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
  // PROVIDER_COST_ATTRIBUTION_V1
  /** The quantity was derived by Content Studio (Veo seconds = the requested duration of a delivered video), not measured by the provider. */
  'usage_derived_from_request',
  /** One ledger row mixes modalities billed at different rates (OpenAI GPT Image text input vs image input, image vs text output). */
  'modalities_priced_separately',
  /** Kling units are priced at the public unit price; the real price of a unit depends on the resource package the account bought. */
  'kling_package_price_unknown',
  /** The execution predates the first known price: this figure applies the EARLIEST KNOWN (current) price and is a simulation, not a period estimate. */
  'current_price_simulation',
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

interface CostBody {
  /** Canonical decimal string at 12 fractional digits max (e.g. "0.0042"). Never a float. */
  amount: string
  currency: string
  /** Proven by the provider's own response, or the provider's only tier - never inferred. */
  serviceTier: string
  pricing: CostPricingReference
  components: CostComponent[]
  assumptions: CostAssumption[]
}

export type ProviderUsageCost =
  | ({ status: 'estimated'; basis: 'list_price_equivalent' } & CostBody)
  /**
   * PROVIDER_COST_ATTRIBUTION_V1: the execution predates every known price for this key, so the amount applies the EARLIEST KNOWN
   * (current) price. It is a what-if, never a period estimate: aggregation keeps it out of the estimated totals.
   */
  | ({ status: 'simulated'; basis: 'current_list_price_simulation' } & CostBody)
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
  | { ok: true; lines: BillableLine[]; tier: string | null; paidTierListPrice: boolean; assumptions?: CostAssumption[] }
  | { ok: false; result: ProviderUsageCost }

const GEMINI_TIERS: readonly string[] = ['standard', 'flex', 'priority']

function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

// PROVIDER_COST_ATTRIBUTION_V1 — Google Veo is billed per generated SECOND of video, at a rate that depends on the model and the output
// resolution. Veo's responses carry no usage, so the ledger row holds the DERIVED duration (the delivered request's duration) and the
// resolution sits in the row's request facts. Only these resolutions have a price category; anything else is unavailable, never a guess.
const VEO_RESOLUTIONS = ['720p', '1080p', '4k'] as const

function planGeminiVideoSeconds(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  const resolution = typeof input.requestResolution === 'string' ? input.requestResolution.toLowerCase() : null
  if (!resolution || !(VEO_RESOLUTIONS as readonly string[]).includes(resolution)) return { ok: false, result: unavailable('resolution_unknown') }
  // The ledger quantity must be the requested duration the row itself records: a disagreement is inconsistent, not averaged.
  const requested = countOrNull(input.requestDurationSeconds)
  if (requested !== null && parseFixed(requested) !== quantity) return { ok: false, result: unavailable('inconsistent_usage') }
  return {
    ok: true,
    lines: [{ category: `video_second_${resolution}` as PricingCategory, quantity }],
    // Veo has ONE price per (model, resolution) for the real-time API Content Studio calls: Standard is the provider's only tier here.
    tier: 'standard',
    paidTierListPrice: true,
  }
}

function planGemini(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  if (input.unit === 'seconds') return planGeminiVideoSeconds(input, quantity)
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

// OpenAI Images (GPT Image) - PROVIDER_COST_ATTRIBUTION_V1. Two ledger rows per attempt: the aggregate `input_tokens` (which INCLUDES the
// image input tokens) and the aggregate `output_tokens`. Their parts are priced at DIFFERENT rates, so each aggregate is split with the
// modality detail the same response reported, and the split must add up to the aggregate EXACTLY (never double counted, never assumed):
//   input_tokens  = text input (`input` price) + image input (`image_input` price)
//   output_tokens = image output (`image_output` price) + text output (`output` price; GPT Image 2 publishes none, so a text-output
//                   token makes the row unavailable instead of borrowing another rate).
// Batch and cached-input prices are never used: the Images API Content Studio calls is real-time Standard and the cached rate only
// applies to the Responses API. A detail that is simply absent is only taken as zero when the other part equals the whole aggregate.
function splitAggregate(total: Fixed, a: number | null | undefined, b: number | null | undefined): [number, number] | 'unattributed' | 'inconsistent' {
  const first = countOrNull(a)
  const second = countOrNull(b)
  if (first === null && second === null) return 'unattributed'
  const firstFixed = first === null ? null : parseFixed(first)
  const secondFixed = second === null ? null : parseFixed(second)
  if (first !== null && second !== null) return firstFixed! + secondFixed! === total ? [first, second] : 'inconsistent'
  if (first !== null) return firstFixed === total ? [first, 0] : 'unattributed'
  return secondFixed === total ? [0, second!] : 'unattributed'
}

function nonZeroLines(lines: BillableLine[]): BillableLine[] {
  const present = lines.filter((line) => line.quantity > BigInt(0))
  // A measured zero stays priced (as zero) against its first rate, so the row still carries its price reference.
  return present.length > 0 ? present : lines.slice(0, 1)
}

function planOpenAiImage(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  if (input.unit === 'input_tokens') {
    const split = splitAggregate(quantity, input.inputTextTokens, input.inputImageTokens)
    if (split === 'unattributed') return { ok: false, result: unavailable('input_modality_unattributed') }
    if (split === 'inconsistent') return { ok: false, result: unavailable('inconsistent_usage') }
    return {
      ok: true,
      lines: nonZeroLines([
        { category: 'input', quantity: parseFixed(split[0])! },
        { category: 'image_input', quantity: parseFixed(split[1])! },
      ]),
      tier: null,
      paidTierListPrice: false,
    }
  }
  if (input.unit === 'output_tokens') {
    const split = splitAggregate(quantity, input.outputImageTokens, input.outputTextTokens)
    if (split === 'unattributed') return { ok: false, result: unavailable('output_modality_unattributed') }
    if (split === 'inconsistent') return { ok: false, result: unavailable('inconsistent_usage') }
    return {
      ok: true,
      lines: nonZeroLines([
        { category: 'image_output', quantity: parseFixed(split[0])! },
        { category: 'output', quantity: parseFixed(split[1])! },
      ]),
      tier: null,
      paidTierListPrice: false,
    }
  }
  return { ok: false, result: unavailable('unit_not_priceable') }
}

function planOpenAi(input: ProviderUsageCostInput, quantity: Fixed): BillingPlan {
  if (input.operation === 'image_generation') return planOpenAiImage(input, quantity)
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
  return { ok: true, lines: [{ category: 'unit', quantity }], tier: 'standard', paidTierListPrice: false, assumptions: ['kling_package_price_unknown'] }
}

// FUTURE-064 Slice D — service-tier fallback for Gemini IMAGE generation rows.
//
// A provider-REPORTED tier always wins (and a reported non-Standard tier never receives Standard rates). Only when the response
// reported NO tier at all, Standard is taken when — and only while — the registry prices exactly one tier for the model and that
// tier is Standard: the real-time generateContent path Content Studio uses never requests another tier, and Google lists no other
// tier for these models. The moment a second tier exists for the model, this returns null and the row is ambiguous again.
function soleStandardTier(input: ProviderUsageCostInput, versions: readonly PricingVersion[]): string | null {
  // OpenAI Images responses never carry a tier either; Content Studio only calls the real-time (Standard) Images API (Batch is a different API).
  if ((input.provider !== 'gemini' && input.provider !== 'openai') || input.operation !== 'image_generation' || !input.model) return null
  if (typeof input.serviceTier === 'string' && input.serviceTier.length > 0) return null // reported (even if unrecognized): never replaced
  const tiers = new Set(versions.filter((v) => v.provider === input.provider && v.model === input.model).map((v) => v.serviceTier))
  return tiers.size === 1 && tiers.has('standard') ? 'standard' : null
}

// PROVIDER_COST_ATTRIBUTION_V1: which executions may be shown as a SIMULATION when they predate the first known price. Only the two
// kinds whose first prices arrive with this change (OpenAI GPT Image, Google Veo seconds). Every previously approved pricing
// (Gemini text / Review / image, OpenAI chat, Kling units) keeps its strict rule - an execution before its first price stays
// unavailable - so no historical figure that already exists moves. Widening this list is an owner decision.
function simulationEligible(input: ProviderUsageCostInput): boolean {
  return (input.provider === 'openai' && input.operation === 'image_generation') || (input.provider === 'gemini' && input.unit === 'seconds')
}

const ADAPTERS: Record<string, (input: ProviderUsageCostInput, quantity: Fixed) => BillingPlan> = {
  gemini: planGemini,
  openai: planOpenAi,
  kling: planKling,
}

// ---------------------------------------------------------------------------

export function deriveProviderUsageCost(input: ProviderUsageCostInput, versions: readonly PricingVersion[]): ProviderUsageCost {
  if (input.quantity === null || input.unit === null) return unavailable('usage_unknown')
  // The ONE audited exception to "only provider-reported quantities are priced": Veo seconds, derived from the delivered request (see top).
  const derivedVeoSeconds = input.provider === 'gemini' && input.unit === 'seconds' && input.measurementSource === 'derived'
  if (input.measurementSource !== 'provider_reported' && !derivedVeoSeconds) return unavailable('measurement_not_provider_reported')
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
  let simulated = false
  for (const line of plan.lines) {
    const lookup = findPricingVersion(versions, { provider: input.provider, model: input.model, usageCategory: line.category, serviceTier: tier }, at)
    if (lookup.status === 'overlap') return ambiguous('overlapping_pricing_versions')
    if (lookup.status === 'no_match') return unavailable('no_pricing_for_category')
    let version: PricingVersion
    if (lookup.status === 'not_effective') {
      // The execution predates the first known price. With a later known price this becomes a clearly separate SIMULATION at that
      // (current) price; with none (every known window ended before the execution) it stays unavailable.
      if (!lookup.nearest || !simulationEligible(input)) return unavailable('pricing_not_effective_at_execution')
      version = lookup.nearest
      simulated = true
    } else {
      version = lookup.version
    }
    const amount = multiplyDivide(line.quantity, version.priceAmount, version.unitQuantity)
    total += amount
    used.push(version)
    components.push({ category: line.category, quantity: fixedToString(line.quantity), amount: fixedToString(amount), pricingVersionId: version.id })
  }
  if (new Set(used.map((v) => v.currency)).size !== 1) return unavailable('mixed_currency')

  const reference = used.reduce((latest, v) => (v.effectiveFrom > latest.effectiveFrom ? v : latest))
  const assumptions: CostAssumption[] = ['list_price_equivalent']
  if (plan.paidTierListPrice) assumptions.push('paid_tier_list_price')
  if (plan.lines.some((line) => line.category === 'cached_input')) assumptions.push('cached_tokens_priced_separately')
  else if (components.length > 1) assumptions.push('modalities_priced_separately')
  if (used.some((v) => v.effectiveFromBasis !== 'official_effective_date')) assumptions.push('price_observed_at_source')
  if (soleTierAssumed) assumptions.push('service_tier_sole_registry_tier')
  if (derivedVeoSeconds) assumptions.push('usage_derived_from_request')
  if (plan.assumptions) assumptions.push(...plan.assumptions)
  if (simulated) assumptions.push('current_price_simulation')
  if (input.funding === 'user_byok') assumptions.push('byok_invoice_may_differ')

  const body: CostBody = {
    amount: fixedToString(total),
    currency: used[0].currency,
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
  return simulated ? { status: 'simulated', basis: 'current_list_price_simulation', ...body } : { status: 'estimated', basis: 'list_price_equivalent', ...body }
}

// ---------------------------------------------------------------------------
// Ledger row -> deriver input (server side; reads only the closed set of provider_metadata facts it needs).
// ---------------------------------------------------------------------------

export function costInputFromRow(row: Record<string, any>): ProviderUsageCostInput {
  const metadata = row.provider_metadata && typeof row.provider_metadata === 'object' ? row.provider_metadata : {}
  const usage = metadata.usage && typeof metadata.usage === 'object' ? metadata.usage : {}
  const request = metadata.request && typeof metadata.request === 'object' ? metadata.request : {}
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
    // OpenAI Images modality detail (the normalized `usage` the recorder stores next to the aggregate rows).
    inputTextTokens: countOrNull(usage.inputTextTokens),
    inputImageTokens: countOrNull(usage.inputImageTokens),
    outputTextTokens: countOrNull(usage.outputTextTokens),
    outputImageTokens: countOrNull(usage.outputImageTokens),
    // Video request facts the recorder stores with a generation row.
    requestResolution: typeof request.resolution === 'string' ? request.resolution : null,
    requestDurationSeconds: countOrNull(request.duration),
  }
}
