/**
 * AUTH_PASSWORD_RECOVERY_V1 — pure helpers for the self-service password flows.
 *
 * Everything here uses only the end-user Supabase Auth surface (the caller
 * passes a normal browser/server client). Nothing in this module reads
 * secrets, and nothing logs a code, token or password.
 */

export const PASSWORD_MIN_LENGTH = 6 // same client-side policy as /signup

export const AUTH_CALLBACK_PATH = '/auth/callback'
export const FORGOT_PASSWORD_PATH = '/auth/forgot-password'
export const UPDATE_PASSWORD_PATH = '/auth/update-password'

/**
 * Canonical app origin for Auth email links. Explicit and environment-driven
 * (NEXT_PUBLIC_APP_URL), never derived from a request Host header, and always
 * https so a recovery link can never point at an insecure or local origin.
 */
export function getAuthAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!raw) throw new Error('NEXT_PUBLIC_APP_URL is not configured')
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('NEXT_PUBLIC_APP_URL must be https')
  return url.origin
}

/** The explicit `redirectTo` for the recovery email: callback, then the update-password page. */
export function buildRecoveryRedirectUrl(): string {
  return `${getAuthAppOrigin()}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(UPDATE_PASSWORD_PATH)}`
}

/**
 * Same-origin, path-only redirect target. Anything that could leave the origin
 * (absolute URL, `//host`, `/\host`, `@host` tricks, control characters)
 * collapses to the fallback.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback
  try {
    const base = 'https://origin.invalid'
    const url = new URL(next, base)
    if (url.origin !== base) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

type AuthErrorLike = { status?: number; code?: string; name?: string } | null | undefined

function isRateLimited(error: AuthErrorLike): boolean {
  return Boolean(error) && (error!.status === 429 || error!.code === 'over_email_send_rate_limit' || error!.code === 'over_request_rate_limit')
}

export type RecoveryRequestOutcome = 'sent' | 'rate_limited' | 'failed'

/**
 * The success outcome is deliberately identical whether or not the email has an
 * account (Supabase answers the same), so the UI stays neutral. Only a real
 * rate limit or a transport failure is surfaced, and neither reveals anything
 * about the address.
 */
export function classifyRecoveryRequest(error: AuthErrorLike): RecoveryRequestOutcome {
  if (!error) return 'sent'
  return isRateLimited(error) ? 'rate_limited' : 'failed'
}

export function recoveryOutcomeMessage(outcome: Exclude<RecoveryRequestOutcome, 'sent'>): string {
  return outcome === 'rate_limited'
    ? 'Muitas tentativas. Aguarde alguns minutos antes de solicitar um novo email.'
    : 'Não foi possível enviar o email agora. Tente novamente em instantes.'
}

export const RECOVERY_NEUTRAL_SUCCESS = 'Se houver uma conta com este email, enviaremos as instruções para redefinir a senha.'

/** Client-side validation shared by the recovery page and Configurações. */
export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password !== confirmation) return 'As senhas não coincidem'
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`
  return null
}

/** User-facing message for a failed `updateUser({ password })`; never exposes Supabase internals. */
export function passwordUpdateErrorMessage(error: AuthErrorLike): string {
  if (isRateLimited(error)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  switch (error?.code) {
    case 'same_password':
      return 'A nova senha precisa ser diferente da senha atual.'
    case 'weak_password':
      return `Senha muito fraca. Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres e evite senhas comuns.`
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return 'Por segurança, é preciso entrar novamente antes de alterar a senha.'
    case 'session_not_found':
    case 'session_expired':
    case 'user_not_found':
      return 'Sua sessão expirou. Entre novamente ou solicite um novo link de redefinição.'
    default:
      break
  }
  if (error?.name === 'AuthSessionMissingError' || error?.status === 401 || error?.status === 403) {
    return 'Sua sessão expirou. Entre novamente ou solicite um novo link de redefinição.'
  }
  return 'Não foi possível alterar a senha. Tente novamente.'
}
