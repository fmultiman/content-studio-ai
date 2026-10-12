import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  GEMINI_IMAGE_MAX_BYTES,
  GeminiImageError,
  buildGeminiImageRequestBody,
  buildGeminiImageUrl,
  generateGeminiImage,
  type GeminiImageErrorKind,
} from '@/lib/providers/gemini/image-client'
import {
  GEMINI_IMAGE_ALIASES,
  GEMINI_IMAGE_ASPECT_RATIOS,
  GEMINI_IMAGE_SIZE,
  isGeminiImageAlias,
  resolveGeminiImageModel,
} from '@/lib/providers/gemini/image-models'
import { GEMINI_IMAGE_GENERATION_FLAG, isGeminiImageGenerationEnabled } from '@/lib/providers/gemini/image-feature'

// FUTURE-064 Slice A — pure unit tests. Every provider call is a fake `fetch`: 0 real calls, dummy key.

let png: Buffer
let jpeg: Buffer
let webp: Buffer
beforeAll(async () => {
  const base = { create: { width: 32, height: 32, channels: 3 as const, background: '#cc3366' } }
  png = await sharp(base).png().toBuffer()
  jpeg = await sharp(base).jpeg().toBuffer()
  webp = await sharp(base).webp().toBuffer()
})

const KEY = 'AIza-dummy-key-not-real'
const request = (overrides: Record<string, unknown> = {}) => ({
  apiKey: KEY, providerModel: 'gemini-nano-banana-2.1', prompt: 'a red fox', aspectRatio: '1:1', imageSize: GEMINI_IMAGE_SIZE, ...overrides,
})
const ok = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init })
const imageBody = (bytes: Buffer, mimeType = 'image/png', extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] }, finishReason: 'STOP' }],
  ...extra,
})
const run = (response: Response | (() => Promise<Response>), overrides: Record<string, unknown> = {}) => {
  const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response)) as unknown as typeof fetch
  return { fetchImpl, promise: generateGeminiImage(request(overrides), { fetchImpl }) }
}
const kindOf = async (promise: Promise<unknown>): Promise<GeminiImageErrorKind> => {
  try { await promise } catch (error) { if (error instanceof GeminiImageError) return error.kind; throw error }
  throw new Error('expected a GeminiImageError')
}

describe('Gemini image model registry (closed, server-side)', () => {
  it('resolves exactly the two approved V1 aliases to the official Google model ids', () => {
    expect(GEMINI_IMAGE_ALIASES).toEqual(['gemini-nb-2.1', 'gemini-nb-lite'])
    expect(resolveGeminiImageModel('gemini-nb-2.1')).toMatchObject({ providerModel: 'gemini-nano-banana-2.1' })
    expect(resolveGeminiImageModel('gemini-nb-lite')).toMatchObject({ providerModel: 'gemini-3.1-flash-lite-image' })
  })

  it('keeps every alias within the varchar(20) selector columns', () => {
    for (const alias of GEMINI_IMAGE_ALIASES) expect(alias.length).toBeLessThanOrEqual(20)
  })

  it.each([
    'gpt-image-2', 'nanobanana-v1', 'nanobanana-v2', 'v1', 'gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image',
    'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image', 'GEMINI-NB-2.1', ' gemini-nb-2.1', 'gemini-nb-2.1 ',
    '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'gemini-nb-pro', 'gemini-nb-2',
  ])('rejects %j (no alias, no fallback)', (value) => {
    expect(resolveGeminiImageModel(value)).toBeNull()
    expect(isGeminiImageAlias(value)).toBe(false)
  })

  it.each([undefined, null, 0, 1, true, {}, [], ['gemini-nb-2.1']])('rejects non-string %j', (value) => {
    expect(resolveGeminiImageModel(value)).toBeNull()
  })

  it('documents the 10 official aspect ratios and fixes the V1 size at 1K', () => {
    expect(GEMINI_IMAGE_ASPECT_RATIOS).toHaveLength(10)
    expect(GEMINI_IMAGE_SIZE).toBe('1K')
  })
})

describe('Gemini image release switch', () => {
  it('is OFF unless the exact acknowledgement string is present', () => {
    expect(isGeminiImageGenerationEnabled({})).toBe(false)
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on', 'Enabled', ' enabled', 'enabled ', '']) {
      expect(isGeminiImageGenerationEnabled({ [GEMINI_IMAGE_GENERATION_FLAG]: value })).toBe(false)
    }
    expect(isGeminiImageGenerationEnabled({ [GEMINI_IMAGE_GENERATION_FLAG]: 'enabled' })).toBe(true)
  })
})

describe('generateGeminiImage — official generateContent contract', () => {
  it.each(GEMINI_IMAGE_ASPECT_RATIOS)('uses Lite 1K with the supported ratio %s and parses one inline image', async (aspectRatio) => {
    const { fetchImpl, promise } = run(ok(imageBody(png)), { providerModel: 'gemini-3.1-flash-lite-image', aspectRatio })
    const result = await promise
    expect(result.bytes.equals(png)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '1K' } })
  })
  it.each(['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'])('sends one image-only POST to %s with the key only in x-goog-api-key', async (providerModel) => {
    const { fetchImpl, promise } = run(ok(imageBody(png)), { providerModel })
    await promise
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${providerModel}:generateContent`)
    expect(url).not.toContain(KEY)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'x-goog-api-key': KEY, 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'a red fox' }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    })
    expect(init.redirect).toBe('error')
  })

  it('has no way to carry an input image: the request body is text-only', () => {
    const body = JSON.stringify(buildGeminiImageRequestBody({ prompt: 'x', aspectRatio: '16:9', imageSize: '1K' }))
    expect(body).not.toMatch(/inlineData|fileData|inline_data|file_data/)
    expect(buildGeminiImageUrl('gemini-3.1-flash-lite-image')).toContain('/models/gemini-3.1-flash-lite-image:generateContent')
  })

  it('returns validated bytes, mime type, dimensions, and normalized usage (unknown stays null, never 0)', async () => {
    const withUsage = imageBody(png, 'image/png', {
      responseId: 'resp-1', modelVersion: 'v-1',
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 1290, totalTokenCount: 1302, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }], serviceTier: 'standard' },
    })
    const result = await run(ok(withUsage)).promise
    expect(result.mimeType).toBe('image/png')
    expect(result.bytes.equals(png)).toBe(true)
    expect([result.width, result.height]).toEqual([32, 32])
    expect(result.responseId).toBe('resp-1')
    expect(result.modelVersion).toBe('v-1')
    expect(result.usage).toMatchObject({ promptTokens: 12, candidatesTokens: 1290, candidatesTokensDetails: [{ modality: 'IMAGE', tokens: 1290 }], serviceTier: 'standard', thoughtsTokens: null })

    const noUsage = await run(ok(imageBody(png))).promise
    expect(noUsage.usage).toBeNull()
  })

  it.each([['image/jpeg', () => jpeg], ['image/webp', () => webp]])('accepts %s when the bytes match', async (mime, bytes) => {
    const result = await run(ok(imageBody(bytes(), mime))).promise
    expect(result.mimeType).toBe(mime)
  })

  it('accepts the snake_case inline_data spelling', async () => {
    const body = { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: png.toString('base64') } }] } }] }
    expect((await run(ok(body)).promise).mimeType).toBe('image/png')
  })

  it('uses the first image and ignores leading text parts', async () => {
    const body = { candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }
    expect((await run(ok(body)).promise).bytes.equals(png)).toBe(true)
  })
})

describe('generateGeminiImage — error classification, zero retries', () => {
  it.each([
    [400, 'invalid_request'], [401, 'invalid_credential'], [403, 'invalid_credential'], [404, 'unsupported_model'],
    [408, 'timeout'], [429, 'rate_limited'], [500, 'provider_server_error'], [503, 'provider_server_error'],
  ] as const)('HTTP %i -> %s with exactly one request (no automatic retry)', async (status, kind) => {
    const { fetchImpl, promise } = run(new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), { status }))
    expect(await kindOf(promise)).toBe(kind)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats an API_KEY_INVALID 400 as a rejected credential', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 })
    expect(await kindOf(run(response).promise)).toBe('invalid_credential')
  })

  it('never copies provider bodies, the prompt or the key into an error', async () => {
    const response = new Response(JSON.stringify({ error: { message: `leaked ${KEY} a red fox` } }), { status: 500 })
    const error = await run(response).promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GeminiImageError)
    expect(String((error as Error).message)).not.toMatch(/leaked|a red fox|AIza/)
  })

  it('classifies a network failure and an abort without retrying', async () => {
    const network = vi.fn(async () => { throw new TypeError('fetch failed: getaddrinfo secret-host') }) as unknown as typeof fetch
    expect(await kindOf(generateGeminiImage(request(), { fetchImpl: network }))).toBe('network')
    expect(network).toHaveBeenCalledTimes(1)
    const aborted = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as unknown as typeof fetch
    expect(await kindOf(generateGeminiImage(request(), { fetchImpl: aborted }))).toBe('timeout')
  })

  it('aborts a request that exceeds the timeout', async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })) as unknown as typeof fetch
    expect(await kindOf(generateGeminiImage(request({ timeoutMs: 20 }), { fetchImpl: hang }))).toBe('timeout')
  })

  it('flags which failures leave the provider outcome unknown (possible charge) and which are definite', () => {
    expect(new GeminiImageError('network', 'x').outcomeUnknown).toBe(true)
    expect(new GeminiImageError('timeout', 'x').outcomeUnknown).toBe(true)
    expect(new GeminiImageError('invalid_image', 'x').outcomeUnknown).toBe(true)
    expect(new GeminiImageError('invalid_credential', 'x').outcomeUnknown).toBe(false)
    expect(new GeminiImageError('rate_limited', 'x').outcomeUnknown).toBe(false)
    expect(new GeminiImageError('content_blocked', 'x').outcomeUnknown).toBe(false)
  })
})

describe('generateGeminiImage — malformed, empty, blocked and invalid payloads', () => {
  it('rejects a non-JSON 200', async () => { expect(await kindOf(run(ok('<html>not json</html>')).promise)).toBe('malformed_response') })
  it.each([['null'], ['[]'], ['"x"'], ['7']])('rejects a non-object JSON body %s', async (body) => {
    expect(await kindOf(run(ok(body)).promise)).toBe('malformed_response')
  })
  it('reports no_image for empty candidates and text-only answers', async () => {
    expect(await kindOf(run(ok({ candidates: [] })).promise)).toBe('no_image')
    expect(await kindOf(run(ok({})).promise)).toBe('no_image')
    expect(await kindOf(run(ok({ candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'STOP' }] })).promise)).toBe('no_image')
    expect(await kindOf(run(ok({ candidates: [{ finishReason: 'STOP' }] })).promise)).toBe('no_image')
  })
  it('reports content_blocked for promptFeedback blocks and blocked finish reasons', async () => {
    expect(await kindOf(run(ok({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).promise)).toBe('content_blocked')
    expect(await kindOf(run(ok({ candidates: [], promptFeedback: { blockReason: 'IMAGE_SAFETY' } })).promise)).toBe('content_blocked')
    for (const finishReason of ['SAFETY', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST']) {
      expect(await kindOf(run(ok({ candidates: [{ finishReason }] })).promise)).toBe('content_blocked')
    }
  })
  it('rejects invalid base64, unsupported types, signature mismatches, undecodable and tiny images', async () => {
    const part = (inline: unknown) => ok({ candidates: [{ content: { parts: [{ inlineData: inline }] } }] })
    expect(await kindOf(run(part({ mimeType: 'image/png', data: 'not base64 !!' })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/png', data: `${png.toString('base64').slice(0, 40)}@@@@` })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/png', data: 'abc' })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/gif', data: png.toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ data: png.toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/jpeg', data: png.toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/png', data: Buffer.alloc(500, 7).toString('base64') })).promise)).toBe('invalid_image')
    const fakePng = Buffer.concat([png.subarray(0, 8), Buffer.alloc(200, 1)])
    expect(await kindOf(run(part({ mimeType: 'image/png', data: fakePng.toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/png', data: Buffer.from('tiny').toString('base64') })).promise)).toBe('invalid_image')
    expect(await kindOf(run(part({ mimeType: 'image/png', data: 12345 })).promise)).toBe('malformed_response')
  })
  it('rejects oversized payloads before decoding or parsing them', async () => {
    const declared = new Response('{}', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } })
    expect(await kindOf(run(declared).promise)).toBe('image_too_large')
    const huge = 'A'.repeat(Math.ceil(((GEMINI_IMAGE_MAX_BYTES + 4096) / 3)) * 4)
    expect(await kindOf(run(ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: huge } }] } }] })).promise)).toBe('image_too_large')
  })
  it('stops reading a streamed body that grows past the cap', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(4 * 1024 * 1024)); if (pulled > 20) controller.close() },
    })
    expect(await kindOf(run(new Response(stream, { status: 200 })).promise)).toBe('image_too_large')
    expect(pulled).toBeLessThan(10)
  })
})

describe('FUTURE-064 Slice C — what Google sent is carried on failures that happened AFTER a response was received', () => {
  const failure = async (promise: Promise<unknown>) => (await promise.then(() => null, (error: unknown) => error)) as GeminiImageError
  const usageMetadata = { promptTokenCount: 14, candidatesTokenCount: 1290, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1290 }] }

  it('a blocked prompt, a missing image and an invalid image carry the reported usage, response id and model version', async () => {
    const envelopes: Array<[unknown, GeminiImageErrorKind]> = [
      [{ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata, responseId: 'r1', modelVersion: 'm1' }, 'content_blocked'],
      [{ candidates: [{ content: { parts: [{ text: 'sorry' }] } }], usageMetadata, responseId: 'r1', modelVersion: 'm1' }, 'no_image'],
      [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: '!!!!' } }] } }], usageMetadata, responseId: 'r1', modelVersion: 'm1' }, 'invalid_image'],
      [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 5 } }] } }], usageMetadata, responseId: 'r1', modelVersion: 'm1' }, 'malformed_response'],
    ]
    for (const [envelope, kind] of envelopes) {
      const error = await failure(run(ok(envelope)).promise)
      expect(error.kind).toBe(kind)
      expect(error.received).toMatchObject({ responseId: 'r1', modelVersion: 'm1', usage: { promptTokens: 14, candidatesTokens: 1290, serviceTier: 'standard', candidatesTokensDetails: [{ modality: 'IMAGE', tokens: 1290 }] } })
    }
  })

  it('a received response that reports no usage carries usage: null (unknown, not zero)', async () => {
    const error = await failure(run(ok({ promptFeedback: { blockReason: 'OTHER' } })).promise)
    expect(error.received).toEqual({ usage: null, responseId: null, modelVersion: null })
  })

  it('a 2xx response too large to read is a received execution with unknown usage', async () => {
    const error = await failure(run(new Response('{}', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } })).promise)
    expect(error.kind).toBe('image_too_large')
    expect(error.received).toEqual({ usage: null, responseId: null, modelVersion: null })
  })

  it('NO received usage exists for HTTP error statuses, network failures, timeouts or unreadable bodies (nothing to account)', async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      expect((await failure(run(new Response(JSON.stringify({ error: { message: 'x' }, usageMetadata }), { status })).promise)).received).toBeNull()
    }
    const network = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    expect((await failure(generateGeminiImage(request(), { fetchImpl: network }))).received).toBeNull()
    const aborted = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as unknown as typeof fetch
    expect((await failure(generateGeminiImage(request(), { fetchImpl: aborted }))).received).toBeNull()
    expect((await failure(run(ok('<html>not json</html>')).promise)).received).toBeNull()
    expect((await failure(run(ok('[]')).promise)).received).toBeNull()
  })

  it('a successful call returns the same normalized usage the failure paths carry', async () => {
    const result = await run(ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }], usageMetadata, responseId: 'r9' })).promise
    expect(result.usage).toMatchObject({ promptTokens: 14, candidatesTokens: 1290 })
    expect(result.responseId).toBe('r9')
  })
})
