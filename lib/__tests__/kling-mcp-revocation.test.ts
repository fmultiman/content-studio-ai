import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { revokeKlingMcpGrant, type KlingOAuthDependencies } from '@/lib/provider-connections/kling-mcp-oauth'
import { saveConnectionTokens } from '@/lib/provider-connections/token-store'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const REDIRECT_URI = 'https://content.example.test/api/provider-connections/kling/mcp/callback'
const TOKENS = { access_token: 'at-revoke-secret-1', refresh_token: 'rt-revoke-secret-1', token_type: 'Bearer', expires_in: 3600 }

function seed(withClient = true) {
  return createFakeDb({
    seed: {
      provider_connections: [{ id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected' }],
      provider_oauth_clients: withClient
        ? [{ id: 'c', provider: 'kling', issuer: ISSUER, redirect_uri: REDIRECT_URI, client_id: 'client-1', registration_response_fields: [] }]
        : [],
    },
  })
}

const discoverWith = (metadata: Record<string, unknown>) =>
  vi.fn(async () => ({ authorizationServerUrl: new URL(ISSUER), authorizationServerMetadata: metadata, resourceMetadata: {} })) as never

describe('Kling MCP grant revocation (RFC 7009)', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('revokes the refresh token and the access token at the provider’s revocation endpoint', async () => {
    const db = seed()
    await saveConnectionTokens(db as any, 'conn-1', TOKENS)
    const fetchFn = vi.fn(async (_url: unknown, _init?: unknown) => new Response('', { status: 200 }))

    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER, revocation_endpoint: 'https://kling.ai/auth/revoke' }),
      fetchFn: fetchFn as never,
    } as KlingOAuthDependencies)

    expect(outcome).toBe('succeeded')
    expect(fetchFn).toHaveBeenCalledTimes(2)

    const requests = fetchFn.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }))
    for (const { url, init } of requests) {
      expect(url).toBe('https://kling.ai/auth/revoke')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
      // Tokens travel in the POST body — never in the URL.
      expect(url).not.toContain('at-revoke-secret-1')
      expect(url).not.toContain('rt-revoke-secret-1')
    }

    const bodies = requests.map(({ init }) => new URLSearchParams(String(init.body)))
    expect(bodies.map((body) => body.get('token_type_hint'))).toEqual(['refresh_token', 'access_token'])
    expect(bodies[0].get('token')).toBe(TOKENS.refresh_token)
    expect(bodies[1].get('token')).toBe(TOKENS.access_token)
    expect(bodies.every((body) => body.get('client_id') === 'client-1')).toBe(true)
  })

  it('reports failure (without throwing) when the provider rejects the revocation', async () => {
    const db = seed()
    await saveConnectionTokens(db as any, 'conn-1', TOKENS)
    const fetchFn = vi.fn(async () => new Response('', { status: 500 }))

    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER, revocation_endpoint: 'https://kling.ai/auth/revoke' }),
      fetchFn: fetchFn as never,
    } as KlingOAuthDependencies)
    expect(outcome).toBe('failed')
  })

  it('reports failure (without throwing) on a network error', async () => {
    const db = seed()
    await saveConnectionTokens(db as any, 'conn-1', TOKENS)
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER, revocation_endpoint: 'https://kling.ai/auth/revoke' }),
      fetchFn: fetchFn as never,
    } as KlingOAuthDependencies)
    expect(outcome).toBe('failed')
  })

  it('skips (nothing to revoke) when there are no stored tokens', async () => {
    const db = seed()
    const fetchFn = vi.fn()
    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER, revocation_endpoint: 'https://kling.ai/auth/revoke' }),
      fetchFn: fetchFn as never,
    } as KlingOAuthDependencies)
    expect(outcome).toBe('skipped')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('skips when the authorization server advertises no revocation endpoint', async () => {
    const db = seed()
    await saveConnectionTokens(db as any, 'conn-1', TOKENS)
    const fetchFn = vi.fn()
    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER }),
      fetchFn: fetchFn as never,
    } as KlingOAuthDependencies)
    expect(outcome).toBe('skipped')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('never throws when the encryption key is unavailable (local cleanup still proceeds)', async () => {
    const db = seed()
    await saveConnectionTokens(db as any, 'conn-1', TOKENS)
    delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY

    const outcome = await revokeKlingMcpGrant(db as any, 'conn-1', {
      discover: discoverWith({ issuer: ISSUER, revocation_endpoint: 'https://kling.ai/auth/revoke' }),
      fetchFn: vi.fn() as never,
    } as KlingOAuthDependencies)
    expect(outcome).toBe('failed')
  })
})
