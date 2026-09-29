import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  RECOVERY_NEUTRAL_SUCCESS,
  buildRecoveryRedirectUrl,
  classifyRecoveryRequest,
  getAuthAppOrigin,
  passwordUpdateErrorMessage,
  recoveryOutcomeMessage,
  safeNextPath,
  validateNewPassword,
} from '../recovery'

afterEach(() => vi.unstubAllEnvs())

describe('AUTH_PASSWORD_RECOVERY_V1 — redirect target', () => {
  it('is the explicit canonical production callback that continues to the update-password page', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://content.multihuman.com.br')
    expect(buildRecoveryRedirectUrl()).toBe('https://content.multihuman.com.br/auth/callback?next=%2Fauth%2Fupdate-password')
  })

  it('normalizes to the origin (a path/trailing slash in the env never leaks into the link)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://content.multihuman.com.br/some/path/')
    expect(getAuthAppOrigin()).toBe('https://content.multihuman.com.br')
  })

  it('refuses insecure or local origins and a missing configuration instead of guessing', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://content.multihuman.com.br')
    expect(() => buildRecoveryRedirectUrl()).toThrow(/https/)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3000')
    expect(() => buildRecoveryRedirectUrl()).toThrow(/https/)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(() => buildRecoveryRedirectUrl()).toThrow(/not configured/)
  })
})

describe('AUTH_PASSWORD_RECOVERY_V1 — safeNextPath', () => {
  it('keeps same-origin paths (with query) and defaults otherwise', () => {
    expect(safeNextPath('/auth/update-password')).toBe('/auth/update-password')
    expect(safeNextPath('/projetos?x=1')).toBe('/projetos?x=1')
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
  })

  it.each([
    '@evil.example',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '/ok\nLocation: https://evil.example',
    '/a\\b',
  ])('rejects %j', (value) => {
    expect(safeNextPath(value)).toBe('/dashboard')
  })
})

describe('AUTH_PASSWORD_RECOVERY_V1 — recovery request outcome', () => {
  it('reports success identically (neutral) and never distinguishes existing accounts', () => {
    expect(classifyRecoveryRequest(null)).toBe('sent')
    expect(RECOVERY_NEUTRAL_SUCCESS).toBe('Se houver uma conta com este email, enviaremos as instruções para redefinir a senha.')
  })

  it('surfaces a real rate limit truthfully, and other failures generically', () => {
    expect(classifyRecoveryRequest({ status: 429 })).toBe('rate_limited')
    expect(classifyRecoveryRequest({ code: 'over_email_send_rate_limit' })).toBe('rate_limited')
    expect(classifyRecoveryRequest({ status: 500, code: 'unexpected_failure' })).toBe('failed')
    expect(recoveryOutcomeMessage('rate_limited')).toMatch(/Muitas tentativas/)
    expect(recoveryOutcomeMessage('failed')).toMatch(/Não foi possível/)
  })
})

describe('AUTH_PASSWORD_RECOVERY_V1 — password validation and error copy', () => {
  it('rejects a mismatch and a too-short password; accepts a valid one', () => {
    expect(validateNewPassword('abcdefg', 'abcdefh')).toBe('As senhas não coincidem')
    expect(validateNewPassword('abc', 'abc')).toContain(String(PASSWORD_MIN_LENGTH))
    expect(validateNewPassword('abcdefg', 'abcdefg')).toBeNull()
  })

  it('maps Supabase errors to Portuguese copy without exposing internals', () => {
    expect(passwordUpdateErrorMessage({ code: 'same_password' })).toMatch(/diferente/)
    expect(passwordUpdateErrorMessage({ code: 'weak_password' })).toMatch(/fraca/)
    expect(passwordUpdateErrorMessage({ code: 'reauthentication_needed' })).toMatch(/entrar novamente/)
    expect(passwordUpdateErrorMessage({ name: 'AuthSessionMissingError' })).toMatch(/sessão expirou/)
    expect(passwordUpdateErrorMessage({ status: 429 })).toMatch(/Muitas tentativas/)
    const generic = passwordUpdateErrorMessage({ status: 500, code: 'unexpected_failure' })
    expect(generic).toBe('Não foi possível alterar a senha. Tente novamente.')
    expect(generic).not.toMatch(/unexpected_failure|500|supabase/i)
  })
})
