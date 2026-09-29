import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client'
import {
  buildCapabilitySnapshot,
  callReadOnlyTool,
  mapMcpError,
  runKlingReadOnlyCheck,
  type KlingMcpClientLike,
} from '@/lib/provider-connections/kling-mcp-client'
import { checkKlingMcpConnection, type CheckDependencies } from '@/lib/provider-connections/connection-check'
import { saveConnectionTokens } from '@/lib/provider-connections/token-store'
import { KLING_MCP_READ_ONLY_TOOLS, isKlingMcpReadOnlyTool } from '@/lib/provider-connections/kling-mcp'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const GRANT = { clientId: 'client-content-studio-1', issuer: ISSUER }
const REDIRECT_URI = 'https://content.example.test/api/provider-connections/kling/mcp/callback'
const NOW = new Date('2026-09-29T12:00:00Z')

const TOKENS = { access_token: 'at-check-secret-0001', refresh_token: 'rt-check-secret-0001', token_type: 'Bearer', expires_in: 3600 }

// Everything a real Kling MCP server exposes — INCLUDING the tools that generate or mutate.
const SERVER_TOOLS = [
  'who_am_i', 'query_membership_and_credits', 'query_tasks', 'motion_library_list', 'element_list', 'element_get',
  'text_to_video', 'image_to_video', 'text_to_image', 'image_to_image', 'motion_control',
  'file_upload', 'element_create', 'element_update', 'element_delete', 'logout', 'feedback',
]
const FORBIDDEN_TOOLS = SERVER_TOOLS.filter((name) => !isKlingMcpReadOnlyTool(name))

const WHO_AM_I = {
  user: { userId: 424242 },
  mcpVersion: '1.3.3',
  authMode: 'oauth',
  availableModels: {
    text_to_video: { defaultModel: 'kling-video-v3_0_omni', models: [{ model: 'kling-video-v3_0' }, { model: 'kling-video-v3_0_turbo' }] },
    image_to_video: { defaultModel: 'kling-video-v3_0', models: [{ model: 'kling-video-v3_0' }] },
  },
}
const MEMBERSHIP = { userId: 424242, membershipType: 'SVIP', membershipTypeDescription: 'Pro', availableRemainCredits: 987654 }

const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

function fakeClient(overrides: Partial<KlingMcpClientLike> = {}) {
  const callTool = vi.fn(async ({ name }: { name: string }) => {
    if (name === 'who_am_i') return text(WHO_AM_I)
    if (name === 'query_membership_and_credits') return text(MEMBERSHIP)
    throw new Error(`UNEXPECTED TOOL CALL: ${name}`)
  })
  const client: KlingMcpClientLike & { callTool: typeof callTool } = {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({ tools: SERVER_TOOLS.map((name) => ({ name })) })),
    callTool,
    close: vi.fn(async () => undefined),
    ...overrides,
  } as never
  return client
}

const factory = (client: KlingMcpClientLike, seenTokens: string[] = []) => (accessToken: string) => {
  seenTokens.push(accessToken)
  return { client, transport: {} }
}

describe('read-only MCP verification', () => {
  it('connects, lists tools, calls only who_am_i and query_membership_and_credits, then disconnects', async () => {
    const client = fakeClient()
    const result = await runKlingReadOnlyCheck('token', { createClient: factory(client) })

    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.listTools).toHaveBeenCalledTimes(1)
    expect(client.callTool.mock.calls.map(([params]) => params.name)).toEqual(['who_am_i', 'query_membership_and_credits'])
    expect(client.close).toHaveBeenCalledTimes(1)
    expect(result.accountId).toBe('424242')
  })

  it('asks who_am_i only about text_to_video / image_to_video capabilities (read-only discovery)', async () => {
    const client = fakeClient()
    await runKlingReadOnlyCheck('token', { createClient: factory(client) })
    expect(client.callTool.mock.calls[0][0]).toEqual({ name: 'who_am_i', arguments: { tools: ['text_to_video', 'image_to_video'] } })
  })

  it('passes the access token only to the transport factory', async () => {
    const seen: string[] = []
    await runKlingReadOnlyCheck('the-access-token', { createClient: factory(fakeClient(), seen) })
    expect(seen).toEqual(['the-access-token'])
  })

  it('returns a live credit read for display and includes it nowhere in the persisted capability snapshot', async () => {
    const result = await runKlingReadOnlyCheck('token', { createClient: factory(fakeClient()) })
    expect(result.credits).toEqual({ available: 987654 })
    expect(JSON.stringify(result.capabilities)).not.toContain('987654')
    // (the tool NAME query_membership_and_credits is legitimate capability metadata; a balance is not)
    expect(JSON.stringify(result.capabilities)).not.toMatch(/balance|availableRemainCredits/i)
  })

  it('still disconnects when a call fails', async () => {
    const client = fakeClient({ listTools: vi.fn(async () => { throw new Error('network') }) })
    await expect(runKlingReadOnlyCheck('token', { createClient: factory(client) })).rejects.toBeInstanceOf(ProviderConnectionError)
    expect(client.close).toHaveBeenCalledTimes(1)
  })
})

describe('generation tools are unreachable', () => {
  it('the allowlist is exactly the two account/capability tools', () => {
    expect([...KLING_MCP_READ_ONLY_TOOLS]).toEqual(['who_am_i', 'query_membership_and_credits'])
  })

  it.each(FORBIDDEN_TOOLS)('callReadOnlyTool refuses "%s" before any request is sent', async (tool) => {
    const client = fakeClient()
    await expect(callReadOnlyTool(client, tool, { prompt: 'x' })).rejects.toBeInstanceOf(ProviderConnectionError)
    expect(client.callTool).not.toHaveBeenCalled()
  })

  it('a full check never calls any generation, upload or mutation tool even though the server exposes them', async () => {
    const client = fakeClient()
    await runKlingReadOnlyCheck('token', { createClient: factory(client) })
    const called = client.callTool.mock.calls.map(([params]) => params.name)
    for (const forbidden of FORBIDDEN_TOOLS) expect(called).not.toContain(forbidden)
  })

  it('treats a tool-level error result as a controlled error', async () => {
    const client = fakeClient({ callTool: vi.fn(async () => ({ isError: true, content: [{ type: 'text', text: 'Insufficient credits' }] })) as never })
    await expect(callReadOnlyTool(client, 'who_am_i')).rejects.toMatchObject({ code: 'PROVIDER_TOOL_ERROR' })
  })
})

describe('MCP error mapping (no leakage)', () => {
  it('maps a rejected token (UnauthorizedError) to authorization required', () => {
    expect(mapMcpError(new UnauthorizedError())).toBeInstanceOf(ProviderAuthorizationRequiredError)
  })

  it('maps HTTP 401 / 403 SDK errors', () => {
    const http = (code: string, status: number) =>
      new SdkHttpError(code as never, 'msg with Authorization: Bearer secret-header-value', { status, statusText: '', text: '' } as never)
    expect(mapMcpError(http(SdkErrorCode.ClientHttpAuthentication, 401))).toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(mapMcpError(http(SdkErrorCode.ClientHttpForbidden, 403))).toMatchObject({ code: 'PROVIDER_SCOPE_INSUFFICIENT' })
  })

  it('maps anything else to a generic unavailable error carrying no provider detail', () => {
    const mapped = mapMcpError(new Error('ECONNRESET https://kling.ai/mcp?code=abc Authorization: Bearer leaked-token'))
    expect(mapped.code).toBe('PROVIDER_UNAVAILABLE')
    expect(mapped.message).not.toContain('leaked-token')
    expect(mapped.message).not.toContain('ECONNRESET')
  })
})

describe('capability snapshot', () => {
  it('keeps only safe metadata: tool names, model ids, server version and membership label', () => {
    const snapshot = buildCapabilitySnapshot({ toolNames: ['who_am_i', 'text_to_video'], whoAmI: WHO_AM_I, membership: MEMBERSHIP })
    expect(snapshot).toEqual({
      mcpServerVersion: '1.3.3',
      tools: ['text_to_video', 'who_am_i'],
      models: {
        text_to_video: ['kling-video-v3_0', 'kling-video-v3_0_turbo'],
        image_to_video: ['kling-video-v3_0'],
      },
      membership: { type: 'SVIP', label: 'Pro' },
      // Normalized video capabilities only (see kling-mcp-video-capabilities.test.ts); never the raw schema.
      video: expect.objectContaining({ schemaVersion: 1 }),
    })
    expect(JSON.stringify(snapshot)).not.toContain('424242')
    expect(JSON.stringify(snapshot)).not.toContain('987654')
  })
})

describe('connection check orchestration', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  async function seed(userId = 'user-a') {
    const db = createFakeDb({
      seed: {
        provider_connections: [
          { id: 'conn-1', user_id: userId, provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', scopes: ['generation.read', 'account.credit.read'], capabilities: {}, external_account_id: null },
        ],
        provider_oauth_clients: [
          { id: 'c', provider: 'kling', issuer: ISSUER, redirect_uri: REDIRECT_URI, client_id: 'client-1', registration_response_fields: [] },
        ],
      },
    })
    await saveConnectionTokens(db as any, 'conn-1', TOKENS, GRANT, NOW)
    return db
  }

  const baseDeps = (client: KlingMcpClientLike, extra: Partial<CheckDependencies> = {}): CheckDependencies => ({
    now: () => NOW,
    createClient: factory(client),
    discover: vi.fn(async () => ({ authorizationServerUrl: new URL(ISSUER), authorizationServerMetadata: { issuer: ISSUER }, resourceMetadata: {} })) as never,
    ...extra,
  })

  it('verifies the connection and records only safe metadata', async () => {
    const db = await seed()
    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient()))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.connection).toMatchObject({ id: 'conn-1', status: 'connected', accountHint: '4242', lastErrorCode: null })
    expect(outcome.connection.capabilities.membership).toEqual({ type: 'SVIP', label: 'Pro' })
    expect(outcome.credits).toEqual({ available: 987654 })

    const [row] = db.tables.provider_connections
    expect(row.status).toBe('connected')
    expect(row.last_checked_at).toBeTruthy()
    expect(row.external_account_id).toBe('424242')
    expect(JSON.stringify(row)).not.toContain('987654')
    expect(JSON.stringify(row)).not.toContain(TOKENS.access_token)
    expect(JSON.stringify(outcome)).not.toContain(TOKENS.access_token)
    expect(JSON.stringify(outcome)).not.toContain(TOKENS.refresh_token)
  })

  it('exposes only a 4-character account hint — never the full provider account id — to the browser shape', async () => {
    const db = await seed()
    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient()))
    expect(JSON.stringify(outcome)).not.toContain('424242')
  })

  it('a different user cannot check another user’s connection, and no token is read', async () => {
    const db = await seed('user-a')
    db.log.length = 0 // Clear seed log
    const client = fakeClient()
    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-b' }, baseDeps(client))

    expect(outcome).toEqual({ ok: false, notFound: true })
    expect(client.connect).not.toHaveBeenCalled()
    expect(db.log).not.toContain('select:provider_connection_secrets')
  })

  it('an unknown connection id is indistinguishable from a foreign one', async () => {
    const db = await seed()
    expect(await checkKlingMcpConnection(db as any, { connectionId: 'does-not-exist', userId: 'user-a' }, baseDeps(fakeClient()))).toEqual({ ok: false, notFound: true })
  })

  it('a rejected-but-unexpired token is refreshed once and the check retried', async () => {
    const db = await seed()
    let attempts = 0
    const runCheck = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new ProviderAuthorizationRequiredError()
      return { accountId: '424242', capabilities: {}, credits: { available: 1 } }
    })
    const refresh = vi.fn(async () => ({ access_token: 'at-after-refresh', token_type: 'Bearer', expires_in: 3600 }))

    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient(), { runCheck: runCheck as never, refresh: refresh as never }))

    expect(outcome.ok).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(runCheck).toHaveBeenCalledTimes(2)
    expect((runCheck.mock.calls[1] as unknown[])[0]).toBe('at-after-refresh')
  })

  it('if the provider keeps rejecting after a refresh, the connection becomes authorization_required', async () => {
    const db = await seed()
    const runCheck = vi.fn(async () => { throw new ProviderAuthorizationRequiredError() })
    const refresh = vi.fn(async () => ({ access_token: 'at-after-refresh', token_type: 'Bearer', expires_in: 3600 }))

    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient(), { runCheck: runCheck as never, refresh: refresh as never }))

    expect(outcome).toMatchObject({ ok: false, code: 'PROVIDER_AUTHORIZATION_REQUIRED', connectionStatus: 'authorization_required' })
    expect(db.tables.provider_connections[0]).toMatchObject({ status: 'authorization_required', last_error_code: 'PROVIDER_AUTHORIZATION_REQUIRED' })
  })

  it('a revoked refresh token maps to authorization_required (never a generic 500)', async () => {
    const db = await seed()
    await saveConnectionTokens(db as any, 'conn-1', { ...TOKENS, expires_in: 1 }, GRANT, new Date(NOW.getTime() - 3600_000))
    const refresh = vi.fn(async () => { throw new OAuthError(OAuthErrorCode.InvalidGrant, 'revoked') })

    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient(), { refresh: refresh as never }))

    expect(outcome).toMatchObject({ ok: false, code: 'PROVIDER_AUTHORIZATION_REQUIRED', connectionStatus: 'authorization_required' })
    expect(db.tables.provider_connection_secrets).toHaveLength(0)
  })

  it('an insufficient scope is recorded as an error state with a controlled code', async () => {
    const db = await seed()
    const runCheck = vi.fn(async () => { throw new ProviderConnectionError('PROVIDER_SCOPE_INSUFFICIENT') })
    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient(), { runCheck: runCheck as never }))

    expect(outcome).toMatchObject({ ok: false, code: 'PROVIDER_SCOPE_INSUFFICIENT', connectionStatus: 'error' })
    expect(db.tables.provider_connections[0]).toMatchObject({ status: 'error', last_error_code: 'PROVIDER_SCOPE_INSUFFICIENT' })
  })

  it('a transient outage does not flip a healthy connection to error and omits connectionStatus from the response', async () => {
    const db = await seed()
    const runCheck = vi.fn(async () => { throw new ProviderConnectionError('PROVIDER_UNAVAILABLE') })
    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient(), { runCheck: runCheck as never }))

    expect(outcome).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' })
    expect(outcome).not.toHaveProperty('connectionStatus')
    expect(db.tables.provider_connections[0].status).toBe('connected')
  })

  it('a DB error on ownership lookup throws CONNECTION_STORE_UNAVAILABLE instead of looking like notFound', async () => {
    const db = await seed()
    const originalFrom = db.from;
    db.from = vi.fn((table: string) => {
      if (table === 'provider_connections') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') })
        } as any
      }
      return originalFrom.call(db, table)
    })

    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient()))
    expect(outcome).toMatchObject({ ok: false, code: 'CONNECTION_STORE_UNAVAILABLE' })
    expect(outcome).not.toHaveProperty('connectionStatus')
  })

  it('a missing encryption key is reported as an infrastructure problem and does not alter the connection', async () => {
    const db = await seed()
    delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY

    const outcome = await checkKlingMcpConnection(db as any, { connectionId: 'conn-1', userId: 'user-a' }, baseDeps(fakeClient()))
    expect(outcome).toMatchObject({ ok: false, code: 'CONNECTION_ENCRYPTION_NOT_CONFIGURED' })
    expect(db.tables.provider_connections[0].status).toBe('connected')
  })
})
