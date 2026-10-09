// Server-only: resolves the Supabase administrative (RLS-bypassing) API credential from the environment.
// FUTURE-052 — PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1.
//
// Supabase now issues two kinds of admin credential:
//   * secret API key  `sb_secret_...`  — opaque, independently created/revoked, NOT a JWT (the target).
//   * legacy service_role JWT `eyJ...` — three base64url segments signed by the project's legacy JWT secret.
//
// supabase-js accepts either as the `supabaseKey` argument and sends it unchanged in `apikey`, so nothing here
// decodes, signs, splits or reads claims from the key. The only thing this module does is
//   1. pick WHICH variable supplies the key, and
//   2. refuse (loudly, without echoing the value) anything that is not one of the two documented shapes — in
//      particular a publishable key pasted into an admin variable, which would otherwise surface later as a
//      confusing RLS failure.
//
// Variable contract (transition):
//   SUPABASE_SECRET_KEY        canonical. Wins whenever it is non-empty.
//   SUPABASE_SERVICE_ROLE_KEY  legacy name, read ONLY when SUPABASE_SECRET_KEY is absent/empty.
// A malformed SUPABASE_SECRET_KEY never falls back to the legacy variable: a typo must not silently re-arm the
// compromised credential.
//
// Removal plan for the legacy fallback: delete LEGACY_ADMIN_KEY_ENV (and the 'legacy-jwt' branch) once the legacy
// JWT-based keys are disabled in the Supabase dashboard and SUPABASE_SERVICE_ROLE_KEY has been removed from every
// Vercel scope. See docs/discovery/security/PRODUCTION_SERVICE_ROLE_KEY_REPLACEMENT_V1.md.
//
// Never import this from a client component or any module a client bundle can reach.

import type { PolicyEnv } from '@/lib/providers/execution-policy'

export const ADMIN_SECRET_KEY_ENV = 'SUPABASE_SECRET_KEY'
export const LEGACY_ADMIN_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY'

export type AdminCredentialVariable = typeof ADMIN_SECRET_KEY_ENV | typeof LEGACY_ADMIN_KEY_ENV
export type AdminCredentialShape = 'secret-key' | 'legacy-jwt'
export type AdminCredentialRejection = 'publishable-key' | 'unrecognised-format'

export type ResolvedAdminCredential = {
  key: string
  variable: AdminCredentialVariable
  shape: AdminCredentialShape
}

const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{16,}$/
// Structure only (three base64url segments, JOSE header); the payload is never decoded.
const LEGACY_JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export class AdminCredentialMalformedError extends Error {
  readonly code = 'ADMIN_CREDENTIAL_MALFORMED'
  readonly variable: AdminCredentialVariable
  readonly reason: AdminCredentialRejection
  constructor(variable: AdminCredentialVariable, reason: AdminCredentialRejection) {
    super(
      reason === 'publishable-key'
        ? `${variable} holds a publishable key; the admin credential must be a secret API key (sb_secret_...) or the legacy service_role JWT.`
        : `${variable} is not a recognised Supabase admin credential (expected sb_secret_... or the legacy service_role JWT).`,
    )
    this.name = 'AdminCredentialMalformedError'
    this.variable = variable
    this.reason = reason
  }
}

export function classifyAdminCredential(value: string): AdminCredentialShape | AdminCredentialRejection {
  if (value.startsWith('sb_publishable_')) return 'publishable-key'
  if (SECRET_KEY_PATTERN.test(value)) return 'secret-key'
  if (LEGACY_JWT_PATTERN.test(value)) return 'legacy-jwt'
  return 'unrecognised-format'
}

const present = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0

/** Returns null when no admin credential is configured; throws AdminCredentialMalformedError when one is, but malformed. */
export function resolveAdminCredential(env: PolicyEnv = process.env): ResolvedAdminCredential | null {
  const variable: AdminCredentialVariable | null = present(env[ADMIN_SECRET_KEY_ENV])
    ? ADMIN_SECRET_KEY_ENV
    : present(env[LEGACY_ADMIN_KEY_ENV])
      ? LEGACY_ADMIN_KEY_ENV
      : null
  if (!variable) return null
  const key = (env[variable] as string).trim()
  const shape = classifyAdminCredential(key)
  if (shape === 'publishable-key' || shape === 'unrecognised-format') throw new AdminCredentialMalformedError(variable, shape)
  return { key, variable, shape }
}

export type AdminCredentialDiagnostic = {
  configured: boolean
  variable: AdminCredentialVariable | null
  /** `invalid` = a variable is set but is not an accepted shape. */
  shape: AdminCredentialShape | 'invalid' | null
  /** True while the legacy variable name is what supplies the credential. */
  legacyVariableInUse: boolean
}

/** Browser-safe summary (names and shape class only — never any part of the value). Never throws. */
export function describeAdminCredential(env: PolicyEnv = process.env): AdminCredentialDiagnostic {
  try {
    const resolved = resolveAdminCredential(env)
    if (!resolved) return { configured: false, variable: null, shape: null, legacyVariableInUse: false }
    return {
      configured: true,
      variable: resolved.variable,
      shape: resolved.shape,
      legacyVariableInUse: resolved.variable === LEGACY_ADMIN_KEY_ENV,
    }
  } catch (error) {
    if (error instanceof AdminCredentialMalformedError) {
      return { configured: true, variable: error.variable, shape: 'invalid', legacyVariableInUse: error.variable === LEGACY_ADMIN_KEY_ENV }
    }
    throw error
  }
}
