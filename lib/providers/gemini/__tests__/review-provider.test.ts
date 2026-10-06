import { describe, expect, it, vi } from 'vitest'
import { createGeminiClient } from '../client'
import { createGeminiReviewProvider } from '../review-provider'
import { GEMINI_REVIEW_MODELS, assertGeminiModelSupports } from '../review-models'
import { REVIEW_VIDEO_MAX_BYTES, REVIEW_VIDEO_MAX_DURATION_MS } from '@/lib/reviews/media-limits'
import type { AuthorizedReviewMedia } from '@/lib/reviews/execution-provider'

const KEY = 'AIza-test-secret-key'
const HOST = 'https://generativelanguage.googleapis.com'
const UPLOAD_URL = `${HOST}/upload/v1beta/files/session-1`
const FILE_URI = `${HOST}/v1beta/files/abc`

type Call = { url: string; init: RequestInit }

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function modelOk(text = '{"score":90,"feedback":"ok","improvements":[]}') {
  return json({ responseId: 'resp-1', candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { totalTokenCount: 12 } })
}

function harness(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return handler(call, calls.length - 1)
  }) as unknown as typeof fetch
  let clock = 0
  const sleep = vi.fn(async (ms: number) => { clock += ms })
  const client = createGeminiClient({ fetchImpl, sleep, now: () => clock })
  return { calls, fetchImpl, sleep, provider: createGeminiReviewProvider({ client }) }
}

function image(overrides: Partial<AuthorizedReviewMedia> = {}): AuthorizedReviewMedia {
  return { kind: 'image', artifactId: 'a1', mimeType: 'image/png', byteSize: 3, durationMs: null, load: async () => new Uint8Array([1, 2, 3]), ...overrides }
}

function video(overrides: Partial<AuthorizedReviewMedia> = {}): AuthorizedReviewMedia {
  return { kind: 'video', artifactId: 'v1', mimeType: 'video/mp4', byteSize: 4, durationMs: 30_000, load: async () => new Uint8Array([1, 2, 3, 4]), ...overrides }
}

const base = { apiKey: KEY, model: 'gemini-3.5-flash', instructions: 'system', input: 'input', responseSchema: { type: 'object' } as Record<string, unknown> | null }

function isModelCall(call: Call) { return call.url.includes(':generateContent') }

describe('Gemini Review provider: Image', () => {
  it('sends authorized image bytes inline with the key in a header only and returns raw text + metadata', async () => {
    const h = harness(() => modelOk())
    const response = await h.provider.execute({ ...base, media: [image()] })

    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]
    expect(call.url).toBe(`${HOST}/v1beta/models/gemini-3.5-flash:generateContent`)
    expect(call.url).not.toContain(KEY)
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY)
    const body = JSON.parse(String(call.init.body))
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') })
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } })
    expect(body.systemInstruction.parts[0].text).toBe('system')
    expect(response).toMatchObject({ providerId: 'gemini', model: 'gemini-3.5-flash', providerRequestId: 'resp-1', warnings: [] })
    expect(JSON.parse(response.rawText)).toMatchObject({ score: 90 })
    expect(response.remoteFile).toBeUndefined()
  })

  it('maps provider 4xx/5xx/credential failures without leaking the key or provider body', async () => {
    const cases: Array<[number, unknown, string]> = [
      [400, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }, 'invalid_credential'],
      [403, { error: { message: 'denied' } }, 'invalid_credential'],
      [404, { error: { message: 'model gemini-x is not found' } }, 'unsupported_model'],
      [429, { error: { message: `quota for ${KEY}` } }, 'provider_client_error'],
      [503, { error: { message: 'overloaded' } }, 'provider_server_error'],
    ]
    for (const [status, body, kind] of cases) {
      const h = harness(() => json(body, status))
      const error = await h.provider.execute({ ...base, media: [image()] }).catch((e) => e)
      expect(error).toMatchObject({ name: 'ReviewProviderError', kind })
      expect(String(error.message)).not.toContain(KEY)
      expect(String(error.message)).not.toContain('quota for')
    }
  })

  it('maps an aborted model request to a timeout', async () => {
    const h = harness(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })
    await expect(h.provider.execute({ ...base, media: [image()] })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('treats truncated, blocked, empty and thought-only responses as invalid (never success)', async () => {
    const bodies = [
      { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"score":1' }] } }] },
      { promptFeedback: { blockReason: 'SAFETY' } },
      { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'reasoning', thought: true }] } }] },
      { candidates: [] },
    ]
    for (const body of bodies) {
      const h = harness(() => json(body))
      await expect(h.provider.execute({ ...base, media: [image()] })).rejects.toMatchObject({ kind: 'invalid_response' })
    }
  })

  it('requires a credential before any network call', async () => {
    const h = harness(() => modelOk())
    await expect(h.provider.execute({ ...base, apiKey: '', media: [image()] })).rejects.toMatchObject({ kind: 'missing_credential' })
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Gemini Review provider: native Video via Files API', () => {
  function videoFlow(options: { processing?: Array<'PROCESSING' | 'ACTIVE' | 'FAILED'>; deleteStatus?: number; modelResponse?: () => Response } = {}) {
    const states = [...(options.processing ?? ['ACTIVE'])]
    const fileJson = (state: string) => ({ name: 'files/abc', uri: FILE_URI, mimeType: 'video/mp4', state, expirationTime: '2026-10-08T00:00:00Z' })
    return harness((call) => {
      if (call.url.endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': UPLOAD_URL } })
      if (call.url === UPLOAD_URL) return json({ file: fileJson('PROCESSING') })
      if (call.url.endsWith('/v1beta/files/abc') && call.init.method === 'GET') return json(fileJson(states.shift() ?? 'ACTIVE'))
      if (call.url.endsWith('/v1beta/files/abc') && call.init.method === 'DELETE') return new Response('{}', { status: options.deleteStatus ?? 200 })
      if (isModelCall(call)) return options.modelResponse?.() ?? modelOk()
      return json({}, 500)
    })
  }

  it('uploads, waits for ACTIVE, references the provider file, then deletes it', async () => {
    const h = videoFlow({ processing: ['PROCESSING', 'ACTIVE'] })
    const response = await h.provider.execute({ ...base, media: [video()] })

    const methods = h.calls.map((c) => `${c.init.method} ${c.url.replace(HOST, '')}`)
    expect(methods).toEqual([
      'POST /upload/v1beta/files',
      `POST ${UPLOAD_URL.replace(HOST, '')}`,
      'GET /v1beta/files/abc',
      'GET /v1beta/files/abc',
      'POST /v1beta/models/gemini-3.5-flash:generateContent',
      'DELETE /v1beta/files/abc',
    ])
    const start = h.calls[0].init.headers as Record<string, string>
    expect(start['X-Goog-Upload-Protocol']).toBe('resumable')
    expect(start['X-Goog-Upload-Header-Content-Length']).toBe('4')
    expect(start['X-Goog-Upload-Header-Content-Type']).toBe('video/mp4')
    const finalize = h.calls[1].init.headers as Record<string, string>
    expect(finalize['X-Goog-Upload-Command']).toBe('upload, finalize')
    expect(finalize['x-goog-api-key']).toBeUndefined()
    const model = JSON.parse(String(h.calls[4].init.body))
    expect(model.contents[0].parts[1].fileData).toEqual({ mimeType: 'video/mp4', fileUri: FILE_URI })
    expect(h.sleep.mock.calls.length).toBeLessThanOrEqual(3)
    expect(response.remoteFile).toMatchObject({ id: 'files/abc', deleted: true })
    expect(response.warnings).toEqual([])
  })

  it('rejects an oversized, over-long or unmeasured video before any network call', async () => {
    for (const media of [
      video({ byteSize: REVIEW_VIDEO_MAX_BYTES + 1 }),
      video({ durationMs: REVIEW_VIDEO_MAX_DURATION_MS + 1 }),
      video({ byteSize: null }),
      video({ durationMs: null }),
    ]) {
      const h = videoFlow()
      await expect(h.provider.execute({ ...base, media: [media] })).rejects.toMatchObject({ kind: 'media_limit_exceeded' })
      expect(h.fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('re-checks real byte length, not only declared metadata, before uploading', async () => {
    const h = videoFlow()
    const lying = video({ byteSize: 4, load: async () => ({ byteLength: REVIEW_VIDEO_MAX_BYTES + 1 }) as unknown as Uint8Array })
    await expect(h.provider.execute({ ...base, media: [lying] })).rejects.toMatchObject({ kind: 'media_limit_exceeded' })
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an unsupported model and unsupported media before upload or model call', async () => {
    const h = videoFlow()
    await expect(h.provider.execute({ ...base, model: 'gemini-unknown', media: [video()] })).rejects.toMatchObject({ kind: 'unsupported_model' })
    await expect(h.provider.execute({ ...base, media: [] })).rejects.toMatchObject({ kind: 'unsupported_capability' })
    await expect(h.provider.execute({ ...base, media: [video(), video({ artifactId: 'v2' })] })).rejects.toMatchObject({ kind: 'media_limit_exceeded' })
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })

  it('reports an upload failure as upload_failed and makes no model call', async () => {
    const h = harness((call) => call.url.endsWith('/upload/v1beta/files') ? json({ error: { message: 'x' } }, 500) : modelOk())
    await expect(h.provider.execute({ ...base, media: [video()] })).rejects.toMatchObject({ kind: 'upload_failed' })
    expect(h.calls.some(isModelCall)).toBe(false)
  })

  it('rejects an upload session URL outside the Gemini API host', async () => {
    const h = harness(() => new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://evil.example/upload' } }))
    await expect(h.provider.execute({ ...base, media: [video()] })).rejects.toMatchObject({ kind: 'upload_failed' })
    expect(h.calls).toHaveLength(1)
  })

  it('fails on provider file-processing failure, skips the model call, and still deletes the file', async () => {
    const h = videoFlow({ processing: ['FAILED'] })
    await expect(h.provider.execute({ ...base, media: [video()] })).rejects.toMatchObject({ kind: 'file_processing_failed' })
    expect(h.calls.some(isModelCall)).toBe(false)
    expect(h.calls.at(-1)?.init.method).toBe('DELETE')
  })

  it('times out bounded file processing without aggressive polling and cleans up', async () => {
    const h = videoFlow({ processing: Array(50).fill('PROCESSING') })
    await expect(h.provider.execute({ ...base, media: [video()] })).rejects.toMatchObject({ kind: 'timeout' })
    const polls = h.calls.filter((c) => c.init.method === 'GET').length
    expect(polls).toBeLessThanOrEqual(20)
    expect(h.sleep.mock.calls.every(([ms]) => (ms as number) >= 2_000 && (ms as number) <= 10_000)).toBe(true)
    expect(h.calls.at(-1)?.init.method).toBe('DELETE')
    expect(h.calls.some(isModelCall)).toBe(false)
  })

  it('does not fabricate a Review failure when only cleanup fails; it warns instead', async () => {
    const h = videoFlow({ deleteStatus: 500 })
    const response = await h.provider.execute({ ...base, media: [video()] })
    expect(JSON.parse(response.rawText)).toMatchObject({ score: 90 })
    expect(response.warnings).toEqual([{ code: 'REMOTE_FILE_CLEANUP_FAILED', message: expect.any(String), remoteFileId: 'files/abc' }])
    expect(response.remoteFile?.deleted).toBe(false)
  })

  it('still reports the execution failure (with the cleanup warning attached) when both fail', async () => {
    const h = videoFlow({ deleteStatus: 500, modelResponse: () => json({ error: { message: 'x' } }, 503) })
    const error = await h.provider.execute({ ...base, media: [video()] }).catch((e) => e)
    expect(error).toMatchObject({ kind: 'provider_server_error' })
    expect(error.warnings).toHaveLength(1)
  })

  it('treats an already-expired remote file (404) as a successful cleanup', async () => {
    const h = videoFlow({ deleteStatus: 404 })
    const response = await h.provider.execute({ ...base, media: [video()] })
    expect(response.warnings).toEqual([])
  })
})

describe('Gemini Review model registry', () => {
  it('declares image and video review capability per model and rejects unknown models', () => {
    for (const model of GEMINI_REVIEW_MODELS) {
      expect(assertGeminiModelSupports(model.id, 'image_review').id).toBe(model.id)
      expect(assertGeminiModelSupports(model.id, 'video_review').id).toBe(model.id)
    }
    expect(() => assertGeminiModelSupports('nope', 'image_review')).toThrow(/not a registered/)
  })
})
