// GEMINI_PROVIDER_USAGE_AND_COST_INTEGRATION_V1
//
// Normalizes the `usageMetadata` object that the official Gemini API returns with generateContent.
// Contract (verified against the v1beta discovery document, `UsageMetadata` / `ModalityTokenCount`):
//
//   promptTokenCount            input tokens; INCLUDES cached content when cachedContent is used
//   cachedContentTokenCount     the cached part of the prompt (a subset of promptTokenCount)
//   candidatesTokenCount        generated response tokens (does NOT include thoughts)
//   thoughtsTokenCount          thinking tokens (thinking models)
//   toolUsePromptTokenCount     tool-use prompt tokens
//   totalTokenCount             prompt + tool-use + thoughts + candidates
//   promptTokensDetails[]       { modality: TEXT|IMAGE|VIDEO|AUDIO|DOCUMENT, tokenCount }
//   candidatesTokensDetails[]   same shape, for the response
//   serviceTier                 standard | flex | priority
//
// Provider-native quantities are preserved as separate fields and are never merged. A field is kept only
// when the provider sent a non-negative integer for it; anything else is "not reported" (null), never 0.
// Pure: no I/O, no secrets.

export const GEMINI_USAGE_MODALITIES = ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'] as const
export type GeminiUsageModality = (typeof GEMINI_USAGE_MODALITIES)[number]
export const GEMINI_SERVICE_TIERS = ['standard', 'flex', 'priority'] as const
export type GeminiServiceTier = (typeof GEMINI_SERVICE_TIERS)[number]

export type GeminiModalityTokens = { modality: GeminiUsageModality; tokens: number }

export type GeminiUsage = {
  promptTokens: number | null
  cachedContentTokens: number | null
  candidatesTokens: number | null
  thoughtsTokens: number | null
  toolUsePromptTokens: number | null
  totalTokens: number | null
  promptTokensDetails: GeminiModalityTokens[]
  candidatesTokensDetails: GeminiModalityTokens[]
  serviceTier: GeminiServiceTier | null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function details(value: unknown): GeminiModalityTokens[] {
  if (!Array.isArray(value)) return []
  const out: GeminiModalityTokens[] = []
  for (const item of value.slice(0, 16)) {
    const modality = (item as { modality?: unknown } | null)?.modality
    const tokens = count((item as { tokenCount?: unknown } | null)?.tokenCount)
    if (tokens !== null && (GEMINI_USAGE_MODALITIES as readonly unknown[]).includes(modality)) out.push({ modality: modality as GeminiUsageModality, tokens })
  }
  return out
}

/** Returns null when the response carried no recognizable usage at all (usage UNKNOWN, not zero). */
export function extractGeminiUsage(raw: unknown): GeminiUsage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const meta = raw as Record<string, unknown>
  const tier = meta.serviceTier
  const usage: GeminiUsage = {
    promptTokens: count(meta.promptTokenCount),
    cachedContentTokens: count(meta.cachedContentTokenCount),
    candidatesTokens: count(meta.candidatesTokenCount),
    thoughtsTokens: count(meta.thoughtsTokenCount),
    toolUsePromptTokens: count(meta.toolUsePromptTokenCount),
    totalTokens: count(meta.totalTokenCount),
    promptTokensDetails: details(meta.promptTokensDetails),
    candidatesTokensDetails: details(meta.candidatesTokensDetails),
    serviceTier: (GEMINI_SERVICE_TIERS as readonly unknown[]).includes(tier) ? (tier as GeminiServiceTier) : null,
  }
  const measured = [usage.promptTokens, usage.cachedContentTokens, usage.candidatesTokens, usage.thoughtsTokens, usage.toolUsePromptTokens, usage.totalTokens]
  return measured.some((value) => value !== null) ? usage : null
}
