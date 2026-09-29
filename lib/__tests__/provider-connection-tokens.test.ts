import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/client'
import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  deleteConnectionTokens,
  forceRefreshAccessToken,
  getValidAccessToken,
  INVALID_GRANT_RECHECK_DELAYS_MS,
  readTokensForRevocation,
  saveConnectionTokens,
  type TokenRefreshDependencies,
} from '@/lib/provider-connections/token-store'
import { ProviderAuthorizationRequiredError, ProviderConnectionError } from '@/lib/provider-connections/types'
import { KLING_MCP_URL } from '@/lib/provider-connections/kling-mcp'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const ISSUER = 'https://kling.ai/auth'
const GRANT = { clientId: 'client-content-studio-1', issuer: ISSUER }
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
    // The invalid_grant re-check delays are real time in production; tests do not wait.
    sleep: async () => undefined,
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)

    const [row] = db.tables.provider_connection_secrets
    expect(JSON.stringify(row)).not.toContain(INITIAL.access_token)
    expect(JSON.stringify(row)).not.toContain(INITIAL.refresh_token)
    expect(row.ciphertext.startsWith('v1.')).toBe(true)
    expect(row.access_token_expires_at).toBe(later(3600_000).toISOString())
    expect(row.secret_version).toBe(1)
  })

  it('binds each secret to its connection: a ciphertext copied to another connection is unreadable', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    db.tables.provider_connection_secrets.push({ ...db.tables.provider_connection_secrets[0], connection_id: 'conn-other' })

    await expect(getValidAccessToken(db as any, 'conn-other', makeDeps(vi.fn(), NOW))).rejects.toThrow()
  })

  it('deleting a connection’s tokens removes all secret material', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    await deleteConnectionTokens(db as any, 'conn-1')
    expect(db.tables.provider_connection_secrets).toHaveLength(0)
    expect(await readTokensForRevocation(db as any, 'conn-1')).toBeNull()
  })

  it('deleteConnectionTokens throws CONNECTION_STORE_UNAVAILABLE on DB error', async () => {
    const db = seedDb()
    const originalFrom = db.from;
    db.from = vi.fn((table: string) => {
      if (table === 'provider_connection_secrets') {
        return {
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: new Error('DB error') }) 
        } as any
      }
      return originalFrom.call(db, table)
    })

    await expect(deleteConnectionTokens(db as any, 'conn-1')).rejects.toThrow('CONNECTION_STORE_UNAVAILABLE')
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn()

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(60_000)))
    expect(token).toBe(INITIAL.access_token)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes an expired access token using the stored refresh token, server-side', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-near-expiry', token_type: 'Bearer', expires_in: 3600 }))

    const almostExpired = later(3600_000 - ACCESS_TOKEN_REFRESH_SKEW_MS + 1000)
    expect(await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, almostExpired))).toBe('at-near-expiry')
  })

  it('persists a ROTATED refresh token securely and bumps the secret version', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-refreshed-0003', token_type: 'Bearer', expires_in: 3600 }))
    await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))

    const stored = await readTokensForRevocation(db as any, 'conn-1')
    expect(stored?.refresh_token).toBe(INITIAL.refresh_token)
    expect(stored?.access_token).toBe('at-refreshed-0003')
  })

  it.each([OAuthErrorCode.InvalidGrant, OAuthErrorCode.UnauthorizedClient])(
    'a revoked/invalid grant (%s) maps to PROVIDER_AUTHORIZATION_REQUIRED and clears the dead secrets',
    async (code) => {
      const db = seedDb()
      await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
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
    await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-only', token_type: 'Bearer', expires_in: 60 }, GRANT, NOW)

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

  it('refreshes successfully even if the environment has no client registration row (uses the grant’s own client)', async () => {
    // The registry is empty.
    const db = createFakeDb({ seed: { provider_connections: [{ id: 'conn-1', user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected' }] } })
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)

    const refresh = vi.fn(async () => ({ access_token: 'at-no-registry', token_type: 'Bearer', expires_in: 3600 }))
    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))
    expect(token).toBe('at-no-registry')
    expect(refresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientInformation: { client_id: GRANT.clientId } })
    )
  })

  it('an invalid_client error during refresh is a PROVIDER_CLIENT_REJECTED error without deleting the tokens (status unchanged)', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => {
      throw new OAuthError(OAuthErrorCode.InvalidClient, 'client rejected')
    })
    
    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000))).catch(e => e)
    expect(error).toBeInstanceOf(ProviderConnectionError)
    expect(error.code).toBe('PROVIDER_CLIENT_REJECTED')
    expect(db.tables.provider_connections[0].status).toBe('connected')
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
  })

  it('a DB read error on readSecretRow is a CONNECTION_STORE_UNAVAILABLE error (not AuthRequired)', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    
    const originalFrom = db.from;
    db.from = vi.fn((table: string) => {
      if (table === 'provider_connection_secrets') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('DB outage') })
        } as any
      }
      return originalFrom.call(db, table)
    })

    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(vi.fn(), later(2 * 3600_000))).catch(e => e)
    expect(error).toBeInstanceOf(ProviderConnectionError)
    expect(error.code).toBe('CONNECTION_STORE_UNAVAILABLE')
  })

  it('a missing client_id or mismatched issuer in the grant results in PROVIDER_CONNECTION_INVALID without deleting secrets', async () => {
    const db = seedDb()
    // Malformed grant (no client_id)
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, { clientId: '', issuer: GRANT.issuer }, NOW)

    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(vi.fn(), later(2 * 3600_000))).catch(e => e)
    expect(error).toBeInstanceOf(ProviderConnectionError)
    expect(error.code).toBe('PROVIDER_CONNECTION_INVALID')
    expect(db.tables.provider_connection_secrets).toHaveLength(1) // not deleted
  })

  it('mismatched issuer across discovery yields PROVIDER_CONNECTION_INVALID without deleting secrets', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    
    // Discover returns a different issuer than the one in the grant!
    const discover = vi.fn(async () => ({ authorizationServerUrl: 'https://other.kling.ai/auth' } as any))
    
    const error = await getValidAccessToken(db as any, 'conn-1', {
      ...makeDeps(vi.fn(), later(2 * 3600_000)),
      discover
    }).catch(e => e)
    expect(error).toBeInstanceOf(ProviderConnectionError)
    expect(error.code).toBe('PROVIDER_CONNECTION_INVALID')
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
  })

  it('reconnecting monotonically increments the secret_version', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    expect(db.tables.provider_connection_secrets[0].secret_version).toBe(1)
    
    // Simulating reconnect
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, later(60000))
    expect(db.tables.provider_connection_secrets[0].secret_version).toBe(2)
  })

  it('concurrent refresh: the loser of the compare-and-swap uses the winner’s newer token and never overwrites it', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)

    // While our refresh is "in flight", another invocation stores a newer token set.
    const refresh = vi.fn(async () => {
      await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-winner', refresh_token: 'rt-winner', token_type: 'Bearer', expires_in: 3600 }, GRANT, NOW)
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
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)

    const refresh = vi.fn(async () => {
      await saveConnectionTokens(db as any, 'conn-1', { access_token: 'at-rotated-elsewhere', refresh_token: 'rt-rotated-elsewhere', token_type: 'Bearer', expires_in: 3600 }, GRANT, NOW)
      db.tables.provider_connection_secrets[0].secret_version = 2
      throw new OAuthError(OAuthErrorCode.InvalidGrant, 'already used')
    })

    const token = await getValidAccessToken(db as any, 'conn-1', makeDeps(refresh, later(2 * 3600_000)))
    expect(token).toBe('at-rotated-elsewhere')
    expect(db.tables.provider_connections[0].status).toBe('connected')
  })

  it('a concurrent refresh whose write lands DURING the re-check window is honored: the grant is NOT declared revoked', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => { throw new OAuthError(OAuthErrorCode.InvalidGrant, 'already used') })

    // Nothing newer is stored at the first re-read; the winner's compare-and-swap lands while we wait.
    let waits = 0
    const sleep = vi.fn(async () => {
      waits += 1
      if (waits === 2) db.tables.provider_connection_secrets[0].secret_version += 1
    })

    const token = await getValidAccessToken(db as any, 'conn-1', { ...makeDeps(refresh, later(2 * 3600_000)), sleep })

    expect(sleep).toHaveBeenCalledTimes(2)
    expect(token).toBeTruthy()
    expect(db.tables.provider_connections[0].status).toBe('connected')
    expect(db.tables.provider_connection_secrets).toHaveLength(1)
  })

  it('invalid_grant is declared revoked only after the re-check delays elapse with no newer credentials', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => { throw new OAuthError(OAuthErrorCode.InvalidGrant, 'revoked') })
    const sleep = vi.fn(async (_ms: number) => undefined)

    await expect(getValidAccessToken(db as any, 'conn-1', { ...makeDeps(refresh, later(2 * 3600_000)), sleep })).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)

    expect(sleep.mock.calls.map((call) => call[0])).toEqual([...INVALID_GRANT_RECHECK_DELAYS_MS])
    expect(db.tables.provider_connections[0].status).toBe('authorization_required')
    expect(db.tables.provider_connection_secrets).toHaveLength(0)
  })

  it('a connection with NO stored credentials stops claiming to be connected (so the UI asks for reconnection)', async () => {
    const db = seedDb()
    const refresh = vi.fn()
    await expect(getValidAccessToken(db as any, 'conn-1', makeDeps(refresh))).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(db.tables.provider_connections[0].status).toBe('authorization_required')
    await expect(forceRefreshAccessToken(db as any, 'conn-1', makeDeps(refresh))).rejects.toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('forceRefreshAccessToken refreshes even when the recorded expiry has not passed', async () => {
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)
    const refresh = vi.fn(async () => ({ access_token: 'at-forced', token_type: 'Bearer', expires_in: 3600 }))

    expect(await forceRefreshAccessToken(db as any, 'conn-1', makeDeps(refresh, later(1000)))).toBe('at-forced')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('never logs a token, and thrown errors carry no token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
    const db = seedDb()
    await saveConnectionTokens(db as any, 'conn-1', INITIAL, GRANT, NOW)

    const failing = vi.fn(async () => {
      throw new OAuthError(OAuthErrorCode.InvalidGrant, `revoked ${INITIAL.refresh_token}`)
    })
    const error = await getValidAccessToken(db as any, 'conn-1', makeDeps(failing, later(2 * 3600_000))).catch((e) => e)

    const everything = JSON.stringify(spies.flatMap((spy) => spy.mock.calls)) + String(error.message) + String(error.stack)
    expect(everything).not.toContain(INITIAL.access_token)
    expect(everything).not.toContain(INITIAL.refresh_token)
  })
})
