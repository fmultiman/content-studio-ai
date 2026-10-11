// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Application-level authenticated encryption for user connection secrets
// (OAuth access/refresh tokens, PKCE verifiers, registration-management
// material). This is a third, separate authority from:
//   - infrastructure secrets (e.g. KLING_WEBHOOK_SECRET), and
//   - platform provider credentials (platform-credentials.ts).
//
// Construction: AES-256-GCM via node:crypto (no custom cryptography).
// Ciphertext format (versioned, key-id'd for rotation):
//
//     v1.<keyId>.<iv>.<authTag>.<ciphertext>          (segments are base64url)
//
// The ciphertext is bound to its purpose/row through GCM additional
// authenticated data (AAD), so a ciphertext copied to another row or purpose
// fails authentication.
//
// The key lives only in the server environment:
//   PROVIDER_CONNECTION_ENCRYPTION_KEY          base64, exactly 32 bytes (current)
//   PROVIDER_CONNECTION_ENCRYPTION_KEY_ID       optional, default "k1"
//   PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS optional, base64 32 bytes (rotation)
//   PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID
//
// Rotation path: set the new key as current with a new id and move the old
// one to *_PREVIOUS; existing ciphertext still decrypts (selected by key id),
// new writes use the current key. Re-encrypting old rows is a future job.
//
// Never log a key, plaintext, or ciphertext from this module.

import {
  EnvelopeDecryptError,
  EnvelopeKeyMissingError,
  createEnvelopeCodec,
} from '@/lib/security/aes-gcm-envelope'

export class ConnectionEncryptionNotConfiguredError extends Error {
  readonly code = 'CONNECTION_ENCRYPTION_NOT_CONFIGURED'
  constructor() {
    super('Connection secret encryption is not configured.')
    this.name = 'ConnectionEncryptionNotConfiguredError'
  }
}

export class ConnectionSecretDecryptionError extends Error {
  readonly code = 'CONNECTION_SECRET_UNREADABLE'
  constructor() {
    super('Connection secret could not be decrypted.')
    this.name = 'ConnectionSecretDecryptionError'
  }
}

// The algorithm lives in the shared envelope codec (also used, with a DIFFERENT key identity, by the BYOK provider
// credential store). The environment variable names below are this module's own and are read nowhere else.
const codec = createEnvelopeCodec({
  keyEnv: 'PROVIDER_CONNECTION_ENCRYPTION_KEY',
  keyIdEnv: 'PROVIDER_CONNECTION_ENCRYPTION_KEY_ID',
  previousKeyEnv: 'PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS',
  previousKeyIdEnv: 'PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID',
  defaultKeyId: 'k1',
})

/** True when a valid encryption key is configured. Never reveals the key. */
export function isConnectionEncryptionConfigured(): boolean {
  return codec.isConfigured()
}

/**
 * True when `candidateBase64` is the same key material as the connection-secret key (constant-time). Lets the BYOK
 * credential module refuse to share this master key without ever reading or exposing it.
 */
export function isConnectionKeyMaterial(candidateBase64: string | undefined): boolean {
  return codec.currentKeyEquals(candidateBase64)
}

export function encryptConnectionSecret(plaintext: string, aad: string): string {
  try {
    return codec.encrypt(plaintext, aad)
  } catch (error) {
    if (error instanceof EnvelopeKeyMissingError) throw new ConnectionEncryptionNotConfiguredError()
    throw error
  }
}

export function decryptConnectionSecret(token: string, aad: string): string {
  try {
    return codec.decrypt(token, aad)
  } catch (error) {
    if (error instanceof EnvelopeKeyMissingError) throw new ConnectionEncryptionNotConfiguredError()
    if (error instanceof EnvelopeDecryptError) throw new ConnectionSecretDecryptionError()
    throw error
  }
}
