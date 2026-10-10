import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/execution-policy', () => ({ assertProviderExecutionAllowed: vi.fn() }))

describe('Prompt Assistance provider adapters', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('executes OpenAI with the selected model and returns factual usage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'openai-req',
      choices: [{ message: { content: 'A precise image prompt.' } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const result = await executePromptProvider({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'secret', systemInstruction: 'system', userInstruction: 'user' })
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(body.model).toBe('gpt-4o-mini')
    expect(result).toEqual({ text: 'A precise image prompt.', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18, providerRequestId: 'openai-req' } })
  })

  it('normalizes Gemini usage and maps rate limits without exposing provider bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), { status: 429 }))
    const { executePromptProvider } = await import('../providers')
    await expect(executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash', apiKey: 'secret', systemInstruction: 'system', userInstruction: 'user' })).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' })
  })

  it('returns Gemini text and token counts from the official generateContent shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gemini-req',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'A Gemini image prompt.' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6, totalTokenCount: 16, serviceTier: 'standard' },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const result = await executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'secret', systemInstruction: 'system', userInstruction: 'user' })
    expect(fetchSpy.mock.calls[0][0]).toContain('gemini-3.5-flash-lite:generateContent')
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).generationConfig.responseMimeType).toBe('text/plain')
    expect(result).toMatchObject({ text: 'A Gemini image prompt.', usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16, serviceTier: 'standard', providerRequestId: 'gemini-req' } })
  })

  it('keeps provider-reported usage on an unusable Gemini 200 (blocked or truncated) without leaking provider text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gemini-cut',
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial secret text' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 4096, totalTokenCount: 4116 },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const error = await executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' }).catch((e) => e)
    expect(error).toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE', status: 502, usage: { inputTokens: 20, outputTokens: 4096, totalTokens: 4116, providerRequestId: 'gemini-cut' } })
    expect(String(error.message)).not.toContain('partial secret text')
  })

  it('keeps provider-reported usage when OpenAI returns an empty suggestion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'openai-empty',
      choices: [{ message: { content: '   ' } }],
      usage: { prompt_tokens: 30, completion_tokens: 0, total_tokens: 30 },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    await expect(executePromptProvider({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' }))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE', usage: { inputTokens: 30, outputTokens: 0, totalTokens: 30, providerRequestId: 'openai-empty' } })
  })

  it('captures Gemini thinking tokens, the cached subset, tool-use tokens and the service tier ONLY as reported, without adding them to the other counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gem-think',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden reasoning' }, { text: 'Visible prompt.' }] } }],
      usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 50, toolUsePromptTokenCount: 4, totalTokenCount: 184, serviceTier: 'flex' },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const result = await executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' })
    expect(result.text).toBe('Visible prompt.')
    expect(result.usage).toEqual({
      inputTokens: 100, outputTokens: 30, totalTokens: 184, serviceTier: 'flex', thoughtsTokens: 50, cachedInputTokens: 20, toolUsePromptTokens: 4, providerRequestId: 'gem-think',
    })
  })

  it('does not invent Gemini thinking or tier data the provider did not send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gem-plain',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Plain.' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6, totalTokenCount: 16 },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const { usage } = await executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash-lite', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' })
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 6, totalTokens: 16, serviceTier: null, providerRequestId: 'gem-plain' })
    expect(usage).not.toHaveProperty('thoughtsTokens')
  })

  it('Gemini thinking tokens survive a rejected (truncated) paid response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      responseId: 'gem-cut2',
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'x' }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 4000, totalTokenCount: 4030 },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    await expect(executePromptProvider({ provider: 'gemini', model: 'gemini-3.5-flash', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' }))
      .rejects.toMatchObject({ code: 'PROVIDER_INVALID_RESPONSE', usage: { inputTokens: 20, outputTokens: 10, thoughtsTokens: 4000, providerRequestId: 'gem-cut2' } })
  })

  it('captures the OpenAI cached subset and the service tier the response itself reports, and nothing else', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'openai-tier',
      service_tier: 'default',
      choices: [{ message: { content: 'Prompt.' } }],
      usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: 0 } },
    }), { status: 200 }))
    const { executePromptProvider } = await import('../providers')
    const { usage } = await executePromptProvider({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' })
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 40, totalTokens: 1240, cachedInputTokens: 1024, serviceTier: 'default', providerRequestId: 'openai-tier' })
  })

  it('ignores an OpenAI service_tier that is not a plain token and never defaults a missing one', async () => {
    const run = async (service_tier: unknown) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        id: 'o', ...(service_tier === undefined ? {} : { service_tier }), choices: [{ message: { content: 'P.' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }))
      const { executePromptProvider } = await import('../providers')
      return (await executePromptProvider({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'secret', systemInstruction: 's', userInstruction: 'u' })).usage
    }
    expect(await run(undefined)).not.toHaveProperty('serviceTier')
    expect(await run('<script>alert(1)</script>')).not.toHaveProperty('serviceTier')
    expect(await run(null)).not.toHaveProperty('serviceTier')
  })
})
