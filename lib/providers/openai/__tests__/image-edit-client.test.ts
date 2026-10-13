import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { editOpenAIImage, buildOpenAIImageEditBody, OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES,
  OPENAI_IMAGE_EDIT_OUTPUT_MAX_BYTES, OPENAI_IMAGE_EDIT_TIMEOUT_MS } from '../image-edit-client'

let png: Buffer
let jpeg: Buffer
let webp: Buffer
beforeAll(async () => {
  const image = sharp({ create: { width: 32, height: 24, channels: 3, background: '#205090' } })
  ;[png, jpeg, webp] = await Promise.all([image.clone().png({ compressionLevel: 0 }).toBuffer(), image.clone().jpeg().toBuffer(), image.clone().webp().toBuffer()])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
const request = () => ({ apiKey: 'dummy-key-never-live', prompt: '  sunset scene  ', size: '1024x1024', quality: 'medium', referenceImage: { bytes: png, mimeType: 'image/png' as const } })
const response = (extra: Record<string, unknown> = {}, status = 200) => new Response(JSON.stringify({
  data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 105, output_tokens: 32 }, ...extra,
}), { status, headers: { 'x-request-id': 'req-test-123' } })

describe('GPT Image 2 edit multipart contract', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)('sends exactly one verified %s file with fixed safe fields', async (mimeType) => {
    const bytes = { 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp }[mimeType]
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response())
    const result = await editOpenAIImage({ ...request(), referenceImage: { bytes, mimeType } }, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer dummy-key-never-live' } })
    expect(new Headers(init!.headers).has('content-type')).toBe(false)
    const multipart = init!.body as FormData
    expect([...multipart.keys()].sort()).toEqual(['background', 'image[]', 'model', 'moderation', 'n', 'output_format', 'prompt', 'quality', 'size'])
    expect(Object.fromEntries([...multipart.entries()].filter(([key]) => key !== 'image[]'))).toEqual({
      model: 'gpt-image-2', prompt: 'sunset scene', size: '1024x1024', quality: 'medium', n: '1', output_format: 'png', background: 'opaque', moderation: 'auto',
    })
    const file = multipart.get('image[]') as File
    expect(file.type).toBe(mimeType)
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes)
    expect(result).toMatchObject({ bytes: png, mimeType: 'image/png', width: 32, height: 24, responseId: 'req-test-123', rawUsage: { input_tokens: 105, output_tokens: 32 } })
  })

  it.each(['1024x1024', '1536x1024', '1024x1536'])('supports only existing V1 output control %s', (size) => {
    expect(buildOpenAIImageEditBody({ ...request(), size }).get('size')).toBe(size)
  })

  it.each([{ size: 'auto' }, { size: '3840x2160' }, { quality: 'auto' }, { quality: 'max' }, { prompt: '' }])('rejects invalid edit controls %j before fetch', async (extra) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(editOpenAIImage({ ...request(), ...extra }, { fetchImpl })).rejects.toMatchObject({ code: 'INVALID_EDIT_REQUEST', outcomeUnknown: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('bounded inline PNG outputs and usage evidence', () => {
  it.each([
    ['URL-only', { data: [{ url: 'http://169.254.169.254/never-fetch' }] }],
    ['invalid base64', { data: [{ b64_json: 'AAAA $$$' }] }],
    ['base64 whitespace', { data: [{ b64_json: ' YQ== ' }] }],
    ['noncanonical base64', { data: [{ b64_json: 'Zh==' }] }],
    ['empty data', { data: [] }], ['multiple results', { data: [{ b64_json: 'YQ==' }, { b64_json: 'YQ==' }] }],
  ])('rejects %s without remote fetch and retains received usage', async (_name, extra) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(extra))
    await expect(editOpenAIImage(request(), { fetchImpl })).rejects.toMatchObject({ status: 502, outcomeUnknown: true,
      received: { rawUsage: { input_tokens: 105, output_tokens: 32 }, responseId: 'req-test-123' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects a JPEG declared by the forced PNG output request', async () => {
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ b64_json: jpeg.toString('base64') }] })) })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', received: { rawUsage: { input_tokens: 105 } } })
  })

  it('fully decodes PNG pixels, rejecting readable headers with truncated pixels', async () => {
    const partial = png.subarray(0, Math.floor(png.length / 2))
    expect(await sharp(partial).metadata()).toMatchObject({ format: 'png', width: 32, height: 24 })
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ b64_json: partial.toString('base64') }] })) })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', received: { responseId: 'req-test-123' } })
  })

  it('rejects an output edge beyond the registry ceiling before accepting the result', async () => {
    const beyondEdge = await sharp({ create: { width: 3841, height: 1, channels: 3, background: '#205090' } }).png().toBuffer()
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ b64_json: beyondEdge.toString('base64') }] })) })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', received: { responseId: 'req-test-123' } })
  })

  it('rejects oversized output before decoding while keeping parsed usage', async () => {
    const bytes = Buffer.alloc(OPENAI_IMAGE_EDIT_OUTPUT_MAX_BYTES + 1)
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [{ b64_json: bytes.toString('base64') }] }))
    await expect(editOpenAIImage(request(), { fetchImpl })).rejects.toMatchObject({ code: 'PROVIDER_IMAGE_TOO_LARGE', received: { rawUsage: { input_tokens: 105 } } })
  })

  it('cancels a declared oversized 2xx envelope and retains receipt with unknown usage', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{}')) }, cancel })
    const huge = new Response(stream, { headers: { 'content-length': String(OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES + 1), 'x-request-id': 'req-oversized-declared' } })
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(huge) })).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE', outcomeUnknown: true,
      received: { rawUsage: null, responseId: 'req-oversized-declared' },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('enforces envelope bytes even when content-length is understated', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES)); controller.enqueue(new Uint8Array([1])) }, cancel })
    const huge = new Response(stream, { headers: { 'content-length': '1', 'x-request-id': 'req-oversized-stream' } })
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(huge) })).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE', outcomeUnknown: true,
      received: { rawUsage: null, responseId: 'req-oversized-stream' },
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not trust an invalid request ID header', async () => {
    const ok = response()
    ok.headers.set('x-request-id', 'secret?unsafe=' + 'a'.repeat(150))
    expect((await editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(ok) })).responseId).toBeNull()
  })

  it.each([
    ['malformed JSON', '{'], ['truncated JSON', '{"data":[{"b64_json":"unfinished'],
    ['null envelope', 'null'], ['array envelope', '[]'], ['primitive envelope', '42'], ['empty body', ''],
  ])('retains successful HTTP receipt and unknown usage for %s', async (_name, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200, headers: { 'x-request-id': 'req-unreadable-200' } }))
    await expect(editOpenAIImage(request(), { fetchImpl })).rejects.toMatchObject({ status: 502, code: 'INVALID_PROVIDER_RESPONSE', outcomeUnknown: true,
      received: { rawUsage: null, responseId: 'req-unreadable-200' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retains a successful receipt after response stream reading fails', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('private stream details')) } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'x-request-id': 'req-stream-failed' } }))
    const promise = editOpenAIImage(request(), { fetchImpl })
    await expect(promise).rejects.toMatchObject({ status: 502, code: 'INVALID_PROVIDER_RESPONSE', outcomeUnknown: true,
      received: { rawUsage: null, responseId: 'req-stream-failed' },
    })
    await expect(promise).rejects.not.toHaveProperty('message', 'private stream details')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('controlled failures and one bounded submission', () => {
  it.each([
    [401, 'PROVIDER_CREDENTIAL_REJECTED', 400, false], [403, 'PROVIDER_CREDENTIAL_REJECTED', 400, false],
    [429, 'PROVIDER_RATE_LIMITED', 429, false], [400, 'PROVIDER_ERROR', 502, false],
    [500, 'PROVIDER_UNAVAILABLE', 502, true], [503, 'PROVIDER_UNAVAILABLE', 502, true],
  ])('maps HTTP %s to %s with safe message and no usage claim', async (http, code, status, outcomeUnknown) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { message: 'sensitive user content and provider secret' } }, http))
    const promise = editOpenAIImage(request(), { fetchImpl })
    await expect(promise).rejects.toMatchObject({ code, status, outcomeUnknown, received: null })
    await expect(promise).rejects.not.toHaveProperty('message', 'sensitive user content and provider secret')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([400, 403, 422, 429])('maps proven moderation_blocked HTTP %s before credential/quota classification', async (status) => {
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: 'moderation_blocked', message: 'private prompt' } }, status)) })).rejects.toMatchObject({ status: 422, code: 'PROVIDER_CONTENT_BLOCKED', outcomeUnknown: false, received: null })
  })

  it('maps malformed 401 bodies as credential errors instead of invalid image responses', async () => {
    await expect(editOpenAIImage(request(), { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 401 })) })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_REJECTED', outcomeUnknown: false, received: null })
  })

  it('maps network failure generically and never retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret request data'))
    await expect(editOpenAIImage(request(), { fetchImpl })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', outcomeUnknown: true, received: null })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('aborts a stalled request at 120 seconds without resubmitting', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    const promise = editOpenAIImage(request(), { fetchImpl })
    const assertion = expect(promise).rejects.toMatchObject({ status: 504, code: 'PROVIDER_TIMEOUT', outcomeUnknown: true, received: null })
    await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_EDIT_TIMEOUT_MS)
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1]!.signal!.aborted).toBe(true)
  })

  it('bounds a stalled response stream under the same request deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers: { 'x-request-id': 'req-stalled-body' } }))
    const promise = editOpenAIImage(request(), { fetchImpl })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', outcomeUnknown: true,
      received: { rawUsage: null, responseId: 'req-stalled-body' },
    })
    await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_EDIT_TIMEOUT_MS)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps received null when a non-2xx body stalls before the deadline', async () => {
    vi.useFakeTimers()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 500, headers: { 'x-request-id': 'req-non-2xx' } }))
    const promise = editOpenAIImage(request(), { fetchImpl })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', outcomeUnknown: true, received: null })
    await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_EDIT_TIMEOUT_MS)
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retains received usage when the deadline expires during output pixel decoding', async () => {
    vi.useFakeTimers()
    const stats = vi.spyOn(Object.getPrototypeOf(sharp(png)), 'stats').mockImplementation(() => new Promise(() => undefined))
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response())
    const promise = editOpenAIImage(request(), { fetchImpl })
    const assertion = expect(promise).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', outcomeUnknown: true,
      received: { responseId: 'req-test-123', rawUsage: { input_tokens: 105, output_tokens: 32 } },
    })
    await vi.waitFor(() => expect(stats).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(OPENAI_IMAGE_EDIT_TIMEOUT_MS)
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
