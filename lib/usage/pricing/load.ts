// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — SERVER ONLY, READ ONLY.
//
// Loads the pricing authority (`provider_pricing_versions`) with the caller's own session: it is public
// reference data behind a SELECT-only policy, so no service role is needed and nothing can be written from here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { toPricingVersion, type PricingVersion } from './registry'

const COLUMNS =
  'id, provider, model, usage_category, service_tier, currency, unit_name, unit_quantity, price_amount, effective_from, effective_to, effective_from_basis, source_url, source_label, retrieved_at, notes'

/** `null` = the registry could not be loaded (callers show "pricing unavailable", never zero). Invalid rows are dropped. */
export async function loadPricingVersions(db: Pick<SupabaseClient, 'from'>): Promise<PricingVersion[] | null> {
  try {
    const { data, error } = await db.from('provider_pricing_versions').select(COLUMNS)
    if (error) return null
    return ((data ?? []) as Array<Record<string, unknown>>).map(toPricingVersion).filter((version): version is PricingVersion => version !== null)
  } catch {
    return null
  }
}
