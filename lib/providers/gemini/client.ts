// GEMINI_REVIEW_PROVIDER_FOUNDATION_V1
//
// Minimal official Gemini API (generativelanguage.googleapis.com) REST client:
// generateContent plus the Files API primitives needed for native Video Review
// (resumable upload, status, delete). Server-side only. The API key is sent in
// the `x-goog-api-key` header, never in a URL, and never appears in a thrown
// message. Provider bodies are never copied into errors.
//
// Not a general Google file manager: no list, no cache, no persistence.

import { ReviewProviderError, type ReviewProviderErrorKind } from '@/lib/reviews/execution-provider'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com'

export const GEMINI_GENERATE_TIMEOUT_MS = 120_000
export const GEMINI_UPLOAD_TIMEOUT_MS = 300_000
export const GEMINI_FILE_PROCESSING_TIMEOUT_MS = 180_000
export const GEMINI_FILE_POLL_INITIAL_MS = 2_000
export const GEMINI_FILE_POLL_MAX_MS = 10_000
export const GEMINI_CLEANUP_TIMEOUT_MS = 15_000

export type GeminiRemoteFile = {
  name: string
  uri: string
  mimeType: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED'
  expirationTime?: string
}

export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }

export type GeminiGenerateInput = {
  model: string
  systemInstruction: string
  parts: GeminiContentPart[]
  responseSchema: Record<string, unknown> | null
  timeoutMs?: number
}

export type GeminiGenerateOutput = {
  text: string
  responseId?: string
  usage?: Record<string, unknown>
}

export type GeminiClientOptions = {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

function classify(status: number, body: unknown): { kind: ReviewProviderErrorKind; message: string } {
  const error = (body as { error?: { message?: unknown; details?: unknown } } | null)?.error
  const reasons = Array.isArray(error?.details)
    ? (error.details as Array<Record<string, unknown>>).map((detail) => detail?.reason)
    : []
  const message = typeof error?.message === 'string' ? error.message : ''
  if (status === 401 || status === 403 || reasons.includes('API_KEY_INVALID') || /api key not valid/i.test(message)) {
    return { kind: 'invalid_credential', message: 'Gemini rejected the configured API key.' }
  }
  if (status === 404) return { kind: 'unsupported_model', message: 'Gemini model or resource was not found.' }
  if (status >= 500) return { kind: 'provider_server_error', message: 'Gemini is temporarily unavailable.' }
  return { kind: 'provider_client_error', message: 'Gemini rejected the request.' }
}

export function createGeminiClient(options: GeminiClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now

  async function request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    failureKind: ReviewProviderErrorKind,
    label: string,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw new ReviewProviderError('timeout', `Gemini ${label} timed out.`)
      throw new ReviewProviderError(failureKind === 'provider_client_error' ? 'provider_server_error' : failureKind, `Gemini ${label} failed.`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function failFromResponse(response: Response, uploadStage: boolean): Promise<never> {
    const body = await response.json().catch(() => null)
    const classified = classify(response.status, body)
    // Upload-stage non-credential failures keep a distinct upload_failed kind.
    const kind = uploadStage && (classified.kind === 'provider_client_error' || classified.kind === 'provider_server_error' || classified.kind === 'unsupported_model')
      ? 'upload_failed'
      : classified.kind
    throw new ReviewProviderError(kind, uploadStage && kind === 'upload_failed' ? 'Gemini file upload failed.' : classified.message, response.status)
  }

  function parseFile(raw: unknown): GeminiRemoteFile {
    const file = ((raw as { file?: unknown } | null)?.file ?? raw) as Record<string, unknown> | null
    if (!file || typeof file.name !== 'string' || typeof file.uri !== 'string') {
      throw new ReviewProviderError('upload_failed', 'Gemini file response was malformed.')
    }
    const state = file.state === 'ACTIVE' || file.state === 'FAILED' ? file.state : 'PROCESSING'
    return {
      name: file.name,
      uri: file.uri,
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
      state,
      expirationTime: typeof file.expirationTime === 'string' ? file.expirationTime : undefined,
    }
  }

  const client = {
    async uploadFile(input: { apiKey: string; bytes: Uint8Array; mimeType: string; displayName?: string; timeoutMs?: number }): Promise<GeminiRemoteFile> {
      const timeoutMs = input.timeoutMs ?? GEMINI_UPLOAD_TIMEOUT_MS
      const start = await request(`${GEMINI_API_BASE}/upload/v1beta/files`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': input.apiKey,
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(input.bytes.byteLength),
          'X-Goog-Upload-Header-Content-Type': input.mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: input.displayName ?? 'content-studio-review' } }),
      }, timeoutMs, 'upload_failed', 'file upload')
      if (!start.ok) await failFromResponse(start, true)
      const uploadUrl = start.headers.get('x-goog-upload-url')
      let parsed: URL | null = null
      try { parsed = uploadUrl ? new URL(uploadUrl) : null } catch { parsed = null }
      // The resumable URL must stay on Google's API host; never follow an arbitrary redirect target.
      if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== 'generativelanguage.googleapis.com') {
        throw new ReviewProviderError('upload_failed', 'Gemini file upload session was invalid.')
      }
      const finalize = await request(parsed.toString(), {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Offset': '0',
          'X-Goog-Upload-Command': 'upload, finalize',
          'Content-Length': String(input.bytes.byteLength),
        },
        body: input.bytes as unknown as BodyInit,
      }, timeoutMs, 'upload_failed', 'file upload')
      if (!finalize.ok) await failFromResponse(finalize, true)
      return parseFile(await finalize.json().catch(() => null))
    },

    async getFile(input: { apiKey: string; name: string }): Promise<GeminiRemoteFile> {
      const response = await request(`${GEMINI_API_BASE}/v1beta/${input.name}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': input.apiKey },
      }, 30_000, 'file_processing_failed', 'file status check')
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const classified = classify(response.status, body)
        throw new ReviewProviderError(classified.kind === 'invalid_credential' ? 'invalid_credential' : 'file_processing_failed', 'Gemini file status check failed.', response.status)
      }
      return parseFile(await response.json().catch(() => null))
    },

    /** Bounded, low-frequency wait for provider-side processing. No unbounded loop. */
    async waitForActiveFile(input: { apiKey: string; file: GeminiRemoteFile; timeoutMs?: number }): Promise<GeminiRemoteFile> {
      const deadline = now() + (input.timeoutMs ?? GEMINI_FILE_PROCESSING_TIMEOUT_MS)
      let file = input.file
      let interval = GEMINI_FILE_POLL_INITIAL_MS
      while (file.state === 'PROCESSING') {
        if (now() + interval > deadline) throw new ReviewProviderError('timeout', 'Gemini file processing timed out.')
        await sleep(interval)
        interval = Math.min(interval * 2, GEMINI_FILE_POLL_MAX_MS)
        file = await client.getFile({ apiKey: input.apiKey, name: file.name })
      }
      if (file.state === 'FAILED') throw new ReviewProviderError('file_processing_failed', 'Gemini failed to process the uploaded file.')
      return file
    },

    async deleteFile(input: { apiKey: string; name: string }): Promise<void> {
      const response = await request(`${GEMINI_API_BASE}/v1beta/${input.name}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': input.apiKey },
      }, GEMINI_CLEANUP_TIMEOUT_MS, 'provider_server_error', 'file cleanup')
      // 404 means the file is already gone (expired or deleted): cleanup goal reached.
      if (!response.ok && response.status !== 404) throw new ReviewProviderError('provider_server_error', 'Gemini file cleanup failed.', response.status)
    },

    async generateContent(input: GeminiGenerateInput & { apiKey: string }): Promise<GeminiGenerateOutput> {
      const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json', maxOutputTokens: 4096, temperature: 0.2 }
      if (input.responseSchema) generationConfig.responseJsonSchema = input.responseSchema
      const response = await request(`${GEMINI_API_BASE}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': input.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.systemInstruction }] },
          contents: [{ role: 'user', parts: input.parts }],
          generationConfig,
        }),
      }, input.timeoutMs ?? GEMINI_GENERATE_TIMEOUT_MS, 'provider_server_error', 'model request')
      if (!response.ok) await failFromResponse(response, false)
      const data = await response.json().catch(() => null) as Record<string, any> | null
      if (!data) throw new ReviewProviderError('invalid_response', 'Gemini returned an unreadable response.')
      if (data.promptFeedback?.blockReason) throw new ReviewProviderError('invalid_response', 'Gemini blocked the Review request.')
      const candidate = data.candidates?.[0]
      // Anything but a natural stop (truncation, safety, recitation, ...) is not a complete Review.
      if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
        throw new ReviewProviderError('invalid_response', 'Gemini did not complete the Review response.')
      }
      const parts: Array<{ text?: unknown; thought?: unknown }> = Array.isArray(candidate.content?.parts) ? candidate.content.parts : []
      const text = parts.filter((part) => typeof part.text === 'string' && part.thought !== true).map((part) => part.text as string).join('')
      if (!text.trim()) throw new ReviewProviderError('invalid_response', 'Gemini returned no Review text.')
      return {
        text,
        responseId: typeof data.responseId === 'string' ? data.responseId : undefined,
        usage: data.usageMetadata && typeof data.usageMetadata === 'object' ? data.usageMetadata : undefined,
      }
    },
  }
  return client
}

export type GeminiClient = ReturnType<typeof createGeminiClient>
