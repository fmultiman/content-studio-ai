// Resolves the Supabase PUBLIC (browser / SSR user-session / middleware) API credential.
// FUTURE-052C — LEGACY_CREDENTIAL_FALLBACK_CLEANUP_V1.
//
// The application requires NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
// Legacy anon JWTs and fallback to legacy anon variables are retired.
//
// supabase-js / @supabase/ssr accept the publishable key as the `supabaseKey` argument and send it unchanged in `apikey`.
// It is not a secret: it is designed to ship in the browser bundle, and RLS (driven by the signed-in user's JWT, which is a
// separate, asymmetrically-signed token) is what protects data. This module only
//   1. reads the canonical public key variable, and
//   2. refuses (loudly, without echoing the value) anything that is not a modern publishable key — in particular a
//      `sb_secret_...` key, a legacy `service_role` JWT, or a legacy `anon` JWT.
//
// Variable contract:
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  canonical and required.
//
// NEXT.JS INLINING: `process.env.NEXT_PUBLIC_*` is replaced at build time ONLY when written as a literal member
// expression. `env[name]` or `const e = process.env` is not inlined and is `undefined` in the browser. That is why
// `readPublicCredentialEnv` spells the name out and everything else takes the env as an argument.
//
// Browser-safe: no server-only imports.

export const PUBLIC_PUBLISHABLE_KEY_ENV = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'

export type PublicCredentialVariable = typeof PUBLIC_PUBLISHABLE_KEY_ENV
export type PublicCredentialShape = 'publishable-key'
export type PublicCredentialRejection = 'secret-key' | 'service-role-jwt' | 'legacy-anon-jwt' | 'unrecognised-format'

export type PublicCredentialEnv = Partial<Record<PublicCredentialVariable, string | undefined>>

export type ResolvedPublicCredential = {
  key: string
  variable: PublicCredentialVariable
  shape: PublicCredentialShape
}

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,}$/
// Structure only (three base64url segments, JOSE header); the role claim is read separately and never the signature.
const LEGACY_JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/

/** The only place the NEXT_PUBLIC_* name is read from `process.env` (literal access so Next.js inlines it). */
export function readPublicCredentialEnv(): PublicCredentialEnv {
  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }
}

export class PublicCredentialNotConfiguredError extends Error {
  readonly code = 'PUBLIC_CREDENTIAL_NOT_CONFIGURED'
  constructor() {
    super(`Supabase public API key is not configured: set ${PUBLIC_PUBLISHABLE_KEY_ENV}.`)
    this.name = 'PublicCredentialNotConfiguredError'
  }
}

export class PublicCredentialMalformedError extends Error {
  readonly code = 'PUBLIC_CREDENTIAL_MALFORMED'
  readonly variable: PublicCredentialVariable
  readonly reason: PublicCredentialRejection
  constructor(variable: PublicCredentialVariable, reason: PublicCredentialRejection) {
    super(
      reason === 'unrecognised-format'
        ? `${variable} is not a recognised Supabase public key (expected sb_publishable_...).`
        : reason === 'legacy-anon-jwt'
          ? `${variable} holds a legacy anon JWT; the public key must be a publishable key (sb_publishable_...).`
          : `${variable} holds an administrative credential (${reason}); it must be a publishable key (sb_publishable_...).`,
    )
    this.name = 'PublicCredentialMalformedError'
    this.variable = variable
    this.reason = reason
  }
}

// Reads the (public, unsigned-data) `role` claim of a legacy JWT. Works in browser, middleware and Node (atob).
function legacyJwtRole(payloadSegment: string): string | null {
  try {
    const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims: unknown = JSON.parse(atob(padded))
    const role = (claims as { role?: unknown } | null)?.role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

export function classifyPublicCredential(value: string): PublicCredentialShape | PublicCredentialRejection {
  if (value.startsWith('sb_secret_')) return 'secret-key'
  if (PUBLISHABLE_KEY_PATTERN.test(value)) return 'publishable-key'
  const jwt = LEGACY_JWT_PATTERN.exec(value)
  if (jwt) {
    const role = legacyJwtRole(jwt[1])
    if (role === 'service_role') return 'service-role-jwt'
    if (role === 'anon') return 'legacy-anon-jwt'
  }
  return 'unrecognised-format'
}

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0

/** Throws PublicCredentialNotConfiguredError when the canonical variable is not set, PublicCredentialMalformedError when it is not a publishable key. */
export function resolvePublicCredential(env: PublicCredentialEnv = readPublicCredentialEnv()): ResolvedPublicCredential {
  const variable: PublicCredentialVariable = PUBLIC_PUBLISHABLE_KEY_ENV
  if (!present(env[variable])) throw new PublicCredentialNotConfiguredError()
  const key = (env[variable] as string).trim()
  const shape = classifyPublicCredential(key)
  if (shape !== 'publishable-key') {
    throw new PublicCredentialMalformedError(variable, shape)
  }
  return { key, variable, shape }
}

/** Convenience for the client factories: the key to hand to supabase-js. */
export function getSupabasePublicKey(env?: PublicCredentialEnv): string {
  return resolvePublicCredential(env).key
}

export type PublicCredentialDiagnostic = {
  configured: boolean
  variable: PublicCredentialVariable | null
  /** `invalid` = a variable is set but is not an accepted public shape. */
  shape: PublicCredentialShape | 'invalid' | null
  /** False in modern configuration (legacy variables are completely retired). */
  legacyVariableInUse: boolean
}

/** Browser-safe summary (names and shape class only — never any part of the value). Never throws. */
export function describePublicCredential(env: PublicCredentialEnv = readPublicCredentialEnv()): PublicCredentialDiagnostic {
  try {
    const resolved = resolvePublicCredential(env)
    return {
      configured: true,
      variable: resolved.variable,
      shape: resolved.shape,
      legacyVariableInUse: false,
    }
  } catch (error) {
    if (error instanceof PublicCredentialNotConfiguredError) return { configured: false, variable: null, shape: null, legacyVariableInUse: false }
    if (error instanceof PublicCredentialMalformedError) {
      return { configured: true, variable: error.variable, shape: 'invalid', legacyVariableInUse: false }
    }
    throw error
  }
}
