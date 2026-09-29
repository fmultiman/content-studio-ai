import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeKlingMcpAuthorization,
  startKlingMcpAuthorization,
  type KlingOAuthDependencies,
} from '@/lib/provider-connections/kling-mcp-oauth'
import { consumeAuthorizationAttempt, hashOAuthState } from '@/lib/provider-connections/oauth-state'
import { readTokensForRevocation } from '@/lib/provider-connections/token-store'
import {
  KLING_MCP_READ_ONLY_SCOPES,
  KLING_MCP_SCOPE_STRING,
  KLING_MCP_URL,
  klingMcpRedirectUri,
} from '@/lib/provider-connections/kling-mcp'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const REDIRECT_URI = 'https://content.example.test/api/provider-connections/kling/mcp/callback'

const METADATA = {
  issuer: ISSUER,
  authorization_endpoint: 'https://kling.ai/auth/authorize',
  token_endpoint: 'https://kling.ai/auth/token',
  registration_endpoint: 'https://kling.ai/auth/register',
  revocation_endpoint: 'https://kling.ai/auth/revoke',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['generation.create', 'generation.read', 'account.credit.read'],
}

const TOKENS = {
  access_token: 'at-secret-access-token-1',
  refresh_token: 'rt-secret-refresh-token-1',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'generation.read account.credit.read',
}

function makeDeps(overrides: Partial<KlingOAuthDependencies> = {}) {
  const discover = vi.fn(async () => ({
    authorizationServerUrl: new URL(ISSUER),
    authorizationServerMetadata: METADATA,
    resourceMetadata: { resource: KLING_MCP_URL },
  }))
  const register = vi.fn(async (_issuer: unknown, options: { clientMetadata: Record<string, unknown> }) => ({
    client_id: 'client-content-studio-1',
    ...options.clientMetadata,
  }))
  const exchange = vi.fn(async () => ({ ...TOKENS }))
  return { discover, register, exchange, deps: { discover, register, exchange, ...overrides } as unknown as KlingOAuthDependencies }
}

async function start(db: ReturnType<typeof createFakeDb>, deps: KlingOAuthDependencies, userId = 'user-a') {
  const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId }, deps)
  const url = new URL(authorizationUrl)
  return { url, state: url.searchParams.get('state') as string }
}

describe('Kling MCP OAuth — authorization start', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('builds the official authorization URL with PKCE S256, state, exact redirect URI and the resource', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { url } = await start(db, deps)

    expect(`${url.origin}${url.pathname}`).toBe('https://kling.ai/auth/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-content-studio-1')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('resource')).toBe(KLING_MCP_URL)
    expect(url.searchParams.get('code_challenge_method')).not.toBe('plain')
  })

  it('requests ONLY the read-only scopes — never generation.create', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { url } = await start(db, deps)

    const requested = (url.searchParams.get('scope') ?? '').split(' ')
    expect(requested.sort()).toEqual([...KLING_MCP_READ_ONLY_SCOPES].sort())
    expect(requested).not.toContain('generation.create')
    expect(KLING_MCP_SCOPE_STRING).toBe('generation.read account.credit.read')
  })

  it('keeps the PKCE verifier server-side: not in the URL, stored encrypted, and the URL challenge is its S256 hash', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { url, state } = await start(db, deps)

    const serverSide = await consumeAuthorizationAttempt(db as any, { state, userId: 'user-a' })
    expect(serverSide.ok).toBe(true)
    if (!serverSide.ok) return

    const verifier = serverSide.attempt.codeVerifier
    expect(url.toString()).not.toContain(verifier)
    const expectedChallenge = createHash('sha256').update(verifier).digest('base64url')
    expect(url.searchParams.get('code_challenge')).toBe(expectedChallenge)
  })

  it('binds the attempt to the initiating user and stores only the state hash', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { state } = await start(db, deps, 'user-a')

    const [row] = db.tables.provider_oauth_authorizations
    expect(row.user_id).toBe('user-a')
    expect(row.state_hash).toBe(hashOAuthState(state))
    expect(JSON.stringify(row)).not.toContain(state)
    expect(row.redirect_uri).toBe(REDIRECT_URI)
    expect(row.scope).toBe(KLING_MCP_SCOPE_STRING)
  })

  it('produces a different state and challenge for every attempt', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const first = await start(db, deps)
    const second = await start(db, deps)
    expect(first.state).not.toBe(second.state)
    expect(first.url.searchParams.get('code_challenge')).not.toBe(second.url.searchParams.get('code_challenge'))
  })

  it('derives the redirect URI from explicit configuration, not from a request', () => {
    expect(klingMcpRedirectUri()).toBe(REDIRECT_URI)
    process.env.NEXT_PUBLIC_APP_URL = 'http://insecure.example.test'
    expect(() => klingMcpRedirectUri()).toThrow()
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    expect(klingMcpRedirectUri()).toBe('http://localhost:3000/api/provider-connections/kling/mcp/callback')
  })
})

describe('Kling MCP OAuth — client registration (DCR)', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(() => {
    clearTestConnectionEnv()
    vi.unstubAllGlobals()
  })

  it('registers Content Studio once as a public web client and reuses it for every user', async () => {
    const db = createFakeDb()
    const { deps, register } = makeDeps()

    await start(db, deps, 'user-a')
    await start(db, deps, 'user-b')

    expect(register).toHaveBeenCalledTimes(1)
    const options = register.mock.calls[0][1] as { clientMetadata: Record<string, unknown>; scope: string }
    expect(options.clientMetadata).toMatchObject({
      client_name: 'Content Studio',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    })
    expect(options.scope).toBe(KLING_MCP_SCOPE_STRING)
    expect(db.tables.provider_oauth_clients).toHaveLength(1)
    expect(db.tables.provider_oauth_clients[0]).toMatchObject({
      provider: 'kling',
      issuer: ISSUER,
      redirect_uri: REDIRECT_URI,
      client_id: 'client-content-studio-1',
    })
  })

  it('records the NAMES of the provider response fields and encrypts any registration-management material', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            client_id: 'client-content-studio-1',
            registration_access_token: 'rat-secret-management-token',
            registration_client_uri: 'https://kling.ai/auth/register/client-content-studio-1',
            client_id_issued_at: 1,
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const db = createFakeDb()
    const register = vi.fn(async (_issuer: unknown, options: { fetchFn: (url: string) => Promise<Response>; clientMetadata: Record<string, unknown> }) => {
      await options.fetchFn('https://kling.ai/auth/register')
      return { client_id: 'client-content-studio-1', ...options.clientMetadata }
    })
    const { deps } = makeDeps({ register: register as never })

    await start(db, deps)

    const [row] = db.tables.provider_oauth_clients
    expect(row.registration_response_fields).toEqual([
      'client_id',
      'client_id_issued_at',
      'registration_access_token',
      'registration_client_uri',
    ])
    expect(row.management_ciphertext.startsWith('v1.')).toBe(true)
    expect(JSON.stringify(row)).not.toContain('rat-secret-management-token')
  })

  it('stores no management ciphertext when the provider returns none', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    await start(db, deps)
    expect(db.tables.provider_oauth_clients[0].management_ciphertext).toBeNull()
  })
})

describe('Kling MCP OAuth — callback completion', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('exchanges the code server-side with the stored verifier, then persists an encrypted connection', async () => {
    const db = createFakeDb()
    const { deps, exchange } = makeDeps()
    const { url, state } = await start(db, deps)
    const verifierHash = url.searchParams.get('code_challenge')

    const result = await completeKlingMcpAuthorization(
      db as any,
      { userId: 'user-a', state, code: 'authorization-code-123', iss: ISSUER },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(exchange).toHaveBeenCalledTimes(1)
    const args = (exchange.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(args.authorizationCode).toBe('authorization-code-123')
    expect(args.redirectUri).toBe(REDIRECT_URI)
    expect(args.resource).toBe(KLING_MCP_URL)
    expect(args.iss).toBe(ISSUER)
    expect(args.clientInformation).toEqual({ client_id: 'client-content-studio-1' })
    // The verifier used is the server-held one whose S256 hash was sent to Kling.
    expect(createHash('sha256').update(args.codeVerifier as string).digest('base64url')).toBe(verifierHash)
  })

  it('stores the connection as connected with granted scopes, and NO token in provider_connections', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { state } = await start(db, deps)
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)

    expect(result.ok).toBe(true)
    const [connection] = db.tables.provider_connections
    expect(connection).toMatchObject({
      user_id: 'user-a',
      provider: 'kling',
      connection_method: 'mcp_oauth',
      status: 'connected',
      scopes: ['generation.read', 'account.credit.read'],
    })

    const serialized = JSON.stringify(db.tables.provider_connections)
    expect(serialized).not.toContain(TOKENS.access_token)
    expect(serialized).not.toContain(TOKENS.refresh_token)
    expect(serialized).not.toMatch(/access_token|refresh_token/)
  })

  it('stores tokens only as ciphertext, and they decrypt server-side', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { state } = await start(db, deps)
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)
    if (!result.ok) throw new Error('expected success')

    const [secret] = db.tables.provider_connection_secrets
    expect(secret.connection_id).toBe(result.connection.id)
    expect(secret.ciphertext).not.toContain(TOKENS.access_token)
    expect(secret.ciphertext).not.toContain(TOKENS.refresh_token)
    expect(JSON.stringify(secret)).not.toContain(TOKENS.refresh_token)
    expect(secret.access_token_expires_at).toBeTruthy()

    const decrypted = await readTokensForRevocation(db as any, result.connection.id)
    expect(decrypted?.refresh_token).toBe(TOKENS.refresh_token)
  })

  it('returns no token to the caller', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { state } = await start(db, deps)
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(TOKENS.access_token)
    expect(serialized).not.toContain(TOKENS.refresh_token)
  })

  it('reconnecting reuses the user’s single connection row', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()

    const first = await start(db, deps)
    await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state: first.state, code: 'c1' }, deps)
    const second = await start(db, deps)
    await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state: second.state, code: 'c2' }, deps)

    expect(db.tables.provider_connections).toHaveLength(1)
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
  })

  it('rejects an unknown state without calling the provider', async () => {
    const db = createFakeDb()
    const { deps, exchange } = makeDeps()
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state: 'not-a-real-state', code: 'c' }, deps)
    expect(result).toEqual({ ok: false, failure: 'invalid_state' })
    expect(exchange).not.toHaveBeenCalled()
  })

  it('rejects a replayed state — the code is exchanged at most once', async () => {
    const db = createFakeDb()
    const { deps, exchange } = makeDeps()
    const { state } = await start(db, deps)

    expect((await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)).ok).toBe(true)
    const replay = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)
    expect(replay).toEqual({ ok: false, failure: 'invalid_state' })
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired state', async () => {
    const db = createFakeDb()
    let clock = new Date('2026-09-29T10:00:00Z')
    const { deps, exchange } = makeDeps({ now: () => clock })
    const { state } = await start(db, deps)

    clock = new Date(clock.getTime() + 11 * 60 * 1000)
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)
    expect(result).toEqual({ ok: false, failure: 'expired_state' })
    expect(exchange).not.toHaveBeenCalled()
    expect(db.tables.provider_connections ?? []).toHaveLength(0)
  })

  it('rejects a state initiated by another user (wrong-user callback) and stores nothing', async () => {
    const db = createFakeDb()
    const { deps, exchange } = makeDeps()
    const { state } = await start(db, deps, 'user-a')

    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-b', state, code: 'c' }, deps)
    expect(result).toEqual({ ok: false, failure: 'state_mismatch' })
    expect(exchange).not.toHaveBeenCalled()
    expect(db.tables.provider_connections ?? []).toHaveLength(0)
    expect(db.tables.provider_connection_secrets ?? []).toHaveLength(0)
  })

  it('maps a failed code exchange to a controlled failure and stores nothing', async () => {
    const db = createFakeDb()
    const exchange = vi.fn(async () => {
      throw new Error('boom: raw provider detail that must not leak')
    })
    const { deps } = makeDeps({ exchange: exchange as never })
    const { state } = await start(db, deps)

    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, deps)
    expect(result).toEqual({ ok: false, failure: 'exchange_failed' })
    expect(JSON.stringify(result)).not.toContain('raw provider detail')
    expect(db.tables.provider_connections ?? []).toHaveLength(0)
  })

  it('rejects the exchange when the authorization server issuer changed since the attempt started', async () => {
    const db = createFakeDb()
    const { deps, exchange } = makeDeps()
    const { state } = await start(db, deps)

    const mixedUp = {
      ...deps,
      discover: vi.fn(async () => ({
        authorizationServerUrl: new URL('https://evil.example.test/auth'),
        authorizationServerMetadata: { ...METADATA, issuer: 'https://evil.example.test/auth' },
        resourceMetadata: {},
      })),
    } as unknown as KlingOAuthDependencies

    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c' }, mixedUp)
    expect(result).toEqual({ ok: false, failure: 'exchange_failed' })
    expect(exchange).not.toHaveBeenCalled()
  })
})
