// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — estimated-cost aggregation. Pure and client-safe.
//
//   - amounts are summed as exact decimals, and only within ONE currency (no FX, ever);
//   - a row that is not `estimated` contributes NOTHING to a numeric total and is counted instead:
//     "unknown" is never added as zero;
//   - the headline total is only trustworthy next to its coverage (priced vs unpriced), so both are returned;
//   - PROVIDER_COST_ATTRIBUTION_V1: a `simulated` row (execution before the first known price, priced at the earliest known one) is a
//     what-if, never a period estimate. It is summed APART (`simulatedTotals`) and never enters `totals`; it also keeps the total partial.

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
  /** One entry per currency, sorted by currency code. Empty when nothing could be priced. ESTIMATED rows only. */
  totals: EstimatedCostTotal[]
  /** What the `simulated` rows would cost at the earliest known (current) price, per currency. Kept out of `totals`. */
  simulatedTotals: EstimatedCostTotal[]
  /** Rows priced only as a simulation at the current price (they predate the first known price). */
  simulatedEvents: number
  pricedEvents: number
  /** Rows that could not be priced (no applicable price / unsupported / usage unknown). */
  unavailableEvents: number
  /** Rows that could not be priced because the facts did not identify one price. */
  ambiguousEvents: number
  /** unavailable + ambiguous: every row that is NOT in a numeric total. */
  unpricedEvents: number
  totalEvents: number
  /**
   * FUTURE-064 Slice D. true ONLY when there is at least one row and EVERY row is priced (estimated). When false, `totals` is just the
   * sum of the priced rows (a lower bound), never "the cost": presentation must call it partial. A known zero amount is a priced row;
   * an unknown amount is never zero and never makes a total complete, and neither does a simulated row.
   */
  complete: boolean
}

/** A missing cost (an older payload) counts as unavailable - never as zero. */
export function summarizeEstimatedCost(costs: ReadonlyArray<ProviderUsageCost | null | undefined>): EstimatedCostSummary {
  const byCurrency = new Map<string, { sum: Fixed; events: number }>()
  const simulatedByCurrency = new Map<string, { sum: Fixed; events: number }>()
  let simulatedEvents = 0
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
    } else if (cost?.status === 'simulated') {
      const amount = parseFixed(cost.amount)
      if (amount === null) {
        unavailableEvents += 1
        continue
      }
      const entry = simulatedByCurrency.get(cost.currency) ?? { sum: BigInt(0), events: 0 }
      entry.sum += amount
      entry.events += 1
      simulatedByCurrency.set(cost.currency, entry)
      simulatedEvents += 1
    } else if (cost?.status === 'ambiguous') {
      ambiguousEvents += 1
    } else {
      unavailableEvents += 1
    }
  }
  const toTotals = (map: Map<string, { sum: Fixed; events: number }>): EstimatedCostTotal[] =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, { sum, events }]) => ({ currency, amount: fixedToString(sum), pricedEvents: events }))
  return {
    totals: toTotals(byCurrency),
    simulatedTotals: toTotals(simulatedByCurrency),
    simulatedEvents,
    pricedEvents,
    unavailableEvents,
    ambiguousEvents,
    unpricedEvents: unavailableEvents + ambiguousEvents,
    totalEvents: costs.length,
    complete: costs.length > 0 && unavailableEvents + ambiguousEvents + simulatedEvents === 0,
  }
}
