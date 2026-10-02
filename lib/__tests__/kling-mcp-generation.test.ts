import { describe, expect, it, vi } from 'vitest'
import { ProtocolError, ProtocolErrorCode, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client'
import {
  buildKlingMcpVideoCall,
  KlingMcpSubmitError,
  queryKlingMcpTask,
  submitKlingMcpVideo,
} from '@/lib/provider-connections/kling-mcp-generation'
import { parseGenerationId, parseTaskReading } from '@/lib/provider-connections/kling-mcp-task'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { findModel, type VideoModelCapability } from '@/lib/video-generation/capabilities'
import { validateVideoRequest } from '@/lib/video-generation/request'
import { KlingMcpTransport } from '@/lib/video-generation/transport'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'

const operations = normalizeKlingMcpVideoCapabilities(whoAmIFixture()).operations
const TOKEN = 'ACCESS-TOKEN-SHOULD-NEVER-APPEAR'

function request(raw: Record<string, unknown>) {
  const result = validateVideoRequest(operations, raw)
  if (!result.ok) throw new Error(result.code)
  return result
}

function call(raw: Record<string, unknown>, extra: { prompt?: string; sourceImageUrl?: string } = {}) {
  const { request: normalized, model } = request(raw)
  return buildKlingMcpVideoCall({ request: normalized, model, prompt: extra.prompt ?? 'a red fox', sourceImageUrl: extra.sourceImageUrl })
}

const argMap = (built: ReturnType<typeof call>) => Object.fromEntries(built.arguments.map((entry) => [entry.name, entry.value]))

describe('MCP argument mapping (explicit, bounded)', () => {
  it('text_to_video: every offered control is sent explicitly, as strings, with the output count pinned to 1', () => {
    const built = call({ operation: 'text_to_video', model: 'kling-video-v3_0', duration: 10, resolution: '1080p', aspect_ratio: '9:16', audio: 'on', multi_shot: true })

    expect(built.tool).toBe('text_to_video')
    expect(built.model).toBe('kling-video-v3_0')
    expect(built.inputs).toEqual([])
    expect(argMap(built)).toEqual({
      prompt: 'a red fox',
      duration: '10',
      resolution: '1080p',
      aspect_ratio: '9:16',
      enable_audio: 'true',
      prefer_multi_shots: 'true',
      imageCount: '1',
    })
  })

  it('explicit defaults are sent even where they equal Content Studio defaults that differ from the provider’s', () => {
    // Provider defaults for Kling 3.0 are 1080p / audio true / multi-shot true. We must send OUR values.
    const built = call({ operation: 'text_to_video', model: 'kling-video-v3_0' })
    expect(argMap(built)).toMatchObject({ resolution: '720p', enable_audio: 'false', prefer_multi_shots: 'false', duration: '5', aspect_ratio: '16:9', imageCount: '1' })
  })

  it('output count is ALWAYS 1, even though the provider allows up to 4', () => {
    for (const model of ['kling-video-v2_5', 'kling-video-v3_0', 'kling-video-v3_0_turbo']) {
      expect(argMap(call({ operation: 'text_to_video', model }))).toMatchObject({ imageCount: '1' })
    }
  })

  it('a model without audio / multi-shot gets neither argument (nothing hidden is sent)', () => {
    const built = call({ operation: 'text_to_video', model: 'kling-video-v3_0_turbo' })
    expect(Object.keys(argMap(built)).sort()).toEqual(['aspect_ratio', 'duration', 'imageCount', 'prompt', 'resolution'])
  })

  it('image_to_video: the single source image goes as first_image; no aspect ratio, no tail image', () => {
    const built = call({ operation: 'image_to_video', model: 'kling-video-v3_0', duration: 6 }, { sourceImageUrl: 'https://s3.example.test/x.png?sig=1' })

    expect(built.tool).toBe('image_to_video')
    expect(built.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: 'https://s3.example.test/x.png?sig=1' }])
    expect(built.inputs.some((input) => input.name === 'tail_image')).toBe(false)
    expect(argMap(built)).not.toHaveProperty('aspect_ratio')
    expect(argMap(built)).toMatchObject({ duration: '6', imageCount: '1' })
  })

  it('image_to_video without a source URL cannot be built', () => {
    expect(() => call({ operation: 'image_to_video' })).toThrow()
  })

  it('never forwards arbitrary UI JSON: only productized controls (by their Product keys) are mapped explicitly', () => {
    // Raw provider-named / unproductized keys a browser might forge, next to ONE legitimate Product control (audio_prompt).
    const { request: normalized, model } = request({ operation: 'text_to_video', model: 'kling-video-v2_5', enable_asmr: true, audio_prompt: 'x', elements: '[]', tail_image: 'https://evil.example/t.png', imageCount: 4 } as any)
    const built = buildKlingMcpVideoCall({ request: normalized, model, prompt: 'p' })
    const args = argMap(built)

    // ASMR is a Product control keyed `asmr` (default false). The forged provider-named `enable_asmr: true` is not a Product key and is ignored.
    expect(normalized.asmr).toBe(false)
    expect(args.enable_asmr).toBe('false')
    expect(built.arguments.filter((entry) => entry.name === 'enable_asmr')).toEqual([{ name: 'enable_asmr', value: 'false' }])
    // audio_prompt IS a Product request field for Kling 2.5 text-to-video: it is forwarded explicitly.
    expect(args.audio_prompt).toBe('x')
    // music_prompt was not supplied: empty means omitted, never invented.
    expect(built.arguments.map((entry) => entry.name)).not.toContain('music_prompt')
    // Unproductized inputs never reach the provider, as arguments or as inputs.
    expect(built.arguments.map((entry) => entry.name)).not.toContain('elements')
    expect(built.arguments.map((entry) => entry.name)).not.toContain('tail_image')
    expect(built.inputs).toEqual([])
    // The output count is adapter-controlled (always 1); a browser-supplied imageCount has no authority.
    expect(args.imageCount).toBe('1')
    expect(built.arguments.filter((entry) => entry.name === 'imageCount')).toHaveLength(1)
    // Nothing else leaks: the full argument set is exactly the explicit mapping.
    expect(Object.keys(args).sort()).toEqual(['aspect_ratio', 'audio_prompt', 'duration', 'enable_asmr', 'enable_audio', 'imageCount', 'prompt', 'resolution'])
  })

  it('the canonical Product ASMR control (asmr) is what drives enable_asmr, and music_prompt is forwarded when supplied', () => {
    const { request: normalized, model } = request({ operation: 'text_to_video', model: 'kling-video-v2_5', asmr: true, music_prompt: 'calm piano' })
    const args = argMap(buildKlingMcpVideoCall({ request: normalized, model, prompt: 'p' }))
    expect(args.enable_asmr).toBe('true')
    expect(args.music_prompt).toBe('calm piano')
    expect(args).not.toHaveProperty('audio_prompt')
  })

  it('imageCount is omitted for a model that does not declare it (nothing invented)', () => {
    const { request: normalized } = request({ operation: 'text_to_video', model: 'kling-video-v3_0' })
    const withoutHint: VideoModelCapability = { ...findModel(operations, 'text_to_video', 'kling-video-v3_0')!, outputCountArg: false }
    expect(buildKlingMcpVideoCall({ request: normalized, model: withoutHint, prompt: 'p' }).arguments.map((a) => a.name)).not.toContain('imageCount')
  })
})

function fakeClient(handlers: { callTool?: (params: any) => Promise<unknown>; connect?: () => Promise<unknown> } = {}) {
  const client = {
    connect: vi.fn(handlers.connect ?? (async () => undefined)),
    listTools: vi.fn(),
    callTool: vi.fn(handlers.callTool ?? (async () => ({ content: [{ type: 'text', text: JSON.stringify({ generationId: 'gen-777' }) }] }))),
    close: vi.fn(async () => undefined),
  }
  const seenTokens: string[] = []
  return { client, seenTokens, deps: { createClient: (token: string) => { seenTokens.push(token); return { client: client as any, transport: {} } } } }
}

const builtCall = () => call({ operation: 'text_to_video', model: 'kling-video-v3_0' })

describe('MCP submit (mocked client only — no real provider call)', () => {
  it('submits EXACTLY ONE generation with the mapped model/arguments and returns the generation_id', async () => {
    const { client, seenTokens, deps } = fakeClient()
    const result = await submitKlingMcpVideo(TOKEN, builtCall(), deps)

    expect(result).toEqual({ generationId: 'gen-777' })
    expect(client.callTool).toHaveBeenCalledTimes(1)
    const sent = client.callTool.mock.calls[0][0]
    expect(sent.name).toBe('text_to_video')
    expect(sent.arguments.model).toBe('kling-video-v3_0')
    expect(sent.arguments.arguments).toEqual(expect.arrayContaining([{ name: 'imageCount', value: '1' }, { name: 'resolution', value: '720p' }]))
    expect(sent.arguments).not.toHaveProperty('inputs')
    expect(seenTokens).toEqual([TOKEN])
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['structured content', { structuredContent: { generation_id: 'g-1' }, content: [] }, 'g-1'],
    ['text JSON', { content: [{ type: 'text', text: '{"generationId":"g-2"}' }] }, 'g-2'],
    ['nested data', { content: [{ type: 'text', text: '{"data":{"id":"g-3"}}' }] }, 'g-3'],
    ['numeric id', { content: [{ type: 'text', text: '{"generationId":123456}' }] }, '123456'],
  ])('reads the generation id from %s', async (_name, response, expected) => {
    const { deps } = fakeClient({ callTool: async () => response })
    expect((await submitKlingMcpVideo(TOKEN, builtCall(), deps)).generationId).toBe(expected)
  })

  it('a successful call whose id cannot be found is reported as possibly-billed, never retried', async () => {
    const { client, deps } = fakeClient({ callTool: async () => ({ content: [{ type: 'text', text: 'Accepted.' }] }) })
    await expect(submitKlingMcpVideo(TOKEN, builtCall(), deps)).rejects.toMatchObject({ name: 'KlingMcpSubmitError', failureClass: 'SUBMIT_RESPONSE_UNREADABLE', outcomeUnknown: true })
    expect(client.callTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Account inspiration credits are insufficient; please top up', 'PROVIDER_QUOTA_EXCEEDED'],
    ['The prompt/input media contains disallowed content', 'PROVIDER_CONTENT_REJECTED'],
    ['Something else went wrong', 'PROVIDER_REJECTED'],
  ])('provider rejection %j is classified as %s and is NOT an unknown outcome', async (text, failureClass) => {
    const { client, deps } = fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text }] }) })
    const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
    expect(error).toBeInstanceOf(KlingMcpSubmitError)
    expect(error).toMatchObject({ failureClass, outcomeUnknown: false })
    expect(client.callTool).toHaveBeenCalledTimes(1)
  })

  it('a failure AFTER the request was sent is an unknown outcome (possibly billed) and is never retried', async () => {
    const { client, deps } = fakeClient({ callTool: async () => { throw new Error(`socket hang up Authorization: Bearer ${TOKEN}`) } })
    const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
    expect(error).toMatchObject({ failureClass: 'PROVIDER_UNAVAILABLE', outcomeUnknown: true })
    expect(client.callTool).toHaveBeenCalledTimes(1)
    expect(String(error.message)).not.toContain(TOKEN)
  })

  it.each([
    ['a JSON-RPC error response (invalid params)', () => new ProtocolError(ProtocolErrorCode.InvalidParams, 'bad params')],
    ['an HTTP 403 (permission)', () => new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'forbidden', { status: 403 })],
    ['an HTTP 400', () => new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'bad request', { status: 400 })],
  ])('%s means the tool did NOT run: a definitive rejection, not an "unknown outcome"', async (_name, make) => {
    const { client, deps } = fakeClient({ callTool: async () => { throw make() } })
    const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
    expect(error).toBeInstanceOf(KlingMcpSubmitError)
    expect(error).toMatchObject({ failureClass: 'PROVIDER_REJECTED', outcomeUnknown: false })
    expect(client.callTool).toHaveBeenCalledTimes(1)
  })

  it('a 403 tells the user the account is not authorized to generate (not "check for a charge")', async () => {
    const { deps } = fakeClient({ callTool: async () => { throw new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'forbidden', { status: 403 }) } })
    const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
    expect(error.message).toMatch(/Autorize a geração/)
    expect(error.message).not.toMatch(/Verifique a sua conta/)
  })

  it.each([
    ['a 5xx after sending', () => new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'upstream', { status: 502 })],
    ['a dropped connection', () => new Error('ECONNRESET')],
  ])('%s may have reached the tool: it stays an UNKNOWN outcome', async (_name, make) => {
    const { deps } = fakeClient({ callTool: async () => { throw make() } })
    const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
    expect(error).toMatchObject({ failureClass: 'PROVIDER_UNAVAILABLE', outcomeUnknown: true })
  })

  it('a token rejected before any tool call is an authorization error (nothing submitted)', async () => {
    const { client, deps } = fakeClient({ connect: async () => { throw new UnauthorizedError('nope') } })
    await expect(submitKlingMcpVideo(TOKEN, builtCall(), deps)).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('errors and results never contain the access token or provider headers', async () => {
    for (const deps of [
      fakeClient({ callTool: async () => { throw new Error(`boom ${TOKEN}`) } }).deps,
      fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'no' }] }) }).deps,
    ]) {
      const error = await submitKlingMcpVideo(TOKEN, builtCall(), deps).catch((e) => e)
      expect(JSON.stringify({ name: error.name, message: error.message, ...error })).not.toContain(TOKEN)
    }
  })

  it('image_to_video sends the source as inputs[{name:first_image,inputType:URL,url}]', async () => {
    const { client, deps } = fakeClient()
    await submitKlingMcpVideo(TOKEN, call({ operation: 'image_to_video', model: 'kling-video-v3_0' }, { sourceImageUrl: 'https://s3.example.test/a.png' }), deps)
    expect(client.callTool.mock.calls[0][0]).toMatchObject({
      name: 'image_to_video',
      arguments: { inputs: [{ name: 'first_image', inputType: 'URL', url: 'https://s3.example.test/a.png' }] },
    })
  })

  it('refuses any tool outside the video allow-list before a request is sent', async () => {
    const { client, deps } = fakeClient()
    const forged = { ...builtCall(), tool: 'motion_control' } as any
    await expect(submitKlingMcpVideo(TOKEN, forged, deps)).rejects.toBeInstanceOf(KlingMcpSubmitError)
    expect(client.callTool).not.toHaveBeenCalled()
  })
})

describe('MCP status query and result parsing', () => {
  it.each([
    ['succeed', 'succeeded'],
    ['SUCCESS', 'succeeded'],
    ['completed', 'succeeded'],
    ['failed', 'failed'],
    ['timed-out', 'failed'],
    ['processing', 'processing'],
    ['submitted', 'processing'],
    ['mystery_state', 'processing'],
  ])('raw state %j maps to the domain state %s', (raw, state) => {
    const reading = parseTaskReading({ status: raw, works: [{ url: 'https://cdn.example.test/v.mp4' }] })
    expect(reading.state).toBe(state)
    expect(reading.rawState).toBe(raw)
  })

  it('an UNKNOWN state is never terminal, even when a URL is present (the raw state is surfaced as evidence)', () => {
    const reading = parseTaskReading({ status: 'weird', works: [{ url: 'https://cdn.example.test/v.mp4' }] })
    expect(reading).toMatchObject({ state: 'processing', resultUrl: null, rawState: 'weird' })
  })

  it('the most specific state wins: a task/work state is not shadowed by an envelope status', () => {
    expect(parseTaskReading({ status: 'ok', tasks: [{ status: 'succeed', works: [{ url: 'https://a/v.mp4' }] }] })).toMatchObject({ state: 'succeeded', rawState: 'succeed', resultUrl: 'https://a/v.mp4' })
    expect(parseTaskReading({ status: 'ok', works: [{ status: 'failed' }] })).toMatchObject({ state: 'failed', rawState: 'failed' })
    expect(parseTaskReading({ status: 'ok', data: { status: 'processing' } })).toMatchObject({ state: 'processing', rawState: 'processing' })
  })

  it('an unrecognised state keeps the URL as UNCONFIRMED (for repeated-observation acceptance) but never as the result', () => {
    expect(parseTaskReading({ status: 'finished_ok', works: [{ url: 'https://a/v.mp4' }] })).toMatchObject({ state: 'processing', resultUrl: null, unconfirmedResultUrl: 'https://a/v.mp4' })
    expect(parseTaskReading({ status: 'processing' })).toMatchObject({ unconfirmedResultUrl: null })
  })

  it('reads the result URL (prefers the watermark-free URL), only https', () => {
    expect(parseTaskReading({ status: 'succeed', works: [{ url: 'https://a/v.mp4', urlWithoutWatermark: 'https://b/v.mp4' }] }).resultUrl).toBe('https://b/v.mp4')
    expect(parseTaskReading({ status: 'succeed', data: { works: [{ resource: { url: 'https://c/v.mp4' } }] } }).resultUrl).toBe('https://c/v.mp4')
    expect(parseTaskReading({ status: 'succeed', works: [{ url: 'http://insecure/v.mp4' }] }).resultUrl).toBeNull()
    expect(parseTaskReading({ status: 'succeed', works: [{ cover: 'https://cover/c.jpg' }] }).resultUrl).toBeNull()
  })

  it('"succeeded" without a URL is reported as succeeded-without-url (the poller keeps waiting)', () => {
    expect(parseTaskReading({ status: 'succeed', works: [] })).toMatchObject({ state: 'succeeded', resultUrl: null })
  })

  it('failed tasks carry a bounded provider message', () => {
    expect(parseTaskReading({ status: 'failed', message: 'x'.repeat(2000) }).message).toHaveLength(300)
  })

  it('parseGenerationId tolerates absent/garbage input', () => {
    for (const input of [null, undefined, 'x', 3, [], {}, { generationId: '' }]) expect(parseGenerationId(input)).toBeNull()
  })

  it('queryKlingMcpTask calls ONLY query_tasks with the generation id and reads the state', async () => {
    const { client, deps } = fakeClient({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'succeed', works: [{ url: 'https://cdn.example.test/v.mp4' }] }) }] }) })
    const reading = await queryKlingMcpTask(TOKEN, 'gen-777', deps)
    expect(reading).toMatchObject({ state: 'succeeded', resultUrl: 'https://cdn.example.test/v.mp4' })
    expect(client.callTool).toHaveBeenCalledWith({ name: 'query_tasks', arguments: { generationId: 'gen-777' } })
  })

  it('documented task-level failure text means the GENERATION failed; anything else is transient', async () => {
    const failing = fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Account inspiration credits are insufficient; please top up' }] }) })
    expect(await queryKlingMcpTask(TOKEN, 'g', failing.deps)).toMatchObject({ state: 'failed' })

    const invalid = fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Invalid generationId.' }] }) })
    await expect(queryKlingMcpTask(TOKEN, 'g', invalid.deps)).rejects.toMatchObject({ code: 'PROVIDER_TOOL_ERROR' })
  })

  it.each([
    'Service is temporarily unavailable; please retry later',
    'Request timed out',
    'Internal error',
    'rate limited',
  ])('ambiguous/outage text %j is TRANSIENT: it must never terminally fail a possibly-running paid generation', async (text) => {
    const { deps } = fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text }] }) })
    await expect(queryKlingMcpTask(TOKEN, 'g', deps)).rejects.toMatchObject({ code: 'PROVIDER_TOOL_ERROR' })
  })

  it.each([
    'The prompt/input media contains disallowed content',
    'Account inspiration credits are insufficient; please top up',
    'The selected model does not support this parameter combination',
    'Generation timed out; please resubmit in a moment',
    'Parameter format is invalid',
  ])('unambiguous documented task failure %j fails the generation', async (text) => {
    const { deps } = fakeClient({ callTool: async () => ({ isError: true, content: [{ type: 'text', text }] }) })
    expect(await queryKlingMcpTask(TOKEN, 'g', deps)).toMatchObject({ state: 'failed', message: text })
  })

  it('a malformed generation id is refused locally, before any connection', async () => {
    const { client, deps } = fakeClient()
    await expect(queryKlingMcpTask(TOKEN, 'x; drop', deps)).rejects.toBeInstanceOf(ProviderConnectionError)
    expect(client.connect).not.toHaveBeenCalled()
  })

  it('a rejected token surfaces as authorization-required', async () => {
    const { deps } = fakeClient({ connect: async () => { throw new UnauthorizedError('expired') } })
    await expect(queryKlingMcpTask(TOKEN, 'g', deps)).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)
  })
})

describe('KlingMcpTransport (normalized submit/status contract)', () => {
  const tokens = (values: string[]) => {
    const queue = [...values]
    return { get: vi.fn(async () => queue[0]), refresh: vi.fn(async () => { queue.shift(); return queue[0] }) }
  }

  it('submit returns the normalized task id + safe provider metadata (no token)', async () => {
    const { deps } = fakeClient()
    const transport = new KlingMcpTransport(tokens([TOKEN]), deps)
    const { request: normalized, model } = request({ operation: 'text_to_video', model: 'kling-video-v3_0' })
    const result = await transport.submit({ generationId: 'row-1', prompt: 'p', request: normalized, model })
    expect(result).toEqual({ taskId: 'gen-777', providerMetadata: { generation_id: 'gen-777', tool: 'text_to_video', model: 'kling-video-v3_0' } })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(transport.transport).toBe('mcp')
  })

  it('a token rejected before use is refreshed ONCE and the call retried (safe: nothing was submitted)', async () => {
    let attempt = 0
    const { client, seenTokens, deps } = fakeClient({
      connect: async () => { if (attempt++ === 0) throw new UnauthorizedError('expired') },
    })
    const auth = tokens(['old-token', 'new-token'])
    const transport = new KlingMcpTransport(auth, deps)
    const { request: normalized, model } = request({ operation: 'text_to_video', model: 'kling-video-v3_0' })

    await transport.submit({ generationId: 'row-1', prompt: 'p', request: normalized, model })

    expect(seenTokens).toEqual(['old-token', 'new-token'])
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    expect(client.callTool).toHaveBeenCalledTimes(1)
  })

  it('a second rejection is surfaced, not looped', async () => {
    const { deps } = fakeClient({ connect: async () => { throw new UnauthorizedError('still bad') } })
    const auth = tokens(['a', 'b'])
    await expect(new KlingMcpTransport(auth, deps).getStatus('gen-1')).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
  })

  it('getStatus normalizes to the existing domain vocabulary (no MCP-specific status)', async () => {
    const respond = (payload: unknown) => fakeClient({ callTool: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) }).deps
    const t = (payload: unknown) => new KlingMcpTransport(tokens([TOKEN]), respond(payload)).getStatus('gen-1')

    expect(await t({ status: 'processing' })).toMatchObject({ state: 'processing' })
    expect(await t({ status: 'succeed', works: [{ url: 'https://cdn.example.test/v.mp4' }] })).toEqual({ state: 'succeeded', resultUrl: 'https://cdn.example.test/v.mp4', rawState: 'succeed' })
    expect(await t({ status: 'failed', message: 'nope' })).toMatchObject({ state: 'failed', message: 'nope', code: 'PROVIDER_FAILED' })
  })
})
