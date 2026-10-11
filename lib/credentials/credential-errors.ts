// SERVER ONLY — typed errors of the BYOK credential store boundary (see api-credential-store.ts).
//
// Moved out of the store module in FUTURE_059 Slice 3A so the encrypted-storage helpers can raise them without a
// circular import; `api-credential-store.ts` re-exports every name, so existing imports keep working.
//
// Messages are static and browser-safe: no column, value, query text, ciphertext, key or database message. `reason` is a
// coarse code for logs and tests.

import type { AiProvider } from './provider-credentials'

export const PROVIDER_CREDENTIAL_UNAVAILABLE = 'PROVIDER_CREDENTIAL_UNAVAILABLE'
export const CREDENTIAL_ACCESS_DENIED = 'CREDENTIAL_ACCESS_DENIED'

export type CredentialUnavailableReason =
  /** The privileged server client could not be created (not configured / not permitted in this runtime). */
  | 'store_client_unavailable'
  /** A database read or write failed. */
  | 'store_failure'
  /** A stored value exists but is not a string (legacy store). */
  | 'malformed'
  /** CONFIGURATION: encrypted storage is active but the BYOK master key is missing, invalid or not separate. */
  | 'encryption_not_configured'
  /** An encrypted credential exists but failed integrity verification (tampered, wrong owner/provider, unknown key id). */
  | 'decryption_failed'
  /** An encrypted credential decrypted but its payload is not a supported credential format. */
  | 'payload_invalid'

/** The credential store could not be read or written. NOT "credential missing". */
export class ProviderCredentialUnavailableError extends Error {
  readonly code = PROVIDER_CREDENTIAL_UNAVAILABLE
  readonly status = 503
  readonly reason: CredentialUnavailableReason
  readonly provider: AiProvider | null

  constructor(reason: CredentialUnavailableReason, provider: AiProvider | null = null) {
    // Browser-safe: no column, value, query or database message.
    super('As credenciais do provedor estão temporariamente indisponíveis. Tente novamente.')
    this.name = 'ProviderCredentialUnavailableError'
    this.reason = reason
    this.provider = provider
  }
}

export function isProviderCredentialUnavailableError(error: unknown): error is ProviderCredentialUnavailableError {
  return error instanceof ProviderCredentialUnavailableError
}

/** The requested owner/provider is not acceptable for a credential access. */
export class CredentialAccessDeniedError extends Error {
  readonly code = CREDENTIAL_ACCESS_DENIED
  readonly status = 403

  constructor() {
    super('Acesso à credencial negado.')
    this.name = 'CredentialAccessDeniedError'
  }
}
