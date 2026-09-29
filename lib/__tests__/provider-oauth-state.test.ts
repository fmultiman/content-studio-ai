import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OAUTH_ATTEMPT_TTL_MS,
  consumeAuthorizationAttempt,
  discardAuthorizationAttempt,
  generateOAuthState,
  hashOAuthState,
  storeAuthorizationAttempt,
} from '@/lib/provider-connections/oauth-state'
import { clearTestConnectionEnv, createFakeDb, useTestConnectionEnv } from './helpers/fake-db'

const VERIFIER = 'pkce-verifier-value-that-must-stay-server-side-0123456789'

function attempt(overrides: Partial<Parameters<typeof storeAuthorizationAttempt>[1]> = {}) {
  return {
    userId: 'user-a',
    provider: 'kling',
    connectionMethod: 'mcp_oauth',
    issuer: 'https://kling.ai/auth',
    clientId: 'client-1',
    redirectUri: 'https://content.example.test/api/provider-connections/kling/mcp/callback',
    scope: 'generation.read account.credit.read',
    state: generateOAuthState(),
    codeVerifier: VERIFIER,
    ...overrides,
  }
}

describe('OAuth state / PKCE attempt authority', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('generates cryptographically random, distinct, URL-safe state values with ≥256 bits', () => {
    const states = new Set(Array.from({ length: 200 }, () => generateOAuthState()))
    expect(states.size).toBe(200)
    for (const state of states) {
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes → 43 base64url chars
    }
  })

  it('stores only a hash of the state and an ENCRYPTED verifier', async () => {
    const db = createFakeDb()
    const input = attempt()
    await storeAuthorizationAttempt(db as any, input)

    const [row] = db.tables.provider_oauth_authorizations
    expect(row.state_hash).toBe(hashOAuthState(input.state))
    expect(row.state_hash).not.toBe(input.state)
    expect(JSON.stringify(row)).not.toContain(input.state)
    expect(JSON.stringify(row)).not.toContain(VERIFIER)
    expect(row.code_verifier_ciphertext.startsWith('v1.')).toBe(true)
  })

  it('returns the server-side verifier for the initiating user', async () => {
    const db = createFakeDb()
    const input = attempt()
    await storeAuthorizationAttempt(db as any, input)

    const result = await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.attempt.codeVerifier).toBe(VERIFIER)
      expect(result.attempt.issuer).toBe('https://kling.ai/auth')
      expect(result.attempt.scope).toBe('generation.read account.credit.read')
    }
  })

  it('is single-use: a replayed state is rejected and nothing is left behind', async () => {
    const db = createFakeDb()
    const input = attempt()
    await storeAuthorizationAttempt(db as any, input)

    expect((await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' })).ok).toBe(true)
    const replay = await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' })
    expect(replay).toEqual({ ok: false, reason: 'invalid_state' })
    expect(db.tables.provider_oauth_authorizations).toHaveLength(0)
  })

  it('rejects an unknown state', async () => {
    const db = createFakeDb()
    const result = await consumeAuthorizationAttempt(db as any, { state: generateOAuthState(), userId: 'user-a' })
    expect(result).toEqual({ ok: false, reason: 'invalid_state' })
  })

  it('rejects an expired state (and consumes it)', async () => {
    const db = createFakeDb()
    const input = attempt()
    const startedAt = new Date('2026-09-29T10:00:00Z')
    await storeAuthorizationAttempt(db as any, input, startedAt)

    const later = new Date(startedAt.getTime() + OAUTH_ATTEMPT_TTL_MS + 1)
    const result = await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' }, later)
    expect(result).toEqual({ ok: false, reason: 'expired_state' })
    expect(db.tables.provider_oauth_authorizations).toHaveLength(0)
  })

  it('accepts a state just inside the 10-minute window', async () => {
    const db = createFakeDb()
    const input = attempt()
    const startedAt = new Date('2026-09-29T10:00:00Z')
    await storeAuthorizationAttempt(db as any, input, startedAt)

    const almost = new Date(startedAt.getTime() + OAUTH_ATTEMPT_TTL_MS - 1000)
    expect((await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' }, almost)).ok).toBe(true)
  })

  it('rejects a state presented by a different user — and burns it so it cannot be retried', async () => {
    const db = createFakeDb()
    const input = attempt({ userId: 'user-a' })
    await storeAuthorizationAttempt(db as any, input)

    const wrongUser = await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-b' })
    expect(wrongUser).toEqual({ ok: false, reason: 'state_mismatch' })

    const legitimateRetry = await consumeAuthorizationAttempt(db as any, { state: input.state, userId: 'user-a' })
    expect(legitimateRetry).toEqual({ ok: false, reason: 'invalid_state' })
  })

  it('sweeps expired attempts when a new one starts', async () => {
    const db = createFakeDb()
    const t0 = new Date('2026-09-29T10:00:00Z')
    await storeAuthorizationAttempt(db as any, attempt({ userId: 'old-user' }), t0)
    await storeAuthorizationAttempt(db as any, attempt({ userId: 'new-user' }), new Date(t0.getTime() + OAUTH_ATTEMPT_TTL_MS + 5000))

    expect(db.tables.provider_oauth_authorizations.map((row) => row.user_id)).toEqual(['new-user'])
  })

  it('can discard an attempt without decrypting it', async () => {
    const db = createFakeDb()
    const input = attempt()
    await storeAuthorizationAttempt(db as any, input)
    await discardAuthorizationAttempt(db as any, input.state)
    expect(db.tables.provider_oauth_authorizations).toHaveLength(0)
  })
})
