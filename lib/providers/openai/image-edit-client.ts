import sharp from 'sharp'
import { assertProviderExecutionAllowed } from '@/lib/providers/execution-policy'
import { OPENAI_IMAGE_EDIT_MODEL, OPENAI_IMAGE_EDIT_SIZES, OPENAI_IMAGE_EDIT_QUALITIES, resolveOpenAIImageEditModel } from './image-models'

// GPT Image 2 edits only. Generations retain their existing route/transport.
// Official contract: https://developers.openai.com/api/reference/resources/images/methods/edit
export const OPENAI_IMAGE_EDIT_URL = 'https://api.openai.com/v1/images/edits'
export const OPENAI_IMAGE_EDIT_TIMEOUT_MS = 120_000
export const OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES = 32 * 1024 * 1024
export const OPENAI_IMAGE_EDIT_OUTPUT_MAX_BYTES = 16 * 1024 * 1024
const MODEL = resolveOpenAIImageEditModel(OPENAI_IMAGE_EDIT_MODEL)!
const MAX_INPUT_BYTES = MODEL.referenceCapabilities.maxBytes
const OUTPUT_MAX_PIXELS = MODEL.providerSizeConstraints.maxPixels
const OUTPUT_MAX_EDGE = MODEL.providerSizeConstraints.maxEdge
const SIZES = OPENAI_IMAGE_EDIT_SIZES
const QUALITIES = OPENAI_IMAGE_EDIT_QUALITIES
export const isOpenAIImageEditSize = (value: unknown): value is (typeof SIZES)[number] => typeof value === 'string' && SIZES.some((size) => size === value)
export const isOpenAIImageEditQuality = (value: unknown): value is (typeof QUALITIES)[number] => typeof value === 'string' && QUALITIES.some((quality) => quality === value)

export type OpenAIImageEditReceived = { rawUsage: unknown; responseId: string | null }
export class OpenAIImageEditError extends Error {
  received: OpenAIImageEditReceived | null = null
  constructor(readonly status: number, readonly code: string, readonly outcomeUnknown: boolean, message: string) {
    super(message)
    this.name = 'OpenAIImageEditError'
  }
}
export type OpenAIImageEditRequest = {
  apiKey: string; prompt: string; size: string; quality: string
  referenceImage: { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' }
}
export type OpenAIImageEditResult = OpenAIImageEditReceived & { bytes: Buffer; mimeType: 'image/png'; width: number; height: number }
export type OpenAIImageEditDependencies = { fetchImpl?: typeof fetch; timeoutMs?: number }

export function buildOpenAIImageEditBody(input: OpenAIImageEditRequest): FormData {
  const image = input.referenceImage
  if (!input.prompt.trim() || input.prompt.length > 32_000 || !isOpenAIImageEditSize(input.size) || !isOpenAIImageEditQuality(input.quality)
    || !image.bytes.length || image.bytes.length > MAX_INPUT_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) {
    throw new OpenAIImageEditError(400, 'INVALID_EDIT_REQUEST', false, 'Parâmetros de edição inválidos.')
  }
  const body = new FormData()
  for (const [key, value] of Object.entries({ model: OPENAI_IMAGE_EDIT_MODEL, prompt: input.prompt.trim(), size: input.size,
    quality: input.quality, n: '1', output_format: 'png', background: 'opaque', moderation: 'auto' })) body.set(key, value)
  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice('image/'.length)
  body.append('image[]', new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }), `reference.${extension}`)
  return body
}

function invalidOutput(code = 'INVALID_PROVIDER_RESPONSE') {
  return new OpenAIImageEditError(502, code, true, 'A OpenAI retornou um resultado de edição inválido.')
}
function boundedResponseId(response: Response): string | null {
  const id = response.headers.get('x-request-id')
  return id && /^[A-Za-z0-9_.:-]{1,128}$/.test(id) ? id : null
}
function classifyHttp(status: number, body: unknown): OpenAIImageEditError {
  const code = body && typeof body === 'object' ? (body as { error?: { code?: unknown } }).error?.code : null
  if (status >= 400 && status < 500 && code === 'moderation_blocked') return new OpenAIImageEditError(422, 'PROVIDER_CONTENT_BLOCKED', false, 'A OpenAI bloqueou este conteúdo. Ajuste o prompt.')
  if (status === 401 || status === 403) return new OpenAIImageEditError(400, 'PROVIDER_CREDENTIAL_REJECTED', false, 'A OpenAI recusou a API Key configurada.')
  if (status === 429) return new OpenAIImageEditError(429, 'PROVIDER_RATE_LIMITED', false, 'Limite ou cota da OpenAI atingido.')
  return new OpenAIImageEditError(502, status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR', status >= 500,
    'Não foi possível concluir a edição na OpenAI.')
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw invalidOutput('PROVIDER_RESPONSE_TOO_LARGE')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > OPENAI_IMAGE_EDIT_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw invalidOutput('PROVIDER_RESPONSE_TOO_LARGE')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

async function decodeOutput(body: Record<string, unknown>): Promise<Pick<OpenAIImageEditResult, 'bytes' | 'mimeType' | 'width' | 'height'>> {
  if (!Array.isArray(body.data) || body.data.length !== 1) throw invalidOutput('EMPTY_PROVIDER_RESULT')
  const first = body.data[0] as { b64_json?: unknown; url?: unknown } | null
  const data = first?.b64_json
  // Never fetch output URLs; edits require one validated inline PNG and durable storage.
  if (typeof data !== 'string' || !data.length || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalidOutput()
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const size = data.length / 4 * 3 - padding
  if (size > OPENAI_IMAGE_EDIT_OUTPUT_MAX_BYTES) throw invalidOutput('PROVIDER_IMAGE_TOO_LARGE')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length !== size || bytes.toString('base64') !== data || bytes.length < 8
    || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw invalidOutput()
  try {
    const image = sharp(bytes, { limitInputPixels: OUTPUT_MAX_PIXELS, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1
      || metadata.width > OUTPUT_MAX_EDGE || metadata.height > OUTPUT_MAX_EDGE) throw invalidOutput()
    await image.stats()
    return { bytes, mimeType: 'image/png', width: metadata.width, height: metadata.height }
  } catch { throw invalidOutput() }
}

/** One submission, no retry. Deadline covers fetch, response streaming and result validation. */
export async function editOpenAIImage(input: OpenAIImageEditRequest, deps: OpenAIImageEditDependencies = {}): Promise<OpenAIImageEditResult> {
  assertProviderExecutionAllowed({ provider: 'openai', operation: 'image_generation' })
  const body = buildOpenAIImageEditBody(input)
  const controller = new AbortController()
  let received: OpenAIImageEditReceived | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new OpenAIImageEditError(504, 'PROVIDER_TIMEOUT', true, 'A OpenAI demorou demais para responder.')
      error.received = received
      reject(error)
      controller.abort()
    }, deps.timeoutMs ?? OPENAI_IMAGE_EDIT_TIMEOUT_MS)
  })
  const run = async () => {
    let response: Response
    try {
      response = await (deps.fetchImpl ?? fetch)(OPENAI_IMAGE_EDIT_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${input.apiKey}` }, body, redirect: 'error', signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new OpenAIImageEditError(504, 'PROVIDER_TIMEOUT', true, 'A OpenAI demorou demais para responder.')
      }
      throw new OpenAIImageEditError(502, 'PROVIDER_UNAVAILABLE', true, 'Não foi possível concluir a edição na OpenAI.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBounded(response, controller.signal))
    } catch (error) {
      if (!response.ok) throw classifyHttp(response.status, null)
      if (error instanceof OpenAIImageEditError) throw error
      throw invalidOutput()
    }
    if (!response.ok) throw classifyHttp(response.status, parsed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidOutput()
    const envelope = parsed as Record<string, unknown>
    received = { rawUsage: envelope.usage ?? null, responseId: boundedResponseId(response) }
    try {
      return { ...await decodeOutput(envelope), ...received }
    } catch (error) {
      const mapped = error instanceof OpenAIImageEditError ? error : invalidOutput()
      mapped.received = received
      throw mapped
    }
  }
  try { return await Promise.race([run(), deadline]) } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}
