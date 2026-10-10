import { assertProviderExecutionAllowed } from '@/lib/providers/execution-policy'
import { createGeminiClient } from '@/lib/providers/gemini/client'
import { extractGeminiUsage } from '@/lib/providers/gemini/usage'
import { PromptAssistanceError, type PromptAssistanceProvider, type PromptAssistanceUsage } from './contract'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_TIMEOUT_MS = 60_000
const GEMINI_TIMEOUT_MS = 120_000

function openAiUsage(raw: unknown, requestId: unknown): PromptAssistanceUsage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const usage = raw as Record<string, unknown>
  const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
  const inputTokens = integer(usage.prompt_tokens)
  const outputTokens = integer(usage.completion_tokens)
  const totalTokens = integer(usage.total_tokens)
  if (inputTokens === null && outputTokens === null && totalTokens === null) return null
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof requestId === 'string' ? { providerRequestId: requestId } : {}),
  }
}

function geminiUsage(raw: unknown, requestId: unknown): PromptAssistanceUsage | null {
  const usage = extractGeminiUsage(raw)
  if (!usage) return null
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.candidatesTokens,
    totalTokens: usage.totalTokens,
    serviceTier: usage.serviceTier,
    ...(typeof requestId === 'string' ? { providerRequestId: requestId } : {}),
  }
}

function providerStatus(status: number, provider: string): PromptAssistanceError {
  if (status === 429) return new PromptAssistanceError('PROVIDER_RATE_LIMITED', `${provider} está temporariamente limitado. Tente novamente em instantes.`, 429)
  if (status === 401 || status === 403) return new PromptAssistanceError('PROVIDER_NOT_CONFIGURED', `A credencial do ${provider} não foi aceita.`, 422)
  if (status >= 500) return new PromptAssistanceError('PROVIDER_UNAVAILABLE', `${provider} está temporariamente indisponível.`, 502)
  return new PromptAssistanceError('PROVIDER_UNAVAILABLE', `${provider} rejeitou a solicitação de assistência.`, 502)
}

export type PromptProviderInput = {
  provider: PromptAssistanceProvider
  model: string
  apiKey: string
  systemInstruction: string
  userInstruction: string
}

export type PromptProviderOutput = {
  text: string
  usage: PromptAssistanceUsage | null
}

export async function executePromptProvider(input: PromptProviderInput): Promise<PromptProviderOutput> {
  assertProviderExecutionAllowed({ provider: input.provider, operation: 'text_generation' })

  if (input.provider === 'openai') {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: 'system', content: input.systemInstruction },
            { role: 'user', content: input.userInstruction },
          ],
          max_tokens: 700,
          temperature: 0.7,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw new PromptAssistanceError('PROVIDER_UNAVAILABLE', 'A OpenAI excedeu o tempo limite.', 504)
      throw new PromptAssistanceError('PROVIDER_UNAVAILABLE', 'Não foi possível alcançar a OpenAI.', 502)
    } finally {
      clearTimeout(timer)
    }
    const data = await response.json().catch(() => null) as Record<string, any> | null
    if (!response.ok) throw providerStatus(response.status, 'OpenAI')
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      throw new PromptAssistanceError(
        'PROVIDER_INVALID_RESPONSE',
        'A OpenAI retornou uma sugestão vazia.',
        502,
        openAiUsage(data?.usage, data?.id),
      )
    }
    return { text: text.trim(), usage: openAiUsage(data?.usage, data?.id) }
  }

  try {
    const result = await createGeminiClient().generateContent({
      apiKey: input.apiKey,
      model: input.model,
      systemInstruction: input.systemInstruction,
      parts: [{ text: input.userInstruction }],
      responseSchema: null,
      timeoutMs: GEMINI_TIMEOUT_MS,
    })
    return { text: result.text.trim(), usage: geminiUsage(result.usage, result.responseId) }
  } catch (error) {
    const kind = (error as { kind?: string })?.kind
    if ((error as { providerStatus?: number })?.providerStatus === 429) throw new PromptAssistanceError('PROVIDER_RATE_LIMITED', 'Gemini está temporariamente limitado. Tente novamente em instantes.', 429)
    if (kind === 'invalid_credential') throw new PromptAssistanceError('PROVIDER_NOT_CONFIGURED', 'A credencial do Gemini não foi aceita.', 422)
    if (kind === 'unsupported_model') throw new PromptAssistanceError('UNSUPPORTED_MODEL', 'O modelo Gemini selecionado não está disponível.', 422)
    if (kind === 'timeout') throw new PromptAssistanceError('PROVIDER_UNAVAILABLE', 'O Gemini excedeu o tempo limite.', 504)
    if (kind === 'invalid_response') {
      const usage = geminiUsage((error as { usage?: unknown })?.usage, (error as { providerRequestId?: unknown })?.providerRequestId)
      throw new PromptAssistanceError('PROVIDER_INVALID_RESPONSE', 'O Gemini retornou uma sugestão inválida.', 502, usage)
    }
    throw new PromptAssistanceError('PROVIDER_UNAVAILABLE', 'Não foi possível concluir a assistência no Gemini.', 502)
  }
}
