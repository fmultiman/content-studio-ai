// Server-only: resolves the Supabase administrative (RLS-bypassing) API credential from the environment.
// FUTURE-052C — LEGACY_CREDENTIAL_FALLBACK_CLEANUP_V1.
//
// The application requires SUPABASE_SECRET_KEY (`sb_secret_...`).
// Legacy service_role JWTs and fallback to legacy admin variables are retired.
//
// supabase-js accepts the secret API key as the `supabaseKey` argument and sends it unchanged in `apikey`.
// Nothing here decodes, signs, splits or reads claims from the key. The only thing this module does is
//   1. read the canonical admin key variable, and
//   2. refuse (loudly, without echoing the value) anything that is not a modern secret key — in
//      particular a publishable key, legacy JWT, or unrecognised string pasted into SUPABASE_SECRET_KEY.
//
// Variable contract:
//   SUPABASE_SECRET_KEY  canonical and required.
//
// Never import this from a client component or any module a client bundle can reach.

import type { PolicyEnv } from '@/lib/providers/execution-policy'

export const ADMIN_SECRET_KEY_ENV = 'SUPABASE_SECRET_KEY'

export type AdminCredentialVariable = typeof ADMIN_SECRET_KEY_ENV
export type AdminCredentialShape = 'secret-key'
export type AdminCredentialRejection = 'publishable-key' | 'legacy-jwt' | 'unrecognised-format'

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
        ? `${variable} holds a publishable key; the admin credential must be a secret API key (sb_secret_...).`
        : reason === 'legacy-jwt'
          ? `${variable} holds a legacy JWT; the admin credential must be a secret API key (sb_secret_...).`
          : `${variable} is not a recognised Supabase admin credential (expected sb_secret_...).`,
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

/** Returns null when no admin credential is configured; throws AdminCredentialMalformedError when configured but not a secret API key. */
export function resolveAdminCredential(env: PolicyEnv = process.env): ResolvedAdminCredential | null {
  const variable: AdminCredentialVariable = ADMIN_SECRET_KEY_ENV
  if (!present(env[variable])) return null
  const key = (env[variable] as string).trim()
  const shape = classifyAdminCredential(key)
  if (shape !== 'secret-key') throw new AdminCredentialMalformedError(variable, shape)
  return { key, variable, shape }
}

export type AdminCredentialDiagnostic = {
  configured: boolean
  variable: AdminCredentialVariable | null
  /** `invalid` = a variable is set but is not an accepted shape. */
  shape: AdminCredentialShape | 'invalid' | null
  /** False in modern configuration (legacy variables are completely retired). */
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
      legacyVariableInUse: false,
    }
  } catch (error) {
    if (error instanceof AdminCredentialMalformedError) {
      return { configured: true, variable: error.variable, shape: 'invalid', legacyVariableInUse: false }
    }
    throw error
  }
}
