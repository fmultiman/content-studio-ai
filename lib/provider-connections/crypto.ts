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

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const FORMAT_VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12

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

interface KeyEntry {
  id: string
  key: Buffer
}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null
  const key = Buffer.from(raw.trim(), 'base64')
  return key.length === KEY_BYTES ? key : null
}

function loadKeyring(): { current: KeyEntry; byId: Map<string, Buffer> } {
  const currentKey = parseKey(process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY)
  if (!currentKey) throw new ConnectionEncryptionNotConfiguredError()

  const current: KeyEntry = {
    id: process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_ID?.trim() || 'k1',
    key: currentKey,
  }
  const byId = new Map<string, Buffer>([[current.id, current.key]])

  const previousKey = parseKey(process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS)
  const previousId = process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID?.trim()
  if (previousKey && previousId && previousId !== current.id) byId.set(previousId, previousKey)

  return { current, byId }
}

/** True when a valid encryption key is configured. Never reveals the key. */
export function isConnectionEncryptionConfigured(): boolean {
  return parseKey(process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY) !== null
}

const b64 = (buffer: Buffer) => buffer.toString('base64url')

export function encryptConnectionSecret(plaintext: string, aad: string): string {
  const { current } = loadKeyring()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', current.key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT_VERSION, current.id, b64(iv), b64(tag), b64(ciphertext)].join('.')
}

export function decryptConnectionSecret(token: string, aad: string): string {
  const { byId } = loadKeyring()
  const parts = token.split('.')
  if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) throw new ConnectionSecretDecryptionError()

  const key = byId.get(parts[1])
  if (!key) throw new ConnectionSecretDecryptionError()

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()])
    return plaintext.toString('utf8')
  } catch {
    // Wrong key, wrong AAD, or tampering: never surface crypto internals.
    throw new ConnectionSecretDecryptionError()
  }
}
