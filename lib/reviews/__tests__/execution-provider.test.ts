import { describe, expect, it, vi } from 'vitest'
import {
  REVIEW_PROVIDER_IDS,
  ReviewProviderError,
  assertMediaSupported,
  capabilityForMedia,
  parseProviderJson,
  toReviewServiceError,
  type AuthorizedReviewMedia,
} from '../execution-provider'
import { ReviewServiceError } from '../errors'
import { DEFAULT_REVIEW_PROVIDER_ID, assertProviderModelSupportsMedia, getReviewExecutionProvider, resolveReviewModelId } from '../provider-registry'
import { createOpenAiReviewProvider } from '../providers/openai'
import { createGeminiReviewProvider } from '@/lib/providers/gemini/review-provider'
import { PROVIDER_METADATA } from '@/lib/credentials/provider-metadata'

const image: AuthorizedReviewMedia = { kind: 'image', artifactId: 'a1', mimeType: 'image/png', byteSize: 3, durationMs: null, url: 'https://example.test/server-resolved.png', load: async () => new Uint8Array([1, 2, 3]) }
const video: AuthorizedReviewMedia = { kind: 'video', artifactId: 'v1', mimeType: 'video/mp4', byteSize: 4, durationMs: 1000, load: async () => new Uint8Array([1]) }

describe('Review execution-provider contract', () => {
  it('both providers conform to the shared interface', () => {
    for (const provider of [createOpenAiReviewProvider(), createGeminiReviewProvider()]) {
      expect(REVIEW_PROVIDER_IDS).toContain(provider.providerId)
      expect(typeof provider.execute).toBe('function')
      expect(provider.capabilities).toBeInstanceOf(Set)
    }
    expect(createOpenAiReviewProvider().providerId).toBe('openai')
    expect(createGeminiReviewProvider().providerId).toBe('gemini')
  })

  it('selects providers by canonical id, defaults to OpenAI, and rejects unknown providers', () => {
    expect(DEFAULT_REVIEW_PROVIDER_ID).toBe('openai')
    expect(getReviewExecutionProvider('openai').providerId).toBe('openai')
    expect(getReviewExecutionProvider('gemini').providerId).toBe('gemini')
    expect(() => getReviewExecutionProvider('nano_banana')).toThrow(ReviewProviderError)
    expect(() => getReviewExecutionProvider('antigravity')).toThrow(/Unsupported Review provider/)
    const override = createOpenAiReviewProvider()
    expect(getReviewExecutionProvider('openai', { openai: override })).toBe(override)
  })

  it('declares capabilities truthfully: OpenAI image only, Gemini image and video', () => {
    expect([...createOpenAiReviewProvider().capabilities]).toEqual(['image_review'])
    expect([...createGeminiReviewProvider().capabilities].sort()).toEqual(['image_review', 'video_review'])
    expect(capabilityForMedia('video')).toBe('video_review')
    expect(PROVIDER_METADATA.openai.reviewCapabilities).toEqual(['image_review'])
    expect(PROVIDER_METADATA.gemini.reviewCapabilities).toEqual(['image_review', 'video_review'])
    expect(PROVIDER_METADATA.nano_banana.reviewCapabilities).toEqual([])
    // Gemini has no generation path in this slice.
    expect(PROVIDER_METADATA.gemini.executionImplemented).toBe(false)
  })

  it('rejects unsupported media types before any provider call', async () => {
    const fetchImpl = vi.fn()
    const openai = createOpenAiReviewProvider({ fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(openai.execute({ model: 'gpt-4o-mini', apiKey: 'k', instructions: 's', input: 'i', media: [video], responseSchema: null })).rejects.toMatchObject({ kind: 'unsupported_capability' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(() => assertMediaSupported(openai, [])).toThrow(ReviewProviderError)
    expect(() => assertProviderModelSupportsMedia(openai, 'gpt-4o-mini', 'video')).toThrow(/does not support video/)
    expect(() => assertProviderModelSupportsMedia(createGeminiReviewProvider(), 'gemini-unregistered', 'image')).toThrow(/not a registered/)
  })

  it('preserves model metadata and configured model resolution', () => {
    const prior = { openai: process.env.OPENAI_EVALUATION_MODEL, gemini: process.env.GEMINI_REVIEW_MODEL }
    try {
      delete process.env.OPENAI_EVALUATION_MODEL
      delete process.env.GEMINI_REVIEW_MODEL
      expect(resolveReviewModelId('openai')).toBe('gpt-4o-mini')
      expect(resolveReviewModelId('gemini')).toBe('gemini-3.5-flash')
      process.env.OPENAI_EVALUATION_MODEL = 'gpt-custom'
      process.env.GEMINI_REVIEW_MODEL = 'gemini-3.5-flash-lite'
      expect(resolveReviewModelId('openai')).toBe('gpt-custom')
      expect(resolveReviewModelId('gemini')).toBe('gemini-3.5-flash-lite')
    } finally {
      for (const [key, value] of [['OPENAI_EVALUATION_MODEL', prior.openai], ['GEMINI_REVIEW_MODEL', prior.gemini]] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('normalizes provider errors onto Review service error semantics', () => {
    const cases: Array<[ConstructorParameters<typeof ReviewProviderError>[0], string, number]> = [
      ['timeout', 'REVIEW_PROVIDER_TIMEOUT', 504],
      ['invalid_response', 'REVIEW_INVALID_EVALUATOR_RESPONSE', 502],
      ['missing_credential', 'REVIEW_PROVIDER_NOT_CONFIGURED', 422],
      ['unsupported_model', 'REVIEW_PROVIDER_UNSUPPORTED', 422],
      ['unsupported_capability', 'REVIEW_PROVIDER_UNSUPPORTED', 422],
      ['media_limit_exceeded', 'REVIEW_PROVIDER_UNSUPPORTED', 422],
      ['invalid_credential', 'REVIEW_PROVIDER_ERROR', 502],
      ['provider_client_error', 'REVIEW_PROVIDER_ERROR', 502],
      ['provider_server_error', 'REVIEW_PROVIDER_ERROR', 502],
      ['upload_failed', 'REVIEW_PROVIDER_ERROR', 502],
      ['file_processing_failed', 'REVIEW_PROVIDER_ERROR', 502],
    ]
    for (const [kind, code, status] of cases) {
      expect(toReviewServiceError(new ReviewProviderError(kind, 'm'))).toMatchObject({ code, status })
    }
    const existing = new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'x')
    expect(toReviewServiceError(existing)).toBe(existing)
    expect(toReviewServiceError(new Error('boom'))).toMatchObject({ code: 'REVIEW_PROVIDER_ERROR' })
  })

  it('parseProviderJson never accepts non-JSON text as a Review result', () => {
    expect(parseProviderJson('{"a":1}')).toEqual({ a: 1 })
    expect(() => parseProviderJson('not json')).toThrow(ReviewServiceError)
    expect(() => parseProviderJson('')).toThrow(/invalid JSON/)
  })
})

describe('OpenAI Review provider (adapted historical request)', () => {
  it('sends the same Chat Completions request with the server-resolved URL and returns raw text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'cmpl-1', choices: [{ message: { content: '{"score":80}' } }], usage: { total_tokens: 5 } }), { status: 200 }))
    const provider = createOpenAiReviewProvider({ fetchImpl: fetchImpl as unknown as typeof fetch })
    const response = await provider.execute({ model: 'gpt-4o-mini', apiKey: 'sk-test', instructions: 'SYS', input: 'IN', media: [image], responseSchema: { type: 'object' } })

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: [{ type: 'text', text: 'IN' }, { type: 'image_url', image_url: { url: 'https://example.test/server-resolved.png', detail: 'low' } }] },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1400,
    })
    expect(response).toMatchObject({ rawText: '{"score":80}', providerId: 'openai', model: 'gpt-4o-mini', providerRequestId: 'cmpl-1', warnings: [] })
  })

  it('maps HTTP failures, empty content and aborts to normalized errors', async () => {
    const run = (response: Response | Error) => createOpenAiReviewProvider({
      fetchImpl: (async () => { if (response instanceof Error) throw response; return response }) as unknown as typeof fetch,
    }).execute({ model: 'm', apiKey: 'k', instructions: 's', input: 'i', media: [image], responseSchema: null })
    await expect(run(new Response('{}', { status: 401 }))).rejects.toMatchObject({ kind: 'invalid_credential' })
    await expect(run(new Response('{}', { status: 500 }))).rejects.toMatchObject({ kind: 'provider_server_error' })
    await expect(run(new Response('{}', { status: 422 }))).rejects.toMatchObject({ kind: 'provider_client_error' })
    await expect(run(new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 }))).rejects.toMatchObject({ kind: 'invalid_response' })
    const abort = new Error('x'); abort.name = 'AbortError'
    await expect(run(abort)).rejects.toMatchObject({ kind: 'timeout' })
  })
})
