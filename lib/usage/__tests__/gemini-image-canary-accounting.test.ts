import { describe, expect, it } from 'vitest'
import { GEMINI_IMAGE_CANARY_USAGE as CANARY } from '@/lib/__tests__/helpers/gemini-image-canary'
import { extractGeminiUsage } from '@/lib/providers/gemini/usage'
import { geminiImageUsageEvents, type GeminiImageUsageContext } from '../gemini-image-usage'

const context: GeminiImageUsageContext = {
  userId: 'u', attemptId: '56ba444f-0280-4675-aa2a-ec90267e8eb8', projectId: null, productionId: null,
  modelAlias: 'gemini-nb-2.1', providerModel: 'gemini-nano-banana-2.1', aspectRatio: '1:1', imageSize: '1K',
  funding: 'user_byok', credentialSource: 'user', providerResponse: 'received',
}
const events = (raw: unknown) => geminiImageUsageEvents(context, extractGeminiUsage(raw))
const quantities = (raw: unknown) => Object.fromEntries(events(raw).map((e) => [e.idempotencyKey.split(':')[2], e.measurement?.quantity]))

describe('candidate remainder from reported metadata', () => {
  it('exact canary: keeps thoughts separate and accounts for the 315-token remainder', () => {
    expect(quantities(CANARY)).toEqual({ input_tokens: 29, image_output_tokens: 1120, thoughts_tokens: 868, output_unattributed_tokens: 315 })
    expect(events(CANARY).find((e) => e.providerMetadata?.usage_category === 'output_unattributed')?.measurement)
      .toEqual({ quantity: 315, unit: 'tokens', source: 'provider_reported' })
  })

  it.each([
    ['fully attributed IMAGE', { candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }, { image_output_tokens: 1120 }],
    ['partial IMAGE', { candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }, { image_output_tokens: 1120, output_unattributed_tokens: 80 }],
    ['mixed TEXT + IMAGE', { candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'TEXT', tokenCount: 60 }, { modality: 'IMAGE', tokenCount: 1120 }] }, { image_output_tokens: 1120, text_output_tokens: 60, output_unattributed_tokens: 20 }],
    ['all modalities', { candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'AUDIO', tokenCount: 50 }, { modality: 'VIDEO', tokenCount: 20 }, { modality: 'DOCUMENT', tokenCount: 10 }] }, { image_output_tokens: 1120 }],
    ['unrecognized modality', { candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }, { modality: 'FUTURE_MODALITY', tokenCount: 60 }] }, { image_output_tokens: 1120, output_unattributed_tokens: 20 }],
    ['no breakdown', { candidatesTokenCount: 1200 }, { output_unattributed_tokens: 1200 }],
    ['no candidate total', { candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }, { image_output_tokens: 1120 }],
    ['inconsistent total', { candidatesTokenCount: 1000, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] }, { image_output_tokens: 1120 }],
    ['malformed counts', { candidatesTokenCount: 1200, candidatesTokensDetails: [null, { modality: 'TEXT', tokenCount: -10 }, { modality: 'IMAGE', tokenCount: 1120 }, { modality: 'AUDIO', tokenCount: '50' }] }, { image_output_tokens: 1120, output_unattributed_tokens: 80 }],
    ['no total inferred from thoughts or totalTokenCount', { totalTokenCount: 2332, thoughtsTokenCount: 868 }, { thoughts_tokens: 868 }],
    ['reported zero total', { promptTokenCount: 0, candidatesTokenCount: 0 }, { input_tokens: 0 }],
    ['unsafe sum', { promptTokenCount: 29, candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'AUDIO', tokenCount: Number.MAX_SAFE_INTEGER }, { modality: 'VIDEO', tokenCount: 1 }] }, { input_tokens: 29 }],
    ['unsafe IMAGE sum', { promptTokenCount: 29, candidatesTokenCount: 1200, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: Number.MAX_SAFE_INTEGER }, { modality: 'IMAGE', tokenCount: 1 }] }, { input_tokens: 29 }],
  ])('%s: invents no quantities', (_label, raw, expected) => {
    expect(quantities(raw)).toEqual(expected)
  })

  it('subtracts the entire breakdown, including entries beyond the old parser limit', () => {
    expect(quantities({ candidatesTokenCount: 20, candidatesTokensDetails: Array.from({ length: 20 }, () => ({ modality: 'TEXT', tokenCount: 1 })) }))
      .toEqual({ text_output_tokens: 20 })
  })
})
