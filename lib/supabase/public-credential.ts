// Resolves the Supabase PUBLIC (browser / SSR user-session / middleware) API credential.
// FUTURE-052B — PUBLIC_SUPABASE_PUBLISHABLE_KEY_MIGRATION_V1.
//
// Supabase now issues two kinds of public credential:
//   * publishable API key  `sb_publishable_...` — opaque, independently created/revoked, NOT a JWT (the target).
//   * legacy anon JWT      `eyJ...`              — signed by the project's legacy JWT secret (disabled with it).
//
// supabase-js / @supabase/ssr accept either as the `supabaseKey` argument and send it unchanged in `apikey`. Neither is
// a secret: both are designed to ship in the browser bundle, and RLS (driven by the signed-in user's JWT, which is a
// separate, asymmetrically-signed token) is what protects data. This module only
//   1. picks WHICH variable supplies the key, and
//   2. refuses (loudly, without echoing the value) anything that is not a public credential — in particular a
//      `sb_secret_...` key or a legacy `service_role` JWT pasted into a NEXT_PUBLIC_* variable, which would otherwise
//      ship administrative authority to every browser.
//
// Variable contract (transition):
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  canonical. Wins whenever it is non-empty.
//   NEXT_PUBLIC_SUPABASE_ANON_KEY         legacy name, read ONLY when the canonical variable is absent/empty.
// A malformed canonical value never falls back to the legacy variable: the fallback would mask the misconfiguration
// until the legacy keys are disabled, and then take every authenticated request down at once.
// The non-public SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY aliases are intentionally NOT read: no source ever read
// them, and a server-only alias cannot reach the browser client anyway.
//
// NEXT.JS INLINING: `process.env.NEXT_PUBLIC_*` is replaced at build time ONLY when written as a literal member
// expression. `env[name]` or `const e = process.env` is not inlined and is `undefined` in the browser. That is why
// `readPublicCredentialEnv` spells both names out and everything else takes the env as an argument.
//
// Removal plan for the legacy fallback (FUTURE-052C): delete LEGACY_PUBLIC_KEY_ENV, its line in readPublicCredentialEnv
// and the 'legacy-anon-jwt' branch once the legacy keys are disabled in the Supabase dashboard (and the Preview +
// Production live smoke has passed with `legacyVariableInUse: false`) and NEXT_PUBLIC_SUPABASE_ANON_KEY /
// SUPABASE_ANON_KEY have been removed from every Vercel scope. See
// docs/discovery/security/PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1.md (Phase B).
//
// Browser-safe: no server-only imports.

export const PUBLIC_PUBLISHABLE_KEY_ENV = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
export const LEGACY_PUBLIC_KEY_ENV = 'NEXT_PUBLIC_SUPABASE_ANON_KEY'

export type PublicCredentialVariable = typeof PUBLIC_PUBLISHABLE_KEY_ENV | typeof LEGACY_PUBLIC_KEY_ENV
export type PublicCredentialShape = 'publishable-key' | 'legacy-anon-jwt'
export type PublicCredentialRejection = 'secret-key' | 'service-role-jwt' | 'unrecognised-format'

export type PublicCredentialEnv = Partial<Record<PublicCredentialVariable, string | undefined>>

export type ResolvedPublicCredential = {
  key: string
  variable: PublicCredentialVariable
  shape: PublicCredentialShape
}

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{16,}$/
// Structure only (three base64url segments, JOSE header); the role claim is read separately and never the signature.
const LEGACY_JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/

/** The only place the NEXT_PUBLIC_* names are read from `process.env` (literal accesses so Next.js inlines them). */
export function readPublicCredentialEnv(): PublicCredentialEnv {
  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
        ? `${variable} is not a recognised Supabase public key (expected sb_publishable_... or the legacy anon JWT).`
        : `${variable} holds an administrative credential (${reason}); it must be a publishable key (sb_publishable_...) or the legacy anon JWT.`,
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

/** Throws PublicCredentialNotConfiguredError when neither variable is set, PublicCredentialMalformedError when the selected one is not a public key. */
export function resolvePublicCredential(env: PublicCredentialEnv = readPublicCredentialEnv()): ResolvedPublicCredential {
  const variable: PublicCredentialVariable | null = present(env[PUBLIC_PUBLISHABLE_KEY_ENV])
    ? PUBLIC_PUBLISHABLE_KEY_ENV
    : present(env[LEGACY_PUBLIC_KEY_ENV])
      ? LEGACY_PUBLIC_KEY_ENV
      : null
  if (!variable) throw new PublicCredentialNotConfiguredError()
  const key = (env[variable] as string).trim()
  const shape = classifyPublicCredential(key)
  if (shape === 'secret-key' || shape === 'service-role-jwt' || shape === 'unrecognised-format') {
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
  /** True while the legacy variable name OR the legacy anon JWT shape is what supplies the credential. */
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
      legacyVariableInUse: resolved.variable === LEGACY_PUBLIC_KEY_ENV || resolved.shape === 'legacy-anon-jwt',
    }
  } catch (error) {
    if (error instanceof PublicCredentialNotConfiguredError) return { configured: false, variable: null, shape: null, legacyVariableInUse: false }
    if (error instanceof PublicCredentialMalformedError) {
      return { configured: true, variable: error.variable, shape: 'invalid', legacyVariableInUse: error.variable === LEGACY_PUBLIC_KEY_ENV }
    }
    throw error
  }
}
