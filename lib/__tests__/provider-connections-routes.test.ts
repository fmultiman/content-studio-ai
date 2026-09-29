import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as serverModule from '@/lib/supabase/server'
import * as serviceRoleModule from '@/lib/supabase/service-role'
import * as oauthModule from '@/lib/provider-connections/kling-mcp-oauth'
import * as checkModule from '@/lib/provider-connections/connection-check'
import { ConnectionEncryptionNotConfiguredError } from '@/lib/provider-connections/crypto'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv, type FakeDb } from './helpers/fake-db'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/provider-connections/kling-mcp-oauth', () => ({
  startKlingMcpAuthorization: vi.fn(),
  completeKlingMcpAuthorization: vi.fn(),
  revokeKlingMcpGrant: vi.fn(),
}))
vi.mock('@/lib/provider-connections/connection-check', () => ({ checkKlingMcpConnection: vi.fn() }))

const SECRET_MARKERS = ['at-route-secret', 'rt-route-secret', 'code-route-secret', 'state-route-secret', 'verifier-route-secret']

function signedIn(userId: string | null, db?: FakeDb) {
  vi.mocked(serverModule.createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: userId ? null : new Error('no session') }) },
    from: db?.from ?? (() => { throw new Error('no db') }),
  } as never)
}

function serviceDb(db: FakeDb) {
  vi.mocked(serviceRoleModule.createServiceRoleSupabase).mockReturnValue(db as never)
}

const expectNoSecrets = (value: unknown) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  for (const marker of SECRET_MARKERS) expect(serialized).not.toContain(marker)
}

beforeEach(() => {
  vi.clearAllMocks()
  useTestConnectionEnv()
})
afterEach(() => {
  clearTestConnectionEnv()
  vi.restoreAllMocks()
})

describe('POST /api/provider-connections/kling/mcp/connect', () => {
  const call = async (body?: unknown) => {
    const { POST } = await import('@/app/api/provider-connections/kling/mcp/connect/route')
    return POST(
      new Request('http://localhost/api/provider-connections/kling/mcp/connect', {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  }

  it('rejects an unauthenticated user', async () => {
    signedIn(null)
    const response = await call()
    expect(response.status).toBe(401)
    expect(oauthModule.startKlingMcpAuthorization).not.toHaveBeenCalled()
  })

  it('fails closed (503) when connection secrets cannot be encrypted, before creating any state', async () => {
    delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY
    signedIn('user-a')
    const response = await call()
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('CONNECTION_ENCRYPTION_NOT_CONFIGURED')
    expect(oauthModule.startKlingMcpAuthorization).not.toHaveBeenCalled()
  })

  it('starts the flow for the SESSION user and returns only the authorization URL', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(oauthModule.startKlingMcpAuthorization).mockResolvedValue({
      authorizationUrl: 'https://kling.ai/auth/authorize?response_type=code&state=public-state&code_challenge=public-challenge&code_challenge_method=S256',
    })

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Object.keys(body)).toEqual(['authorizationUrl'])
    expect(oauthModule.startKlingMcpAuthorization).toHaveBeenCalledWith(expect.anything(), { userId: 'user-a', intent: 'read_only' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.authorizationUrl).not.toMatch(/code_verifier|verifier/)
  })

  it('requests the generation permission ONLY when the client explicitly asks for that intent', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(oauthModule.startKlingMcpAuthorization).mockResolvedValue({ authorizationUrl: 'https://kling.ai/auth/authorize?state=s' })

    const response = await call({ intent: 'generation' })

    expect(response.status).toBe(200)
    expect(oauthModule.startKlingMcpAuthorization).toHaveBeenCalledWith(expect.anything(), { userId: 'user-a', intent: 'generation' })
  })

  it.each([{ intent: 'admin' }, { intent: 42 }, '{not json'])('rejects an unknown intent (%o) without starting any flow', async (payload) => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    const { POST } = await import('@/app/api/provider-connections/kling/mcp/connect/route')
    const response = await POST(
      new Request('http://localhost/x', { method: 'POST', body: typeof payload === 'string' ? payload : JSON.stringify(payload) }),
    )
    expect(response.status).toBe(400)
    expect(oauthModule.startKlingMcpAuthorization).not.toHaveBeenCalled()
  })

  it('returns a generic error (no provider detail) when the flow cannot start', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(oauthModule.startKlingMcpAuthorization).mockRejectedValue(new Error('registration failed at https://kling.ai/auth/register token=leak'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(502)
    expect(body.code).toBe('PROVIDER_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('leak')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('leak')
  })
})

  describe('GET /api/provider-connections/kling/mcp/callback', () => {
    const call = async (query: string) => {
      const { GET } = await import('@/app/api/provider-connections/kling/mcp/callback/route')
      return GET(new NextRequest(`https://content.example.test/api/provider-connections/kling/mcp/callback${query}`))
    }
    const locationStr = (response: Response) => response.headers.get('location') as string
    const location = (response: Response) => new URL(locationStr(response), 'https://content.example.test')

    it('sends an unauthenticated visitor to login without touching any state via a relative redirect', async () => {
      signedIn(null)
      const response = await call('?code=code-route-secret&state=state-route-secret')
      expect(response.status).toBe(303)
      expect(locationStr(response)).toBe('/login')
      expect(oauthModule.completeKlingMcpAuthorization).not.toHaveBeenCalled()
    })

    it('works safely even when NEXT_PUBLIC_APP_URL is unset', async () => {
      signedIn(null)
      const cached = process.env.NEXT_PUBLIC_APP_URL
      delete process.env.NEXT_PUBLIC_APP_URL
      const response = await call('?code=x')
      expect(locationStr(response)).toBe('/login')
      process.env.NEXT_PUBLIC_APP_URL = cached
    })

    it('rejects missing state or code', async () => {
      signedIn('user-a')
      serviceDb(createFakeDb())
      for (const query of ['', '?code=code-route-secret', '?state=state-route-secret']) {
        const response = await call(query)
        expect(location(response).searchParams.get('result')).toBe('missing_parameters')
      }
      expect(oauthModule.completeKlingMcpAuthorization).not.toHaveBeenCalled()
    })

  it('handles a provider OAuth error (user denied) and discards the pending attempt', async () => {
    const db = createFakeDb({ seed: { provider_oauth_authorizations: [] } })
    signedIn('user-a')
    serviceDb(db)
    const { hashOAuthState } = await import('@/lib/provider-connections/oauth-state')
    db.tables.provider_oauth_authorizations.push({ state_hash: hashOAuthState('state-route-secret'), user_id: 'user-a' })

    const response = await call('?error=access_denied&state=state-route-secret')

    expect(location(response).searchParams.get('result')).toBe('provider_denied')
    expect(db.tables.provider_oauth_authorizations).toHaveLength(0)
    expect(oauthModule.completeKlingMcpAuthorization).not.toHaveBeenCalled()
  })

  it('maps other provider errors to provider_error', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    const response = await call('?error=server_error&error_description=leaky-detail')
    expect(location(response).searchParams.get('result')).toBe('provider_error')
    expect(response.headers.get('location')).not.toContain('leaky-detail')
  })

  it('on success redirects to Settings via a relative URL with a result code ONLY — no code, state or token in the URL, no-store, no referrer', async () => {
      signedIn('user-a')
      serviceDb(createFakeDb())
      vi.mocked(oauthModule.completeKlingMcpAuthorization).mockResolvedValue({
        ok: true,
        connection: { id: 'conn-1', access_token: 'at-route-secret' } as never,
      })

      const response = await call('?code=code-route-secret&state=state-route-secret&iss=https%3A%2F%2Fkling.ai%2Fauth')
      const targetStr = locationStr(response)
      const target = location(response)

      expect(response.status).toBe(303)
      expect(targetStr.startsWith('/configuracoes')).toBe(true)
      expect([...target.searchParams.keys()].sort()).toEqual(['connection', 'result'])
      expect(target.searchParams.get('connection')).toBe('kling_mcp')
      expect(target.searchParams.get('result')).toBe('connected')
      expectNoSecrets(targetStr)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expectNoSecrets(await response.text())
    })

  it('completes for the SESSION user with the presented code, state and iss', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(oauthModule.completeKlingMcpAuthorization).mockResolvedValue({ ok: true, connection: {} as never })

    await call('?code=code-route-secret&state=state-route-secret&iss=https%3A%2F%2Fkling.ai%2Fauth')

    expect(oauthModule.completeKlingMcpAuthorization).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-a',
      state: 'state-route-secret',
      code: 'code-route-secret',
      iss: 'https://kling.ai/auth',
    })
  })

  it.each(['invalid_state', 'expired_state', 'state_mismatch', 'exchange_failed'] as const)('reports a %s failure via the result code', async (failure) => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(oauthModule.completeKlingMcpAuthorization).mockResolvedValue({ ok: false, failure })

    const response = await call('?code=code-route-secret&state=state-route-secret')
    expect(location(response).searchParams.get('result')).toBe(failure)
    expectNoSecrets(response.headers.get('location') as string)
  })

  it('reports encryption_unavailable when secrets cannot be stored, and generic exchange_failed otherwise', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    vi.mocked(oauthModule.completeKlingMcpAuthorization).mockRejectedValueOnce(new ConnectionEncryptionNotConfiguredError())
    expect(location(await call('?code=code-route-secret&state=state-route-secret')).searchParams.get('result')).toBe('encryption_unavailable')

    vi.mocked(oauthModule.completeKlingMcpAuthorization).mockRejectedValueOnce(new Error('boom code-route-secret at-route-secret'))
    const response = await call('?code=code-route-secret&state=state-route-secret')
    expect(location(response).searchParams.get('result')).toBe('exchange_failed')

    expectNoSecrets(JSON.stringify(consoleError.mock.calls))
  })
})

describe('POST /api/provider-connections/[id]/check', () => {
  const call = async (id: string) => {
    const { POST } = await import('@/app/api/provider-connections/[id]/check/route')
    return POST(new NextRequest(`https://content.example.test/api/provider-connections/${id}/check`, { method: 'POST' }), {
      params: Promise.resolve({ id }),
    })
  }

  it('rejects an unauthenticated user', async () => {
    signedIn(null)
    expect((await call('conn-1')).status).toBe(401)
    expect(checkModule.checkKlingMcpConnection).not.toHaveBeenCalled()
  })

  it('checks the connection for the SESSION user and returns safe metadata plus a live credit read', async () => {
    signedIn('user-a')
    serviceDb(createFakeDb())
    vi.mocked(checkModule.checkKlingMcpConnection).mockResolvedValue({
      ok: true,
      connection: { id: 'conn-1', provider: 'kling', connectionMethod: 'mcp_oauth', status: 'connected', scopes: ['generation.read'], generationAuthorized: false, accountHint: '4242', capabilities: {}, lastCheckedAt: null, lastErrorCode: null },
      credits: { available: 100 },
    })

    const response = await call('conn-1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(checkModule.checkKlingMcpConnection).toHaveBeenCalledWith(expect.anything(), { connectionId: 'conn-1', userId: 'user-a' })
    expect(Object.keys(body).sort()).toEqual(['connection', 'credits'])
    expectNoSecrets(body)
    expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|ciphertext/)
  })

  it('returns 404 for a foreign or unknown connection', async () => {
    signedIn('user-b')
    serviceDb(createFakeDb())
    vi.mocked(checkModule.checkKlingMcpConnection).mockResolvedValue({ ok: false, notFound: true })
    expect((await call('conn-1')).status).toBe(404)
  })

    it.each([
      ['PROVIDER_AUTHORIZATION_REQUIRED', 409, 'authorization_required'],
      ['PROVIDER_CLIENT_REJECTED', 409, 'error'],
      ['PROVIDER_SCOPE_INSUFFICIENT', 403, 'error'],
      ['PROVIDER_UNAVAILABLE', 502, undefined],
      ['CONNECTION_STORE_UNAVAILABLE', 503, undefined],
      ['CONNECTION_ENCRYPTION_NOT_CONFIGURED', 503, undefined],
    ] as const)('maps %s to HTTP %i with a controlled body and connectionStatus=%s', async (code, status, connectionStatus) => {
      signedIn('user-a')
      serviceDb(createFakeDb())
      vi.mocked(checkModule.checkKlingMcpConnection).mockResolvedValue({ 
        ok: false, 
        code, 
        ...(connectionStatus ? { connectionStatus } : {}) 
      })

      const response = await call('conn-1')
      const body = await response.json()

      expect(response.status).toBe(status)
      expect(body.code).toBe(code)
      if (connectionStatus) {
        expect(body.connectionStatus).toBe(connectionStatus)
      } else {
        expect(body).not.toHaveProperty('connectionStatus')
      }
    })
})

describe('DELETE /api/provider-connections/[id]', () => {
  const call = async (id: string) => {
    const { DELETE } = await import('@/app/api/provider-connections/[id]/route')
    return DELETE(new NextRequest(`https://content.example.test/api/provider-connections/${id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    })
  }

  const seed = () =>
    createFakeDb({
      seed: {
        provider_connections: [
          { id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected' },
          { id: 'conn-2', user_id: 'user-b', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected' },
        ],
        provider_connection_secrets: [
          { connection_id: 'conn-1', ciphertext: 'v1.k1.a.b.c' },
          { connection_id: 'conn-2', ciphertext: 'v1.k1.d.e.f' },
        ],
        user_settings: [{ user_id: 'user-a', kling_api_key: 'REST-API-KEY-MUST-SURVIVE', openai_api_key: 'sk-must-survive' }],
        video_generations: [{ id: 'gen-1', user_id: 'user-a', provider: 'kling', status: 'succeeded', storage_path: 'a/b.mp4' }],
      },
    })

  it('rejects an unauthenticated user', async () => {
    signedIn(null)
    expect((await call('conn-1')).status).toBe(401)
  })

  it('returns 404 for another user’s connection and deletes nothing', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)

    const response = await call('conn-2')
    expect(response.status).toBe(404)
    expect(oauthModule.revokeKlingMcpGrant).not.toHaveBeenCalled()
    expect(db.tables.provider_connections).toHaveLength(2)
    expect(db.tables.provider_connection_secrets).toHaveLength(2)
  })

  it('revokes at the provider, then removes the token material and the connection', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)
    vi.mocked(oauthModule.revokeKlingMcpGrant).mockResolvedValue('succeeded')

    const response = await call('conn-1')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ disconnected: true, revocation: 'succeeded' })
    expect(oauthModule.revokeKlingMcpGrant).toHaveBeenCalledTimes(1)
    expect(db.tables.provider_connections.map((row) => row.id)).toEqual(['conn-2'])
    expect(db.tables.provider_connection_secrets.map((row) => row.connection_id)).toEqual(['conn-2'])
  })

  it('still removes local credentials when provider revocation fails', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)
    vi.mocked(oauthModule.revokeKlingMcpGrant).mockResolvedValue('failed')

    const response = await call('conn-1')
    expect((await response.json()).revocation).toBe('failed')
    expect(db.tables.provider_connection_secrets.map((row) => row.connection_id)).toEqual(['conn-2'])
  })

  it('does NOT touch the Kling REST API key, other provider keys, or historical VideoGenerations', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)
    vi.mocked(oauthModule.revokeKlingMcpGrant).mockResolvedValue('succeeded')
    const before = JSON.stringify({ settings: db.tables.user_settings, generations: db.tables.video_generations })

    await call('conn-1')

    expect(JSON.stringify({ settings: db.tables.user_settings, generations: db.tables.video_generations })).toBe(before)
    expect(db.tables.user_settings[0].kling_api_key).toBe('REST-API-KEY-MUST-SURVIVE')
    // The active-generation guard READS video_generations; nothing is ever written to it or to user_settings.
    expect(
      db.log.filter((entry) => /^(insert|upsert|update|delete):(user_settings|video_generations)$/.test(entry)),
    ).toEqual([])
    expect(db.log.filter((entry) => entry.endsWith(':user_settings'))).toEqual([])
  })

  it.each(['queued', 'submitted', 'processing'])(
    'REFUSES to disconnect (409) while a %s generation depends on the connection, keeping the grant needed to retrieve the paid result',
    async (status) => {
      const db = seed()
      db.tables.video_generations.push({ id: 'gen-active', user_id: 'user-a', connection_id: 'conn-1', transport: 'mcp', status })
      signedIn('user-a')
      serviceDb(db)

      const response = await call('conn-1')
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.code).toBe('CONNECTION_HAS_ACTIVE_GENERATIONS')
      expect(oauthModule.revokeKlingMcpGrant).not.toHaveBeenCalled()
      expect(db.tables.provider_connections).toHaveLength(2)
      expect(db.tables.provider_connection_secrets).toHaveLength(2)
    },
  )

  it('does not let finished generations (or another connection’s active ones) block a disconnect', async () => {
    const db = seed()
    db.tables.video_generations.push(
      { id: 'gen-done', user_id: 'user-a', connection_id: 'conn-1', transport: 'mcp', status: 'succeeded' },
      { id: 'gen-failed', user_id: 'user-a', connection_id: 'conn-1', transport: 'mcp', status: 'failed' },
      { id: 'gen-other', user_id: 'user-b', connection_id: 'conn-2', transport: 'mcp', status: 'processing' },
    )
    signedIn('user-a')
    serviceDb(db)
    vi.mocked(oauthModule.revokeKlingMcpGrant).mockResolvedValue('succeeded')

    const response = await call('conn-1')

    expect(response.status).toBe(200)
    expect(db.tables.provider_connections.map((row) => row.id)).toEqual(['conn-2'])
    // History is untouched by the disconnect (the FK only ever nulls connection_id in the real database).
    expect(db.tables.video_generations).toHaveLength(4)
  })

  it('fails closed (503) when the active-generation check itself fails, deleting nothing', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)
    const originalFrom = db.from
    db.from = vi.fn((table: string) => {
      if (table === 'video_generations') {
        const chain: any = { select: () => chain, eq: () => chain, in: () => chain, limit: () => chain, then: (resolve: any) => resolve({ data: null, error: { message: 'boom' } }) }
        return chain
      }
      return originalFrom.call(db, table)
    }) as any

    const response = await call('conn-1')

    expect(response.status).toBe(503)
    expect(oauthModule.revokeKlingMcpGrant).not.toHaveBeenCalled()
    expect(db.tables.provider_connections).toHaveLength(2)
  })

  it('returns 500 when DB deletion throws, without claiming disconnection', async () => {
    const db = seed()
    signedIn('user-a')
    serviceDb(db)
    vi.mocked(oauthModule.revokeKlingMcpGrant).mockResolvedValue('succeeded')

    const originalFrom = db.from;
    db.from = vi.fn((table: string) => {
      if (table === 'provider_connections') {
        const chain = {
          delete: () => chain,
          eq: () => chain,
          then: (resolve: any) => resolve({ error: new Error('DB error') }) // Fake resolution
        };
        return chain as any;
      }
      return originalFrom.call(db, table)
    })

    const response = await call('conn-1')
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('disconnected') // body doesn't claim disconnected
  })
})

describe('GET /api/provider-connections', () => {
  const call = async () => {
    const { GET } = await import('@/app/api/provider-connections/route')
    return GET()
  }

  const seed = () =>
    createFakeDb({
      seed: {
        provider_connections: [
          { id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', scopes: ['generation.read'], external_account_id: '77778888', capabilities: { tools: ['who_am_i'] }, last_checked_at: null, last_error_code: null, created_at: '2026-01-01' },
          { id: 'conn-2', user_id: 'user-b', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', scopes: [], external_account_id: '11112222', capabilities: {}, last_checked_at: null, last_error_code: null, created_at: '2026-01-02' },
        ],
      },
    })

  it('rejects an unauthenticated user', async () => {
    signedIn(null)
    expect((await call()).status).toBe(401)
  })

  it('returns only the caller’s connections in the safe public shape', async () => {
    const db = seed()
    signedIn('user-a', db)

    const body = await (await call()).json()

    expect(body.connections).toHaveLength(1)
    expect(body.connections[0]).toMatchObject({ id: 'conn-1', provider: 'kling', connectionMethod: 'mcp_oauth', status: 'connected', accountHint: '8888' })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('conn-2')
    expect(serialized).not.toContain('11112222')
    expect(serialized).not.toContain('77778888') // only the 4-char hint leaves the server
    expect(serialized).not.toMatch(/ciphertext|access_token|refresh_token|external_account_id/)
  })

  it('reports whether connections can work in this environment', async () => {
    const db = seed()
    signedIn('user-a', db)
    expect((await (await call()).json()).connectionsAvailable).toBe(true)

    delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY
    signedIn('user-a', db)
    expect((await (await call()).json()).connectionsAvailable).toBe(false)
  })

  it('returns 500 when DB lookup fails', async () => {
    const db = seed()
    const originalFrom = db.from;
    db.from = vi.fn((table: string) => {
      if (table === 'provider_connections') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          then: (resolve: any) => resolve({ error: new Error('DB outage') })
        };
        return chain as any;
      }
      return originalFrom.call(db, table)
    })
    signedIn('user-a', db)

    const response = await call()
    expect(response.status).toBe(500)
  })
})
