import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { deriveProviderUsageCost } from '../derive'
import type { PricingVersion } from '../registry'
import { encodeCost, legacyCostMatrix } from './legacy-cost-matrix'
import { registries } from './image-pricing-fixtures'

// FUTURE-064 Slice D — HISTORICAL COSTS MUST NOT MOVE. The golden file holds the result of the deriver as it was BEFORE the
// image-pricing change (main 6a1f638) for 1,806 OpenAI / Gemini text-Review-prompt-assistance / Kling / unknown usage rows over the
// Production registry (scripts 061 + 062). The current code must reproduce every entry — over the registry as Production has it
// today AND over the registry the reviewed image SQL would produce.

const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'legacy-cost-golden.json'), 'utf8')) as { generatedFrom: string; rows: number; results: string[] }

let oldVersions: PricingVersion[]
let newVersions: PricingVersion[]
beforeAll(async () => {
  const registry = await registries()
  oldVersions = registry.oldVersions
  newVersions = registry.newVersions
}, 60_000)

describe('historical OpenAI, Gemini text and Kling costs are unchanged', () => {
  const matrix = legacyCostMatrix()

  it('the golden file covers the whole matrix and really exercises priced, ambiguous and unavailable outcomes', () => {
    expect(golden.generatedFrom).toMatch(/6a1f638/)
    expect(golden.rows).toBe(matrix.length)
    expect(golden.results).toHaveLength(matrix.length)
    const statuses = new Set(golden.results.map((entry) => entry.split(':')[0]))
    expect([...statuses].sort()).toEqual(['ambiguous', 'estimated', 'unavailable'])
    expect(golden.results.filter((entry) => entry.startsWith('estimated')).length).toBeGreaterThan(200)
    // all three historical providers are priced somewhere in the golden
    for (const needle of ['USD:standard:input=', 'USD:standard:output=', 'USD:standard:unit=']) expect(golden.results.some((entry) => entry.includes(needle))).toBe(true)
  })

  it("is byte-identical over today's Production registry (22 rows)", () => {
    expect(oldVersions).toHaveLength(22)
    const current = matrix.map((input) => encodeCost(deriveProviderUsageCost(input, oldVersions)))
    expect(current).toEqual(golden.results)
  })

  it('is byte-identical over the registry the reviewed image SQL produces (28 rows): the new rows touch no historical price', () => {
    expect(newVersions).toHaveLength(28)
    const current = matrix.map((input) => encodeCost(deriveProviderUsageCost(input, newVersions)))
    expect(current).toEqual(golden.results)
  })

  it('breaks the mapping per provider so a regression names its provider', () => {
    const current = matrix.map((input) => ({ provider: input.provider, encoded: encodeCost(deriveProviderUsageCost(input, newVersions)) }))
    for (const provider of ['openai', 'gemini', 'kling']) {
      const expected = matrix.map((input, index) => (input.provider === provider ? golden.results[index] : null)).filter(Boolean)
      expect(current.filter((row) => row.provider === provider).map((row) => row.encoded)).toEqual(expected)
    }
  })
})
