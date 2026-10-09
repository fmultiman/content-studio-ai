// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — estimated-cost aggregation. Pure and client-safe.
//
//   - amounts are summed as exact decimals, and only within ONE currency (no FX, ever);
//   - a row that is not `estimated` contributes NOTHING to a numeric total and is counted instead:
//     "unknown" is never added as zero;
//   - the headline total is only trustworthy next to its coverage (priced vs unpriced), so both are returned.

import { fixedToString, parseFixed, type Fixed } from './decimal'
import type { ProviderUsageCost } from './derive'

export interface EstimatedCostTotal {
  currency: string
  /** Canonical decimal string. */
  amount: string
  /** Rows that contributed to this total. */
  pricedEvents: number
}

export interface EstimatedCostSummary {
  /** One entry per currency, sorted by currency code. Empty when nothing could be priced. */
  totals: EstimatedCostTotal[]
  pricedEvents: number
  /** Rows that could not be priced (no applicable price / unsupported / usage unknown). */
  unavailableEvents: number
  /** Rows that could not be priced because the facts did not identify one price. */
  ambiguousEvents: number
  /** unavailable + ambiguous: every row that is NOT in a numeric total. */
  unpricedEvents: number
  totalEvents: number
}

/** A missing cost (an older payload) counts as unavailable - never as zero. */
export function summarizeEstimatedCost(costs: ReadonlyArray<ProviderUsageCost | null | undefined>): EstimatedCostSummary {
  const byCurrency = new Map<string, { sum: Fixed; events: number }>()
  let pricedEvents = 0
  let ambiguousEvents = 0
  let unavailableEvents = 0
  for (const cost of costs) {
    if (cost?.status === 'estimated') {
      const amount = parseFixed(cost.amount)
      if (amount === null) {
        unavailableEvents += 1
        continue
      }
      const entry = byCurrency.get(cost.currency) ?? { sum: BigInt(0), events: 0 }
      entry.sum += amount
      entry.events += 1
      byCurrency.set(cost.currency, entry)
      pricedEvents += 1
    } else if (cost?.status === 'ambiguous') {
      ambiguousEvents += 1
    } else {
      unavailableEvents += 1
    }
  }
  return {
    totals: [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, { sum, events }]) => ({ currency, amount: fixedToString(sum), pricedEvents: events })),
    pricedEvents,
    unavailableEvents,
    ambiguousEvents,
    unpricedEvents: unavailableEvents + ambiguousEvents,
    totalEvents: costs.length,
  }
}
