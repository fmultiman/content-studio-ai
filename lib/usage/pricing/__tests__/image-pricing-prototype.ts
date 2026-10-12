// FUTURE-064 Slice D — DESIGN PROTOTYPE of the cost-derivation change. TEST ARTIFACT ONLY: nothing in app/, lib/ production code
// imports this file and lib/usage/pricing/derive.ts, registry.ts and aggregate.ts are NOT modified in the design phase.
//
// It expresses the proposed implementation as the smallest possible delta over the real code:
//
//   * every row that is NOT a Gemini image-generation row goes through the REAL `deriveProviderUsageCost` unchanged
//     (the regression tests assert byte-identical results);
//   * a Gemini `image_generation` row differs from the real deriver in exactly four ways:
//       1. IMAGE output tokens (`tokens` + usage_category `image_output`) are priced with the `image_output` version,
//          never with a text-output version;
//       2. `tokens` + `output_unattributed` stays UNPRICED, with a specific reason (approved decision);
//       3. a service tier that the response did NOT report may be taken from the registry ONLY when the registry prices
//          exactly one tier for that model (the same "sole tier" evidence the Kling rule already uses), the request path
//          never asks for another tier (real-time generateContent, no serviceTier requested) and the assumption is
//          surfaced; a REPORTED tier is always honored and a non-Standard one never falls back to Standard;
//       4. nothing prices `totalTokenCount` (it is never a row).
//   * the registry loader accepts the `image_output` category (the real `toPricingVersion` drops it, which is why applying
//     the SQL before the code change is safe);
//   * aggregation gains an explicit "complete" flag, so a total that omits unpriced rows is never presented as final.

import { fixedToString, multiplyDivide, parseFixed, type Fixed } from '../decimal'
import {
  costInputFromRow,
  deriveProviderUsageCost,
  type CostAssumption,
  type CostComponent,
  type ProviderUsageCost,
  type ProviderUsageCostInput,
} from '../derive'
import { summarizeEstimatedCost, type EstimatedCostSummary } from '../aggregate'
import { findPricingVersion, hasAnyPricingFor, toPricingVersion, type PricingVersion } from '../registry'

export { costInputFromRow }

/** PROPOSED additions to COST_UNAVAILABLE_REASONS / COST_ASSUMPTIONS. */
export const PROPOSED_UNATTRIBUTED_REASON = 'output_modality_unattributed' as const
export const PROPOSED_SOLE_TIER_ASSUMPTION = 'service_tier_sole_registry_tier' as const

export type ProposedCost =
  | ProviderUsageCost
  | { status: 'unavailable'; reason: typeof PROPOSED_UNATTRIBUTED_REASON }

type ProposedEstimated = Extract<ProviderUsageCost, { status: 'estimated' }> & { assumptions: Array<CostAssumption | typeof PROPOSED_SOLE_TIER_ASSUMPTION> }

/** Registry loader proposal: accepts image_output (validated by the real loader through the closest valid category). */
export function toPricingVersionProposed(row: Record<string, unknown>): PricingVersion | null {
  if (row.usage_category !== 'image_output') return toPricingVersion(row)
  const asOutput = toPricingVersion({ ...row, usage_category: 'output' })
  return asOutput ? ({ ...asOutput, usageCategory: 'image_output' } as unknown as PricingVersion) : null
}

const isImageGeneration = (input: ProviderUsageCostInput) => input.provider === 'gemini' && input.operation === 'image_generation'

function soleRegistryTier(versions: readonly PricingVersion[], model: string): string | null {
  const tiers = new Set(versions.filter((v) => v.provider === 'gemini' && v.model === model).map((v) => v.serviceTier))
  return tiers.size === 1 ? [...tiers][0] : null
}

export function deriveProviderUsageCostProposed(input: ProviderUsageCostInput, versions: readonly PricingVersion[]): ProposedCost {
  if (!isImageGeneration(input)) return deriveProviderUsageCost(input, versions)

  // 1) service tier: reported wins; fall back to the sole registry tier ONLY when nothing was reported at all.
  const reported = typeof input.serviceTier === 'string' && input.serviceTier.length > 0
  const soleTier = !reported && input.model ? soleRegistryTier(versions, input.model) : null
  const effective: ProviderUsageCostInput = soleTier ? { ...input, serviceTier: soleTier } : input

  // 2) the dimensions the real deriver already prices correctly (input, text output, thinking) keep its exact logic.
  const isImageOutput = input.unit === 'tokens' && input.usageCategory === 'image_output'
  const isUnattributed = input.unit === 'tokens' && input.usageCategory === 'output_unattributed'
  if (!isImageOutput && !isUnattributed) {
    const cost = deriveProviderUsageCost(effective, versions)
    if (soleTier && cost.status === 'estimated') {
      return { ...cost, assumptions: [...cost.assumptions, PROPOSED_SOLE_TIER_ASSUMPTION] } as ProposedEstimated
    }
    return cost
  }

  // 3) the new/changed dimensions.
  if (isUnattributed) {
    if (input.quantity === null || input.unit === null) return { status: 'unavailable', reason: 'usage_unknown' }
    return { status: 'unavailable', reason: PROPOSED_UNATTRIBUTED_REASON }
  }
  if (input.quantity === null || input.unit === null) return { status: 'unavailable', reason: 'usage_unknown' }
  if (input.measurementSource !== 'provider_reported') return { status: 'unavailable', reason: 'measurement_not_provider_reported' }
  if (!input.model) return { status: 'unavailable', reason: 'model_unknown' }
  const at = Date.parse(input.occurredAt)
  if (Number.isNaN(at)) return { status: 'unavailable', reason: 'invalid_timestamp' }
  const quantity: Fixed | null = parseFixed(input.quantity)
  if (quantity === null) return { status: 'unavailable', reason: 'invalid_usage' }
  if (!hasAnyPricingFor(versions, input.provider, input.model)) return { status: 'unavailable', reason: 'no_pricing_for_model' }
  const tier = effective.serviceTier && ['standard', 'flex', 'priority'].includes(effective.serviceTier) ? effective.serviceTier : null
  if (tier === null) return { status: 'ambiguous', reason: 'service_tier_not_proven' }

  const lookup = findPricingVersion(versions, { provider: input.provider, model: input.model, usageCategory: 'image_output' as never, serviceTier: tier }, at)
  if (lookup.status === 'overlap') return { status: 'ambiguous', reason: 'overlapping_pricing_versions' }
  if (lookup.status === 'no_match') return { status: 'unavailable', reason: 'no_pricing_for_category' }
  if (lookup.status === 'not_effective') return { status: 'unavailable', reason: 'pricing_not_effective_at_execution' }
  const version = lookup.version
  const amount = multiplyDivide(quantity, version.priceAmount, version.unitQuantity)
  const component: CostComponent = { category: 'image_output' as never, quantity: fixedToString(quantity), amount: fixedToString(amount), pricingVersionId: version.id }
  const assumptions: Array<CostAssumption | typeof PROPOSED_SOLE_TIER_ASSUMPTION> = ['list_price_equivalent', 'paid_tier_list_price']
  if (soleTier) assumptions.push(PROPOSED_SOLE_TIER_ASSUMPTION)
  if (version.effectiveFromBasis !== 'official_effective_date') assumptions.push('price_observed_at_source')
  if (input.funding === 'user_byok') assumptions.push('byok_invoice_may_differ')
  return {
    status: 'estimated',
    amount: fixedToString(amount),
    currency: version.currency,
    basis: 'list_price_equivalent',
    serviceTier: tier,
    pricing: {
      versionIds: [version.id],
      sourceUrl: version.sourceUrl,
      sourceLabel: version.sourceLabel,
      retrievedAt: version.retrievedAt,
      effectiveFrom: new Date(version.effectiveFrom).toISOString(),
      effectiveFromBasis: version.effectiveFromBasis,
    },
    components: [component],
    assumptions: assumptions as CostAssumption[],
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Aggregation proposal: an explicit completeness flag, and an execution-level verdict.
// --------------------------------------------------------------------------------------------------------------------

export type ProposedCostSummary = EstimatedCostSummary & {
  /** true only when EVERY row is priced. A false value means the amounts are a LOWER BOUND of the priced rows, not a total. */
  complete: boolean
}

export function summarizeEstimatedCostProposed(costs: ReadonlyArray<ProposedCost | null | undefined>): ProposedCostSummary {
  const summary = summarizeEstimatedCost(costs as ReadonlyArray<ProviderUsageCost | null | undefined>)
  return { ...summary, complete: summary.totalEvents > 0 && summary.unpricedEvents === 0 }
}

export type ExecutionCostVerdict = 'complete' | 'partial' | 'none'

/** The cost verdict of ONE execution (all the ledger rows of one Attempt). Partial = some components priced, some not. */
export function executionCostVerdict(costs: ReadonlyArray<ProposedCost | null | undefined>): ExecutionCostVerdict {
  const priced = costs.filter((cost) => cost?.status === 'estimated').length
  if (costs.length === 0 || priced === 0) return 'none'
  return priced === costs.length ? 'complete' : 'partial'
}
