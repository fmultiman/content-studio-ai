// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — the pricing authority's read model and lookup. Pure.
//
// The authority is the `provider_pricing_versions` table (scripts/061). This module only knows how to
// SELECT from a loaded set of versions; it never invents a price, a tier or a window.

import { parseFixed, type Fixed } from './decimal'

export const PRICING_CATEGORIES = ['input', 'cached_input', 'output', 'unit'] as const
export type PricingCategory = (typeof PRICING_CATEGORIES)[number]

export const EFFECTIVE_FROM_BASES = ['official_effective_date', 'model_release_no_documented_change', 'retrieval_date'] as const
export type EffectiveFromBasis = (typeof EFFECTIVE_FROM_BASES)[number]

/** One validated pricing version. Amounts are Fixed (BigInt), never floats. */
export interface PricingVersion {
  id: string
  provider: string
  model: string
  usageCategory: PricingCategory
  serviceTier: string
  currency: string
  unitName: string
  unitQuantity: Fixed
  priceAmount: Fixed
  /** Epoch ms, inclusive. */
  effectiveFrom: number
  /** Epoch ms, EXCLUSIVE; null = still current. */
  effectiveTo: number | null
  effectiveFromBasis: EffectiveFromBasis
  sourceUrl: string
  sourceLabel: string
  retrievedAt: string
  notes: string | null
}

/** Raw `provider_pricing_versions` row as PostgREST returns it. */
export type PricingVersionRow = Record<string, unknown>

/** Rows that fail validation are DROPPED (so they can only ever produce "unavailable"), never repaired. */
export function toPricingVersion(row: PricingVersionRow): PricingVersion | null {
  const text = (key: string) => (typeof row[key] === 'string' && (row[key] as string).length > 0 ? (row[key] as string) : null)
  const time = (key: string) => {
    const value = row[key]
    if (typeof value !== 'string') return null
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  const id = text('id')
  const provider = text('provider')
  const model = text('model')
  const serviceTier = text('service_tier')
  const currency = text('currency')
  const unitName = text('unit_name')
  const sourceUrl = text('source_url')
  const sourceLabel = text('source_label')
  const retrievedAt = text('retrieved_at')
  const category = row.usage_category
  const basis = row.effective_from_basis
  const unitQuantity = parseFixed(row.unit_quantity)
  const priceAmount = parseFixed(row.price_amount)
  const effectiveFrom = time('effective_from')
  const effectiveTo = row.effective_to === null || row.effective_to === undefined ? null : time('effective_to')
  if (!id || !provider || !model || !serviceTier || !currency || !unitName || !sourceUrl || !sourceLabel || !retrievedAt) return null
  if (!(PRICING_CATEGORIES as readonly unknown[]).includes(category)) return null
  if (!(EFFECTIVE_FROM_BASES as readonly unknown[]).includes(basis)) return null
  if (unitQuantity === null || unitQuantity <= BigInt(0) || priceAmount === null || effectiveFrom === null) return null
  if (row.effective_to !== null && row.effective_to !== undefined && effectiveTo === null) return null
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) return null
  return {
    id, provider, model, usageCategory: category as PricingCategory, serviceTier, currency, unitName, unitQuantity, priceAmount,
    effectiveFrom, effectiveTo, effectiveFromBasis: basis as EffectiveFromBasis, sourceUrl, sourceLabel, retrievedAt,
    notes: typeof row.notes === 'string' ? row.notes : null,
  }
}

export interface PricingKey {
  provider: string
  model: string
  usageCategory: PricingCategory
  serviceTier: string
}

export type PricingLookup =
  | { status: 'found'; version: PricingVersion }
  /** The key has versions, but none covers the instant (e.g. the execution predates the first published price). */
  | { status: 'not_effective'; nearest: PricingVersion | null }
  /** No version exists for the key at all. */
  | { status: 'no_match' }
  /** More than one version covers the instant: the registry is inconsistent for this key - never guess. */
  | { status: 'overlap'; versions: PricingVersion[] }

const sameKey = (v: PricingVersion, k: PricingKey) =>
  v.provider === k.provider && v.model === k.model && v.usageCategory === k.usageCategory && v.serviceTier === k.serviceTier

/** The version effective at `at` (epoch ms): effective_from <= at < effective_to. Later windows are never used for earlier executions. */
export function findPricingVersion(versions: readonly PricingVersion[], key: PricingKey, at: number): PricingLookup {
  const candidates = versions.filter((v) => sameKey(v, key))
  if (candidates.length === 0) return { status: 'no_match' }
  const covering = candidates.filter((v) => v.effectiveFrom <= at && (v.effectiveTo === null || at < v.effectiveTo))
  if (covering.length === 1) return { status: 'found', version: covering[0] }
  if (covering.length > 1) return { status: 'overlap', versions: covering }
  const earlier = candidates.filter((v) => v.effectiveFrom > at).sort((a, b) => a.effectiveFrom - b.effectiveFrom)
  return { status: 'not_effective', nearest: earlier[0] ?? null }
}

/** Does the registry price this (provider, model) at all, for any category/tier/time? Used to word the "unavailable" reason. */
export function hasAnyPricingFor(versions: readonly PricingVersion[], provider: string, model: string): boolean {
  return versions.some((v) => v.provider === provider && v.model === model)
}
