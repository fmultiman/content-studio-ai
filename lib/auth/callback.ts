import { FORGOT_PASSWORD_PATH, UPDATE_PASSWORD_PATH, safeNextPath } from './recovery'

/**
 * Decides where the PKCE `/auth/callback` sends the browser. Pure: the code
 * exchange is injected, and neither the code nor any token is ever logged or
 * copied into a redirect.
 *
 * - `next` is validated to a same-origin path (it used to be concatenated
 *   verbatim, which allowed `next=@evil.example` to leave the origin).
 * - A failed/expired recovery link returns the user to the "forgot password"
 *   page with a truthful message instead of a generic login error.
 */
export async function resolveAuthCallbackRedirect(input: {
  origin: string
  code: string | null
  next: string | null
  exchangeCodeForSession: (code: string) => Promise<{ error: unknown }>
}): Promise<string> {
  const next = safeNextPath(input.next)

  if (input.code) {
    try {
      const { error } = await input.exchangeCodeForSession(input.code)
      if (!error) return `${input.origin}${next}`
    } catch {
      // fall through to the failure redirect
    }
  }

  if (next.startsWith(UPDATE_PASSWORD_PATH)) return `${input.origin}${FORGOT_PASSWORD_PATH}?error=invalid_link`
  return `${input.origin}/login?error=auth_failed`
}
