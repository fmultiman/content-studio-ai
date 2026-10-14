import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { accountConnectionRef } from '@/lib/video-generation/connection-ref'
import { createFakeDb } from './helpers/fake-db'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'

// VEO_KLING_FIRST_LAST_FRAME_V1 — the whole server flow with mocks only. There is NO real provider call in this file: the
// Kling REST adapter is a stub, the Kling MCP client is a recording fake and Google Veo is a stubbed global fetch.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/storage/s3', async () => {
  const { pngBytes } = await import('./helpers/image-fixtures')
  const png = pngBytes(1024, 1024, 4096)
  return {
    createPresignedReadUrl: vi.fn(async (path?: string) => `https://s3.example.test/signed/${encodeURIComponent(path ?? 'x')}?sig=1`),
    headS3Object: vi.fn(async () => ({ size: png.byteLength, contentType: 'image/png' })),
    readS3Object: vi.fn(async () => ({ bytes: png, contentType: 'image/png' })),
  }
})
vi.mock('@/lib/security/pinned-provider-upload', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/security/pinned-provider-upload')>()),
  postMultipartToProvider: vi.fn(async () => ({ status: 200, json: { url: 'https://provider-files.example.test/u/abc123.png' } })),
}))
vi.mock('@/lib/storage/video-downloader', () => ({ downloadAndStoreVideo: vi.fn() }))
vi.mock('@/lib/provider-connections/token-store', () => ({
  getValidAccessToken: vi.fn(async () => 'MCP-ACCESS-TOKEN-SECRET'),
  forceRefreshAccessToken: vi.fn(async () => 'MCP-REFRESHED-TOKEN-SECRET'),
}))
vi.mock('@/lib/provider-connections/kling-mcp-client', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/provider-connections/kling-mcp-client')>()),
  createKlingMcpClient: vi.fn(),
}))

const restCalls: Array<{ kind: string; args: unknown[] }> = []
vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    submitImageToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 'i2v', args }); return { task_id: 'rest-task-1' } }
    submitTextToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 't2v', args }); return { task_id: 'rest-task-2' } }
    getTaskStatus = async () => ({ id: 'rest-task-1', status: 'processing', created_at: 1, updated_at: 1 })
  },
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import * as mcpClient from '@/lib/provider-connections/kling-mcp-client'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import { createPresignedReadUrl, headS3Object, readS3Object } from '@/lib/storage/s3'
import { postMultipartToProvider } from '@/lib/security/pinned-provider-upload'
import { pollDueMcpGenerations } from '@/lib/video-generation/polling'
import { pngBytes } from './helpers/image-fixtures'

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const IMG_A = '10000000-0000-4000-8000-00000000000a'
const IMG_B = '10000000-0000-4000-8000-00000000000b'
const IMG_FOREIGN = '10000000-0000-4000-8000-0000000000ff'
const LIB_B = '20000000-0000-4000-8000-00000000000b'
const SESSION = '30000000-0000-4000-8000-000000000001'
const BLOB = (n: number) => `99999999-9999-4999-8999-99999999999${n}`
const PROVIDER_FILE_URL = 'https://provider-files.example.test/u/abc123.png'
const GEMINI_KEY = 'AIza-TEST-FIXTURE-KEY-0000'
const NOW_ISO = new Date().toISOString()
const OP = 'models/veo-3.1-fast-generate-preview/operations/op-123'

const video = normalizeKlingMcpVideoCapabilities(whoAmIFixture())

const connectionRow = () => ({
  id: CONNECTION_ID, user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected',
  scopes: ['generation.read', 'account.credit.read', 'generation.create'], external_account_id: '424242',
  capabilities: { membership: { label: 'Pro' }, video }, last_checked_at: NOW_ISO, last_error_code: null,
})

const image = (id: string, blob: number, userId = 'user-a') => ({
  id, user_id: userId, project_id: 'proj-1', image_url: `https://img.example.test/${id}.png`, storage_path: `users/${userId}/images/${BLOB(blob)}/original.png`,
})
const libraryFile = (id: string, blob: number) => ({
  id, user_id: 'user-a', project_id: 'proj-1', kind: 'image', mime_type: 'image/png', name: 'fim.png',
  storage_path: `users/user-a/library/${BLOB(blob)}/fim.png`, public_url: 'https://cdn.example.test/fim.png', deleted_at: null, origin: 'upload',
})

function makeDb(options: { klingKey?: string; geminiKey?: string; connections?: any[]; generations?: any[]; libraryFiles?: any[] } = {}) {
  const settings: Record<string, unknown> = { user_id: 'user-a' }
  if (options.klingKey) settings.kling_api_key = options.klingKey
  if (options.geminiKey) settings.gemini_api_key = options.geminiKey
  return createFakeDb({
    seed: {
      provider_connections: options.connections ?? [],
      user_settings: options.klingKey || options.geminiKey ? [settings] : [],
      video_generations: options.generations ?? [],
      video_generation_sessions: [{ id: SESSION, user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1' }],
      productions: [{ id: 'prod-1', project_id: 'proj-1', user_id: 'user-a' }],
      images: [image('img-1', 1), image(IMG_A, 2), image(IMG_B, 3), image(IMG_FOREIGN, 4, 'user-b')],
      library_files: options.libraryFiles ?? [libraryFile(LIB_B, 5)],
      provider_usage_events: [],
      video_drafts: [],
    },
    unique: { images: [['id']], library_files: [['id']], productions: [['id']] },
  }) as any
}

function signIn(db: any) {
  const client = { from: db.from, auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-a' } }, error: null })) } }
  vi.mocked(server.createClient).mockResolvedValue(client as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
  return client
}

interface FakeMcp { calls: Array<{ name: string; arguments: any }> }
const UPLOAD_TICKET = { ticket: 'UPLOAD-TICKET-SECRET', upload_url: 'https://upload.example.test/put', expire_at: Math.floor(Date.now() / 1000) + 600 }
function installFakeMcp(): FakeMcp {
  const state: FakeMcp = { calls: [] }
  vi.mocked(mcpClient.createKlingMcpClient).mockImplementation((() => ({
    client: {
      connect: async () => undefined,
      listTools: async () => ({ tools: [] }),
      callTool: async (params: any) => {
        state.calls.push(params)
        return params.name === 'file_upload'
          ? { content: [{ type: 'text', text: JSON.stringify(UPLOAD_TICKET) }] }
          : { content: [{ type: 'text', text: JSON.stringify({ generationId: 'mcp-gen-1' }) }] }
      },
      close: async () => undefined,
    },
    transport: {},
  })) as any)
  return state
}

// Google Veo: a stubbed global fetch. Every call is recorded; nothing leaves the process.
interface VeoCall { url: string; method: string; headers: Record<string, string>; body: any }
let veoCalls: VeoCall[] = []
let veoReply: (call: VeoCall) => Response = () => new Response(JSON.stringify({ name: OP }), { status: 200 })
function installVeo() {
  veoCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const call: VeoCall = { url: String(url), method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(String(init.body)) : null }
    veoCalls.push(call)
    return veoReply(call)
  }))
}

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/video-generations/route')
  return POST(new NextRequest('http://localhost/api/video-generations', { method: 'POST', body: JSON.stringify(body) }))
}
const base = { projectId: 'proj-1', productionId: 'prod-1', prompt: 'a door slowly opens onto a garden' }
const i2v = (extra: Record<string, unknown> = {}) => ({ ...base, mode: 'image_to_video', sourceImageId: IMG_A, ...extra })

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  restCalls.length = 0
  veoCalls = []
  veoReply = () => new Response(JSON.stringify({ name: OP }), { status: 200 })
  process.env.NEXT_PUBLIC_APP_URL = 'https://content.example.test'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  consoleError.mockRestore()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ===========================================================================
// Kling REST: first + last frame
// ===========================================================================
describe('Kling REST — image_to_video with a first AND a last frame', () => {
  it('sends both presigned URLs, records the frame pair as ids only, and leaves single-image I2V untouched', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)

    const response = await post(i2v({ lastFrameImageId: IMG_B, connectionRef: 'kling:api', model: 'kling-v3' }))

    expect(response.status).toBe(200)
    expect(restCalls).toHaveLength(1)
    const args = restCalls[0].args as any[]
    expect(args[1]).toContain(encodeURIComponent(`users/user-a/images/${BLOB(2)}/original.png`))
    expect(args[6]).toContain(encodeURIComponent(`users/user-a/images/${BLOB(3)}/original.png`))
    expect(args[1]).not.toBe(args[6])
    expect(args[5]).toBe('kling-v3')
    const row = db.tables.video_generations[0]
    expect(row).toMatchObject({
      mode: 'image_to_video', source_image_id: IMG_A, source_library_file_id: null, transport: 'rest', provider: 'kling',
      request_config: { first_frame: { type: 'generated', id: IMG_A }, last_frame: { type: 'generated', id: IMG_B }, multi_shot: false },
    })
    // Ids only: never a URL or a storage path.
    expect(JSON.stringify(row.request_config)).not.toMatch(/https?:|signed|users\//)

    // A single-image I2V on the same connection records no frame pair and sends no last frame.
    restCalls.length = 0
    const single = await post(i2v({ connectionRef: 'kling:api' }))
    expect(single.status).toBe(200)
    expect((restCalls[0].args as any[])[6]).toBeUndefined()
    expect(db.tables.video_generations[1].request_config).not.toHaveProperty('last_frame')
  })

  it('a LibraryFile can be the last frame (Arquivos / Galeria / Enviar are all LibraryFiles)', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    const response = await post(i2v({ lastFrameLibraryFileId: LIB_B, connectionRef: 'kling:api' }))
    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0].request_config).toMatchObject({ first_frame: { type: 'generated', id: IMG_A }, last_frame: { type: 'library', id: LIB_B } })
  })

  it('Kling 2.6 + two frames at 720p is refused with the specific reason - zero records, zero provider calls', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    const response = await post(i2v({ lastFrameImageId: IMG_B, connectionRef: 'kling:api', model: 'kling-v2-6', resolution: '720p' }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('LAST_FRAME_RESOLUTION_CONFLICT')
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
    const ok = await post(i2v({ lastFrameImageId: IMG_B, connectionRef: 'kling:api', model: 'kling-v2-6', resolution: '1080p', audio: 'off' }))
    expect(ok.status).toBe(200)
  })

  it('a last frame is never accepted for text_to_video, with both ids, or equal to the first frame', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    expect((await (await post({ ...base, mode: 'text_to_video', lastFrameImageId: IMG_B, connectionRef: 'kling:api' })).json()).code).toBe('UNSUPPORTED_LAST_FRAME')
    expect((await (await post(i2v({ lastFrameImageId: IMG_B, lastFrameLibraryFileId: LIB_B }))).json()).code).toBe('INVALID_LAST_FRAME')
    expect((await (await post(i2v({ lastFrameImageId: IMG_A }))).json()).code).toBe('LAST_FRAME_SAME_AS_FIRST')
    expect((await (await post(i2v({ lastFrameImageId: 'not-a-uuid' }))).json()).code).toBe('INVALID_LAST_FRAME')
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('another user’s image as the last frame is "not found": nothing is created or sent', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    const response = await post(i2v({ lastFrameImageId: IMG_FOREIGN, connectionRef: 'kling:api' }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ frame: 'last' })
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('idempotency covers BOTH frames: the same key replays without a second paid call; a different end frame is a conflict', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    const key = '40000000-0000-4000-8000-000000000001'
    const first = await post(i2v({ lastFrameImageId: IMG_B, connectionRef: 'kling:api', clientRequestId: key, sessionId: SESSION }))
    expect(first.status).toBe(200)
    expect(restCalls).toHaveLength(1)

    const replay = await post(i2v({ lastFrameImageId: IMG_B, connectionRef: 'kling:api', clientRequestId: key, sessionId: SESSION }))
    expect(replay.status).toBe(200)
    expect((await replay.json()).idempotentReplay).toBe(true)

    const conflict = await post(i2v({ lastFrameLibraryFileId: LIB_B, connectionRef: 'kling:api', clientRequestId: key, sessionId: SESSION }))
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_KEY_REUSED')

    const dropped = await post(i2v({ connectionRef: 'kling:api', clientRequestId: key, sessionId: SESSION }))
    expect(dropped.status).toBe(409)
    expect(restCalls).toHaveLength(1)
    expect(db.tables.video_generations).toHaveLength(1)
  })
})

// ===========================================================================
// Kling MCP: tail_image
// ===========================================================================
describe('Kling MCP — image_to_video with first_image + tail_image', () => {
  const mcpBody = (extra: Record<string, unknown> = {}) => i2v({ connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0', multi_shot: false, ...extra })

  it('uploads BOTH frames first, then sends first_image and tail_image as the provider’s own URLs (never ours)', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody({ lastFrameImageId: IMG_B }))

    expect(response.status).toBe(200)
    expect(mcp.calls.map((call) => call.name)).toEqual(['file_upload', 'file_upload', 'image_to_video'])
    expect(postMultipartToProvider).toHaveBeenCalledTimes(2)
    expect(mcp.calls[2].arguments.inputs).toEqual([
      { name: 'first_image', inputType: 'URL', url: PROVIDER_FILE_URL },
      { name: 'tail_image', inputType: 'URL', url: PROVIDER_FILE_URL },
    ])
    expect(JSON.stringify(mcp.calls)).not.toMatch(/s3\.example\.test|signed|data:image|UPLOAD-TICKET-SECRET/)
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(db.tables.video_generations[0]).toMatchObject({ transport: 'mcp', provider: 'kling', request_config: { last_frame: { type: 'generated', id: IMG_B } } })
  })

  it('a model without tail_image (Turbo) refuses the last frame BEFORE any upload', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await post(mcpBody({ lastFrameImageId: IMG_B, model: 'kling-video-v3_0_turbo', multi_shot: undefined }))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('UNSUPPORTED_LAST_FRAME')
    expect(mcp.calls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('Kling 2.6 over MCP: 720p and audio-on are refused; 1080p without audio is sent', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    expect((await post(mcpBody({ lastFrameImageId: IMG_B, model: 'kling-video-v2_6', resolution: '720p', multi_shot: undefined }))).status).toBe(400)
    expect((await (await post(mcpBody({ lastFrameImageId: IMG_B, model: 'kling-video-v2_6', resolution: '1080p', audio: 'on', multi_shot: undefined }))).json()).code).toBe('LAST_FRAME_AUDIO_CONFLICT')
    expect(mcp.calls).toEqual([])
    const ok = await post(mcpBody({ lastFrameImageId: IMG_B, model: 'kling-video-v2_6', resolution: '1080p', audio: 'off', multi_shot: undefined }))
    expect(ok.status).toBe(200)
    expect(mcp.calls.at(-1)?.arguments.inputs.map((input: any) => input.name)).toEqual(['first_image', 'tail_image'])
  })
})

// ===========================================================================
// Google Veo
// ===========================================================================
describe('Google Veo — text_to_video and first/last-frame image_to_video', () => {
  const veoBody = (extra: Record<string, unknown> = {}) => ({ connectionRef: 'google:gemini', model: 'veo-3.1-fast-generate-preview', ...extra })
  const enable = () => vi.stubEnv('CONTENT_STUDIO_VEO_VIDEO_GENERATION', 'enabled')

  it('ships DISABLED: a saved key is not enough - 403, no record, no provider call, no frame read', async () => {
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    const response = await post(i2v(veoBody({ lastFrameImageId: IMG_B })))
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('FEATURE_DISABLED')
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
    expect(readS3Object).not.toHaveBeenCalled()
  })

  it('CONTROLLED CANARY: with an allowlist the switch only opens Veo for the listed user - anyone else is refused before any record or call', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    vi.stubEnv('CONTENT_STUDIO_VEO_CANARY_USER_IDS', '99999999-9999-4999-8999-999999999999')
    const refused = await post({ ...base, mode: 'text_to_video', ...veoBody() })
    expect(refused.status).toBe(403)
    // A distinct code: "released, but this account is not on the allowlist" is not "switch off".
    expect((await refused.json()).code).toBe('CANARY_RESTRICTED')
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)

    vi.stubEnv('CONTENT_STUDIO_VEO_CANARY_USER_IDS', 'user-a')
    const allowed = await post({ ...base, mode: 'text_to_video', ...veoBody() })
    expect(allowed.status).toBe(200)
    expect(veoCalls).toHaveLength(1)
  })

  it('A+B at 4 s is refused for Veo before any record or call (8 s only, conservatively)', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    const response = await post(i2v(veoBody({ lastFrameImageId: IMG_B, duration: 4 })))
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('LAST_FRAME_DURATION_CONFLICT')
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
    // One image keeps 4 s.
    expect((await post(i2v(veoBody({ duration: 4 })))).status).toBe(200)
  })

  it('without the user’s own Gemini key it is a typed 422 (a Kling key never substitutes)', async () => {
    enable()
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    installVeo()
    const response = await post({ ...base, mode: 'text_to_video', ...veoBody() })
    expect(response.status).toBe(422)
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('T2V: one predictLongRunning call, key only in the header, the operation is recorded and polling is scheduled', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()

    const response = await post({ ...base, mode: 'text_to_video', ...veoBody({ duration: 6, resolution: '720p', aspect_ratio: '9:16' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(veoCalls).toHaveLength(1)
    expect(veoCalls[0]).toMatchObject({ method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning' })
    expect(veoCalls[0].headers['x-goog-api-key']).toBe(GEMINI_KEY)
    expect(veoCalls[0].body).toEqual({ instances: [{ prompt: base.prompt }], parameters: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 6 } })
    expect(db.tables.video_generations[0]).toMatchObject({
      provider: 'gemini', transport: 'rest', connection_id: null, model: 'veo-3.1-fast-generate-preview', status: 'submitted', task_id: OP, poll_attempts: 0,
      request_config: { duration: 6, resolution: '720p', aspect_ratio: '9:16', output_count: 1 },
    })
    expect(db.tables.video_generations[0].next_poll_at).toBeTruthy()
    expect(JSON.stringify([body, db.tables.video_generations])).not.toContain(GEMINI_KEY)
  })

  it('I2V with A only: image inline, no lastFrame; aspect ratio defaults explicitly', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    const response = await post(i2v(veoBody()))
    expect(response.status).toBe(200)
    const instance = veoCalls[0].body.instances[0]
    expect(Object.keys(instance).sort()).toEqual(['image', 'prompt'])
    expect(instance.image.inlineData.mimeType).toBe('image/png')
    expect(veoCalls[0].body.parameters).toEqual({ aspectRatio: '16:9', resolution: '720p', durationSeconds: 8 })
    expect(db.tables.video_generations[0].request_config).not.toHaveProperty('last_frame')
  })

  it('I2V with A + B: both frames inline, the pair recorded as ids, nothing public or presigned involved', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()

    const response = await post(i2v(veoBody({ lastFrameLibraryFileId: LIB_B, duration: 8, resolution: '1080p' })))

    expect(response.status).toBe(200)
    expect(Object.keys(veoCalls[0].body.instances[0]).sort()).toEqual(['image', 'lastFrame', 'prompt'])
    expect(veoCalls[0].body.parameters).toMatchObject({ resolution: '1080p', durationSeconds: 8 })
    expect(db.tables.video_generations[0]).toMatchObject({
      source_image_id: IMG_A, source_library_file_id: null, provider: 'gemini',
      request_config: { first_frame: { type: 'generated', id: IMG_A }, last_frame: { type: 'library', id: LIB_B } },
    })
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('1080p with a 4 s clip is refused (Google ties 1080p/4k to 8 s); an unknown model is not guessed', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    expect((await (await post(i2v(veoBody({ resolution: '1080p', duration: 4 })))).json()).code).toBe('DURATION_RESOLUTION_CONFLICT')
    expect((await (await post(i2v(veoBody({ model: 'veo-2.0-generate-001' })))).json()).code).toBe('UNSUPPORTED_MODEL')
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('a frame over the Veo inline limit is refused before any record or provider call', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    const huge = pngBytes(1024, 1024, 8_000_000)
    vi.mocked(headS3Object).mockResolvedValueOnce({ size: huge.byteLength, contentType: 'image/png' } as any)
    vi.mocked(readS3Object).mockResolvedValueOnce({ bytes: huge, contentType: 'image/png' } as any)
    const response = await post(i2v(veoBody()))
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('SOURCE_IMAGE_TOO_LARGE')
    expect(veoCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('a 5xx from Google is an UNKNOWN outcome: recorded as possibly billed, never retried, and a replay of the key does not call Google again', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    veoReply = () => new Response(JSON.stringify({ error: { message: 'internal' } }), { status: 503 })
    const key = '40000000-0000-4000-8000-000000000002'

    const response = await post(i2v(veoBody({ lastFrameImageId: IMG_B, clientRequestId: key, sessionId: SESSION })))
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', outcomeUnknown: true })
    expect(veoCalls).toHaveLength(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'SUBMIT_OUTCOME_UNKNOWN', outcome_unknown: true } })

    const replay = await post(i2v(veoBody({ lastFrameImageId: IMG_B, clientRequestId: key, sessionId: SESSION })))
    expect((await replay.json())).toMatchObject({ idempotentReplay: true, outcomeUnknown: true })
    expect(veoCalls).toHaveLength(1)
    expect(JSON.stringify([body, db.tables.video_generations])).not.toContain(GEMINI_KEY)
  })

  it('a definitive refusal (400) is recorded as certain: outcome_unknown is false', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    veoReply = () => new Response(JSON.stringify({ error: { message: 'Invalid value at parameters.durationSeconds' } }), { status: 400 })
    const response = await post({ ...base, mode: 'text_to_video', ...veoBody() })
    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'PROVIDER_REJECTED', outcomeUnknown: false })
    // The browser never receives Google's text; the attempt keeps the status and the bounded message for diagnosis.
    expect(JSON.stringify(body)).not.toContain('durationSeconds')
    expect(db.tables.video_generations[0]).toMatchObject({
      status: 'failed',
      error_details: { outcome_unknown: false, provider_status: 400, provider_text: 'Invalid value at parameters.durationSeconds' },
    })
    expect(veoCalls).toHaveLength(1)
  })

  it('a project-scoped frame of another user never reaches Google', async () => {
    enable()
    const db = makeDb({ geminiKey: GEMINI_KEY })
    signIn(db)
    installVeo()
    expect((await post(i2v(veoBody({ lastFrameImageId: IMG_FOREIGN })))).status).toBe(403)
    expect(veoCalls).toEqual([])
  })
})

// ===========================================================================
// Google Veo: polling, completion, sync, cost
// ===========================================================================
describe('Google Veo — polling and completion', () => {
  const RESULT_URI = 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media'
  const veoRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'gen-veo-1', user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'image_to_video', provider: 'gemini', transport: 'rest',
    model: 'veo-3.1-fast-generate-preview', status: 'submitted', task_id: OP, created_at: NOW_ISO, poll_attempts: 0,
    next_poll_at: new Date(Date.now() - 5000).toISOString(), request_config: { duration: 8, resolution: '720p', aspect_ratio: '16:9', output_count: 1 }, ...overrides,
  })
  const doneReply = () => new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: RESULT_URI } }] } } }), { status: 200 })
  const stored = { storagePath: 'user-a/videos/ai/proj-1/gen-veo-1.mp4', publicUrl: 'https://s3.example.test/gen-veo-1.mp4', mime: 'video/mp4', size: 99 }

  it('the scheduled poller reads the operation with the OWNER’s key, copies the result with the key header, and records DERIVED seconds', async () => {
    const db = makeDb({ geminiKey: GEMINI_KEY, generations: [veoRow()] })
    installVeo()
    veoReply = doneReply
    const download = vi.fn(async () => stored)

    const summary = await pollDueMcpGenerations(db, { download: download as any })

    expect(summary.outcomes).toMatchObject({ completed: 1 })
    expect(veoCalls).toHaveLength(1)
    expect(veoCalls[0]).toMatchObject({ method: 'GET', url: `https://generativelanguage.googleapis.com/v1beta/${OP}` })
    expect(veoCalls[0].headers['x-goog-api-key']).toBe(GEMINI_KEY)
    expect(download).toHaveBeenCalledWith(RESULT_URI, 'user-a/videos/ai/proj-1', { objectName: 'gen-veo-1.mp4', headers: { 'x-goog-api-key': GEMINI_KEY } })
    const row = db.tables.video_generations[0]
    expect(row).toMatchObject({ status: 'succeeded', storage_path: stored.storagePath })
    // Neither the temporary Google URI nor the key is persisted.
    expect(JSON.stringify(row)).not.toContain('generativelanguage')
    expect(JSON.stringify(row)).not.toContain(GEMINI_KEY)
    const usage = db.tables.provider_usage_events
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ provider: 'gemini', operation: 'image_to_video', model: 'veo-3.1-fast-generate-preview', quantity: 8, unit: 'seconds', measurement_source: 'derived', resource_id: 'gen-veo-1' })
    expect(JSON.stringify(usage)).not.toContain(GEMINI_KEY)
  })

  it('a pending operation stays pending (rescheduled); a safety-filtered result fails WITHOUT usage', async () => {
    const db = makeDb({ geminiKey: GEMINI_KEY, generations: [veoRow()] })
    installVeo()
    veoReply = () => new Response(JSON.stringify({ done: false }), { status: 200 })
    await pollDueMcpGenerations(db, { download: vi.fn() as any })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', poll_attempts: 1 })

    const filtered = makeDb({ geminiKey: GEMINI_KEY, generations: [veoRow()] })
    veoReply = () => new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1 } } }), { status: 200 })
    const summary = await pollDueMcpGenerations(filtered, { download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ failed: 1 })
    expect(filtered.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_CONTENT_FILTERED' } })
    expect(filtered.tables.provider_usage_events).toHaveLength(0)
  })

  it('a transient Google outage is not a verdict: the row stays in flight and is retried later', async () => {
    const db = makeDb({ geminiKey: GEMINI_KEY, generations: [veoRow()] })
    installVeo()
    veoReply = () => new Response('', { status: 503 })
    const summary = await pollDueMcpGenerations(db, { download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ transient_error: 1 })
    expect(db.tables.video_generations[0].status).not.toBe('failed')
  })

  it('if the owner’s Gemini key is gone the job is failed explicitly (nothing to retrieve with), without calling Google', async () => {
    const db = makeDb({ generations: [veoRow()] })
    installVeo()
    const summary = await pollDueMcpGenerations(db, { download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ connection_unavailable: 1 })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'CONNECTION_UNAVAILABLE' } })
    expect(veoCalls).toEqual([])
  })

  it('the manual sync route completes a Veo generation through the same boundary with the user’s own key', async () => {
    const db = makeDb({ geminiKey: GEMINI_KEY, generations: [veoRow({ status: 'processing' })] })
    signIn(db)
    installVeo()
    veoReply = doneReply
    vi.mocked(downloadAndStoreVideo).mockResolvedValue(stored)
    const { POST } = await import('@/app/api/video-generations/[id]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/video-generations/gen-veo-1/sync', { method: 'POST' }), { params: Promise.resolve({ id: 'gen-veo-1' }) })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.outcome).toBe('completed')
    expect(downloadAndStoreVideo).toHaveBeenCalledWith(RESULT_URI, 'user-a/videos/ai/proj-1', { objectName: 'gen-veo-1.mp4', headers: { 'x-goog-api-key': GEMINI_KEY } })
    expect(JSON.stringify(body)).not.toContain(GEMINI_KEY)
  })
})
