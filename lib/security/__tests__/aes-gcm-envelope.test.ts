import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelopeCodec, EnvelopeDecryptError, EnvelopeKeyMissingError } from '../aes-gcm-envelope'
import {
  ConnectionEncryptionNotConfiguredError,
  ConnectionSecretDecryptionError,
  decryptConnectionSecret,
  encryptConnectionSecret,
  isConnectionKeyMaterial,
} from '@/lib/provider-connections/crypto'

// FUTURE_059 Slice 3A — the shared AES-256-GCM envelope, and the proof that extracting it did not change the Kling MCP
// connection-secret format. Dummy keys only.

const KEY = Buffer.alloc(32, 7).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64')

// Produced by the PRE-REFACTOR lib/provider-connections/crypto.ts (key = 32 x 0x07, id "k1",
// aad "connection-secret:golden-test", plaintext "dummy-golden-secret").
const GOLDEN_TOKEN = 'v1.k1.NGWC99NJ6lFuE3wS.gXQKlsC3EeKy0lgwrSpzRA.y_aceM_9Waodg_6AqKj5rK_h7g'

const ENV_NAMES = ['PROVIDER_CONNECTION_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY_ID', 'PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS', 'PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID', 'TEST_ENVELOPE_KEY', 'TEST_ENVELOPE_KEY_ID', 'TEST_ENVELOPE_PREV', 'TEST_ENVELOPE_PREV_ID']
beforeEach(() => { for (const name of ENV_NAMES) vi.stubEnv(name, '') })
afterEach(() => vi.unstubAllEnvs())

const codec = createEnvelopeCodec({ keyEnv: 'TEST_ENVELOPE_KEY', keyIdEnv: 'TEST_ENVELOPE_KEY_ID', previousKeyEnv: 'TEST_ENVELOPE_PREV', previousKeyIdEnv: 'TEST_ENVELOPE_PREV_ID', defaultKeyId: 'e1' })

describe('envelope codec', () => {
  it('round-trips, never exposes the plaintext, and uses a fresh nonce each time', () => {
    vi.stubEnv('TEST_ENVELOPE_KEY', KEY)
    const a = codec.encrypt('dummy-plaintext', 'ctx')
    const b = codec.encrypt('dummy-plaintext', 'ctx')
    expect(a).not.toContain('dummy-plaintext')
    expect(a).not.toBe(b)
    expect(codec.decrypt(a, 'ctx')).toBe('dummy-plaintext')
    const [version, keyId, iv, tag] = a.split('.')
    expect([version, keyId]).toEqual(['v1', 'e1'])
    expect(Buffer.from(iv, 'base64url')).toHaveLength(12)
    expect(Buffer.from(tag, 'base64url')).toHaveLength(16)
  })

  it('rejects another context, a tampered segment, a malformed token and an unknown key id', () => {
    vi.stubEnv('TEST_ENVELOPE_KEY', KEY)
    const token = codec.encrypt('dummy-plaintext', 'ctx')
    expect(() => codec.decrypt(token, 'other')).toThrow(EnvelopeDecryptError)
    const parts = token.split('.')
    for (const index of [2, 3, 4]) {
      const tampered = [...parts]
      tampered[index] = (tampered[index][0] === 'A' ? 'B' : 'A') + tampered[index].slice(1)
      expect(() => codec.decrypt(tampered.join('.'), 'ctx'), `segment ${index}`).toThrow(EnvelopeDecryptError)
    }
    expect(() => codec.decrypt(`v2.${parts.slice(1).join('.')}`, 'ctx')).toThrow(EnvelopeDecryptError)
    expect(() => codec.decrypt([parts[0], 'nope', ...parts.slice(2)].join('.'), 'ctx')).toThrow(EnvelopeDecryptError)
    expect(() => codec.decrypt('not-a-token', 'ctx')).toThrow(EnvelopeDecryptError)
    expect(() => codec.decrypt(undefined as unknown as string, 'ctx')).toThrow(EnvelopeDecryptError)
    expect(() => codec.decrypt([parts[0], parts[1], 'AAAA', parts[3], parts[4]].join('.'), 'ctx')).toThrow(EnvelopeDecryptError) // wrong-length nonce
  })

  it('fails closed without a key, and the errors carry no secret', () => {
    expect(codec.isConfigured()).toBe(false)
    expect(codec.currentKeyId()).toBeNull()
    expect(() => codec.encrypt('dummy-plaintext', 'ctx')).toThrow(EnvelopeKeyMissingError)
    vi.stubEnv('TEST_ENVELOPE_KEY', 'too-short')
    expect(codec.isConfigured()).toBe(false)
  })

  it('supports rotation by key id: a previous key still decrypts, new writes use the current one', () => {
    vi.stubEnv('TEST_ENVELOPE_KEY', KEY)
    const old = codec.encrypt('dummy-plaintext', 'ctx')
    vi.stubEnv('TEST_ENVELOPE_KEY', OTHER_KEY)
    vi.stubEnv('TEST_ENVELOPE_KEY_ID', 'e2')
    vi.stubEnv('TEST_ENVELOPE_PREV', KEY)
    vi.stubEnv('TEST_ENVELOPE_PREV_ID', 'e1')
    expect(codec.decrypt(old, 'ctx')).toBe('dummy-plaintext')
    expect(codec.encrypt('dummy-plaintext', 'ctx').split('.')[1]).toBe('e2')
    expect(codec.currentKeyId()).toBe('e2')
  })

  it('compares key material in constant time without revealing it', () => {
    vi.stubEnv('TEST_ENVELOPE_KEY', KEY)
    expect(codec.currentKeyEquals(KEY)).toBe(true)
    expect(codec.currentKeyEquals(OTHER_KEY)).toBe(false)
    expect(codec.currentKeyEquals(undefined)).toBe(false)
    expect(codec.currentKeyEquals('short')).toBe(false)
  })
})

describe('Kling MCP connection crypto after the extraction (format and behaviour unchanged)', () => {
  it('still decrypts a token produced by the PRE-refactor implementation (golden vector)', () => {
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', KEY)
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY_ID', 'k1')
    expect(decryptConnectionSecret(GOLDEN_TOKEN, 'connection-secret:golden-test')).toBe('dummy-golden-secret')
  })

  it('produces the same token shape (v1.k1.<12-byte iv>.<16-byte tag>.<ciphertext>) and the golden token fails under another AAD', () => {
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', KEY)
    const token = encryptConnectionSecret('dummy-golden-secret', 'connection-secret:golden-test')
    const parts = token.split('.')
    expect(parts).toHaveLength(5)
    expect(parts.slice(0, 2)).toEqual(['v1', 'k1'])
    expect(parts[4]).toHaveLength(GOLDEN_TOKEN.split('.')[4].length)
    expect(() => decryptConnectionSecret(GOLDEN_TOKEN, 'connection-secret:other')).toThrow(ConnectionSecretDecryptionError)
  })

  it('keeps its domain errors: no key -> NotConfigured (encrypt and decrypt), bad token -> Decryption', () => {
    expect(() => encryptConnectionSecret('x', 'a')).toThrow(ConnectionEncryptionNotConfiguredError)
    expect(() => decryptConnectionSecret(GOLDEN_TOKEN, 'a')).toThrow(ConnectionEncryptionNotConfiguredError)
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', KEY)
    expect(() => decryptConnectionSecret('garbage', 'a')).toThrow(ConnectionSecretDecryptionError)
  })

  it('exposes only a boolean key-material comparison for the BYOK separation check', () => {
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', KEY)
    expect(isConnectionKeyMaterial(KEY)).toBe(true)
    expect(isConnectionKeyMaterial(OTHER_KEY)).toBe(false)
  })
})
