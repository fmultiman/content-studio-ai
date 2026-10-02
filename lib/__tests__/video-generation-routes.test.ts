import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { UnauthorizedError } from '@modelcontextprotocol/client'
import { normalizeKlingMcpVideoCapabilities } from '@/lib/provider-connections/kling-mcp-video-capabilities'
import { accountConnectionRef } from '@/lib/video-generation/connection-ref'
import { createFakeDb } from './helpers/fake-db'
import { whoAmIFixture } from './helpers/kling-who-am-i-fixture'

// ---------------------------------------------------------------------------
// Mocks: everything below the route is in-memory. There is NO real provider
// call anywhere in this file: the MCP client is a recording fake and the REST
// adapter is a stub.
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/storage/s3', async () => {
  // VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1: MCP reads the source BYTES server-side (REST still presigns a URL).
  const { pngBytes } = await import('./helpers/image-fixtures')
  const png = pngBytes(1024, 1024, 4096)
  return {
    createPresignedReadUrl: vi.fn(async () => 'https://s3.example.test/signed-source.png?sig=1'),
    headS3Object: vi.fn(async () => ({ size: png.byteLength, contentType: 'image/png' })),
    readS3Object: vi.fn(async () => ({ bytes: png, contentType: 'image/png' })),
  }
})
// The provider's upload endpoint: the multipart POST itself is unit-tested in pinned-provider-upload.test.ts.
const PROVIDER_FILE_URL = 'https://provider-files.example.test/u/abc123.png'
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
let restFailure: Error | null = null
const constructedApiKeys: string[] = []
vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    constructor(apiKey: string) {
      constructedApiKeys.push(apiKey)
    }
    submitImageToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 'i2v', args }); if (restFailure) throw restFailure; return { task_id: 'rest-task-1' } }
    submitTextToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 't2v', args }); if (restFailure) throw restFailure; return { task_id: 'rest-task-2' } }
    getTaskStatus = async () => ({ id: 'rest-task-1', status: 'processing', created_at: 1, updated_at: 1 })
  },
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import * as mcpClient from '@/lib/provider-connections/kling-mcp-client'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import { createPresignedReadUrl, headS3Object, readS3Object } from '@/lib/storage/s3'
import { postMultipartToProvider } from '@/lib/security/pinned-provider-upload'
import { pngBytes, toDataUrl } from './helpers/image-fixtures'

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_ID = '22222222-2222-4222-8222-222222222222'
const LIB_BLOB = '99999999-9999-4999-8999-999999999999'
const IMG_BLOB = '88888888-8888-4888-8888-888888888888'
const SECRET_TOKENS = ['MCP-ACCESS-TOKEN-SECRET', 'MCP-REFRESHED-TOKEN-SECRET']
const NOW_ISO = new Date().toISOString()

const video = normalizeKlingMcpVideoCapabilities(whoAmIFixture())

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    user_id: 'user-a',
    provider: 'kling',
    connection_method: 'mcp_oauth',
    status: 'connected',
    scopes: ['generation.read', 'account.credit.read', 'generation.create'],
    external_account_id: '424242',
    capabilities: { membership: { label: 'Pro' }, video },
    last_checked_at: NOW_ISO,
    last_error_code: null,
    ...overrides,
  }
}

function makeDb(rows: { connections?: any[]; klingKey?: string | null; generations?: any[]; images?: any[]; libraryFiles?: any[] } = {}) {
  return createFakeDb({
    seed: {
      provider_connections: rows.connections ?? [],
      user_settings: rows.klingKey === undefined || rows.klingKey === null ? [] : [{ user_id: 'user-a', kling_api_key: rows.klingKey }],
      video_generations: rows.generations ?? [],
      productions: [{ id: 'prod-1', project_id: 'proj-1', user_id: 'user-a' }],
      images: rows.images ?? [{ id: 'img-1', user_id: 'user-a', project_id: 'proj-1', image_url: 'https://img.example.test/1.png', storage_path: `users/user-a/images/${IMG_BLOB}/original.png` }],
      library_files: rows.libraryFiles ?? [],
      video_drafts: [],
      channel_piece_media: [],
    },
    unique: { images: [['id']], library_files: [['id']], productions: [['id']] },
  }) as any
}

/** The user-session client: the same in-memory database, plus auth. */
function signIn(db: any, userId: string | null = 'user-a') {
  const client = { from: db.from, auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } }
  vi.mocked(server.createClient).mockResolvedValue(client as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
  return client
}

interface FakeMcp {
  calls: Array<{ name: string; arguments: any }>
  tokens: string[]
  reply: (params: { name: string; arguments: any }) => unknown
  connectError?: Error
}

const UPLOAD_TICKET = { ticket: 'UPLOAD-TICKET-SECRET', upload_url: 'https://upload.example.test/put', expire_at: Math.floor(Date.now() / 1000) + 600 }
const defaultMcpReply: FakeMcp['reply'] = (params) =>
  params.name === 'file_upload'
    ? { content: [{ type: 'text', text: JSON.stringify(UPLOAD_TICKET) }] }
    : { content: [{ type: 'text', text: JSON.stringify({ generationId: 'mcp-gen-1' }) }] }

function installFakeMcp(reply: FakeMcp['reply'] = defaultMcpReply): FakeMcp {
  const state: FakeMcp = { calls: [], tokens: [], reply }
  vi.mocked(mcpClient.createKlingMcpClient).mockImplementation(((token: string) => {
    state.tokens.push(token)
    return {
      client: {
        connect: async () => { if (state.connectError) throw state.connectError },
        listTools: async () => ({ tools: [] }),
        callTool: async (params: any) => { state.calls.push(params); return state.reply(params) },
        close: async () => undefined,
      },
      transport: {},
    }
  }) as any)
  return state
}

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/video-generations/route')
  return POST(new NextRequest('http://localhost/api/video-generations', { method: 'POST', body: JSON.stringify(body) }))
}

const base = { projectId: 'proj-1', productionId: 'prod-1', prompt: 'a red fox running' }
const mcpBody = (extra: Record<string, unknown> = {}) => ({ ...base, mode: 'text_to_video', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0', ...extra })

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  restCalls.length = 0
  restFailure = null
  constructedApiKeys.length = 0
  process.env.NEXT_PUBLIC_APP_URL = 'https://content.example.test'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  consoleError.mockRestore()
  delete process.env.VIDEO_POLL_WORKER_SECRET
})

const noSecretsIn = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of SECRET_TOKENS) expect(text).not.toContain(secret)
}

// ===========================================================================
// GET /api/video-generations/connections
// ===========================================================================
describe('GET /api/video-generations/connections (capability API)', () => {
  const get = async () => (await import('@/app/api/video-generations/connections/route')).GET()

  it('requires authentication', async () => {
    signIn(makeDb(), null)
    expect((await get()).status).toBe(401)
  })

  it('returns Kling API first, then the user’s own account connections, with normalized capabilities only', async () => {
    const db = makeDb({ klingKey: 'REST-KEY', connections: [connectionRow(), connectionRow({ id: FOREIGN_ID, user_id: 'user-b' })] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.connections.map((entry: any) => entry.ref)).toEqual(['kling:api', accountConnectionRef(CONNECTION_ID)])
    expect(body.connections[0]).toMatchObject({ label: 'Kling API', canGenerate: true, funding: 'kling_api_package' })
    expect(body.connections[1]).toMatchObject({ label: 'Minha conta Kling', accountLabel: 'Pro', canGenerate: true, funding: 'kling_web_credits' })

    // Safe by construction: no secrets, no raw schema, no mapping hints, no foreign connection, no account id.
    const text = JSON.stringify(body)
    for (const forbidden of ['REST-KEY', 'kling_api_key', 'ciphertext', 'access_token', 'refresh_token', 'allowedValues', 'outputCountArg', '424242', FOREIGN_ID]) {
      expect(text).not.toContain(forbidden)
    }
    // Rendering the form performs NO provider request.
    expect(mcp.calls).toEqual([])
    expect(mcpClient.createKlingMcpClient).not.toHaveBeenCalled()
  })

  it('a read-only account is listed with its models but cannot generate, and says why', async () => {
    signIn(makeDb({ klingKey: 'k', connections: [connectionRow({ scopes: ['generation.read', 'account.credit.read'] })] }))
    const body = await (await get()).json()
    expect(body.connections[1]).toMatchObject({ canGenerate: false, blockedReason: 'generation_authorization_required', needsGenerationAuthorization: true })
    expect(body.connections[1].operations.length).toBeGreaterThan(0)
  })

  it('a store failure is a 503 with a specific code — never an empty list that reads as "no connections"', async () => {
    const db = makeDb({ klingKey: 'k' })
    signIn(db)
    const failing = { ...db, from: () => { const chain: any = { select: () => chain, eq: () => chain, order: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }), then: (r: any) => r({ data: null, error: { message: 'down' } }) }; return chain } }
    vi.mocked(server.createClient).mockResolvedValue({ from: failing.from, auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } } as any)
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'CONNECTIONS_UNAVAILABLE' })
  })
})

// ===========================================================================
// POST /api/video-generations — server validation matrix
// ===========================================================================
describe('POST /api/video-generations — server-side authorization and validation', () => {
  const expectNothingHappened = (db: any, mcp: FakeMcp) => {
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(constructedApiKeys).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
    expect(db.log.filter((entry: string) => entry === 'insert:video_generations')).toEqual([])
  }

  it.each([
    ['another user’s connection', { connections: [connectionRow({ user_id: 'user-b' })] }, 404, 'CONNECTION_NOT_FOUND'],
    ['an unknown connection reference', { connections: [] }, 404, 'CONNECTION_NOT_FOUND'],
    ['a disconnected/authorization_required connection', { connections: [connectionRow({ status: 'authorization_required' })] }, 409, 'AUTHORIZATION_REQUIRED'],
    ['an errored connection', { connections: [connectionRow({ status: 'error' })] }, 409, 'CONNECTION_ERROR'],
    ['a read-only MCP connection (no generation permission)', { connections: [connectionRow({ scopes: ['generation.read', 'account.credit.read'] })] }, 403, 'GENERATION_AUTHORIZATION_REQUIRED'],
    ['a connection without a capability snapshot', { connections: [connectionRow({ capabilities: {} })] }, 409, 'CAPABILITIES_MISSING'],
    ['a connection with expired capabilities', { connections: [connectionRow({ last_checked_at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() })] }, 409, 'CAPABILITIES_EXPIRED'],
  ])('rejects %s — zero provider calls, zero records', async (_name, rows, status, code) => {
    const db = makeDb(rows as any)
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody())

    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expectNothingHappened(db, mcp)
  })

  it('a forged/malformed connection reference is not found', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    for (const connectionRef of ['kling:account:not-a-uuid', 'mcp', 'kling:account:', { $ne: 1 }]) {
      const response = await post(mcpBody({ connectionRef }))
      expect(response.status).toBe(404)
    }
    expectNothingHappened(db, mcp)
  })

  it.each([
    ['unsupported operation', { mode: 'motion_control' }, 'UNSUPPORTED_OPERATION'],
    ['unsupported model', { model: 'kling-video-v9_9' }, 'UNSUPPORTED_MODEL'],
    ['unsupported resolution for the model', { model: 'kling-video-v3_0_turbo', resolution: '4k' }, 'UNSUPPORTED_RESOLUTION'],
    ['unsupported duration for the model', { model: 'kling-video-v2_5', duration: 12 }, 'UNSUPPORTED_DURATION'],
    ['unsupported aspect ratio', { aspect_ratio: '4:3' }, 'UNSUPPORTED_ASPECT_RATIO'],
    ['audio when the model has no audio control', { model: 'kling-video-v3_0_turbo', audio: 'on' }, 'UNSUPPORTED_AUDIO'],
    ['multi-shot when the model has none', { model: 'kling-video-o1', multi_shot: true }, 'UNSUPPORTED_MULTI_SHOT'],
    ['output count above one', { outputCount: 4 }, 'UNSUPPORTED_OUTPUT_COUNT'],
    ['imageCount above one', { imageCount: 2 }, 'UNSUPPORTED_OUTPUT_COUNT'],
  ])('rejects %s (400) with zero provider calls', async (_name, extra, code) => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody(extra))

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe(code)
    expectNothingHappened(db, mcp)
  })

  it.each([
    ['forged transport', { transport: 'mcp' }],
    ['a client-chosen execution mode', { executionMode: 'content_studio_credits' }],
    ['a snake_case execution mode', { execution_mode: 'content_studio_credits' }],
    ['a credential source', { credentialSource: 'platform' }],
    ['a direct connection id', { connection_id: CONNECTION_ID }],
    ['a provider override', { provider: 'openai' }],
  ])('rejects %s outright (400 UNSUPPORTED_FIELD) — the server decides these', async (_name, extra) => {
    const db = makeDb({ klingKey: 'REST-KEY', connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody(extra))

    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('UNSUPPORTED_FIELD')
    expectNothingHappened(db, mcp)
  })

  it('REST: a client claiming transport "mcp" cannot redirect a REST generation', async () => {
    const db = makeDb({ klingKey: 'REST-KEY', connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await post({ ...base, mode: 'text_to_video', transport: 'mcp' })
    expect(response.status).toBe(400)
    expectNothingHappened(db, mcp)
  })

  it('REST: values valid only for MCP are rejected on the Kling API connection', async () => {
    const db = makeDb({ klingKey: 'REST-KEY' })
    signIn(db)
    const mcp = installFakeMcp()
    for (const extra of [{ model: 'kling-video-v3_0' }, { resolution: '4k' }, { duration: 15 }]) {
      expect((await post({ ...base, mode: 'text_to_video', ...extra })).status).toBe(400)
    }
    expectNothingHappened(db, mcp)
  })
})

// ===========================================================================
// POST — transport selection and MCP submit (mocked provider)
// ===========================================================================
describe('POST /api/video-generations — transport is chosen from the RESOLVED server connection', () => {
  it('MCP text_to_video: maps the normalized request to the tool, stores generation_id, provenance and the first poll', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody({ duration: 10, resolution: '1080p', aspect_ratio: '9:16', audio: 'on', multi_shot: true }))
    const body = await response.json()

    expect(response.status).toBe(200)
    // Exactly ONE tool call, exactly the mapped request.
    expect(mcp.calls).toHaveLength(1)
    expect(mcp.calls[0].name).toBe('text_to_video')
    expect(mcp.calls[0].arguments.model).toBe('kling-video-v3_0')
    expect(Object.fromEntries(mcp.calls[0].arguments.arguments.map((a: any) => [a.name, a.value]))).toEqual({
      prompt: base.prompt,
      duration: '10',
      resolution: '1080p',
      aspect_ratio: '9:16',
      enable_audio: 'true',
      prefer_multi_shots: 'true',
      imageCount: '1',
    })
    expect(mcp.tokens).toEqual(['MCP-ACCESS-TOKEN-SECRET'])
    // Never the REST adapter.
    expect(constructedApiKeys).toEqual([])

    const row = db.tables.video_generations[0]
    expect(row).toMatchObject({
      status: 'submitted',
      task_id: 'mcp-gen-1',
      provider: 'kling',
      model: 'kling-video-v3_0',
      transport: 'mcp',
      connection_id: CONNECTION_ID,
      provider_metadata: { generation_id: 'mcp-gen-1', tool: 'text_to_video', model: 'kling-video-v3_0' },
      request_config: { duration: 10, resolution: '1080p', audio: 'on', multi_shot: true, aspect_ratio: '9:16', output_count: 1 },
      poll_attempts: 0,
    })
    expect(new Date(row.next_poll_at).getTime()).toBeGreaterThan(Date.now())
    expect(body.generation.id).toBe(row.id)

    // No secrets in the row, the response or the logs.
    noSecretsIn(row)
    noSecretsIn(body)
    noSecretsIn(consoleError.mock.calls)
    // Generation != Composition: nothing else was created.
    for (const table of ['video_drafts', 'library_files', 'channel_piece_media']) expect(db.tables[table]).toEqual([])
    expect(row.library_file_id).toBeUndefined()
  })

  it('MCP explicit defaults: an omitted control is sent with Content Studio’s value, never left to the provider', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    expect((await post(mcpBody())).status).toBe(200)

    const sent = Object.fromEntries(mcp.calls[0].arguments.arguments.map((a: any) => [a.name, a.value]))
    expect(sent).toMatchObject({ duration: '5', resolution: '720p', enable_audio: 'false', prefer_multi_shots: 'false', aspect_ratio: '16:9', imageCount: '1' })
  })

  it('MCP hidden control (model without audio) is not sent even if a stale client value existed', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    expect((await post(mcpBody({ model: 'kling-video-v3_0_turbo' }))).status).toBe(200)

    const names = mcp.calls[0].arguments.arguments.map((a: any) => a.name)
    expect(names).not.toContain('enable_audio')
    expect(names).not.toContain('prefer_multi_shots')
    const config = db.tables.video_generations[0].request_config
    expect(config.audio).toBeUndefined()
    expect(config.multi_shot).toBeUndefined()
  })

  describe('MCP advanced Product controls (asmr / audio_prompt / music_prompt) reach the provider through the server route', () => {
    const sentArgs = (mcp: FakeMcp) => Object.fromEntries(mcp.calls[0].arguments.arguments.map((a: any) => [a.name, a.value]))

    it('Kling 2.5 text_to_video: the user’s ASMR, audio prompt and music prompt are validated, sent explicitly and recorded', async () => {
      const db = makeDb({ connections: [connectionRow()] })
      signIn(db)
      const mcp = installFakeMcp()

      const response = await post(mcpBody({ model: 'kling-video-v2_5', asmr: true, audio_prompt: 'soft rain', music_prompt: 'calm piano' }))

      expect(response.status).toBe(200)
      expect(sentArgs(mcp)).toMatchObject({ enable_asmr: 'true', audio_prompt: 'soft rain', music_prompt: 'calm piano', imageCount: '1' })
      expect(db.tables.video_generations[0].request_config).toMatchObject({ asmr: true, audio_prompt: 'soft rain', music_prompt: 'calm piano', output_count: 1 })
    })

    it('Kling 2.5 text_to_video: omitted advanced controls are sent with Content Studio’s defaults (ASMR off, no prompts)', async () => {
      const db = makeDb({ connections: [connectionRow()] })
      signIn(db)
      const mcp = installFakeMcp()

      expect((await post(mcpBody({ model: 'kling-video-v2_5' }))).status).toBe(200)

      const sent = sentArgs(mcp)
      expect(sent.enable_asmr).toBe('false')
      expect(sent).not.toHaveProperty('audio_prompt')
      expect(sent).not.toHaveProperty('music_prompt')
      expect(db.tables.video_generations[0].request_config).toMatchObject({ asmr: false })
    })

    it('Kling 2.5 image_to_video: ASMR is offered by the model and honored; audio/music prompts are not offered and are rejected', async () => {
      const db = makeDb({ connections: [connectionRow()] })
      signIn(db)
      const mcp = installFakeMcp()
      const i2v = { mode: 'image_to_video', sourceImageId: 'img-1', model: 'kling-video-v2_5' }

      expect((await post(mcpBody({ ...i2v, audio_prompt: 'x' }))).status).toBe(400)
      expect(mcp.calls).toEqual([])
      expect((await post(mcpBody({ ...i2v, asmr: true }))).status).toBe(200)
      expect(mcp.calls.at(-1)!.arguments.arguments).toEqual(expect.arrayContaining([{ name: 'enable_asmr', value: 'true' }]))
    })

    it.each([
      ['asmr on a model that does not offer it', { model: 'kling-video-v3_0', asmr: true }, 'UNSUPPORTED_ASMR'],
      ['audio_prompt on a model that does not offer it', { model: 'kling-video-v3_0', audio_prompt: 'x' }, 'UNSUPPORTED_AUDIO_PROMPT'],
      ['music_prompt on a model that does not offer it', { model: 'kling-video-v2_6', music_prompt: 'x' }, 'UNSUPPORTED_MUSIC_PROMPT'],
      ['a non-boolean asmr', { model: 'kling-video-v2_5', asmr: 'true' }, 'UNSUPPORTED_ASMR'],
      ['a non-string audio_prompt', { model: 'kling-video-v2_5', audio_prompt: 7 }, 'UNSUPPORTED_AUDIO_PROMPT'],
    ])('rejects %s — zero provider calls, zero records', async (_name, extra, code) => {
      const db = makeDb({ connections: [connectionRow()] })
      signIn(db)
      const mcp = installFakeMcp()

      const response = await post(mcpBody(extra as any))

      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe(code)
      expect(mcp.calls).toEqual([])
      expect(db.tables.video_generations).toHaveLength(0)
    })

    it('REST (Kling API): MCP-only advanced controls are rejected', async () => {
      const db = makeDb({ klingKey: 'REST-KEY' })
      signIn(db)
      installFakeMcp()
      for (const extra of [{ asmr: true }, { audio_prompt: 'x' }, { music_prompt: 'x' }]) {
        expect((await post({ ...base, mode: 'text_to_video', ...extra })).status).toBe(400)
      }
      expect(restCalls).toEqual([])
    })
  })

  it('MCP image_to_video: uploads the trusted source bytes FIRST and sends the PROVIDER file URL as first_image (never our presigned URL)', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-1', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0' })

    expect(response.status).toBe(200)
    expect(mcp.calls.map((call) => call.name)).toEqual(['file_upload', 'image_to_video'])
    expect(mcp.calls[0].arguments).toEqual({ contentType: 'image/png', filename: expect.stringMatching(/\.png$/), size: 4096 })
    expect(mcp.calls[1].arguments.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: PROVIDER_FILE_URL }])
    expect(JSON.stringify(mcp.calls)).not.toMatch(/s3\.example\.test|signed-source|data:image|UPLOAD-TICKET-SECRET/)
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(postMultipartToProvider).toHaveBeenCalledTimes(1)
    expect(mcp.calls[1].arguments.arguments.map((a: any) => a.name)).not.toContain('aspect_ratio')
    expect(db.tables.video_generations[0]).toMatchObject({ mode: 'image_to_video', source_image_id: 'img-1', source_library_file_id: null, transport: 'mcp' })
  })

  it.each([
    ['an image with no url at all', { id: 'img-empty', user_id: 'user-a', project_id: 'proj-1', image_url: '', storage_path: null }],
  ])('%s is refused (422) BEFORE any record or provider call (MCP: SOURCE_IMAGE_UNAVAILABLE, REST: SOURCE_MEDIA_UNAVAILABLE)', async (_name, image) => {
    const db = makeDb({ connections: [connectionRow()], klingKey: 'user-rest-key', images: [image] })
    signIn(db)
    const mcp = installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockResolvedValueOnce(null as any)

    const response = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-empty', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0' })
    const viaRest = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-empty', connectionRef: 'kling:api' })

    expect(viaRest.status).toBe(422)
    expect((await viaRest.json()).code).toBe('SOURCE_MEDIA_UNAVAILABLE')
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('SOURCE_IMAGE_UNAVAILABLE')
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('MCP image_to_video still requires exactly one owned source', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    expect((await post({ ...base, mode: 'image_to_video', connectionRef: accountConnectionRef(CONNECTION_ID) })).status).toBe(400)
    expect((await post({ ...base, mode: 'image_to_video', sourceImageId: 'a', sourceLibraryFileId: 'b', connectionRef: accountConnectionRef(CONNECTION_ID) })).status).toBe(400)
    expect((await post({ ...base, mode: 'image_to_video', sourceImageId: 'someone-elses', connectionRef: accountConnectionRef(CONNECTION_ID) })).status).toBe(403)
    expect(mcp.calls).toEqual([])
  })

  it('REST (default, no connection reference): unchanged behavior, transport "rest", null connection, explicit settings', async () => {
    const db = makeDb({ klingKey: 'user-rest-key', connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post({ ...base, mode: 'text_to_video' })

    expect(response.status).toBe(200)
    expect(constructedApiKeys).toEqual(['user-rest-key'])
    expect(restCalls).toHaveLength(1)
    const [prompt, externalTaskId, callbackUrl, settings] = restCalls[0].args as any[]
    expect(prompt).toBe(base.prompt)
    expect(externalTaskId).toBe(db.tables.video_generations[0].id)
    expect(callbackUrl).toBe('https://content.example.test/api/kling/callback')
    expect(settings).toEqual({ duration: 5, resolution: '720p', audio: 'off', multi_shot: false, aspect_ratio: '16:9' })
    expect(mcp.calls).toEqual([])

    expect(db.tables.video_generations[0]).toMatchObject({
      transport: 'rest',
      connection_id: null,
      model: 'kling-v3',
      task_id: 'rest-task-2',
      status: 'submitted',
      request_config: { duration: 5, resolution: '720p', audio: 'off', multi_shot: false, aspect_ratio: '16:9', output_count: 1 },
    })
    // REST does not schedule polling.
    expect(db.tables.video_generations[0].next_poll_at).toBeUndefined()
    expect(JSON.stringify(db.tables.video_generations[0])).not.toContain('user-rest-key')
  })

  it('REST is selected explicitly with its reference too, and works while an MCP connection exists', async () => {
    const db = makeDb({ klingKey: 'user-rest-key', connections: [connectionRow()] })
    signIn(db)
    installFakeMcp()
    const response = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-1', connectionRef: 'kling:api', duration: 10, resolution: '1080p', audio: 'on', multi_shot: true })
    expect(response.status).toBe(200)
    expect(restCalls[0].kind).toBe('i2v')
    expect(restCalls[0].args[4]).toMatchObject({ duration: 10, resolution: '1080p', audio: 'on', multi_shot: true })
  })

  it('REST with no Kling API key: typed 422, zero calls, zero records (an MCP connection does NOT become a fallback)', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await post({ ...base, mode: 'text_to_video' })
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('PROVIDER_NOT_CONFIGURED')
    expect(mcp.calls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })
})

// VIDEO_I2V_LIBRARY_SOURCE_PICKER_V1 — Arquivos as an Image-to-Video source
describe('POST /api/video-generations — image_to_video from a LibraryFile (Arquivos)', () => {
  const libFile = (overrides: Record<string, unknown> = {}) => ({
    id: 'lib-1',
    user_id: 'user-a',
    project_id: 'proj-1',
    kind: 'image',
    mime_type: 'image/png',
    name: 'capa.png',
    storage_path: `users/user-a/library/${LIB_BLOB}/capa.png`,
    public_url: 'https://cdn.example.test/capa.png',
    deleted_at: null,
    origin: 'upload',
    ...overrides,
  })
  const mcpI2v = (extra: Record<string, unknown> = {}) => ({ ...base, mode: 'image_to_video', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0', ...extra })
  const SIGNED = 'https://s3.example.test/signed-source.png?sig=1'

  it('MCP: a valid image LibraryFile is uploaded as bytes and the PROVIDER URL is first_image; the row records only source_library_file_id', async () => {
    const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post(mcpI2v({ sourceLibraryFileId: 'lib-1' }))

    expect(response.status).toBe(200)
    expect(mcp.calls.map((call) => call.name)).toEqual(['file_upload', 'image_to_video'])
    expect(mcp.calls[1].arguments.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: PROVIDER_FILE_URL }])
    expect(JSON.stringify(mcp.calls)).not.toContain(SIGNED)
    // The LibraryFile id itself never reaches the provider.
    expect(JSON.stringify(mcp.calls)).not.toContain('lib-1')
    expect(db.tables.video_generations[0]).toMatchObject({ mode: 'image_to_video', source_image_id: null, source_library_file_id: 'lib-1', transport: 'mcp' })
  })

  it('REST: a valid image LibraryFile is normalized to the same presigned URL the REST adapter receives', async () => {
    const db = makeDb({ klingKey: 'user-rest-key', libraryFiles: [libFile()] })
    signIn(db)
    installFakeMcp()

    const response = await post({ ...base, mode: 'image_to_video', sourceLibraryFileId: 'lib-1', connectionRef: 'kling:api' })

    expect(response.status).toBe(200)
    expect(restCalls).toHaveLength(1)
    expect(restCalls[0].kind).toBe('i2v')
    expect(restCalls[0].args[1]).toBe(SIGNED)
    expect(JSON.stringify(restCalls[0].args)).not.toContain('lib-1')
    expect(db.tables.video_generations[0]).toMatchObject({ source_image_id: null, source_library_file_id: 'lib-1', transport: 'rest' })
  })

  it('the storage path comes from the stored row, never from the client; client-supplied paths/urls are not an authority', async () => {
    const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
    signIn(db)
    installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockClear()

    vi.mocked(readS3Object).mockClear()
    const response = await post(mcpI2v({ sourceLibraryFileId: 'lib-1', storage_path: 'users/victim/secret.png', sourceUrl: 'https://evil.example.test/x.png', publicUrl: 'https://evil.example.test/y.png' }))

    expect(response.status).toBe(200)
    // MCP reads the object named by the STORED row, never by the client.
    expect(vi.mocked(readS3Object).mock.calls.map((call) => call[0])).toEqual([`users/user-a/library/${LIB_BLOB}/capa.png`])
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(JSON.stringify(db.tables.video_generations[0])).not.toContain('evil.example.test')
  })

  it('the origin of the LibraryFile is irrelevant: a render saved from Creative Editor is as valid as an upload (no Gallery dependency)', async () => {
    const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile({ id: 'lib-render', origin: 'studio_render' })] })
    signIn(db)
    installFakeMcp()
    expect((await post(mcpI2v({ sourceLibraryFileId: 'lib-render' }))).status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ source_library_file_id: 'lib-render' })
  })

  it.each([
    ['another user’s file', { user_id: 'user-b' }, 403, undefined],
    ['a file of another Project', { project_id: 'proj-other' }, 403, undefined],
    ['a trashed (deleted) file', { deleted_at: '2026-09-01T00:00:00.000Z' }, 422, 'SOURCE_LIBRARY_FILE_DELETED'],
    ['a video file', { kind: 'video', mime_type: 'video/mp4' }, 422, 'SOURCE_LIBRARY_FILE_NOT_IMAGE'],
    ['a document file', { kind: 'document', mime_type: 'application/pdf' }, 422, 'SOURCE_LIBRARY_FILE_NOT_IMAGE'],
  ])('%s is refused BEFORE any record or provider call', async (_name, overrides, status, code) => {
    const db = makeDb({ connections: [connectionRow()], klingKey: 'user-rest-key', libraryFiles: [libFile(overrides)] })
    signIn(db)
    const mcp = installFakeMcp()

    const viaMcp = await post(mcpI2v({ sourceLibraryFileId: 'lib-1' }))
    const viaRest = await post({ ...base, mode: 'image_to_video', sourceLibraryFileId: 'lib-1', connectionRef: 'kling:api' })

    for (const response of [viaMcp, viaRest]) {
      expect(response.status).toBe(status)
      if (code) expect((await response.json()).code).toBe(code)
    }
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('a forged Library row pointing at ANOTHER tenant’s object is never signed or sent to a provider (422)', async () => {
    const db = makeDb({
      connections: [connectionRow()],
      klingKey: 'user-rest-key',
      libraryFiles: [libFile({ id: 'lib-forged', storage_path: `users/victim-user/library/${LIB_BLOB}/secret.png` })],
    })
    signIn(db)
    const mcp = installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockClear()

    for (const body of [mcpI2v({ sourceLibraryFileId: 'lib-forged' }), { ...base, mode: 'image_to_video', sourceLibraryFileId: 'lib-forged', connectionRef: 'kling:api' }]) {
      const response = await post(body)
      expect(response.status).toBe(422)
      expect((await response.json()).code).toBe('SOURCE_MEDIA_UNAVAILABLE')
    }
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it.each([
    ['a foreign tenant key', `users/victim-user/images/${IMG_BLOB}/original.png`],
    ['a traversal key', `users/user-a/images/../victim-user/images/${IMG_BLOB}/original.png`],
    ['a lookalike owner prefix', `users/user-a-evil/images/${IMG_BLOB}/original.png`],
    ['a Library key used as an image key', `users/user-a/library/${IMG_BLOB}/original.png`],
    ['a URL instead of a key', `https://s3.example.test/users/user-a/images/${IMG_BLOB}/original.png`],
  ])('an OWNED generated-image row forged with %s is never signed or sent to a provider (422)', async (_name, storage_path) => {
    const db = makeDb({
      connections: [connectionRow()],
      klingKey: 'user-rest-key',
      images: [{ id: 'img-forged', user_id: 'user-a', project_id: 'proj-1', image_url: 'https://attacker.example.test/x.png', storage_path }],
    })
    signIn(db)
    const mcp = installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockClear()

    for (const body of [mcpI2v({ sourceImageId: 'img-forged' }), { ...base, mode: 'image_to_video', sourceImageId: 'img-forged', connectionRef: 'kling:api' }]) {
      const response = await post(body)
      expect(response.status).toBe(422)
      expect((await response.json()).code).toBe('SOURCE_MEDIA_UNAVAILABLE')
    }
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('a legacy image with NO stored key (provider URL representation) keeps its existing behavior on REST; MCP fails closed (no arbitrary fetch)', async () => {
    const db = makeDb({
      connections: [connectionRow()],
      klingKey: 'user-rest-key',
      images: [{ id: 'img-legacy', user_id: 'user-a', project_id: 'proj-1', image_url: 'https://img.example.test/legacy.png', storage_path: null }],
    })
    signIn(db)
    const mcp = installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockClear()

    const viaRest = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-legacy', connectionRef: 'kling:api' })
    expect(viaRest.status).toBe(200)
    expect(restCalls[0].args[1]).toBe('https://img.example.test/legacy.png')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()

    const viaMcp = await post(mcpI2v({ sourceImageId: 'img-legacy' }))
    expect(viaMcp.status).toBe(422)
    expect((await viaMcp.json()).code).toBe('SOURCE_IMAGE_UNAVAILABLE')
    expect(mcp.calls).toEqual([])
    expect(postMultipartToProvider).not.toHaveBeenCalled()
  })

  it('a legacy image whose image_url is a bounded PNG data URL is normalized to bytes and uploaded (the data URL itself is never sent)', async () => {
    const dataUrl = toDataUrl(pngBytes(800, 600))
    const db = makeDb({ connections: [connectionRow()], images: [{ id: 'img-data', user_id: 'user-a', project_id: 'proj-1', image_url: dataUrl, storage_path: null }] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await post(mcpI2v({ sourceImageId: 'img-data' }))
    expect(response.status).toBe(200)
    expect(mcp.calls.map((call) => call.name)).toEqual(['file_upload', 'image_to_video'])
    expect(mcp.calls[0].arguments).toMatchObject({ contentType: 'image/png' })
    expect(JSON.stringify(mcp.calls)).not.toContain('data:image')
    expect(mcp.calls[1].arguments.inputs[0].url).toBe(PROVIDER_FILE_URL)
  })

  it('a generated image of another user is refused (403) and never reaches a provider', async () => {
    const db = makeDb({ connections: [connectionRow()], images: [{ id: 'img-x', user_id: 'user-b', project_id: 'proj-1', image_url: 'https://img.example.test/x.png', storage_path: 'b/x.png' }] })
    signIn(db)
    const mcp = installFakeMcp()
    expect((await post(mcpI2v({ sourceImageId: 'img-x' }))).status).toBe(403)
    expect(mcp.calls).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('XOR: both sources and neither source are refused for image_to_video; any source is refused for text_to_video', async () => {
    const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
    signIn(db)
    const mcp = installFakeMcp()
    expect((await post(mcpI2v({ sourceImageId: 'img-1', sourceLibraryFileId: 'lib-1' }))).status).toBe(400)
    expect((await post(mcpI2v())).status).toBe(400)
    expect((await post({ ...mcpBody(), sourceLibraryFileId: 'lib-1' })).status).toBe(400)
    expect((await post({ ...mcpBody(), sourceImageId: 'img-1' })).status).toBe(400)
    expect(mcp.calls).toEqual([])
    // text_to_video with neither source is accepted.
    expect((await post(mcpBody())).status).toBe(200)
  })
})

describe('POST /api/video-generations — project/production ownership and generic errors', () => {
  it.each([
    ['a production of another user', [{ id: 'prod-1', project_id: 'proj-1', user_id: 'user-b' }]],
    ['a production that belongs to a DIFFERENT project', [{ id: 'prod-1', project_id: 'proj-OTHER', user_id: 'user-a' }]],
    ['a production that does not exist', []],
  ])('rejects %s (403) before any credential, record or provider call', async (_name, productions) => {
    const db = makeDb({ klingKey: 'user-rest-key', connections: [connectionRow()] })
    db.tables.productions = productions as any[]
    signIn(db)
    const mcp = installFakeMcp()

    for (const body of [{ ...base, mode: 'text_to_video' }, mcpBody()]) {
      const response = await post(body)
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe('PRODUCTION_NOT_FOUND')
    }
    expect(mcp.calls).toEqual([])
    expect(restCalls).toEqual([])
    expect(constructedApiKeys).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })

  it('a store failure while validating the production is a 503, not a "not found"', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    const original = db.from
    vi.mocked(server.createClient).mockResolvedValue({
      from: (table: string) => {
        if (table !== 'productions') return original.call(db, table)
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }) }
        return chain
      },
      auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
    } as any)
    const response = await post({ ...base, mode: 'text_to_video' })
    expect(response.status).toBe(503)
    expect(restCalls).toEqual([])
  })

  it('an unexpected pre-submission failure is a 500 with a CODE and a generic message (never the raw error text)', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    const original = db.from
    signIn(db)
    // Row creation is server-owned: it is the service-role client whose INSERT fails here.
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({
      from: (table: string) => {
        const builder = original.call(db, table)
        if (table === 'video_generations') builder.insert = () => { throw new Error('duplicate key value violates unique constraint "secret_internal_name"') }
        return builder
      },
    } as any)

    const response = await post({ ...base, mode: 'text_to_video' })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toMatch(/duplicate key|secret_internal_name/)
    expect(body.outcomeUnknown).toBeUndefined()
    expect(restCalls).toEqual([])
  })
})

describe('POST /api/video-generations — REST submit outcome classification', () => {
  it('an HTTP error answered by Kling is definitive (the job was refused)', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    restFailure = new Error('Kling API HTTP error: Bad Request (code: 1201, message: invalid)')
    const response = await post({ ...base, mode: 'text_to_video' })
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('PROVIDER_SUBMISSION_FAILED')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed' })
  })

  it.each([
    ['a network failure', new TypeError('fetch failed')],
    ['a 2xx whose body has no task id', new Error('Kling API structure error: {"data":{}}')],
  ])('%s may have created a billed job: unknown outcome, flagged, never invites a retry', async (_name, error) => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    restFailure = error
    const response = await post({ ...base, mode: 'text_to_video' })
    const body = await response.json()
    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'SUBMIT_OUTCOME_UNKNOWN', outcomeUnknown: true })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { outcome_unknown: true } })
  })
})

// VIDEO_GENERATION_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1: after migration 043 the user session can
// only READ video_generations. These tests give the user client a table that THROWS on any write, so
// the flows only pass if every lifecycle write goes through the server-authority client.
describe('video_generations lifecycle writes are server-owned (user session is read-only)', () => {
  const readOnlyUser = (db: any, userId = 'user-a') => {
    const denied = () => { throw new Error('permission denied for table video_generations') }
    const client = {
      from: (table: string) => {
        const builder = db.from(table)
        if (table === 'video_generations') Object.assign(builder, { insert: denied, update: denied, upsert: denied, delete: denied })
        return builder
      },
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    }
    vi.mocked(server.createClient).mockResolvedValue(client as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
  }

  it('REST create: the row is inserted and its task id recorded without any user-session write', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    readOnlyUser(db)
    const response = await post({ ...base, mode: 'text_to_video' })
    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ user_id: 'user-a', project_id: 'proj-1', transport: 'rest', status: 'submitted', task_id: 'rest-task-2' })
  })

  it('MCP create: same, including provenance and the first poll', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    readOnlyUser(db)
    installFakeMcp()
    const response = await post(mcpBody())
    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ user_id: 'user-a', transport: 'mcp', connection_id: CONNECTION_ID, status: 'submitted', task_id: 'mcp-gen-1' })
    expect(db.tables.video_generations[0].next_poll_at).toBeTruthy()
  })

  it('a provider refusal is recorded as failed without any user-session write', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    readOnlyUser(db)
    restFailure = new Error('Kling API HTTP error 400')
    const response = await post({ ...base, mode: 'text_to_video' })
    expect(response.status).toBe(500)
    expect(db.tables.video_generations[0].status).toBe('failed')
  })

  it('the row is always created for the VERIFIED session user, never for a body-supplied id', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    readOnlyUser(db)
    await post({ ...base, mode: 'text_to_video', user_id: 'user-b', userId: 'user-b' })
    expect(db.tables.video_generations).toHaveLength(1)
    expect(db.tables.video_generations[0].user_id).toBe('user-a')
  })

  it('REST manual sync: the status change is written with server authority (no user-session write)', async () => {
    const db = makeDb({ klingKey: 'user-rest-key', generations: [{ id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'rest-task-1' }] })
    readOnlyUser(db)
    const { POST } = await import('@/app/api/video-generations/[id]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/video-generations/gen-1/sync', { method: 'POST' }), { params: Promise.resolve({ id: 'gen-1' }) })
    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0].status).toBe('processing')
  })

  it('MCP manual sync completion stores storage_path, status and result metadata with server authority', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [{ id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'processing', task_id: 'mcp-gen-1', transport: 'mcp', connection_id: CONNECTION_ID, created_at: NOW_ISO, poll_attempts: 1 }] })
    readOnlyUser(db)
    installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'succeed', works: [{ url: 'https://cdn.example.test/v.mp4' }] }) }] }))
    vi.mocked(downloadAndStoreVideo).mockResolvedValue({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/gen-1.mp4', mime: 'video/mp4', size: 5 })
    const { POST } = await import('@/app/api/video-generations/[id]/sync/route')
    const response = await POST(new NextRequest('http://localhost/api/video-generations/gen-1/sync', { method: 'POST' }), { params: Promise.resolve({ id: 'gen-1' }) })
    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'succeeded', storage_path: 'user-a/videos/ai/proj-1/gen-1.mp4' })
    expect(db.tables.video_generations[0].result_metadata).toMatchObject({ transport: 'mcp', provider_task_id: 'mcp-gen-1' })
  })
})

describe('POST /api/video-generations — an ACCEPTED submission is never reported as failed', () => {
  /** The server-authority client whose UPDATE of video_generations fails (network/store) after the row was inserted. */
  const breakUpdates = (db: any) => {
    const failing = () => {
      const chain: any = { eq: () => chain, select: () => chain, single: () => Promise.resolve({ data: null, error: { message: 'store' } }), then: (r: any) => r({ data: null, error: { message: 'store' } }) }
      return chain
    }
    const original = db.from
    const patched = (table: string) => {
      const builder = original.call(db, table)
      if (table === 'video_generations') builder.update = failing
      return builder
    }
    vi.mocked(server.createClient).mockResolvedValue({ from: original, auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } } as any)
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: patched } as any)
  }

  it('MCP: if recording the task id fails once, a single retry records it and the user is NOT told to retry', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    // The first UPDATE fails transiently; the retry succeeds.
    const original = db.from
    let failuresLeft = 1
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({
      from: (table: string) => {
        const builder = original.call(db, table)
        const realUpdate = builder.update
        if (table === 'video_generations') {
          builder.update = (...args: unknown[]) => {
            if (failuresLeft-- > 0) { const chain: any = { eq: () => chain, select: () => chain, single: () => Promise.resolve({ data: null, error: { message: 'store' } }) }; return chain }
            return realUpdate.apply(builder, args)
          }
        }
        return builder
      },
    } as any)

    const response = await post(mcpBody())

    expect(response.status).toBe(200)
    expect(mcp.calls).toHaveLength(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'submitted', task_id: 'mcp-gen-1', transport: 'mcp' })
  })

  it('if the accepted job cannot be recorded at all: 502 SUBMISSION_UNRECORDED with an explicit DO-NOT-RETRY message, the row is not marked failed, and the provider id is logged for reconciliation', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    breakUpdates(db)
    const mcp = installFakeMcp()

    const response = await post(mcpBody())
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'SUBMISSION_UNRECORDED', outcomeUnknown: true })
    expect(body.error).toMatch(/NÃO tente de novo/)
    // Exactly one billed submission; nothing was retried; the row was never mislabeled as a failed submission.
    expect(mcp.calls).toHaveLength(1)
    expect(db.tables.video_generations[0].status).toBe('queued')
    expect(consoleError.mock.calls.flat().map((entry: unknown) => JSON.stringify(entry)).join(' ')).toContain('mcp-gen-1')
    noSecretsIn(consoleError.mock.calls)
  })

  it('REST gets the same protection (the accepted Kling task is not reported as a failed submission)', async () => {
    const db = makeDb({ klingKey: 'user-rest-key' })
    signIn(db)
    breakUpdates(db)

    const response = await post({ ...base, mode: 'text_to_video' })

    expect(response.status).toBe(502)
    expect((await response.json()).code).toBe('SUBMISSION_UNRECORDED')
    expect(restCalls).toHaveLength(1)
    expect(db.tables.video_generations[0].status).toBe('queued')
  })
})

describe('POST /api/video-generations — MCP provider errors are normalized safely', () => {
  const submit = async (reply: FakeMcp['reply'], setup?: (mcp: FakeMcp) => void) => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp(reply)
    setup?.(mcp)
    const response = await post(mcpBody())
    return { db, mcp, response, body: await response.json() }
  }

  it('insufficient Kling credits → 402 PROVIDER_QUOTA_EXCEEDED, generation failed, one attempt only', async () => {
    const { db, mcp, response, body } = await submit(() => ({ isError: true, content: [{ type: 'text', text: 'Account inspiration credits are insufficient; please top up' }] }))
    expect(response.status).toBe(402)
    expect(body).toMatchObject({ code: 'PROVIDER_QUOTA_EXCEEDED', outcomeUnknown: false })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_QUOTA_EXCEEDED' } })
    expect(mcp.calls).toHaveLength(1)
  })

  it('content rejection → 422 PROVIDER_CONTENT_REJECTED', async () => {
    const { body, response } = await submit(() => ({ isError: true, content: [{ type: 'text', text: 'The prompt contains disallowed content' }] }))
    expect(response.status).toBe(422)
    expect(body.code).toBe('PROVIDER_CONTENT_REJECTED')
  })

  it('an unconfirmed submission is failed with an explicit "may have been billed" flag and NEVER retried', async () => {
    const { db, mcp, response, body } = await submit(() => { throw new Error('socket hang up MCP-ACCESS-TOKEN-SECRET') })
    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', outcomeUnknown: true })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { outcome_unknown: true } })
    expect(mcp.calls).toHaveLength(1)
    noSecretsIn(body)
    noSecretsIn(db.tables.video_generations[0])
    noSecretsIn(consoleError.mock.calls)
  })

  it('a token rejected up front → 409 AUTHORIZATION_REQUIRED (nothing was submitted)', async () => {
    const { db, response, body } = await submit(() => ({}), (mcp) => { mcp.connectError = new UnauthorizedError('expired') })
    expect(response.status).toBe(409)
    expect(body).toMatchObject({ code: 'AUTHORIZATION_REQUIRED', outcomeUnknown: false })
    expect(db.tables.video_generations[0].status).toBe('failed')
  })

  it('a successful call with an unreadable response is failed as possibly-billed, with the bounded provider text kept for reconciliation', async () => {
    const { db, response, body } = await submit(() => ({ content: [{ type: 'text', text: 'Accepted.' }] }))
    expect(response.status).toBe(502)
    expect(body).toMatchObject({ code: 'SUBMIT_RESPONSE_UNREADABLE', outcomeUnknown: true })
    expect(db.tables.video_generations[0].error_details).toMatchObject({ outcome_unknown: true, provider_text: 'Accepted.' })
  })
})

// ===========================================================================
// Sync + history
// ===========================================================================
describe('POST /api/video-generations/[id]/sync — transport-aware', () => {
  const sync = async (id = 'gen-1') => {
    const { POST } = await import('@/app/api/video-generations/[id]/sync/route')
    return POST(new NextRequest(`http://localhost/api/video-generations/${id}/sync`, { method: 'POST' }), { params: Promise.resolve({ id }) })
  }
  const mcpGeneration = (overrides: Record<string, unknown> = {}) => ({ id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'processing', task_id: 'mcp-gen-1', transport: 'mcp', connection_id: CONNECTION_ID, created_at: NOW_ISO, poll_attempts: 1, ...overrides })

  it('MCP: queries the generation on the connection, completes through the shared boundary, stores app-owned media', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration()] })
    signIn(db)
    const mcp = installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'succeed', works: [{ url: 'https://cdn.example.test/v.mp4' }] }) }] }))
    vi.mocked(downloadAndStoreVideo).mockResolvedValue({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/gen-1.mp4', mime: 'video/mp4', size: 5 })

    const response = await sync()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mcp.calls).toEqual([{ name: 'query_tasks', arguments: { generationId: 'mcp-gen-1' } }])
    expect(body.outcome).toBe('completed')
    expect(downloadAndStoreVideo).toHaveBeenCalledWith('https://cdn.example.test/v.mp4', 'user-a/videos/ai/proj-1', { objectName: 'gen-1.mp4' })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'succeeded', storage_path: 'user-a/videos/ai/proj-1/gen-1.mp4' })
    expect(JSON.stringify(db.tables.video_generations[0])).not.toContain('cdn.example.test')
    noSecretsIn(body)
    // The REST adapter is not involved for an MCP generation.
    expect(constructedApiKeys).toEqual([])
  })

  it('the response for a finished video carries a PRESIGNED url (same contract as the history list), never the raw storage url', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration()] })
    signIn(db)
    installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'succeed', works: [{ url: 'https://cdn.example.test/v.mp4' }] }) }] }))
    vi.mocked(downloadAndStoreVideo).mockResolvedValue({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/raw/gen-1.mp4', mime: 'video/mp4', size: 5 })

    const body = await (await sync()).json()

    expect(body.generation.public_url).toBe('https://s3.example.test/signed-source.png?sig=1')
    expect(body.generation.public_url).not.toContain('/raw/')
  })

  it('manual sync NEVER takes the poller lease or rewrites its schedule/attempt counters', async () => {
    const scheduled = new Date(Date.now() + 90_000).toISOString()
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration({ next_poll_at: scheduled, poll_attempts: 3 })] })
    signIn(db)
    installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'processing' }) }] }))

    const response = await sync()

    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', next_poll_at: scheduled, poll_attempts: 3 })
  })

  it('every route that downloads/uploads a video (or drives the poller) declares generous headroom', async () => {
    const syncRoute = await import('@/app/api/video-generations/[id]/sync/route')
    const callback = await import('@/app/api/kling/callback/route')
    const poll = await import('@/app/api/internal/video-generations/poll/route')
    expect(syncRoute.maxDuration).toBeGreaterThanOrEqual(120)
    expect(callback.maxDuration).toBeGreaterThanOrEqual(120)
    expect(poll.maxDuration).toBeGreaterThanOrEqual(120)
  })

  it('a second sync of the finished generation is a no-op (idempotent)', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration({ status: 'succeeded', storage_path: 'x.mp4' })] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await sync()
    expect(response.status).toBe(200)
    expect(mcp.calls).toEqual([])
    expect(vi.mocked(downloadAndStoreVideo)).not.toHaveBeenCalled()
  })

  it('another user’s generation is not found', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration({ user_id: 'user-b' })] })
    signIn(db)
    expect((await sync()).status).toBe(404)
  })

  it('a generation whose connection no longer exists cannot be synced (409), and no grant is borrowed', async () => {
    const db = makeDb({ connections: [], generations: [mcpGeneration({ connection_id: null })] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await sync()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('CONNECTION_UNAVAILABLE')
    expect(mcp.calls).toEqual([])
  })

  it('an MCP generation cannot be synced with another user’s connection id planted on the row', async () => {
    const db = makeDb({ connections: [connectionRow({ id: FOREIGN_ID, user_id: 'user-b' })], generations: [mcpGeneration({ connection_id: FOREIGN_ID })] })
    signIn(db)
    const mcp = installFakeMcp()
    expect((await sync()).status).toBe(409)
    expect(mcp.calls).toEqual([])
    expect(mcp.tokens).toEqual([])
  })

  it('revoked authorization → 409 AUTHORIZATION_REQUIRED; the job stays non-terminal', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration()] })
    signIn(db)
    installFakeMcp(() => ({})).connectError = new UnauthorizedError('revoked')
    const response = await sync()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('AUTHORIZATION_REQUIRED')
    expect(db.tables.video_generations[0].status).toBe('processing')
  })

  it('provider temporarily failing → 502 and the row is untouched', async () => {
    const db = makeDb({ connections: [connectionRow()], generations: [mcpGeneration()] })
    signIn(db)
    installFakeMcp(() => { throw new Error('upstream 503') })
    expect((await sync()).status).toBe(502)
    expect(db.tables.video_generations[0].status).toBe('processing')
  })

  it('legacy generations (no transport column value) are REST: they sync through the user’s Kling API key', async () => {
    const db = makeDb({ klingKey: 'user-rest-key', generations: [{ id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'rest-task-1' }] })
    signIn(db)
    const mcp = installFakeMcp()
    const response = await sync()
    expect(response.status).toBe(200)
    expect(constructedApiKeys).toEqual(['user-rest-key'])
    expect(mcp.calls).toEqual([])
    expect(db.tables.video_generations[0].status).toBe('processing')
  })
})

describe('GET /api/video-generations — history (historical rows stay valid)', () => {
  it('rows created before transport/connection provenance still load and play (presigned) without any backfill', async () => {
    const legacy = { id: 'old-1', user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'text_to_video', status: 'succeeded', provider: 'kling', model: 'kling-v3', task_id: 'kling-old', storage_path: 'user-a/videos/ai/proj-1/1759000000000-abc123.mp4', public_url: 'https://s3.example.test/old.mp4', request_config: { duration: 5, resolution: '720p' }, created_at: '2026-09-01T00:00:00Z' }
    const mcpRow = { id: 'new-1', user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'text_to_video', status: 'succeeded', provider: 'kling', model: 'kling-video-v3_0', transport: 'mcp', connection_id: null, storage_path: 'user-a/videos/ai/proj-1/new-1.mp4', created_at: '2026-09-29T00:00:00Z' }
    const db = makeDb({ generations: [legacy, mcpRow, { ...legacy, id: 'other-user', user_id: 'user-b' }] })
    signIn(db)

    const { GET } = await import('@/app/api/video-generations/route')
    const response = await GET(new NextRequest('http://localhost/api/video-generations'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.generations.map((row: any) => row.id).sort()).toEqual(['new-1', 'old-1'])
    for (const row of body.generations) expect(row.public_url).toBe('https://s3.example.test/signed-source.png?sig=1')
    // A disconnected connection (connection_id nulled by the FK) keeps provider/model/transport as provenance.
    expect(body.generations.find((row: any) => row.id === 'new-1')).toMatchObject({ provider: 'kling', model: 'kling-video-v3_0', transport: 'mcp', connection_id: null })
    expect(body.generations.find((row: any) => row.id === 'old-1').transport).toBeUndefined()
  })
})

// ===========================================================================
// Scheduled poller endpoint
// ===========================================================================
describe('/api/internal/video-generations/poll — authenticated trigger for the external (VPS) scheduler', () => {
  // A stand-in for the out-of-band secret: a test fixture only, never a real credential.
  const SECRET = 'test-fixture-poll-worker-secret-0123456789abcdef'
  const call = async (headers: Record<string, string> = {}) => {
    const route = await import('@/app/api/internal/video-generations/poll/route')
    return route.POST(new NextRequest('http://localhost/api/internal/video-generations/poll', { method: 'POST', headers }))
  }

  it('exposes POST only: it cannot be triggered by a link, a prefetch or a GET', async () => {
    const route = (await import('@/app/api/internal/video-generations/poll/route')) as Record<string, unknown>
    expect(Object.keys(route).filter((key) => ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(key))).toEqual([])
    expect(typeof route.POST).toBe('function')
  })

  it('fails CLOSED when no secret is configured (503) — nothing is queried', async () => {
    const db = makeDb()
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    const response = await call({ authorization: 'Bearer anything-at-all-1234' })
    expect(response.status).toBe(503)
    expect(vi.mocked(serviceRole.createServiceRoleSupabase)).not.toHaveBeenCalled()
  })

  it('rejects a too-short secret as not configured (a weak secret is treated as none)', async () => {
    process.env.VIDEO_POLL_WORKER_SECRET = 'short'
    expect((await call({ authorization: 'Bearer short' })).status).toBe(503)
    process.env.VIDEO_POLL_WORKER_SECRET = 'x'.repeat(31)
    expect((await call({ authorization: `Bearer ${'x'.repeat(31)}` })).status).toBe(503)
  })

  it('the old shared-cron variable is NOT a valid trigger secret', async () => {
    process.env.CRON_SECRET = SECRET
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(503)
    delete process.env.CRON_SECRET
  })

  it.each([
    ['no header', {}],
    ['wrong secret', { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' }],
    ['not a bearer header', { authorization: 'test-fixture-poll-worker-secret-0123456789abcdef' }],
    ['a prefix of the secret', { authorization: 'Bearer test-fixture-poll-worker-secret' }],
    ['a user session cookie', { cookie: 'sb-access-token=abc' }],
  ])('rejects %s (401) before touching the database', async (_name, headers) => {
    process.env.VIDEO_POLL_WORKER_SECRET = SECRET
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(makeDb())
    expect((await call(headers as any)).status).toBe(401)
    expect(vi.mocked(serviceRole.createServiceRoleSupabase)).not.toHaveBeenCalled()
  })

  it('with the right secret it polls due MCP generations and returns counts only', async () => {
    process.env.VIDEO_POLL_WORKER_SECRET = SECRET
    const due = { id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'mcp-gen-1', transport: 'mcp', connection_id: CONNECTION_ID, created_at: NOW_ISO, next_poll_at: new Date(Date.now() - 5000).toISOString(), poll_attempts: 0 }
    const db = makeDb({ connections: [connectionRow()], generations: [due] })
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    const mcp = installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'processing' }) }] }))

    const response = await call({ authorization: `Bearer ${SECRET}` })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, due: 1, claimed: 1, outcomes: { processing: 1 } })
    expect(mcp.calls).toEqual([{ name: 'query_tasks', arguments: { generationId: 'mcp-gen-1' } }])
    // Counts only: no ids, prompts, provider text or tokens.
    expect(JSON.stringify(body)).not.toMatch(/gen-1|mcp-gen|TOKEN|prompt/)
    noSecretsIn(body)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', poll_attempts: 1 })
  })

  it('overlapping passes (a slow tick plus the next one) never poll the same job twice: the lease serializes them', async () => {
    process.env.VIDEO_POLL_WORKER_SECRET = SECRET
    const due = { id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'mcp-gen-1', transport: 'mcp', connection_id: CONNECTION_ID, created_at: NOW_ISO, next_poll_at: new Date(Date.now() - 5000).toISOString(), poll_attempts: 0 }
    const db = makeDb({ connections: [connectionRow()], generations: [due] })
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    const mcp = installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'processing' }) }] }))

    const [a, b] = await Promise.all([call({ authorization: `Bearer ${SECRET}` }), call({ authorization: `Bearer ${SECRET}` })])
    const claimed = (await a.json()).claimed + (await b.json()).claimed

    expect(claimed).toBe(1)
    expect(mcp.calls).toHaveLength(1)
  })

  it('a store failure is a controlled 500 without detail', async () => {
    process.env.VIDEO_POLL_WORKER_SECRET = SECRET
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: () => { const chain: any = { update: () => chain, select: () => chain, eq: () => chain, in: () => chain, is: () => chain, lt: () => chain, lte: () => chain, order: () => chain, limit: () => chain, then: (r: any) => r({ data: null, error: { message: 'secret db detail' } }) }; return chain } } as any)
    const response = await call({ authorization: `Bearer ${SECRET}` })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret db detail')
  })
})

// ---------------------------------------------------------------------------
// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — MCP Image-to-Video: trusted bytes -> file_upload -> image_to_video.
// Spend order, model mapping and regression. No real provider call: the MCP client and the provider's upload
// endpoint are recording fakes.
// ---------------------------------------------------------------------------
describe('POST /api/video-generations — MCP image_to_video source transport (file_upload before any paid call)', () => {
  const libFile = (overrides: Record<string, unknown> = {}) => ({
    id: 'lib-1', user_id: 'user-a', project_id: 'proj-1', kind: 'image', mime_type: 'image/png', name: 'capa.png',
    storage_path: `users/user-a/library/${LIB_BLOB}/capa.png`, public_url: 'https://cdn.example.test/capa.png', deleted_at: null, origin: 'upload', ...overrides,
  })
  const i2v = (extra: Record<string, unknown> = {}) => ({ ...base, mode: 'image_to_video', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0', sourceLibraryFileId: 'lib-1', ...extra })
  const names = (mcp: FakeMcp) => mcp.calls.map((call) => call.name)
  const SINGLE_IMAGE_MODELS = ['kling-video-v2_5', 'kling-video-v2_6', 'kling-video-v3_0', 'kling-video-v3_0_turbo']

  describe('27-32. each single-image model receives the uploaded PROVIDER reference as first_image', () => {
    it.each(SINGLE_IMAGE_MODELS)('%s', async (model) => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      const response = await post(i2v({ model, duration: 5 }))
      expect(response.status).toBe(200)
      expect(names(mcp)).toEqual(['file_upload', 'image_to_video'])
      expect(mcp.calls[1].arguments.model).toBe(model)
      expect(mcp.calls[1].arguments.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: PROVIDER_FILE_URL }])
      expect(Object.keys(mcp.calls[1].arguments).sort()).toEqual(['arguments', 'inputs', 'model'])
    })

    it.each(['kling-video-o1', 'kling-video-v3_0_omni'])('%s stays excluded: a multi-reference model is refused before any byte is read or uploaded', async (model) => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      vi.mocked(readS3Object).mockClear()
      const response = await post(i2v({ model }))
      expect(response.status).toBe(400)
      expect(mcp.calls).toEqual([])
      expect(readS3Object).not.toHaveBeenCalled()
      expect(postMultipartToProvider).not.toHaveBeenCalled()
      expect(db.tables.video_generations).toHaveLength(0)
    })

    it('33/34. neither our presigned S3 URL nor a data URL is ever sent as first_image or anywhere else', async () => {
      const db = makeDb({ connections: [connectionRow()], images: [{ id: 'img-d', user_id: 'user-a', project_id: 'proj-1', image_url: toDataUrl(pngBytes(400, 400)), storage_path: null }] })
      signIn(db)
      const mcp = installFakeMcp()
      const viaImage = await post(i2v({ sourceLibraryFileId: undefined, sourceImageId: 'img-d' }))
      expect(viaImage.status).toBe(200)
      const db2 = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db2)
      const mcp2 = installFakeMcp()
      await post(i2v())
      for (const recorded of [mcp, mcp2]) {
        const all = JSON.stringify(recorded.calls)
        expect(all).not.toMatch(/data:image|s3\.example\.test|signed-source|cdn\.example\.test/)
        expect(all).toContain(PROVIDER_FILE_URL)
      }
    })

    it('35. the uploaded provider reference is used exactly once in the paid submission, and is not persisted anywhere', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      const response = await post(i2v())
      expect(response.status).toBe(200)
      expect(JSON.stringify(mcp.calls).split(PROVIDER_FILE_URL).length - 1).toBe(1)
      expect(names(mcp).filter((name) => name === 'image_to_video')).toHaveLength(1)
      const persisted = JSON.stringify({ generations: db.tables.video_generations, library: db.tables.library_files, images: db.tables.images })
      expect(persisted).not.toContain(PROVIDER_FILE_URL)
      expect(persisted).not.toContain('UPLOAD-TICKET-SECRET')
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'submitted', source_library_file_id: 'lib-1', source_image_id: null })
      expect(db.tables.video_generations[0].provider_metadata).toEqual({ generation_id: 'mcp-gen-1', tool: 'image_to_video', model: 'kling-video-v3_0' })
    })
  })

  describe('36-41. spend order: any failure BEFORE a valid provider reference means image_to_video is never sent', () => {
    it('36. a source that cannot be resolved (another user / forged key / deleted): file_upload 0, image_to_video 0, no record', async () => {
      for (const file of [libFile({ user_id: 'user-b' }), libFile({ storage_path: `users/user-b/library/${LIB_BLOB}/x.png` }), libFile({ deleted_at: '2026-09-01T00:00:00.000Z' })]) {
        const db = makeDb({ connections: [connectionRow()], libraryFiles: [file] })
        signIn(db)
        const mcp = installFakeMcp()
        const response = await post(i2v())
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(mcp.calls).toEqual([])
        expect(db.tables.video_generations).toHaveLength(0)
      }
      expect(postMultipartToProvider).not.toHaveBeenCalled()
    })

    it.each([
      ['WebP bytes', async () => ({ bytes: (await import('./helpers/image-fixtures')).webpBytes(), contentType: 'image/webp' }), 'SOURCE_IMAGE_FORMAT_UNSUPPORTED'],
      ['a huge image (4K)', async () => ({ bytes: pngBytes(5000, 3000), contentType: 'image/png' }), 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED'],
      ['a missing object', async () => null, 'SOURCE_IMAGE_UNAVAILABLE'],
    ])('37. %s: %s before the provider — file_upload 0, image_to_video 0, no record', async (_name, object, code) => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      vi.mocked(readS3Object).mockImplementationOnce(object as never)
      const response = await post(i2v())
      expect(response.status).toBe(422)
      expect((await response.json()).code).toBe(code)
      expect(mcp.calls).toEqual([])
      expect(postMultipartToProvider).not.toHaveBeenCalled()
      expect(db.tables.video_generations).toHaveLength(0)
    })

    it('38. the provider upload failing: image_to_video is NEVER sent, the row is failed (pre-submission, not outcome-unknown), one attempt only', async () => {
      const { ProviderUploadError } = await import('@/lib/security/pinned-provider-upload')
      vi.mocked(postMultipartToProvider).mockRejectedValueOnce(new ProviderUploadError('UPLOAD_FAILED', 'http 500'))
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      const response = await post(i2v())
      const body = await response.json()
      expect(response.status).toBe(502)
      expect(body).toMatchObject({ code: 'MCP_FILE_UPLOAD_FAILED', outcomeUnknown: false })
      expect(names(mcp)).toEqual(['file_upload'])
      expect(postMultipartToProvider).toHaveBeenCalledTimes(1)
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'MCP_FILE_UPLOAD_FAILED', outcome_unknown: false } })
      expect(db.tables.video_generations[0].task_id ?? null).toBeNull()
      expect(JSON.stringify(body)).not.toMatch(/UPLOAD-TICKET-SECRET|upload\.example\.test|provider-files/)
    })

    it('38. the ticket call failing is the same: image_to_video 0, failed row, no POST', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp((params) => (params.name === 'file_upload' ? { isError: true, content: [{ type: 'text', text: 'nope' }] } : { content: [{ type: 'text', text: '{"generationId":"x"}' }] }))
      const response = await post(i2v())
      expect((await response.json()).code).toBe('MCP_FILE_UPLOAD_FAILED')
      expect(names(mcp)).toEqual(['file_upload'])
      expect(postMultipartToProvider).not.toHaveBeenCalled()
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed' })
    })

    it('39. a malformed upload result (no usable file URL): image_to_video 0, MCP_SOURCE_REFERENCE_INVALID', async () => {
      for (const json of [{}, { ok: true }, { url: 'http://insecure.example.test/a.png' }, null]) {
        vi.mocked(postMultipartToProvider).mockResolvedValueOnce({ status: 200, json })
        const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
        signIn(db)
        const mcp = installFakeMcp()
        const response = await post(i2v())
        expect(response.status).toBe(502)
        expect((await response.json()).code).toBe('MCP_SOURCE_REFERENCE_INVALID')
        expect(names(mcp)).toEqual(['file_upload'])
        expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'MCP_SOURCE_REFERENCE_INVALID', outcome_unknown: false } })
      }
    })

    it('40. a valid upload: exactly one file_upload, one POST and ONE image_to_video, in that order', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      expect((await post(i2v())).status).toBe(200)
      expect(names(mcp)).toEqual(['file_upload', 'image_to_video'])
      expect(postMultipartToProvider).toHaveBeenCalledTimes(1)
      expect(db.tables.video_generations).toHaveLength(1)
    })

    it('41. one request never spawns a second provider sequence, even when the paid submission itself is rejected (no retry, no second upload)', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp((params) => (params.name === 'file_upload' ? { content: [{ type: 'text', text: JSON.stringify(UPLOAD_TICKET) }] } : { isError: true, content: [{ type: 'text', text: 'rejected' }] }))
      const response = await post(i2v())
      expect(response.status).toBe(422)
      // A rejection AFTER a valid upload keeps the existing meaning (PROVIDER_REJECTED): the upload is not the culprit.
      expect((await response.json()).code).toBe('PROVIDER_REJECTED')
      expect(names(mcp)).toEqual(['file_upload', 'image_to_video'])
      expect(postMultipartToProvider).toHaveBeenCalledTimes(1)
    })
  })

  describe('auth stays separate from media ingestion', () => {
    it('a token rejected at file_upload is refreshed ONCE and the upload proceeds (the rejected token never reached the tool)', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      let attempt = 0
      const original = vi.mocked(mcpClient.createKlingMcpClient).getMockImplementation()!
      vi.mocked(mcpClient.createKlingMcpClient).mockImplementation(((token: string) => {
        const made = (original as any)(token)
        if (attempt++ === 0) made.client.connect = async () => { throw new UnauthorizedError('expired') }
        return made
      }) as any)
      expect((await post(i2v())).status).toBe(200)
      expect(names(mcp)).toEqual(['file_upload', 'image_to_video'])
      expect(mcp.tokens[0]).toBe('MCP-ACCESS-TOKEN-SECRET')
      expect(mcp.tokens[1]).toBe('MCP-REFRESHED-TOKEN-SECRET')
    })

    it('a token that stays rejected is AUTHORIZATION_REQUIRED (reauthorize), not a media error; image_to_video 0', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      mcp.connectError = new UnauthorizedError('still bad')
      const response = await post(i2v())
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('AUTHORIZATION_REQUIRED')
      expect(names(mcp)).toEqual([])
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'AUTHORIZATION_REQUIRED' } })
    })

    it('a missing permission (HTTP 403 at file_upload) uses the authorization wording and never claims "read-only" or a media fault', async () => {
      const { SdkHttpError, SdkErrorCode } = await import('@modelcontextprotocol/client')
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp((params) => { if (params.name === 'file_upload') throw new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'forbidden', { status: 403 }); return { content: [] } })
      const response = await post(i2v())
      const body = await response.json()
      expect(response.status).toBe(422)
      expect(body.code).toBe('PROVIDER_REJECTED')
      expect(body.error).toMatch(/autorização da conta não permite gerar/)
      expect(body.error).not.toMatch(/somente leitura|read-only/i)
      expect(names(mcp)).toEqual(['file_upload'])
    })
  })

  describe('42-49. regression: nothing else moved', () => {
    it('42. REST image_to_video is unchanged: the presigned URL goes to the REST adapter; no MCP client, no file_upload, no upload POST', async () => {
      const db = makeDb({ klingKey: 'user-rest-key', libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      vi.mocked(readS3Object).mockClear()
      const response = await post({ ...base, mode: 'image_to_video', sourceLibraryFileId: 'lib-1', connectionRef: 'kling:api' })
      expect(response.status).toBe(200)
      expect(restCalls).toHaveLength(1)
      expect(restCalls[0].args[1]).toBe('https://s3.example.test/signed-source.png?sig=1')
      expect(mcp.calls).toEqual([])
      expect(mcp.tokens).toEqual([])
      expect(readS3Object).not.toHaveBeenCalled()
      expect(postMultipartToProvider).not.toHaveBeenCalled()
    })

    it('43. REST text_to_video is unchanged', async () => {
      const db = makeDb({ klingKey: 'user-rest-key' })
      signIn(db)
      const mcp = installFakeMcp()
      expect((await post({ ...base, mode: 'text_to_video', connectionRef: 'kling:api' })).status).toBe(200)
      expect(restCalls.map((call) => call.kind)).toEqual(['t2v'])
      expect(mcp.calls).toEqual([])
      expect(postMultipartToProvider).not.toHaveBeenCalled()
    })

    it('44. MCP text_to_video is unchanged: only text_to_video is called — no source resolution, no bytes, no file_upload', async () => {
      const db = makeDb({ connections: [connectionRow()] })
      signIn(db)
      const mcp = installFakeMcp()
      vi.mocked(readS3Object).mockClear()
      vi.mocked(headS3Object).mockClear()
      expect((await post(mcpBody())).status).toBe(200)
      expect(names(mcp)).toEqual(['text_to_video'])
      expect(mcp.calls[0].arguments.inputs).toBeUndefined()
      expect(readS3Object).not.toHaveBeenCalled()
      expect(headS3Object).not.toHaveBeenCalled()
      expect(postMultipartToProvider).not.toHaveBeenCalled()
    })

    it('46/47. the source identity contract is unchanged: XOR, and the row records only the Content Studio id', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      installFakeMcp()
      expect((await post(i2v({ sourceImageId: 'img-1' }))).status).toBe(400)
      expect((await post(i2v({ sourceLibraryFileId: undefined }))).status).toBe(400)
      expect((await post(i2v())).status).toBe(200)
      expect(db.tables.video_generations[0]).toMatchObject({ source_library_file_id: 'lib-1', source_image_id: null })
    })

    it('48. file_upload is not a billed event: no usage-ledger row exists after an MCP I2V submission', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      installFakeMcp()
      expect((await post(i2v())).status).toBe(200)
      expect(db.tables.provider_usage_events ?? []).toEqual([])
    })

    it('the generation controls are unchanged: the paid call carries exactly the selected controls and the pinned output count', async () => {
      const db = makeDb({ connections: [connectionRow()], libraryFiles: [libFile()] })
      signIn(db)
      const mcp = installFakeMcp()
      await post(i2v({ model: 'kling-video-v3_0', duration: 10, resolution: '1080p', audio: 'off', multi_shot: false }))
      const args = Object.fromEntries(mcp.calls[1].arguments.arguments.map((entry: any) => [entry.name, entry.value]))
      expect(args).toMatchObject({ duration: '10', resolution: '1080p', enable_audio: 'false', prefer_multi_shots: 'false', imageCount: '1' })
    })
  })
})
