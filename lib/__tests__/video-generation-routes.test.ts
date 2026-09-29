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
vi.mock('@/lib/storage/s3', () => ({ createPresignedReadUrl: vi.fn(async () => 'https://s3.example.test/signed-source.png?sig=1') }))
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
const constructedApiKeys: string[] = []
vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    constructor(apiKey: string) {
      constructedApiKeys.push(apiKey)
    }
    submitImageToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 'i2v', args }); return { task_id: 'rest-task-1' } }
    submitTextToVideo = async (...args: unknown[]) => { restCalls.push({ kind: 't2v', args }); return { task_id: 'rest-task-2' } }
    getTaskStatus = async () => ({ id: 'rest-task-1', status: 'processing', created_at: 1, updated_at: 1 })
  },
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import * as mcpClient from '@/lib/provider-connections/kling-mcp-client'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import { createPresignedReadUrl } from '@/lib/storage/s3'

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const FOREIGN_ID = '22222222-2222-4222-8222-222222222222'
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

function makeDb(rows: { connections?: any[]; klingKey?: string | null; generations?: any[]; images?: any[] } = {}) {
  return createFakeDb({
    seed: {
      provider_connections: rows.connections ?? [],
      user_settings: rows.klingKey === undefined || rows.klingKey === null ? [] : [{ user_id: 'user-a', kling_api_key: rows.klingKey }],
      video_generations: rows.generations ?? [],
      images: rows.images ?? [{ id: 'img-1', user_id: 'user-a', project_id: 'proj-1', image_url: 'https://img.example.test/1.png', storage_path: 'a/1.png' }],
      library_files: [],
      video_drafts: [],
      channel_piece_media: [],
    },
    unique: { images: [['id']], library_files: [['id']] },
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

function installFakeMcp(reply: FakeMcp['reply'] = () => ({ content: [{ type: 'text', text: JSON.stringify({ generationId: 'mcp-gen-1' }) }] })): FakeMcp {
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
  constructedApiKeys.length = 0
  process.env.NEXT_PUBLIC_APP_URL = 'https://content.example.test'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  consoleError.mockRestore()
  delete process.env.CRON_SECRET
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

  it('MCP image_to_video: reuses the owned-source + presigned URL mechanism and sends it as first_image', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()

    const response = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-1', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0' })

    expect(response.status).toBe(200)
    expect(mcp.calls[0].name).toBe('image_to_video')
    expect(mcp.calls[0].arguments.inputs).toEqual([{ name: 'first_image', inputType: 'URL', url: 'https://s3.example.test/signed-source.png?sig=1' }])
    expect(mcp.calls[0].arguments.arguments.map((a: any) => a.name)).not.toContain('aspect_ratio')
    expect(db.tables.video_generations[0]).toMatchObject({ mode: 'image_to_video', source_image_id: 'img-1', source_library_file_id: null, transport: 'mcp' })
  })

  it.each([
    ['an image with no url at all', { id: 'img-empty', user_id: 'user-a', project_id: 'proj-1', image_url: '', storage_path: null }],
  ])('%s is refused (422) BEFORE any record or provider call', async (_name, image) => {
    const db = makeDb({ connections: [connectionRow()], images: [image] })
    signIn(db)
    const mcp = installFakeMcp()
    vi.mocked(createPresignedReadUrl).mockResolvedValueOnce(null as any)

    const response = await post({ ...base, mode: 'image_to_video', sourceImageId: 'img-empty', connectionRef: accountConnectionRef(CONNECTION_ID), model: 'kling-video-v3_0' })

    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('SOURCE_MEDIA_UNAVAILABLE')
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

describe('POST /api/video-generations — an ACCEPTED submission is never reported as failed', () => {
  /** A user client whose UPDATE of video_generations fails (RLS/network) after the row was inserted. */
  const breakUpdates = (db: any, options: { alsoServiceRole?: boolean } = {}) => {
    const failing = () => {
      const chain: any = { eq: () => chain, select: () => chain, single: () => Promise.resolve({ data: null, error: { message: 'rls' } }), then: (r: any) => r({ data: null, error: { message: 'rls' } }) }
      return chain
    }
    const original = db.from
    const patched = (table: string) => {
      const builder = original.call(db, table)
      if (table === 'video_generations') builder.update = failing
      return builder
    }
    const client = { from: patched, auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } }
    vi.mocked(server.createClient).mockResolvedValue(client as any)
    if (options.alsoServiceRole) vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: patched } as any)
  }

  it('MCP: if recording the task id fails once, a server-authority retry records it and the user is NOT told to retry', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    const mcp = installFakeMcp()
    // User-session updates fail; the service-role client (same in-memory db) succeeds.
    const original = db.from
    vi.mocked(server.createClient).mockResolvedValue({
      from: (table: string) => {
        const builder = original.call(db, table)
        if (table === 'video_generations') builder.update = () => { const chain: any = { eq: () => chain, select: () => chain, single: () => Promise.resolve({ data: null, error: { message: 'rls' } }) }; return chain }
        return builder
      },
      auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
    } as any)

    const response = await post(mcpBody())

    expect(response.status).toBe(200)
    expect(mcp.calls).toHaveLength(1)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'submitted', task_id: 'mcp-gen-1', transport: 'mcp' })
  })

  it('if the accepted job cannot be recorded at all: 502 SUBMISSION_UNRECORDED with an explicit DO-NOT-RETRY message, the row is not marked failed, and the provider id is logged for reconciliation', async () => {
    const db = makeDb({ connections: [connectionRow()] })
    signIn(db)
    breakUpdates(db, { alsoServiceRole: true })
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
    breakUpdates(db, { alsoServiceRole: true })

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
    const legacy = { id: 'old-1', user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'text_to_video', status: 'succeeded', provider: 'kling', model: 'kling-v3', task_id: 'kling-old', storage_path: 'u/videos/ai/p/old.mp4', public_url: 'https://s3.example.test/old.mp4', request_config: { duration: 5, resolution: '720p' }, created_at: '2026-09-01T00:00:00Z' }
    const mcpRow = { id: 'new-1', user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'text_to_video', status: 'succeeded', provider: 'kling', model: 'kling-video-v3_0', transport: 'mcp', connection_id: null, storage_path: 'u/videos/ai/p/new-1.mp4', created_at: '2026-09-29T00:00:00Z' }
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
describe('/api/internal/video-generations/poll — internal trigger authentication', () => {
  const call = async (headers: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET') => {
    const route = await import('@/app/api/internal/video-generations/poll/route')
    return route[method](new NextRequest('http://localhost/api/internal/video-generations/poll', { method, headers }))
  }

  it('fails CLOSED when no secret is configured (503) — nothing is queried', async () => {
    const db = makeDb()
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    const response = await call({ authorization: 'Bearer anything-at-all-1234' })
    expect(response.status).toBe(503)
    expect(vi.mocked(serviceRole.createServiceRoleSupabase)).not.toHaveBeenCalled()
  })

  it('rejects a too-short secret as not configured', async () => {
    process.env.CRON_SECRET = 'short'
    expect((await call({ authorization: 'Bearer short' })).status).toBe(503)
  })

  it.each([
    ['no header', {}],
    ['wrong secret', { authorization: 'Bearer wrong-secret-wrong-secret' }],
    ['not a bearer header', { authorization: 'cron-secret-value-0123456789' }],
    ['a user session cookie', { cookie: 'sb-access-token=abc' }],
  ])('rejects %s (401) before touching the database', async (_name, headers) => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(makeDb())
    expect((await call(headers as any)).status).toBe(401)
    expect(vi.mocked(serviceRole.createServiceRoleSupabase)).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST'] as const)('with the right secret (%s) it polls due MCP generations and returns counts only', async (method) => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    const due = { id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'mcp-gen-1', transport: 'mcp', connection_id: CONNECTION_ID, created_at: NOW_ISO, next_poll_at: new Date(Date.now() - 5000).toISOString(), poll_attempts: 0 }
    const db = makeDb({ connections: [connectionRow()], generations: [due] })
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    const mcp = installFakeMcp(() => ({ content: [{ type: 'text', text: JSON.stringify({ status: 'processing' }) }] }))

    const response = await call({ authorization: 'Bearer cron-secret-value-0123456789' }, method)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, due: 1, claimed: 1, outcomes: { processing: 1 } })
    expect(mcp.calls).toEqual([{ name: 'query_tasks', arguments: { generationId: 'mcp-gen-1' } }])
    // Counts only: no ids, prompts, provider text or tokens.
    expect(JSON.stringify(body)).not.toMatch(/gen-1|mcp-gen|TOKEN|prompt/)
    noSecretsIn(body)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', poll_attempts: 1 })
  })

  it('a store failure is a controlled 500 without detail', async () => {
    process.env.CRON_SECRET = 'cron-secret-value-0123456789'
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: () => { const chain: any = { update: () => chain, select: () => chain, eq: () => chain, in: () => chain, is: () => chain, lt: () => chain, lte: () => chain, order: () => chain, limit: () => chain, then: (r: any) => r({ data: null, error: { message: 'secret db detail' } }) }; return chain } } as any)
    const response = await call({ authorization: 'Bearer cron-secret-value-0123456789' })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('secret db detail')
  })
})
