// SERVER ONLY — the shared AES-256-GCM envelope used for application-level secret encryption.
//
// Extracted verbatim from `lib/provider-connections/crypto.ts` (Kling MCP connection secrets, live in Production) so
// that a SECOND, independent key identity (BYOK provider credentials, `lib/credentials/byok-crypto.ts`) can reuse the
// exact same proven construction instead of a copy. The Kling module now delegates here with its own environment
// variable names and produces/accepts byte-for-byte the same tokens (pinned by a golden-vector test).
//
// Construction: AES-256-GCM via node:crypto (no custom cryptography). Token format (versioned, key-id'd for rotation):
//
//     v1.<keyId>.<iv>.<authTag>.<ciphertext>          (segments are base64url)
//
// - 12-byte random IV per encryption (unique nonce); 16-byte GCM tag; integrity is verified on every decrypt.
// - The ciphertext is bound to its context through GCM additional authenticated data (AAD): a token copied to another
//   row, owner or purpose fails authentication.
// - The key ring is read from the environment names given by the caller, at call time, and never cached or logged.
//   Rotation: the new key becomes current under a new id and the old one moves to the *_PREVIOUS pair; tokens select
//   their key by id.
//
// This module never logs, returns in an error, or otherwise surfaces a key, plaintext or ciphertext.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

export const ENVELOPE_FORMAT_VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12

/** No usable current key is configured. */
export class EnvelopeKeyMissingError extends Error {
  constructor() {
    super('Envelope encryption key is not configured.')
    this.name = 'EnvelopeKeyMissingError'
  }
}

/** The token is malformed, unsupported, tampered with, or bound to a different context/key. */
export class EnvelopeDecryptError extends Error {
  constructor() {
    super('Envelope could not be decrypted.')
    this.name = 'EnvelopeDecryptError'
  }
}

export interface EnvelopeConfig {
  keyEnv: string
  keyIdEnv: string
  previousKeyEnv: string
  previousKeyIdEnv: string
  defaultKeyId: string
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

const b64 = (buffer: Buffer) => buffer.toString('base64url')

export function createEnvelopeCodec(config: EnvelopeConfig) {
  function loadKeyring(): { current: KeyEntry; byId: Map<string, Buffer> } {
    const currentKey = parseKey(process.env[config.keyEnv])
    if (!currentKey) throw new EnvelopeKeyMissingError()

    const current: KeyEntry = { id: process.env[config.keyIdEnv]?.trim() || config.defaultKeyId, key: currentKey }
    const byId = new Map<string, Buffer>([[current.id, current.key]])

    const previousKey = parseKey(process.env[config.previousKeyEnv])
    const previousId = process.env[config.previousKeyIdEnv]?.trim()
    if (previousKey && previousId && previousId !== current.id) byId.set(previousId, previousKey)

    return { current, byId }
  }

  return {
    /** True when a valid current key is configured. Never reveals the key. */
    isConfigured(): boolean {
      return parseKey(process.env[config.keyEnv]) !== null
    },

    /** The id of the current key (non-secret), or null when no key is configured. */
    currentKeyId(): string | null {
      return parseKey(process.env[config.keyEnv]) ? process.env[config.keyIdEnv]?.trim() || config.defaultKeyId : null
    },

    /** Constant-time comparison of a candidate base64 key with this codec's current key. Never reveals either. */
    currentKeyEquals(candidateBase64: string | undefined): boolean {
      const own = parseKey(process.env[config.keyEnv])
      const other = parseKey(candidateBase64)
      return own !== null && other !== null && timingSafeEqual(own, other)
    },

    encrypt(plaintext: string, aad: string): string {
      const { current } = loadKeyring()
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', current.key, iv)
      cipher.setAAD(Buffer.from(aad, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [ENVELOPE_FORMAT_VERSION, current.id, b64(iv), b64(tag), b64(ciphertext)].join('.')
    },

    decrypt(token: string, aad: string): string {
      const { byId } = loadKeyring()
      const parts = typeof token === 'string' ? token.split('.') : []
      if (parts.length !== 5 || parts[0] !== ENVELOPE_FORMAT_VERSION) throw new EnvelopeDecryptError()

      const key = byId.get(parts[1])
      if (!key) throw new EnvelopeDecryptError()

      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'))
        decipher.setAAD(Buffer.from(aad, 'utf8'))
        decipher.setAuthTag(Buffer.from(parts[3], 'base64url'))
        const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()])
        return plaintext.toString('utf8')
      } catch {
        // Wrong key, wrong AAD, bad nonce/tag length or tampering: never surface crypto internals.
        throw new EnvelopeDecryptError()
      }
    },
  }
}
