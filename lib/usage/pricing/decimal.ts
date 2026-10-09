// PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1 — decimal-safe money arithmetic. Pure and client-safe.
//
// Money never goes through floating point. A decimal is a BigInt scaled by 10^SCALE_DIGITS, and crosses the
// wire as a canonical decimal STRING (never a JS number).
//
//   storage precision      NUMERIC(24,12) price per unit quantity (scripts/061)
//   calculation precision  12 decimal places (SCALE_DIGITS); products are rounded half-up once, at the end
//   display rounding       done only at presentation time (formatEstimatedAmount), always from the exact value

export const SCALE_DIGITS = 12
const ZERO = BigInt(0)
const ONE = BigInt(1)
const TWO = BigInt(2)
const TEN = BigInt(10)
// The project targets < ES2016, so no bigint literals or `**`.
const pow10 = (digits: number): bigint => {
  let result = ONE
  for (let i = 0; i < digits; i += 1) result *= TEN
  return result
}
const SCALE = pow10(SCALE_DIGITS)

/** A non-negative decimal at 12 fractional digits. */
export type Fixed = bigint

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/

/**
 * Parses a decimal string, an integer, or a finite JS number into Fixed. Numbers are only accepted as the way
 * PostgREST delivers NUMERIC; they are re-read through their shortest decimal text so 0.15 stays 0.15.
 * Returns null for anything that is not a finite, non-negative decimal (NaN, Infinity, negative, junk).
 */
export function parseFixed(value: unknown): Fixed | null {
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    text = /e/i.test(String(value)) ? value.toFixed(SCALE_DIGITS) : String(value)
  } else if (typeof value === 'string') {
    text = value.trim()
  } else {
    return null
  }
  if (!DECIMAL_PATTERN.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const kept = fraction.slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0')
  let result = BigInt(whole) * SCALE + BigInt(kept)
  // Round half-up on the first dropped digit so over-long input is never silently truncated downward.
  if (fraction.length > SCALE_DIGITS && fraction.charCodeAt(SCALE_DIGITS) >= 53) result += ONE
  return result
}

/** quantity x price / unitQuantity, rounded half-up at 12 digits. unitQuantity must be > 0. */
export function multiplyDivide(quantity: Fixed, price: Fixed, unitQuantity: Fixed): Fixed {
  if (unitQuantity <= ZERO) throw new RangeError('unitQuantity must be > 0')
  const numerator = quantity * price
  return (numerator * TWO + unitQuantity) / (unitQuantity * TWO)
}

/** Canonical decimal string with trailing zeros trimmed ("0.0042", "12", never "1e-7"). */
export function fixedToString(value: Fixed): string {
  const whole = value / SCALE
  const fraction = (value % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/** Rounds half-up to `digits` fractional digits and returns the integer count of 10^-digits units. */
export function roundToUnits(value: Fixed, digits: number): bigint {
  const drop = pow10(SCALE_DIGITS - digits)
  return (value * TWO + drop) / (drop * TWO)
}
