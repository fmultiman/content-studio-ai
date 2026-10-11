// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3A — SERVER ONLY.
//
// Operating mode of the BYOK credential store, chosen by the operator through ONE server environment variable:
//
//   PROVIDER_API_CREDENTIAL_MODE = legacy | dual | encrypted
//
//   legacy     (DEFAULT, and the value of every deployment that does not set the variable)
//              plaintext `user_settings` key columns only — exactly the behaviour of FUTURE_059 Slice 1/2. The encrypted
//              table and the BYOK master key are never touched, read or required.
//   dual       encrypted row first; a MISSING encrypted row falls back to the legacy column (bounded transition). Writes
//              go to both stores. An encrypted row that fails verification NEVER falls back.
//   encrypted  encrypted store only; the legacy column is not read; writes are encrypted-only and clear the legacy column.
//
// Nothing activates automatically: an unset, empty or unrecognised value resolves to `legacy` (the known-safe mode), and
// the unrecognised case is reported by `describeCredentialStorage()` so an operator typo is visible, not silent.
//
// The mode is a server decision. No route or client can set it. It is read at call time (no module state), so a redeploy
// with a changed variable — and a redeploy back — is the whole activation and rollback mechanism.

import { describeByokKey, type ByokKeyState } from './byok-crypto'

export type CredentialStorageMode = 'legacy' | 'dual' | 'encrypted'

export const CREDENTIAL_STORAGE_MODE_ENV = 'PROVIDER_API_CREDENTIAL_MODE'
export const DEFAULT_CREDENTIAL_STORAGE_MODE: CredentialStorageMode = 'legacy'

type Env = Record<string, string | undefined>

function parse(raw: string | undefined): { mode: CredentialStorageMode; recognized: boolean } {
  const value = raw?.trim().toLowerCase()
  if (!value) return { mode: DEFAULT_CREDENTIAL_STORAGE_MODE, recognized: true }
  if (value === 'legacy' || value === 'dual' || value === 'encrypted') return { mode: value, recognized: true }
  return { mode: DEFAULT_CREDENTIAL_STORAGE_MODE, recognized: false }
}

/** The effective mode. Unset, empty or unrecognised ⇒ `legacy`. */
export function getCredentialStorageMode(env: Env = process.env): CredentialStorageMode {
  return parse(env[CREDENTIAL_STORAGE_MODE_ENV]).mode
}

export interface CredentialStorageDescription {
  mode: CredentialStorageMode
  /** True when the variable is set to something that is not legacy|dual|encrypted (the effective mode is then `legacy`). */
  invalidModeValue: boolean
  /** Non-secret state of the BYOK master key; `not_required` while the mode is `legacy` and no key is set. */
  encryptionKey: ByokKeyState | 'not_required'
}

/** Browser-safe diagnostic (names and state classes only — never a key, id, URL or value). */
export function describeCredentialStorage(env: Env = process.env): CredentialStorageDescription {
  const { mode, recognized } = parse(env[CREDENTIAL_STORAGE_MODE_ENV])
  const key = describeByokKey()
  return { mode, invalidModeValue: !recognized, encryptionKey: mode === 'legacy' && key === 'missing' ? 'not_required' : key }
}
