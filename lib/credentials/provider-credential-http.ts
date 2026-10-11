// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — HTTP face of "the credential store could not be read". SERVER ONLY.
//
// A credential that cannot be READ is not a credential that is NOT CONFIGURED. Routes map the thrown
// `ProviderCredentialUnavailableError` to one controlled, retryable 503 with a stable code. The body carries the
// provider id and a static message only — never a column, value, query or database error text.
import { NextResponse } from 'next/server'
import { PROVIDER_CREDENTIAL_UNAVAILABLE, isProviderCredentialUnavailableError } from './api-credential-store'

/** Returns the controlled 503 for a credential-store failure, or `null` for any other error. */
export function providerCredentialUnavailableResponse(error: unknown): NextResponse | null {
  if (!isProviderCredentialUnavailableError(error)) return null
  return NextResponse.json(
    { error: error.message, code: PROVIDER_CREDENTIAL_UNAVAILABLE, ...(error.provider ? { provider: error.provider } : {}) },
    { status: error.status },
  )
}
