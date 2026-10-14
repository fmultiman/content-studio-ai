import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { buildKlingMcpVideoCall } from '@/lib/provider-connections/kling-mcp-generation'
import { KlingAdapter } from '@/lib/providers/kling/adapter'
import {
  buildVeoSubmitBody,
  getVeoOperation,
  isSafeVeoResultUri,
  parseVeoOperation,
  submitVeoVideo,
  VEO_MAX_FRAME_BYTES,
  VeoError,
  type VeoFrame,
} from '@/lib/providers/gemini/veo-client'
import { describeVeoAvailability, isVeoVideoGenerationEnabled, veoCanaryUserIds } from '@/lib/providers/gemini/veo-feature'
import { allowedDurations, defaultDuration, findModel, lastFrameConflicts, type VideoModelCapability } from '@/lib/video-generation/capabilities'
import { derivedVideoUsage } from '@/lib/video-generation/completion'
import { describeGeminiConnection, GEMINI_CONNECTION_REF, parseConnectionRef } from '@/lib/video-generation/connections'
import { describeFrameProvenance, frameConfig, lastFrameFields, readFrameIdentities } from '@/lib/video-generation/frames'
import { lastFrameBlockers, reconcileSelection, type VideoFormSelection } from '@/lib/video-generation/form-selection'
import { generateRequestFingerprint } from '@/lib/video-generation/idempotency'
import { restVideoOperations } from '@/lib/video-generation/rest-capabilities'
import { validateVideoRequest, type NormalizedVideoRequest } from '@/lib/video-generation/request'
import { GeminiVeoTransport, KlingMcpTransport } from '@/lib/video-generation/transport'
import { veoVideoOperations } from '@/lib/video-generation/veo-capabilities'
import { attemptToWorkingState, VideoGenerationWorkingStateV1Schema } from '@/lib/video-generation/working-state'
import { SessionWorkingStateSchema } from '@/lib/video-generation/session'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'
import { pngBytes, jpegBytes } from './helpers/image-fixtures'

// VEO_KLING_FIRST_LAST_FRAME_V1 — provider contracts, capability derivation and server validation. Everything is mocked:
// there is NO network call in this file and no paid generation.

// The provider's upload endpoint: the multipart POST itself is unit-tested in pinned-provider-upload.test.ts.
vi.mock('@/lib/security/pinned-provider-upload', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/security/pinned-provider-upload')>()),
  postMultipartToProvider: vi.fn(async () => ({ status: 200, json: { url: 'https://provider-files.example.test/u/abc123.png' } })),
}))

const mcp = normalizeKlingMcpVideoCapabilities(whoAmIFixture()).operations
const veo = veoVideoOperations()
const rest = restVideoOperations()

const imageModel = (operations: ReturnType<typeof veoVideoOperations>, id: string) => findModel(operations, 'image_to_video', id)!
const textModel = (operations: ReturnType<typeof veoVideoOperations>, id: string) => findModel(operations, 'text_to_video', id)!
const ok = (operations: typeof rest, raw: Record<string, unknown>) => {
  const result = validateVideoRequest(operations, raw)
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}
const code = (operations: typeof rest, raw: Record<string, unknown>) => {
  const result = validateVideoRequest(operations, raw)
  return result.ok ? 'OK' : result.code
}

// ---------------------------------------------------------------------------
// Which models can take a first AND a last frame (derived from the effective contract, never from a name)
// ---------------------------------------------------------------------------
describe('first/last-frame capability derivation', () => {
  it('Kling REST: 3.0 and 2.6 accept a last frame; 2.6 needs 1080p and no audio; multi-shot stays off', () => {
    const v3 = imageModel(rest, 'kling-v3')
    const v26 = imageModel(rest, 'kling-v2-6')
    expect(v3.lastFrame).toEqual({ audioAllowed: true, multiShotAllowed: false })
    expect(v26.lastFrame).toEqual({ requiresResolution: '1080p', audioAllowed: false, multiShotAllowed: false })
    // Text-to-video has no frames at all.
    expect(textModel(rest, 'kling-v3').lastFrame).toBeUndefined()
    expect(textModel(rest, 'kling-v2-6').lastFrame).toBeUndefined()
  })

  it('Kling MCP: only models that declare an optional `tail_image` input qualify - never by commercial name', () => {
    const models = findOperationModels(mcp, 'image_to_video')
    const withLast = models.filter((model) => model.lastFrame).map((model) => model.id).sort()
    expect(withLast).toEqual(['kling-video-v2_5', 'kling-video-v2_6', 'kling-video-v3_0'])
    // Turbo declares first_image only; Omni/O1 take numbered references (image_1..image_7) and are not exposed here at all.
    expect(models.find((model) => model.id === 'kling-video-v3_0_turbo')?.lastFrame).toBeUndefined()
    expect(models.map((model) => model.id)).not.toContain('kling-video-v3_0_omni')
    expect(models.map((model) => model.id)).not.toContain('kling-video-o1')
  })

  it('Kling MCP 2.6: the provider’s own argument text sets the 1080p and no-audio rules; 3.0 keeps multi-shot off', () => {
    const models = findOperationModels(mcp, 'image_to_video')
    expect(models.find((model) => model.id === 'kling-video-v2_6')!.lastFrame).toEqual({ requiresResolution: '1080p', audioAllowed: false, multiShotAllowed: true })
    expect(models.find((model) => model.id === 'kling-video-v2_5')!.lastFrame).toEqual({ audioAllowed: true, multiShotAllowed: true })
    // Kling 3.0 has the multi-shot control: two frames define one shot, so it must be off.
    expect(models.find((model) => model.id === 'kling-video-v3_0')!.lastFrame).toEqual({ audioAllowed: true, multiShotAllowed: false })
  })

  it('a stored MCP snapshot taken BEFORE this feature simply has no lastFrame (unsupported until the connection is refreshed)', () => {
    const legacy = JSON.parse(JSON.stringify(mcp)) as typeof mcp
    for (const operation of legacy) for (const model of operation.models) delete model.lastFrame
    expect(code(legacy as any, { operation: 'image_to_video', model: 'kling-video-v3_0', multi_shot: false, lastFrame: true })).toBe('UNSUPPORTED_LAST_FRAME')
  })

  it('Google Veo 3.1 Standard, Fast and Lite accept first + last frame in image_to_video only', () => {
    for (const id of ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview']) {
      // Conservative: the current docs state no first+last-frame duration rule, earlier ones required 8 s -> 8 s until a canary proves otherwise.
      expect(imageModel(veo, id).lastFrame).toEqual({ audioAllowed: true, multiShotAllowed: true, requiresDuration: 8 })
      expect(textModel(veo, id).lastFrame).toBeUndefined()
    }
  })

  it('Veo specifics: 4/6/8 s, 16:9 or 9:16, 1080p/4k only at 8 s, no 4k on Lite, audio is native (no switch)', () => {
    const fast = imageModel(veo, 'veo-3.1-fast-generate-preview')
    expect(fast).toMatchObject({ durations: [4, 6, 8], resolutions: ['720p', '1080p', '4k'], aspectRatios: ['16:9', '9:16'], audio: false, nativeAudio: true, multiShot: false })
    expect(imageModel(veo, 'veo-3.1-lite-generate-preview').resolutions).toEqual(['720p', '1080p'])
    expect(allowedDurations(fast, '720p')).toEqual([4, 6, 8])
    expect(allowedDurations(fast, '1080p')).toEqual([8])
    expect(allowedDurations(fast, '4k')).toEqual([8])
    expect(defaultDuration(fast, '720p')).toBe(8)
    expect(defaultDuration(fast, '1080p')).toBe(8)
  })
})

function findOperationModels(operations: typeof rest, operation: 'image_to_video' | 'text_to_video'): VideoModelCapability[] {
  return operations.find((entry) => entry.operation === operation)!.models
}

// ---------------------------------------------------------------------------
// Server-side request validation (the browser is never the authority)
// ---------------------------------------------------------------------------
describe('validateVideoRequest — last frame', () => {
  it('Kling REST 3.0: accepted with multi-shot off (the explicit default); refused with multi-shot on', () => {
    const accepted = ok(rest, { operation: 'image_to_video', model: 'kling-v3', lastFrame: true })
    expect(accepted.request).toMatchObject({ operation: 'image_to_video', model: 'kling-v3', lastFrame: true, multiShot: false })
    expect(code(rest, { operation: 'image_to_video', model: 'kling-v3', multi_shot: true, lastFrame: true })).toBe('LAST_FRAME_MULTI_SHOT_CONFLICT')
  })

  it('Kling REST 2.6 + two frames requires 1080p (720p is refused, never silently upgraded) and audio off', () => {
    expect(code(rest, { operation: 'image_to_video', model: 'kling-v2-6', resolution: '720p', lastFrame: true })).toBe('LAST_FRAME_RESOLUTION_CONFLICT')
    // The default resolution is 720p, so an omitted resolution is ALSO refused: the user must choose 1080p.
    expect(code(rest, { operation: 'image_to_video', model: 'kling-v2-6', lastFrame: true })).toBe('LAST_FRAME_RESOLUTION_CONFLICT')
    expect(code(rest, { operation: 'image_to_video', model: 'kling-v2-6', resolution: '1080p', audio: 'on', lastFrame: true })).toBe('LAST_FRAME_AUDIO_CONFLICT')
    expect(ok(rest, { operation: 'image_to_video', model: 'kling-v2-6', resolution: '1080p', audio: 'off', lastFrame: true }).request).toMatchObject({ resolution: '1080p', audio: 'off', lastFrame: true })
    // A single-image 2.6 request is untouched by any of this.
    expect(ok(rest, { operation: 'image_to_video', model: 'kling-v2-6', resolution: '720p' }).request.lastFrame).toBe(false)
  })

  it('Kling MCP: a model without `tail_image` refuses a last frame instead of dropping it', () => {
    expect(code(mcp as any, { operation: 'image_to_video', model: 'kling-video-v3_0_turbo', lastFrame: true })).toBe('UNSUPPORTED_LAST_FRAME')
    expect(code(mcp as any, { operation: 'image_to_video', model: 'kling-video-v2_6', resolution: '720p', lastFrame: true })).toBe('LAST_FRAME_RESOLUTION_CONFLICT')
    expect(code(mcp as any, { operation: 'image_to_video', model: 'kling-video-v2_6', resolution: '1080p', audio: 'on', lastFrame: true })).toBe('LAST_FRAME_AUDIO_CONFLICT')
    expect(code(mcp as any, { operation: 'image_to_video', model: 'kling-video-v3_0', multi_shot: true, lastFrame: true })).toBe('LAST_FRAME_MULTI_SHOT_CONFLICT')
    expect(code(mcp as any, { operation: 'image_to_video', model: 'kling-video-v3_0', multi_shot: false, lastFrame: true })).toBe('OK')
  })

  it('a last frame is never valid for text_to_video, and a non-boolean flag is rejected', () => {
    expect(code(veo, { operation: 'text_to_video', model: 'veo-3.1-generate-preview', lastFrame: true })).toBe('UNSUPPORTED_LAST_FRAME')
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-generate-preview', lastFrame: 'yes' })).toBe('UNSUPPORTED_LAST_FRAME')
  })

  it('Google Veo: A+B accepted on every 3.1 model; durations tie to resolution; aspect ratio is explicit', () => {
    // First+last frame is restricted to 8 s on Veo (conservative; see veo-capabilities.ts): the default is already 8.
    const request = ok(veo, { operation: 'image_to_video', model: 'veo-3.1-fast-generate-preview', lastFrame: true }).request
    expect(request).toMatchObject({ operation: 'image_to_video', duration: 8, resolution: '720p', aspectRatio: '16:9', audio: null, multiShot: null, lastFrame: true })
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-generate-preview', resolution: '1080p', duration: 4 })).toBe('DURATION_RESOLUTION_CONFLICT')
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-generate-preview', resolution: '4k', duration: 6 })).toBe('DURATION_RESOLUTION_CONFLICT')
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-generate-preview', resolution: '4k', duration: 8, lastFrame: true })).toBe('OK')
    // A+B at 4 or 6 s is refused (never silently changed to 8); the same durations stay valid for ONE image and for text.
    for (const duration of [4, 6]) {
      expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-fast-generate-preview', duration, lastFrame: true })).toBe('LAST_FRAME_DURATION_CONFLICT')
      expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-fast-generate-preview', duration })).toBe('OK')
      expect(code(veo, { operation: 'text_to_video', model: 'veo-3.1-fast-generate-preview', duration })).toBe('OK')
    }
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-lite-generate-preview', resolution: '4k' })).toBe('UNSUPPORTED_RESOLUTION')
    expect(code(veo, { operation: 'image_to_video', model: 'veo-3.1-generate-preview', aspect_ratio: '1:1' })).toBe('UNSUPPORTED_ASPECT_RATIO')
    // Veo has no audio / multi-shot / ASMR controls: sending one is rejected, not ignored.
    expect(code(veo, { operation: 'text_to_video', model: 'veo-3.1-generate-preview', audio: 'on' })).toBe('UNSUPPORTED_AUDIO')
    expect(code(veo, { operation: 'text_to_video', model: 'veo-3.1-generate-preview', multi_shot: true })).toBe('UNSUPPORTED_MULTI_SHOT')
    // An unknown / removed model id is not guessed.
    expect(code(veo, { operation: 'text_to_video', model: 'veo-3.0-generate-001' })).toBe('UNSUPPORTED_MODEL')
  })

  it('Kling single-image I2V and every T2V keep their previous behaviour (lastFrame false)', () => {
    expect(ok(rest, { operation: 'image_to_video' }).request).toMatchObject({ model: 'kling-v3', lastFrame: false })
    expect(ok(rest, { operation: 'text_to_video' }).request.lastFrame).toBe(false)
  })

  it('lastFrameConflicts is the single rule shared by the form and the server', () => {
    const v26 = imageModel(rest, 'kling-v2-6')
    expect(lastFrameConflicts(v26, { resolution: '720p', audio: 'on', multiShot: null, duration: 5 })).toEqual(['RESOLUTION', 'AUDIO'])
    expect(lastFrameConflicts(v26, { resolution: '1080p', audio: 'off', multiShot: null, duration: 5 })).toEqual([])
    expect(lastFrameConflicts(textModel(rest, 'kling-v3'), { resolution: '720p', audio: 'off', multiShot: false, duration: 5 })).toEqual(['UNSUPPORTED_MODEL'])
    const veoFast = imageModel(veo, 'veo-3.1-fast-generate-preview')
    expect(lastFrameConflicts(veoFast, { resolution: '720p', audio: null, multiShot: null, duration: 6 })).toEqual(['DURATION'])
    expect(lastFrameConflicts(veoFast, { resolution: '720p', audio: null, multiShot: null, duration: 8 })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Kling REST wire contract
// ---------------------------------------------------------------------------
describe('Kling REST adapter — first/last frame payloads', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'task-1' } }) }))
    global.fetch = fetchMock as any
  })
  const bodyOf = () => JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))

  it('Kling 3.0 carries `last_frame` next to `first_frame` in contents[]', async () => {
    await new KlingAdapter('k').submitImageToVideo('p', 'https://a/first.png', 'ext', 'cb', { resolution: '1080p', duration: 5, audio: 'off', multi_shot: false }, 'kling-v3', 'https://a/last.png')
    expect(bodyOf().contents).toEqual([
      { type: 'prompt', text: 'p' },
      { type: 'first_frame', url: 'https://a/first.png' },
      { type: 'last_frame', url: 'https://a/last.png' },
    ])
    expect(bodyOf().settings).toMatchObject({ multi_shot: false })
  })

  it('Kling 2.6 (legacy endpoint) carries `image_tail`, in pro mode (1080p)', async () => {
    await new KlingAdapter('k').submitImageToVideo('p', 'https://a/first.png', 'ext', 'cb', { resolution: '1080p', duration: 5, audio: 'off' }, 'kling-v2-6', 'https://a/last.png')
    expect(String((fetchMock.mock.calls[0] as any)[0])).toContain('/v1/videos/image2video')
    expect(bodyOf()).toMatchObject({ model_name: 'kling-v2-6', image: 'https://a/first.png', image_tail: 'https://a/last.png', mode: 'pro', sound: 'off' })
  })

  it('without a last frame the payloads are exactly what they were (no last_frame / image_tail key)', async () => {
    await new KlingAdapter('k').submitImageToVideo('p', 'https://a/first.png', 'ext', 'cb', {}, 'kling-v3')
    expect(JSON.stringify(bodyOf())).not.toContain('last_frame')
    fetchMock.mockClear()
    await new KlingAdapter('k').submitImageToVideo('p', 'https://a/first.png', 'ext', 'cb', {}, 'kling-v2-6')
    expect(JSON.stringify(bodyOf())).not.toContain('image_tail')
  })
})

// ---------------------------------------------------------------------------
// Kling MCP wire contract + spend order
// ---------------------------------------------------------------------------
describe('Kling MCP — tail_image transport', () => {
  const request = (overrides: Partial<NormalizedVideoRequest> = {}): NormalizedVideoRequest => ({
    operation: 'image_to_video', model: 'kling-video-v3_0', duration: 5, resolution: '1080p', aspectRatio: null, audio: 'off', multiShot: false, asmr: null, audioPrompt: null, musicPrompt: null, lastFrame: true, ...overrides,
  })
  const model = () => findModel(mcp as any, 'image_to_video', 'kling-video-v3_0')!

  it('sends first_image AND tail_image (the provider’s own file URLs) - and only when the request carries a last frame', () => {
    const both = buildKlingMcpVideoCall({ request: request(), model: model(), prompt: 'p', sourceImageUrl: 'https://files/first.png', lastFrameImageUrl: 'https://files/last.png' })
    expect(both.inputs).toEqual([
      { name: 'first_image', inputType: 'URL', url: 'https://files/first.png' },
      { name: 'tail_image', inputType: 'URL', url: 'https://files/last.png' },
    ])
    const single = buildKlingMcpVideoCall({ request: request({ lastFrame: false }), model: model(), prompt: 'p', sourceImageUrl: 'https://files/first.png', lastFrameImageUrl: 'https://files/last.png' })
    expect(single.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: 'https://files/first.png' }])
  })

  it('refuses to build a tail_image call for a model that does not declare it, or without the provider URL', () => {
    const turbo = findModel(mcp as any, 'image_to_video', 'kling-video-v3_0_turbo')!
    expect(() => buildKlingMcpVideoCall({ request: request({ model: 'kling-video-v3_0_turbo' }), model: turbo, prompt: 'p', sourceImageUrl: 'https://f/1.png', lastFrameImageUrl: 'https://f/2.png' })).toThrow()
    expect(() => buildKlingMcpVideoCall({ request: request(), model: model(), prompt: 'p', sourceImageUrl: 'https://f/1.png' })).toThrow()
  })

  it('uploads BOTH frames before the paid tool exists; a failed second upload submits nothing', async () => {
    const calls: Array<{ name: string; arguments: any }> = []
    let uploads = 0
    const createClient = (() => ({
      client: {
        connect: async () => undefined,
        listTools: async () => ({ tools: [] }),
        callTool: async (params: any) => {
          calls.push(params)
          if (params.name === 'file_upload') {
            uploads += 1
            if (uploads === 2) return { isError: true, content: [{ type: 'text', text: 'upload refused' }] }
            return { content: [{ type: 'text', text: JSON.stringify({ ticket: 't', upload_url: 'https://up.example/put', expire_at: Math.floor(Date.now() / 1000) + 600 }) }] }
          }
          return { content: [{ type: 'text', text: JSON.stringify({ generationId: 'g-1' }) }] }
        },
        close: async () => undefined,
      },
      transport: {},
    })) as any
    const transport = new KlingMcpTransport({ get: async () => 'tok', refresh: async () => 'tok2' }, { createClient })
    const image = { bytes: pngBytes(1024, 1024, 4096), mimeType: 'image/png' as const, filename: 'a.png' }
    await expect(transport.submit({ generationId: 'gen', prompt: 'p', request: request(), model: model(), sourceImage: image, lastFrameImage: image })).rejects.toBeTruthy()
    expect(calls.filter((call) => call.name === 'image_to_video')).toHaveLength(0)
    expect(uploads).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Google Veo wire contract
// ---------------------------------------------------------------------------
describe('Google Veo client — first/last frame', () => {
  const first: VeoFrame = { bytes: pngBytes(1024, 1024, 4096), mimeType: 'image/png' }
  const last: VeoFrame = { bytes: jpegBytes(1024, 1024, 4096), mimeType: 'image/jpeg' }
  const params = { apiKey: 'AIza-SECRET-KEY', model: 'veo-3.1-fast-generate-preview', prompt: 'a door opens', duration: 8, resolution: '720p' as const, aspectRatio: '16:9' as const }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('builds instances[0] with prompt + image + lastFrame (inlineData) and the explicit parameters', () => {
    const body = buildVeoSubmitBody({ ...params, firstFrame: first, lastFrame: last })
    expect(body.instances).toHaveLength(1)
    expect(body.instances[0]).toEqual({
      prompt: 'a door opens',
      image: { inlineData: { mimeType: 'image/png', data: Buffer.from(first.bytes).toString('base64') } },
      lastFrame: { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(last.bytes).toString('base64') } },
    })
    expect(body.parameters).toEqual({ aspectRatio: '16:9', resolution: '720p', durationSeconds: 8 })
  })

  it('a refusal keeps Google’s message BOUNDED and key-redacted for diagnosis (never the user-facing text)', async () => {
    const long = 'Invalid value at parameters.durationSeconds ' + 'x'.repeat(500) + ' AIza-SECRET-KEY and AIzaSyABCDEFGHIJKLMNOP'
    const error = (await submitVeoVideo(params, { fetchImpl: (async () => json({ error: { message: long } }, 400)) as any }).catch((e) => e)) as VeoError
    expect(error).toMatchObject({ kind: 'rejected', status: 400, outcomeUnknown: false })
    expect(error.providerText!.length).toBeLessThanOrEqual(300)
    expect(error.providerText).toContain('parameters.durationSeconds')
    expect(error.providerText).not.toContain('AIza')
    expect(error.message).not.toContain('durationSeconds')
    // No provider message => null (never invented).
    expect(((await submitVeoVideo(params, { fetchImpl: (async () => json({}, 400)) as any }).catch((e) => e)) as VeoError).providerText).toBeNull()
  })

  it('text-to-video carries no image/lastFrame; a last frame without a first frame is refused before any network I/O', async () => {
    expect(buildVeoSubmitBody(params).instances[0]).toEqual({ prompt: 'a door opens' })
    const fetchImpl = vi.fn()
    await expect(submitVeoVideo({ ...params, lastFrame: last }, { fetchImpl: fetchImpl as any })).rejects.toMatchObject({ kind: 'invalid_input' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(() => buildVeoSubmitBody({ ...params, firstFrame: { bytes: new Uint8Array(VEO_MAX_FRAME_BYTES + 1), mimeType: 'image/png' } })).toThrow(VeoError)
  })

  it('submits ONCE with the key in the header only (never in the URL or body) and returns the operation name', async () => {
    const fetchImpl = vi.fn(async () => json({ name: 'models/veo-3.1-fast-generate-preview/operations/abc123' }))
    const result = await submitVeoVideo({ ...params, firstFrame: first, lastFrame: last }, { fetchImpl: fetchImpl as any })
    expect(result).toEqual({ operationName: 'models/veo-3.1-fast-generate-preview/operations/abc123' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as any
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning')
    expect(url).not.toContain('AIza')
    expect(init.method).toBe('POST')
    expect(init.headers['x-goog-api-key']).toBe('AIza-SECRET-KEY')
    expect(String(init.body)).not.toContain('AIza')
  })

  it('classifies submit failures: 5xx / network / unreadable 2xx = UNKNOWN outcome (never retried); 4xx = definitive', async () => {
    const attempt = async (impl: () => Promise<Response>) => {
      const fetchImpl = vi.fn(impl)
      const error = (await submitVeoVideo(params, { fetchImpl: fetchImpl as any }).catch((e) => e)) as VeoError
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      return error
    }
    expect(await attempt(async () => json({ error: { message: 'boom' } }, 503))).toMatchObject({ outcomeUnknown: true, kind: 'provider_unavailable' })
    expect(await attempt(async () => { throw new Error('socket hang up') })).toMatchObject({ outcomeUnknown: true })
    expect(await attempt(async () => json({ unexpected: true }))).toMatchObject({ outcomeUnknown: true, kind: 'unreadable_response' })
    expect(await attempt(async () => new Response('not json', { status: 200 }))).toMatchObject({ outcomeUnknown: true })
    expect(await attempt(async () => json({ name: '../../etc/passwd' }))).toMatchObject({ outcomeUnknown: true })
    expect(await attempt(async () => json({}, 400))).toMatchObject({ outcomeUnknown: false, kind: 'rejected' })
    expect(await attempt(async () => json({}, 403))).toMatchObject({ outcomeUnknown: false, kind: 'invalid_credential' })
    expect(await attempt(async () => json({}, 429))).toMatchObject({ outcomeUnknown: false, kind: 'quota' })
    expect(await attempt(async () => json({}, 404))).toMatchObject({ outcomeUnknown: false, kind: 'unsupported_model' })
  })

  it('error messages never contain the key or provider text', async () => {
    const error = (await submitVeoVideo(params, { fetchImpl: (async () => json({ error: { message: 'key AIza-SECRET-KEY invalid' } }, 400)) as any }).catch((e) => e)) as VeoError
    expect(error.message).not.toContain('AIza')
    expect(error.message).not.toContain('invalid')
  })

  it('parses operations: running, success (generateVideoResponse), safety filter, provider error and unsafe URI', () => {
    expect(parseVeoOperation({ name: 'x', done: false })).toEqual({ state: 'processing' })
    const uri = 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media'
    expect(parseVeoOperation({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } })).toEqual({ state: 'succeeded', videoUri: uri })
    expect(parseVeoOperation({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['x'] } } })).toMatchObject({ state: 'failed', code: 'PROVIDER_CONTENT_FILTERED' })
    expect(parseVeoOperation({ done: true, error: { code: 3, message: 'bad' } })).toMatchObject({ state: 'failed', code: 'PROVIDER_FAILED' })
    expect(parseVeoOperation({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://evil.example/x.mp4' } }] } } })).toMatchObject({ state: 'failed' })
    expect(isSafeVeoResultUri('http://generativelanguage.googleapis.com/x')).toBe(false)
    expect(isSafeVeoResultUri('https://generativelanguage.googleapis.com.evil.example/x')).toBe(false)
    expect(isSafeVeoResultUri('https://user:pw@generativelanguage.googleapis.com/x')).toBe(false)
  })

  it('wire contract (Google docs, last updated 2026-10-08): instances[0] {prompt,image,lastFrame}, sibling parameters, JSON-number durationSeconds', () => {
    const body = buildVeoSubmitBody({ ...params, duration: 8, firstFrame: first, lastFrame: last }) as any
    expect(Object.keys(body).sort()).toEqual(['instances', 'parameters'])
    expect(Object.keys(body.instances[0]).sort()).toEqual(['image', 'lastFrame', 'prompt'])
    // image / lastFrame are { inlineData: { mimeType, data } } - camelCase mimeType, base64 data; never bytesBase64Encoded.
    for (const frame of [body.instances[0].image, body.instances[0].lastFrame]) {
      expect(Object.keys(frame)).toEqual(['inlineData'])
      expect(Object.keys(frame.inlineData).sort()).toEqual(['data', 'mimeType'])
    }
    expect(JSON.stringify(body)).not.toMatch(/bytesBase64Encoded|mime_type/)
    // The docs show durationSeconds only as quoted table values and never in a REST body; the field is an integer and is sent as a
    // JSON number (confirm in the paid canary).
    expect(typeof body.parameters.durationSeconds).toBe('number')
    // Only the documented parameters: no output-count field at all (one video per request is the default).
    expect(body.parameters).toEqual({ aspectRatio: '16:9', resolution: '720p', durationSeconds: 8 })
  })

  it('accepts the documented operation name with or without the models/{model}/ prefix, and still refuses any other path', async () => {
    const accept = async (name: string) => getVeoOperation('k', name, { fetchImpl: (async () => json({ done: false })) as any })
    expect(await accept('models/veo-3.1-fast-generate-preview/operations/abc123')).toEqual({ state: 'processing' })
    expect(await accept('operations/abc123')).toEqual({ state: 'processing' })
    for (const bad of ['models/x/../../secrets', 'files/abc123', 'operations/../models', 'operations/a/b', '/operations/abc', 'operations/', 'models/x/operations/a b']) {
      await expect(getVeoOperation('k', bad, { fetchImpl: (async () => json({})) as any })).rejects.toMatchObject({ kind: 'invalid_input' })
    }
    // A submit answered with the unprefixed form is recorded (never lost as "unreadable").
    const result = await submitVeoVideo(params, { fetchImpl: (async () => json({ name: 'operations/abc123' })) as any })
    expect(result).toEqual({ operationName: 'operations/abc123' })
  })

  it('reads an operation with the key header only; a transport failure is transient, a 404 is a definitive failure', async () => {
    const name = 'models/veo-3.1-fast-generate-preview/operations/abc123'
    const fetchImpl = vi.fn(async () => json({ done: false }))
    expect(await getVeoOperation('AIza-SECRET-KEY', name, { fetchImpl: fetchImpl as any })).toEqual({ state: 'processing' })
    const [url, init] = fetchImpl.mock.calls[0] as any
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/${name}`)
    expect(init.headers).toEqual({ 'x-goog-api-key': 'AIza-SECRET-KEY' })
    await expect(getVeoOperation('k', name, { fetchImpl: (async () => { throw new Error('down') }) as any })).rejects.toMatchObject({ kind: 'provider_unavailable' })
    await expect(getVeoOperation('k', name, { fetchImpl: (async () => json({}, 503)) as any })).rejects.toBeInstanceOf(VeoError)
    expect(await getVeoOperation('k', name, { fetchImpl: (async () => json({}, 404)) as any })).toMatchObject({ state: 'failed' })
    await expect(getVeoOperation('k', 'models/x/../../secrets', { fetchImpl: fetchImpl as any })).rejects.toMatchObject({ kind: 'invalid_input' })
  })

  it('the Veo transport maps the status to the product vocabulary and hands the download header to completion only', async () => {
    const uri = 'https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media'
    const transport = new GeminiVeoTransport('AIza-SECRET-KEY', { fetchImpl: (async () => json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } })) as any })
    expect(await transport.getStatus('models/m/operations/o1')).toEqual({ state: 'succeeded', resultUrl: uri, rawState: 'done', downloadHeaders: { 'x-goog-api-key': 'AIza-SECRET-KEY' } })
    expect(transport.transport).toBe('rest')
  })
})

describe('the download header never follows a redirect to another origin', () => {
  const PUBLIC = async () => ['203.0.113.10']
  it('sends the key to the original host only', async () => {
    const seen: Array<{ url: string; headers?: Record<string, string> }> = []
    const fetchFn = vi.fn(async (url: string, init: any) => {
      seen.push({ url, headers: init.headers })
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: 'https://storage.example.test/real.mp4' } })
        : new Response('video-bytes', { status: 200, headers: { 'content-type': 'video/mp4' } })
    })
    const upload = vi.fn(async (_buffer: Buffer, path: string, mime: string, size: number) => ({ storagePath: path, publicUrl: 'x', mime, size }))
    await downloadAndStoreVideo('https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media', 'p', { headers: { 'x-goog-api-key': 'AIza-SECRET-KEY' } }, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })
    expect(seen[0].headers).toEqual({ 'x-goog-api-key': 'AIza-SECRET-KEY' })
    expect(seen[1].headers).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Frames: durable identities, idempotency, session, history
// ---------------------------------------------------------------------------
describe('frame identities, fingerprint and persistence', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const C = '33333333-3333-4333-8333-333333333333'
  const body = { projectId: 'p', productionId: 'q', sessionId: 's', mode: 'image_to_video', prompt: 'x', sourceImageId: A, model: 'veo-3.1-generate-preview' }

  it('the idempotency fingerprint covers BOTH frames; a request without a last frame keeps its previous fingerprint', () => {
    const single = generateRequestFingerprint(body)
    const withB = generateRequestFingerprint({ ...body, lastFrameImageId: B })
    const withC = generateRequestFingerprint({ ...body, lastFrameImageId: C })
    const withLibrary = generateRequestFingerprint({ ...body, lastFrameLibraryFileId: B })
    expect(new Set([single, withB, withC, withLibrary]).size).toBe(4)
    // Unchanged for every request that existed before first/last frame (so an in-flight replay still matches its key).
    expect(single).toBe(generateRequestFingerprint({ ...body, lastFrameImageId: undefined, lastFrameLibraryFileId: undefined }))
  })

  it('request fields name exactly one durable id; none outside image_to_video', () => {
    expect(lastFrameFields('image_to_video', { type: 'generated', id: B })).toEqual({ lastFrameImageId: B })
    expect(lastFrameFields('image_to_video', { type: 'library', id: B })).toEqual({ lastFrameLibraryFileId: B })
    expect(lastFrameFields('text_to_video', { type: 'library', id: B })).toEqual({})
    expect(lastFrameFields('image_to_video', null)).toEqual({})
  })

  it('the attempt records the pair as ids only (never a URL) and history reads it back', () => {
    const config = frameConfig({ type: 'library', id: A }, { type: 'generated', id: B })
    expect(config).toEqual({ first_frame: { type: 'library', id: A }, last_frame: { type: 'generated', id: B } })
    expect(JSON.stringify(config)).not.toMatch(/https?:|storage|signature/i)
    expect(readFrameIdentities(config)).toEqual({ firstFrame: { type: 'library', id: A }, lastFrame: { type: 'generated', id: B } })
    expect(describeFrameProvenance({ request_config: config })).toMatch(/último quadro/)
    expect(describeFrameProvenance({ request_config: { duration: 5 } })).toBeNull()
    expect(describeFrameProvenance({ request_config: null })).toBeNull()
  })

  it('reusing an attempt restores BOTH frames and the Google connection; a single-image attempt has no last frame', () => {
    const restored = attemptToWorkingState({
      prompt: 'p', mode: 'image_to_video', model: 'veo-3.1-generate-preview', provider: 'gemini', transport: 'rest', source_image_id: A,
      request_config: { duration: 8, resolution: '720p', aspect_ratio: '16:9', ...frameConfig({ type: 'generated', id: A }, { type: 'library', id: B }) },
    })
    expect(restored).toMatchObject({ source: { type: 'generated', id: A }, lastFrame: { type: 'library', id: B }, selection: { connectionRef: GEMINI_CONNECTION_REF, modelId: 'veo-3.1-generate-preview', aspectRatio: '16:9' } })
    const single = attemptToWorkingState({ prompt: 'p', mode: 'image_to_video', model: 'kling-v3', transport: 'rest', source_image_id: A, request_config: {} })
    expect('lastFrame' in single).toBe(false)
  })

  it('the Session working state keeps the draft last frame, and older Sessions (no lastFrame) still parse unchanged', () => {
    const selection = reconcileSelection(connectionsFor())
    const base = { schemaVersion: 1 as const, prompt: 'p', source: { type: 'generated' as const, id: A }, selection }
    expect(VideoGenerationWorkingStateV1Schema.parse(base)).toEqual(base)
    const withLast = { ...base, lastFrame: { type: 'library' as const, id: B } }
    expect(VideoGenerationWorkingStateV1Schema.parse(withLast).lastFrame).toEqual({ type: 'library', id: B })
    expect(SessionWorkingStateSchema.safeParse(withLast).success).toBe(true)
    expect(SessionWorkingStateSchema.safeParse({ ...base, lastFrame: { type: 'library', id: 'not-a-uuid' } }).success).toBe(false)
  })

  it('a Google connection ref parses to its own kind (never to a Kling connection)', () => {
    expect(parseConnectionRef(GEMINI_CONNECTION_REF)).toEqual({ kind: 'gemini_api' })
    expect(parseConnectionRef('google:other')).toBeNull()
  })
})

function connectionsFor() {
  return [describeGeminiConnection('configured', true)]
}

// ---------------------------------------------------------------------------
// Form reconciliation: the model/resolution can change without losing or silently sending the draft
// ---------------------------------------------------------------------------
describe('form reconciliation with Google Veo and a last frame', () => {
  const connections = connectionsFor()

  it('selecting 1080p/4k moves the duration to 8 s (the only valid value); going back keeps it', () => {
    const start = reconcileSelection(connections)
    expect(start).toMatchObject({ connectionRef: GEMINI_CONNECTION_REF, modelId: 'veo-3.1-fast-generate-preview', operation: 'image_to_video', duration: 8, resolution: '720p', aspectRatio: '16:9', audio: null })
    const shorter = reconcileSelection(connections, { ...start, duration: 4 })
    expect(shorter.duration).toBe(4)
    expect(reconcileSelection(connections, { ...shorter, resolution: '1080p' }).duration).toBe(8)
    expect(reconcileSelection(connections, { ...shorter, resolution: '4k' })).toMatchObject({ resolution: '4k', duration: 8 })
  })

  it('lastFrameBlockers explains an incompatible selection instead of changing it', () => {
    const v26 = imageModel(rest, 'kling-v2-6')
    const selection: VideoFormSelection = { connectionRef: 'kling:api', operation: 'image_to_video', modelId: 'kling-v2-6', duration: 5, resolution: '720p', aspectRatio: null, audio: 'on', multiShot: null, asmr: null, audioPrompt: null, musicPrompt: null }
    expect(lastFrameBlockers(v26, selection)).toEqual(['RESOLUTION', 'AUDIO'])
    expect(lastFrameBlockers(null, selection)).toEqual(['UNSUPPORTED_MODEL'])
    expect(lastFrameBlockers(v26, { ...selection, resolution: '1080p', audio: 'off' })).toEqual([])
    const veoFast = imageModel(veo, 'veo-3.1-fast-generate-preview')
    const veoSelection: VideoFormSelection = { ...selection, connectionRef: GEMINI_CONNECTION_REF, modelId: 'veo-3.1-fast-generate-preview', duration: 4, resolution: '720p', audio: null, multiShot: null }
    expect(lastFrameBlockers(veoFast, veoSelection)).toEqual(['DURATION'])
    expect(lastFrameBlockers(veoFast, { ...veoSelection, duration: 8 })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Release switch and cost honesty
// ---------------------------------------------------------------------------
describe('Veo release switch and usage', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('Veo ships DISABLED: a saved key alone cannot generate; only the exact acknowledgement value enables it', () => {
    vi.stubEnv('CONTENT_STUDIO_VEO_VIDEO_GENERATION', '')
    expect(describeGeminiConnection('configured')).toMatchObject({ canGenerate: false, blockedReason: 'feature_disabled', status: 'connected' })
    for (const value of ['1', 'true', 'ENABLED', 'yes']) expect(isVeoVideoGenerationEnabled({ CONTENT_STUDIO_VEO_VIDEO_GENERATION: value })).toBe(false)
    expect(isVeoVideoGenerationEnabled({ CONTENT_STUDIO_VEO_VIDEO_GENERATION: 'enabled' })).toBe(true)
    expect(describeGeminiConnection('configured', true)).toMatchObject({ canGenerate: true })
    expect(describeGeminiConnection('missing', true)).toMatchObject({ canGenerate: false, blockedReason: 'not_configured', operations: [] })
  })

  it('the switch is GLOBAL on its own; the canary allowlist limits it to the listed users and fails closed', () => {
    const on = { CONTENT_STUDIO_VEO_VIDEO_GENERATION: 'enabled' }
    // Global: any user (and even an unidentified caller) once the switch is on.
    expect(isVeoVideoGenerationEnabled(on, 'user-x')).toBe(true)
    expect(isVeoVideoGenerationEnabled(on)).toBe(true)
    // Canary: only the listed ids, case/space-insensitive; everyone else and unidentified callers are refused.
    const canary = { ...on, CONTENT_STUDIO_VEO_CANARY_USER_IDS: ' User-A , user-b ' }
    expect(veoCanaryUserIds(canary)).toEqual(['user-a', 'user-b'])
    expect(isVeoVideoGenerationEnabled(canary, 'USER-A')).toBe(true)
    expect(isVeoVideoGenerationEnabled(canary, 'user-c')).toBe(false)
    expect(isVeoVideoGenerationEnabled(canary)).toBe(false)
    expect(isVeoVideoGenerationEnabled(canary, null)).toBe(false)
    // The allowlist never enables anything by itself, and an empty value means "no allowlist".
    expect(isVeoVideoGenerationEnabled({ CONTENT_STUDIO_VEO_CANARY_USER_IDS: 'user-a' }, 'user-a')).toBe(false)
    expect(isVeoVideoGenerationEnabled({ ...on, CONTENT_STUDIO_VEO_CANARY_USER_IDS: '   ' }, 'user-x')).toBe(true)
  })

  it('GO-LIVE: with no allowlist every authenticated user with a valid Gemini BYOK connection can use Veo; an allowlist, when configured, still restricts', () => {
    const on = { CONTENT_STUDIO_VEO_VIDEO_GENERATION: 'enabled' }
    for (const user of ['owner-id', 'another-user', '00000000-0000-4000-8000-000000000042']) expect(describeVeoAvailability(on, user)).toBe('available')
    expect(describeVeoAvailability({ ...on, CONTENT_STUDIO_VEO_CANARY_USER_IDS: '' }, 'another-user')).toBe('available')
    expect(describeVeoAvailability({ ...on, CONTENT_STUDIO_VEO_CANARY_USER_IDS: 'owner-id' }, 'another-user')).toBe('canary_restricted')
    expect(describeVeoAvailability({ ...on, CONTENT_STUDIO_VEO_CANARY_USER_IDS: 'owner-id' }, 'owner-id')).toBe('available')
    expect(describeVeoAvailability({}, 'owner-id')).toBe('switch_off')
  })

  it('the switch tolerates the whitespace / quotes a dashboard stores, but never a boolean-ish value', () => {
    for (const value of ['enabled', ' enabled ', 'enabled\n', '"enabled"', "'enabled'", ' "enabled" \r\n']) {
      expect(describeVeoAvailability({ CONTENT_STUDIO_VEO_VIDEO_GENERATION: value }, 'u')).toBe('available')
    }
    for (const value of ['1', 'true', 'TRUE', 'ENABLED', 'Enabled', 'yes', 'on', 'enabled!', '"enabled', 'disabled', '']) {
      expect(describeVeoAvailability({ CONTENT_STUDIO_VEO_VIDEO_GENERATION: value }, 'u')).toBe('switch_off')
    }
  })

  it('the connection reports the right reason for each availability, and an allowlisted user can generate', () => {
    expect(describeGeminiConnection('configured', 'switch_off')).toMatchObject({ canGenerate: false, blockedReason: 'feature_disabled' })
    expect(describeGeminiConnection('configured', 'canary_restricted')).toMatchObject({ canGenerate: false, blockedReason: 'canary_restricted' })
    expect(describeGeminiConnection('configured', 'available')).toMatchObject({ canGenerate: true })
    // Without a valid Gemini BYOK connection nothing else can make Veo usable.
    expect(describeGeminiConnection('missing', 'available')).toMatchObject({ canGenerate: false, blockedReason: 'not_configured' })
  })

  it('usage for a delivered Veo video is DERIVED seconds (never provider_reported); Kling stays unknown', () => {
    expect(derivedVideoUsage({ provider: 'gemini', request_config: { duration: 8 } })).toEqual({ quantity: 8, unit: 'seconds', source: 'derived' })
    expect(derivedVideoUsage({ provider: 'gemini', request_config: {} })).toBeNull()
    expect(derivedVideoUsage({ provider: 'kling', request_config: { duration: 5 } })).toBeNull()
  })
})
