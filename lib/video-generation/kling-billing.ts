// KLING_REST_RECOVERY_V1 - what the Kling API itself says a task cost. Pure and client-safe.
//
// A Kling API task item may carry a `billing` object (`amount`, `charge_type`, sometimes a package type). Its exact schema is not
// documented anywhere we can read, so this module trusts nothing it cannot validate:
//
//   - a usage QUANTITY is produced only when `charge_type` is exactly "unit" (resource-package units) and `amount` is a finite,
//     non-negative number. Units are provider-native: they are never converted to money and never added to anything else;
//   - any other charge type (e.g. "cash", an amount in a currency) or a malformed value yields NO measurement - an absent value is
//     "unknown", never 0 and never guessed;
//   - the raw, bounded, non-secret facts that were stated (`amount`, `charge_type`, `package_type`) are returned separately so they can
//     be shown and stored next to the attempt for audit, whatever the charge type.

import type { UsageMeasurement } from '@/lib/usage/provider-usage'

export interface KlingBillingFacts {
  amount?: number
  charge_type?: string
  package_type?: string
}

export interface KlingBillingReading {
  /** Provider-reported usage, only for a valid `unit` charge. */
  usage: UsageMeasurement | null
  /** The stated facts (bounded). null when the response carried no billing object at all. */
  facts: KlingBillingFacts | null
}

const SAFE_LABEL = /^[A-Za-z0-9_.:-]{1,40}$/

export function readKlingBilling(billing: unknown): KlingBillingReading {
  if (!billing || typeof billing !== 'object' || Array.isArray(billing)) return { usage: null, facts: null }
  const raw = billing as Record<string, unknown>

  const facts: KlingBillingFacts = {}
  if (typeof raw.amount === 'number' && Number.isFinite(raw.amount) && raw.amount >= 0 && raw.amount < 1_000_000) facts.amount = raw.amount
  if (typeof raw.charge_type === 'string' && SAFE_LABEL.test(raw.charge_type)) facts.charge_type = raw.charge_type
  if (typeof raw.package_type === 'string' && SAFE_LABEL.test(raw.package_type)) facts.package_type = raw.package_type
  if (Object.keys(facts).length === 0) return { usage: null, facts: null }

  const usage: UsageMeasurement | null =
    facts.charge_type === 'unit' && facts.amount !== undefined
      ? { quantity: facts.amount, unit: 'units', source: 'provider_reported' }
      : null
  return { usage, facts }
}
