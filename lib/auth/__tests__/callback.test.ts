import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAuthCallbackRedirect } from '../callback'

const ORIGIN = 'https://content.multihuman.com.br'
const ok = async () => ({ error: null })
const bad = async () => ({ error: { message: 'invalid' } })

describe('AUTH_PASSWORD_RECOVERY_V1 — /auth/callback redirect decision', () => {
  it('a valid recovery code continues to the update-password page on the same origin', async () => {
    const exchange = vi.fn(ok)
    const location = await resolveAuthCallbackRedirect({ origin: ORIGIN, code: 'c', next: '/auth/update-password', exchangeCodeForSession: exchange })
    expect(location).toBe(`${ORIGIN}/auth/update-password`)
    expect(exchange).toHaveBeenCalledWith('c')
  })

  it('keeps the previous default (signup confirmation lands on the dashboard)', async () => {
    expect(await resolveAuthCallbackRedirect({ origin: ORIGIN, code: 'c', next: null, exchangeCodeForSession: ok })).toBe(`${ORIGIN}/dashboard`)
  })

  it('cannot be turned into an open redirect through `next`', async () => {
    for (const next of ['@evil.example', '//evil.example', 'https://evil.example', '/\\evil.example']) {
      const location = await resolveAuthCallbackRedirect({ origin: ORIGIN, code: 'c', next, exchangeCodeForSession: ok })
      expect(location).toBe(`${ORIGIN}/dashboard`)
    }
  })

  it('an invalid/expired recovery link returns to "forgot password" with a truthful reason', async () => {
    const args = { origin: ORIGIN, next: '/auth/update-password' }
    expect(await resolveAuthCallbackRedirect({ ...args, code: 'stale', exchangeCodeForSession: bad })).toBe(`${ORIGIN}/auth/forgot-password?error=invalid_link`)
    expect(await resolveAuthCallbackRedirect({ ...args, code: null, exchangeCodeForSession: ok })).toBe(`${ORIGIN}/auth/forgot-password?error=invalid_link`)
    expect(await resolveAuthCallbackRedirect({ ...args, code: 'x', exchangeCodeForSession: async () => { throw new Error('network') } })).toBe(`${ORIGIN}/auth/forgot-password?error=invalid_link`)
  })

  it('other failures keep the existing login error', async () => {
    expect(await resolveAuthCallbackRedirect({ origin: ORIGIN, code: 'c', next: null, exchangeCodeForSession: bad })).toBe(`${ORIGIN}/login?error=auth_failed`)
  })
})

describe('AUTH_PASSWORD_RECOVERY_V1 — GET /auth/callback route wiring', () => {
  beforeEach(() => vi.resetModules())

  it('exchanges the code through the normal server client and redirects same-origin without echoing the code', async () => {
    const exchangeCodeForSession = vi.fn(ok)
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { exchangeCodeForSession } }) }))
    const { GET } = await import('@/app/auth/callback/route')
    const { NextRequest } = await import('next/server')

    const response = await GET(new NextRequest(`${ORIGIN}/auth/callback?code=SECRETCODE&next=%2Fauth%2Fupdate-password`))
    expect(exchangeCodeForSession).toHaveBeenCalledWith('SECRETCODE')
    expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/update-password`)
    expect(response.headers.get('location')).not.toContain('SECRETCODE')
  })
})
