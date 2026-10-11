// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3A — SERVER ONLY.
//
// Application-level authenticated encryption for user-owned PROVIDER API KEYS (BYOK). Same proven AES-256-GCM envelope
// as the Kling MCP connection secrets (lib/security/aes-gcm-envelope.ts) but a SEPARATE master-key identity:
//
//   BYOK_CREDENTIAL_ENCRYPTION_KEY               base64, exactly 32 bytes (current)
//   BYOK_CREDENTIAL_ENCRYPTION_KEY_ID            optional, default "byok1"
//   BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS      optional, base64 32 bytes (rotation)
//   BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID
//
// These variables are read here and nowhere else (source-scan tested), and ONLY when an encrypt/decrypt/diagnostic call
// is made — a deployment that keeps the credential store in its default `legacy` mode never needs them. If the BYOK key
// is the same key material as PROVIDER_CONNECTION_ENCRYPTION_KEY it is refused (separate identity is enforced, not
// merely recommended).
//
// Binding. Every ciphertext is bound through GCM additional authenticated data to
//     byok-credential:v1:<owner user id>:<provider>
// i.e. the credential FORMAT/version, the OWNER and the PROVIDER. A token copied to another user, another provider, or
// re-labelled with a different format version fails authentication and is reported as an integrity failure; nothing
// decrypts under the wrong ownership context.
//
// Payload. The plaintext inside the envelope is a small JSON document, `{"v":1,"secret":"<api key>"}`, so fields can be
// added later without a new column; the payload version is checked after authentication.
//
// Nothing here logs, returns in an error, or otherwise surfaces a key, plaintext or ciphertext; all errors are static.

import { createEnvelopeCodec, EnvelopeDecryptError, EnvelopeKeyMissingError } from '@/lib/security/aes-gcm-envelope'
import { isConnectionKeyMaterial } from '@/lib/provider-connections/crypto'
import type { AiProvider } from './provider-credentials'

export const BYOK_CREDENTIAL_FORMAT_VERSION = 1
const AAD_PREFIX = `byok-credential:v${BYOK_CREDENTIAL_FORMAT_VERSION}`

const codec = createEnvelopeCodec({
  keyEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY',
  keyIdEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_ID',
  previousKeyEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS',
  previousKeyIdEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID',
  defaultKeyId: 'byok1',
})

export class ByokEncryptionNotConfiguredError extends Error {
  readonly code = 'BYOK_ENCRYPTION_NOT_CONFIGURED'
  constructor() {
    super('BYOK credential encryption is not configured.')
    this.name = 'ByokEncryptionNotConfiguredError'
  }
}

/** Integrity/authentication failure: tampered token, wrong owner/provider/format, unknown key id, bad nonce. */
export class ByokDecryptionError extends Error {
  readonly code = 'BYOK_CREDENTIAL_UNREADABLE'
  constructor() {
    super('BYOK credential could not be decrypted.')
    this.name = 'ByokDecryptionError'
  }
}

/** The envelope authenticated but the payload is not a supported credential document. */
export class ByokPayloadError extends Error {
  readonly code = 'BYOK_PAYLOAD_INVALID'
  constructor() {
    super('BYOK credential payload is not valid.')
    this.name = 'ByokPayloadError'
  }
}

export type ByokKeyState = 'configured' | 'missing' | 'reuses_connection_key'

/** Non-secret diagnostic of the BYOK master key. Never reveals the key or its id. */
export function describeByokKey(): ByokKeyState {
  if (!codec.isConfigured()) return 'missing'
  return isConnectionKeyMaterial(process.env.BYOK_CREDENTIAL_ENCRYPTION_KEY) ? 'reuses_connection_key' : 'configured'
}

/** True only when a valid, SEPARATE BYOK master key is configured. */
export function isByokEncryptionConfigured(): boolean {
  return describeByokKey() === 'configured'
}

function assertUsable() {
  if (describeByokKey() !== 'configured') throw new ByokEncryptionNotConfiguredError()
}

function aadFor(userId: string, provider: AiProvider): string {
  return `${AAD_PREFIX}:${userId}:${provider}`
}

export interface EncryptedCredential {
  /** `v1.<keyId>.<iv>.<tag>.<ciphertext>` */
  token: string
  /** Non-secret copy of the key id inside the token (rotation queries without decrypting). */
  keyId: string
  formatVersion: number
}

export function encryptCredential(params: { userId: string; provider: AiProvider; secret: string }): EncryptedCredential {
  assertUsable()
  const plaintext = JSON.stringify({ v: BYOK_CREDENTIAL_FORMAT_VERSION, secret: params.secret })
  try {
    const token = codec.encrypt(plaintext, aadFor(params.userId, params.provider))
    return { token, keyId: token.split('.')[1], formatVersion: BYOK_CREDENTIAL_FORMAT_VERSION }
  } catch (error) {
    if (error instanceof EnvelopeKeyMissingError) throw new ByokEncryptionNotConfiguredError()
    throw error
  }
}

export function decryptCredential(params: { userId: string; provider: AiProvider; token: string }): string {
  assertUsable()
  let plaintext: string
  try {
    plaintext = codec.decrypt(params.token, aadFor(params.userId, params.provider))
  } catch (error) {
    if (error instanceof EnvelopeKeyMissingError) throw new ByokEncryptionNotConfiguredError()
    if (error instanceof EnvelopeDecryptError) throw new ByokDecryptionError()
    throw error
  }
  let payload: unknown
  try {
    payload = JSON.parse(plaintext)
  } catch {
    throw new ByokPayloadError()
  }
  const document = payload as { v?: unknown; secret?: unknown } | null
  if (!document || typeof document !== 'object' || document.v !== BYOK_CREDENTIAL_FORMAT_VERSION || typeof document.secret !== 'string' || document.secret.trim().length === 0) {
    throw new ByokPayloadError()
  }
  return document.secret
}
