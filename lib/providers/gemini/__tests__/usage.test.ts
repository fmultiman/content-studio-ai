import { describe, expect, it } from 'vitest'
import { extractGeminiUsage } from '../usage'

// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1 — the usageMetadata contract of the official generateContent response.

const REAL_SHAPE = {
  promptTokenCount: 18_432,
  candidatesTokenCount: 612,
  thoughtsTokenCount: 240,
  totalTokenCount: 19_284,
  cachedContentTokenCount: 1_024,
  toolUsePromptTokenCount: 7,
  promptTokensDetails: [{ modality: 'TEXT', tokenCount: 432 }, { modality: 'VIDEO', tokenCount: 17_400 }, { modality: 'AUDIO', tokenCount: 600 }],
  candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 612 }],
  serviceTier: 'standard',
}

describe('extractGeminiUsage', () => {
  it('keeps every provider-native field separate, exactly as reported', () => {
    expect(extractGeminiUsage(REAL_SHAPE)).toEqual({
      promptTokens: 18_432, cachedContentTokens: 1_024, candidatesTokens: 612, thoughtsTokens: 240, toolUsePromptTokens: 7, totalTokens: 19_284,
      promptTokensDetails: [{ modality: 'TEXT', tokens: 432 }, { modality: 'VIDEO', tokens: 17_400 }, { modality: 'AUDIO', tokens: 600 }],
      candidatesTokensDetails: [{ modality: 'TEXT', tokens: 612 }],
      serviceTier: 'standard',
    })
  })

  it('does not derive, add or fill anything: missing fields are null, never 0', () => {
    const usage = extractGeminiUsage({ promptTokenCount: 100, candidatesTokenCount: 5 })!
    expect(usage.thoughtsTokens).toBeNull()
    expect(usage.cachedContentTokens).toBeNull()
    expect(usage.totalTokens).toBeNull()
    expect(usage.promptTokensDetails).toEqual([])
    expect(usage.serviceTier).toBeNull()
  })

  it('a reported zero stays a zero (it is a measurement)', () => {
    expect(extractGeminiUsage({ promptTokenCount: 10, thoughtsTokenCount: 0 })!.thoughtsTokens).toBe(0)
  })

  it.each([undefined, null, 'x', 5, [], {}, { totalTokens: 3 }, { promptTokenCount: -1 }, { promptTokenCount: 1.5 }, { promptTokenCount: '12' }, { promptTokenCount: Number.NaN }])('unusable usage %j is UNKNOWN (null), not zero', (raw) => {
    expect(extractGeminiUsage(raw)).toBeNull()
  })

  it('drops unknown modalities, malformed detail entries and unknown service tiers', () => {
    const usage = extractGeminiUsage({
      promptTokenCount: 1,
      promptTokensDetails: [{ modality: 'HOLOGRAM', tokenCount: 4 }, { modality: 'TEXT', tokenCount: -2 }, null, { modality: 'IMAGE', tokenCount: 3 }],
      serviceTier: 'platinum',
    })!
    expect(usage.promptTokensDetails).toEqual([{ modality: 'IMAGE', tokens: 3 }])
    expect(usage.serviceTier).toBeNull()
  })

  it('never copies unrecognised fields (a provider body or secret cannot ride along)', () => {
    const usage = extractGeminiUsage({ promptTokenCount: 1, apiKey: 'AIza-secret', note: 'x', signedUrl: 'https://s3/x?X-Amz-Signature=1' })
    expect(JSON.stringify(usage)).not.toMatch(/AIza|X-Amz|signedUrl|note/)
  })
})
