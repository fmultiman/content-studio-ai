import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client'
import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  deleteConnectionTokens,
  forceRefreshAccessToken,
  getValidAccessToken,
  readTokensForRevocation,
  saveConnectionTokens,
  type TokenRefreshDependencies,
} from '@/lib/provider-connections/token-store'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { KLING_MCP_URL } from '@/lib/provider-connections/kling-mcp'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const REDIRECT_URI = 'https://content.example.test/api/provider-connections/kling/mcp/callback'
const NOW = new Date('2026-09-29T12:00:00Z')

const INITIAL = {
  access_token: 'at-initial-secret-0001',
  refresh_token: 'rt-initial-secret-0001',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'generation.read account.credit.read',
}

function seedDb() {
  const db = createFakeDb({
    seed: {
      provider_connections: [
        { id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', scopes: [] },
      ],
      provider_oauth_clients: [
        { id: 'client-row', provider: 'kling', issuer: ISSUER, redirect_uri: REDIRECT_URI, client_id: 'client-content-studio-1', registration_response_fields: [] },
      ],
    },
  })
  return db
}

function makeDeps(refresh: (...args: unknown[]) => unknown, now: Date = NOW): TokenRefreshDependencies {
  return {
    now: () => now,
    discover: vi.fn(async () => ({
      authorizationServerUrl: new URL(ISSUER),
      authorizationServerMetadata: { issuer: ISSUER },
      resourceMetadata: {},
    })) as never,
    refresh: refresh as never,
  }
}

const later = (ms: number) => new Date(NOW.getTime() + ms)

describe('connection token storage', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('persists tokens as ciphertext only, with a clear (non-secret) expiry', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)

    const [row] = db.tables.provider_connection_secrets
    expect(JSON.stringify(row)).not.toContain(INITIAL.access_token)
    expect(JSON.stringify(row)).not.toContain(INITIAL.refresh_token)
    expect(row.ciphertext.startsWith('v1.')).toBe(true)
    expect(row.access_token_expires_at).toBe(later(3600_000).toISOString())
    expect(row.secret_version).toBe(1)
  })

  it('binds each secret to its connection: a ciphertext copied to another connection is unreadable', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    db.tables.provider_connection_secrets.push({ ...db.tables.provider_connection_secrets[0], connection_id: 'conn-other' })

    await expect(getValidAccessToken(db as any, 'conn-other', makeDeps(vi.fn(), NOW))).rejects.toThrow()
  })

  it('deleting a connection’s tokens removes all secret material', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    await deleteConnectionTokens(db as any, 'conn-1')
    expect(db.tables.provider_connection_secrets).toHaveLength(0)
    expect(await readTokensForRevocation(db as any, 'conn-1')).toBeNull()
  })
})

describe('access-token refresh', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(() => {
    clearTestConnectionEnv()
    vi.restoreAllMocks()
  })

  it('returns a fresh access token without refreshing', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn()

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(60_000)))
    expect(token).toBe(INITIAL.access_token)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes an expired access token using the stored refresh token, server-side', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => ({
      access_token: 'at-refreshed-0002',
      refresh_token: 'rt-rotated-0002',
      token_type: 'Bearer',
      expires_in: 3600,
    }))

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))

    expect(token).toBe('at-refreshed-0002')
    expect(refresh).toHaveBeenCalledTimes(1)
    const [, options] = refresh.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    expect(options.refreshToken).toBe(INITIAL.refresh_token)
    expect(options.clientInformation).toEqual({ client_id: 'client-content-studio-1' })
    expect(options.resource).toBe(KLING_MCP_URL)
  })

  it('refreshes when the token is inside the expiry skew window', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-near-expiry', token_type: 'Bearer', expires_in: 3600 }))

    const almostExpired = later(3600_000 - ACCESS_TOKEN_REFRESH_SKEW_MS + 1000)
    expect(await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, almostExpired))).toBe('at-near-expiry')
  })

  it('persists a ROTATED refresh token securely and bumps the secret version', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => ({
      access_token: 'at-refreshed-0002',
      refresh_token: 'rt-rotated-0002',
      token_type: 'Bearer',
      expires_in: 1800,
    }))
    const refreshedAt = later(2 * 3600_000)
    await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, refreshedAt))

    const [row] = db.tables.provider_connection_secrets
    expect(row.secret_version).toBe(2)
    expect(JSON.stringify(row)).not.toContain('rt-rotated-0002')
    expect(JSON.stringify(row)).not.toContain('at-refreshed-0002')
    expect(row.access_token_expires_at).toBe(new Date(refreshedAt.getTime() + 1800_000).toISOString())

    const stored = await readTokensForRevocation(db as any, 'conn-1')
    expect(stored?.refresh_token).toBe('rt-rotated-0002')
    expect(stored?.access_token).toBe('at-refreshed-0002')
  })

  it('keeps the existing refresh token when the provider does not rotate it', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-refreshed-0003', token_type: 'Bearer', expires_in: 3600 }))
    await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))

    const stored = await readTokensForRevocation(db as any, 'conn-1')
    expect(stored?.refresh_token).toBe(INITIAL.refresh_token)
    expect(stored?.access_token).toBe('at-refreshed-0003')
  })

  it.each([OAuthErrorCode.InvalidGrant, OAuthErrorCode.InvalidClient, OAuthErrorCode.UnauthorizedClient])(
    'a revoked/invalid grant (%s) maps to PROVIDER_AUTHORIZATION_REQUIRED and clears the dead secrets',
    async (code) => {
      const db = seedDb()
      await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
      const refresh = vi.fn(async () => {
        throw new OAuthError(code, 'token revoked')
      })

      await expect(getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))).rejects.toBeInstanceOf(
        ProviderAuthorizationRequiredError,
      )

      expect(db.tables.provider_connections[0]).toMatchObject({
        status: 'authorization_required',
        last_error_code: 'PROVIDER_AUTHORIZATION_REQUIRED',
      })
      expect(db.tables.provider_connection_secrets).toHaveLength(0)
    },
  )

  it('a transient failure is PROVIDER_UNAVAILABLE and does NOT touch status or secrets', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000))).catch((e) => e)
    expect(error).toBeInstanceOf(ProviderConnectionError)
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(db.tables.provider_connections[0].status).toBe('connected')
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
  })

  it('requires re-authorization when there is no refresh token to use', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-only', token_type: 'Bearer', expires_in: 60 }, NOW)

    await expect(getValidAccessToken(db as any, 'conn-1', makeDeps(vi.fn(), later(3600_000)))).rejects.toBeInstanceOf(
      ProviderAuthorizationRequiredError,
    )
    expect(db.tables.provider_connections[0].status).toBe('authorization_required')
  })

  it('requires re-authorization when the connection has no secrets at all', async () => {
    const db = seedDb()
    await expect(getValidAccessToken(db as any, 'conn-1', makeDeps(vi.fn(), NOW))).rejects.toBeInstanceOf(
      ProviderAuthorizationRequiredError,
    )
  })

  it('requires re-authorization when Content Studio’s client registration is missing', async () => {
    const db = createFakeDb({ seed: { provider_connections: [{ id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected' }] } })
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)

    await expect(getValidAccessToken(db as any, 'conn-1', makeDeps(vi.fn(), later(2 * 3600_000)))).rejects.toBeInstanceOf(
      ProviderAuthorizationRequiredError,
    )
  })

  it('concurrent refresh: the loser of the compare-and-swap uses the winner’s newer token and never overwrites it', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)

    // While our refresh is "in flight", another invocation stores a newer token set.
    const refresh = vi.fn(async () => {
      await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-winner', refresh_token: 'rt-winner', token_type: 'Bearer', expires_in: 3600 }, NOW)
      db.tables.provider_connection_secrets[0].secret_version = 2
      return { access_token: 'at-loser', refresh_token: 'rt-loser', token_type: 'Bearer', expires_in: 3600 }
    })

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))
    expect(token).toBe('at-winner')
    const stored = await readTokensForRevocation(db as any, 'conn-1')
    expect(stored?.refresh_token).toBe('rt-winner')
  })

  it('if a refresh is rejected because another invocation already rotated the token, the newer stored token is used', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)

    const refresh = vi.fn(async () => {
      await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-rotated-elsewhere', refresh_token: 'rt-rotated-elsewhere', token_type: 'Bearer', expires_in: 3600 }, NOW)
      db.tables.provider_connection_secrets[0].secret_version = 2
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'already used')
    })

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))
    expect(token).toBe('at-rotated-elsewhere')
    expect(db.tables.provider_connections[0].status).toBe('connected')
  })

  it('forceRefreshAccessToken refreshes even when the recorded expiry has not passed', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-forced', token_type: 'Bearer', expires_in: 3600 }))

    expect(await forceRefreshAccessToken(db as any, 'conn-1', makeDeps(refresh, later(1000)))).toBe('at-forced')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('never logs a token, and thrown errors carry no token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, NOW)

    const failing = vi.fn(async () => {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, `revoked ${INITIAL.refresh_token}`)
    })
    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(failing, later(2 * 3600_000))).catch((e) => e)

    const everything = JSON.stringify(spies.flatMap((spy) => spy.mock.calls)) + String(error.message) + String(error.stack)
    expect(everything).not.toContain(INITIAL.access_token)
    expect(everything).not.toContain(INITIAL.refresh_token)
  })
})
