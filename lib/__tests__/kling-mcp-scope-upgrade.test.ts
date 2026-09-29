import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client'
import {
  completeKlingMcpAuthorization,
  startKlingMcpAuthorization,
  type KlingOAuthDependencies,
} from '@/lib/provider-connections/kling-mcp-oauth'
import { registrationCoversScope } from '@/lib/provider-connections/oauth-client-registry'
import {
  KLING_MCP_GENERATION_SCOPE_STRING,
  KLING_MCP_READ_ONLY_SCOPES,
  KLING_MCP_SCOPE_STRING,
  KLING_MCP_URL,
  scopeStringForIntent,
} from '@/lib/provider-connections/kling-mcp'
import { readTokensForRevocation, saveConnectionTokens } from '@/lib/provider-connections/token-store'
import { toPublicConnection, type ProviderConnectionRow } from '@/lib/provider-connections/types'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const METADATA = {
  issuer: ISSUER,
  authorization_endpoint: 'https://kling.ai/auth/authorize',
  token_endpoint: 'https://kling.ai/auth/token',
  registration_endpoint: 'https://kling.ai/auth/register',
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
}

const READ_ONLY_TOKENS = { access_token: 'at-old', refresh_token: 'rt-old', token_type: 'Bearer', expires_in: 3600, scope: KLING_MCP_SCOPE_STRING }
const UPGRADED_TOKENS = { access_token: 'at-new', refresh_token: 'rt-new', token_type: 'Bearer', expires_in: 3600, scope: KLING_MCP_GENERATION_SCOPE_STRING }

function makeDeps(options: { tokens?: Record<string, unknown>; exchangeError?: Error; clientIds?: string[] } = {}) {
  const clientIds = [...(options.clientIds ?? ['client-1', 'client-2', 'client-3'])]
  const discover = vi.fn(async () => ({ authorizationServerUrl: new URL(ISSUER), authorizationServerMetadata: METADATA, resourceMetadata: { resource: KLING_MCP_URL } }))
  const register = vi.fn(async (_issuer: unknown, opts: { clientMetadata: Record<string, unknown> }) => ({ client_id: clientIds.shift() ?? 'client-x', ...opts.clientMetadata }))
  const exchange = vi.fn(async () => {
    if (options.exchangeError) throw options.exchangeError
    return { ...(options.tokens ?? UPGRADED_TOKENS) }
  })
  return { discover, register, exchange, deps: { discover, register, exchange } as unknown as KlingOAuthDependencies }
}

const requestedScopes = (authorizationUrl: string) => (new URL(authorizationUrl).searchParams.get('scope') ?? '').split(' ').sort()

beforeEach(useTestConnectionEnv)
afterEach(clearTestConnectionEnv)

describe('scope intent', () => {
  it('read_only (the default) never asks for the generation permission', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a' }, deps)
    expect(requestedScopes(authorizationUrl)).toEqual([...KLING_MCP_READ_ONLY_SCOPES].sort())
    expect(scopeStringForIntent('read_only')).toBe(KLING_MCP_SCOPE_STRING)
  })

  it('the explicit generation intent adds generation.create to the read-only scopes (and only that)', async () => {
    const db = createFakeDb()
    const { deps } = makeDeps()
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, deps)
    expect(requestedScopes(authorizationUrl)).toEqual(['account.credit.read', 'generation.create', 'generation.read'])
    expect(db.tables.provider_oauth_authorizations[0].scope).toBe(KLING_MCP_GENERATION_SCOPE_STRING)
  })
})

describe('OAuth client registration vs. requested scope', () => {
  it('registrationCoversScope requires every requested scope to have been registered', () => {
    expect(registrationCoversScope(KLING_MCP_GENERATION_SCOPE_STRING, KLING_MCP_SCOPE_STRING)).toBe(true)
    expect(registrationCoversScope(KLING_MCP_SCOPE_STRING, KLING_MCP_GENERATION_SCOPE_STRING)).toBe(false)
    expect(registrationCoversScope(KLING_MCP_SCOPE_STRING, KLING_MCP_SCOPE_STRING)).toBe(true)
    expect(registrationCoversScope(null, KLING_MCP_SCOPE_STRING)).toBe(false)
  })

  it('a client registered read-only is replaced by a broader registration for the explicit generation request', async () => {
    const db = createFakeDb()
    const { deps, register } = makeDeps()
    await startKlingMcpAuthorization(db as any, { userId: 'user-a' }, deps)
    expect(db.tables.provider_oauth_clients).toHaveLength(1)
    expect(db.tables.provider_oauth_clients[0]).toMatchObject({ client_id: 'client-1', registered_scope: KLING_MCP_SCOPE_STRING })

    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, deps)

    expect(register).toHaveBeenCalledTimes(2)
    expect((register.mock.calls[1] as unknown as [unknown, { scope: string }])[1].scope).toBe(KLING_MCP_GENERATION_SCOPE_STRING)
    expect(new URL(authorizationUrl).searchParams.get('client_id')).toBe('client-2')
    expect(db.tables.provider_oauth_clients).toHaveLength(1)
    expect(db.tables.provider_oauth_clients[0]).toMatchObject({ client_id: 'client-2', registered_scope: KLING_MCP_GENERATION_SCOPE_STRING })
  })

  it('a client that already covers generation is reused for both intents (no needless re-registration)', async () => {
    const db = createFakeDb()
    const { deps, register } = makeDeps()
    await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, deps)
    await startKlingMcpAuthorization(db as any, { userId: 'user-a' }, deps)
    await startKlingMcpAuthorization(db as any, { userId: 'user-b', intent: 'generation' }, deps)
    expect(register).toHaveBeenCalledTimes(1)
  })
})

describe('re-authorization reuses the existing connection and preserves connection truth', () => {
  async function connectedReadOnly() {
    const db = createFakeDb()
    const first = makeDeps({ tokens: READ_ONLY_TOKENS, clientIds: ['client-1', 'client-2'] })
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a' }, first.deps)
    const state = new URL(authorizationUrl).searchParams.get('state')!
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c1' }, first.deps)
    expect(result.ok).toBe(true)
    return { db, first }
  }

  it('upgrades in place: ONE connection row (same id), new scopes, newer secret version, new grant client', async () => {
    const { db } = await connectedReadOnly()
    const before = { ...db.tables.provider_connections[0] }
    const beforeSecret = { ...db.tables.provider_connection_secrets[0] }
    expect(toPublicConnection(before as ProviderConnectionRow).generationAuthorized).toBe(false)

    const second = makeDeps({ tokens: UPGRADED_TOKENS, clientIds: ['client-2'] })
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, second.deps)
    const state = new URL(authorizationUrl).searchParams.get('state')!
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c2' }, second.deps)

    expect(result.ok).toBe(true)
    expect(db.tables.provider_connections).toHaveLength(1)
    const after = db.tables.provider_connections[0]
    expect(after.id).toBe(before.id)
    expect(after.scopes.sort()).toEqual(['account.credit.read', 'generation.create', 'generation.read'])
    expect(after.status).toBe('connected')
    expect(toPublicConnection(after as ProviderConnectionRow).generationAuthorized).toBe(true)
    // Metadata derived from the previous grant is cleared until the next deliberate check.
    expect(after).toMatchObject({ external_account_id: null, capabilities: {}, last_checked_at: null })

    // Secrets: same row, strictly newer version (CAS safety preserved), the NEW grant's client identity.
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
    expect(db.tables.provider_connection_secrets[0].secret_version).toBeGreaterThan(beforeSecret.secret_version)
    const tokens = await readTokensForRevocation(db as any, before.id)
    expect(tokens).toMatchObject({ access_token: 'at-new', refresh_token: 'rt-new', client_id: 'client-2', issuer: ISSUER })
    expect(JSON.stringify(db.tables.provider_connections)).not.toMatch(/at-new|rt-new|at-old|rt-old/)
  })

  it('if the provider grants FEWER scopes than requested, the connection truthfully stays read-only', async () => {
    const { db } = await connectedReadOnly()
    const second = makeDeps({ tokens: READ_ONLY_TOKENS, clientIds: ['client-2'] })
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, second.deps)
    const state = new URL(authorizationUrl).searchParams.get('state')!
    await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'c2' }, second.deps)

    expect(toPublicConnection(db.tables.provider_connections[0] as ProviderConnectionRow).generationAuthorized).toBe(false)
  })

  it('a failed upgrade (declined/invalid exchange) leaves the existing read-only connection and tokens exactly as they were', async () => {
    const { db } = await connectedReadOnly()
    const connectionBefore = JSON.stringify(db.tables.provider_connections)
    const secretsBefore = JSON.stringify(db.tables.provider_connection_secrets)

    const failing = makeDeps({ exchangeError: new OAuthError(OAuthErrorCode.InvalidGrant, 'bad code'), clientIds: ['client-2'] })
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-a', intent: 'generation' }, failing.deps)
    const state = new URL(authorizationUrl).searchParams.get('state')!
    const result = await completeKlingMcpAuthorization(db as any, { userId: 'user-a', state, code: 'bad' }, failing.deps)

    expect(result).toEqual({ ok: false, failure: 'exchange_failed' })
    expect(JSON.stringify(db.tables.provider_connections)).toBe(connectionBefore)
    expect(JSON.stringify(db.tables.provider_connection_secrets)).toBe(secretsBefore)
  })

  it('another user’s upgrade never touches this user’s connection (one connection per user)', async () => {
    const { db } = await connectedReadOnly()
    const other = makeDeps({ tokens: UPGRADED_TOKENS, clientIds: ['client-2'] })
    const { authorizationUrl } = await startKlingMcpAuthorization(db as any, { userId: 'user-b', intent: 'generation' }, other.deps)
    const state = new URL(authorizationUrl).searchParams.get('state')!
    await completeKlingMcpAuthorization(db as any, { userId: 'user-b', state, code: 'c' }, other.deps)

    expect(db.tables.provider_connections).toHaveLength(2)
    const a = db.tables.provider_connections.find((row: any) => row.user_id === 'user-a')
    expect(a!.scopes.sort()).toEqual(['account.credit.read', 'generation.read'])
  })

  it('saveConnectionTokens stays monotonic across the upgrade (older concurrent writes cannot win)', async () => {
    const { db } = await connectedReadOnly()
    const connectionId = db.tables.provider_connections[0].id
    const v1 = db.tables.provider_connection_secrets[0].secret_version
    await saveConnectionTokens(db as any, connectionId, UPGRADED_TOKENS as any, { clientId: 'client-2', issuer: ISSUER })
    expect(db.tables.provider_connection_secrets[0].secret_version).toBe(v1 + 1)
  })
})
