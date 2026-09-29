import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConnectionEncryptionNotConfiguredError,
  ConnectionSecretDecryptionError,
  decryptConnectionSecret,
  encryptConnectionSecret,
  isConnectionEncryptionConfigured,
} from '@/lib/provider-connections/crypto'
import { OTHER_TEST_ENCRYPTION_KEY, TEST_ENCRYPTION_KEY, clearTestConnectionEnv, useTestConnectionEnv } from './helpers/fake-db'

const PLAINTEXT = '{"access_token":"at-test-plaintext-value","refresh_token":"rt-test-plaintext-value"}'
const AAD = 'connection-secret:conn-1'

describe('connection secret encryption (AES-256-GCM)', () => {
  beforeEach(useTestConnectionEnv)
  afterEach(clearTestConnectionEnv)

  it('round-trips and the ciphertext is not the plaintext', () => {
    const token = encryptConnectionSecret(PLAINTEXT, AAD)
    expect(token).not.toContain('at-test-plaintext-value')
    expect(token).not.toContain('rt-test-plaintext-value')
    expect(token).not.toBe(PLAINTEXT)
    expect(decryptConnectionSecret(token, AAD)).toBe(PLAINTEXT)
  })

  it('uses a versioned, key-id-tagged five-segment format', () => {
    const [version, keyId, iv, tag, ciphertext, ...rest] = encryptConnectionSecret(PLAINTEXT, AAD).split('.')
    expect(rest).toEqual([])
    expect(version).toBe('v1')
    expect(keyId).toBe('k1')
    for (const segment of [iv, tag, ciphertext]) expect(segment).toMatch(/^[A-Za-z0-9_-]+$/)
    // 96-bit IV, 128-bit tag
    expect(Buffer.from(iv, 'base64url')).toHaveLength(12)
    expect(Buffer.from(tag, 'base64url')).toHaveLength(16)
  })

  it('uses a fresh IV every time (same plaintext → different ciphertext)', () => {
    expect(encryptConnectionSecret(PLAINTEXT, AAD)).not.toBe(encryptConnectionSecret(PLAINTEXT, AAD))
  })

  it('binds ciphertext to its purpose/row: a different AAD fails authentication', () => {
    const token = encryptConnectionSecret(PLAINTEXT, AAD)
    expect(() => decryptConnectionSecret(token, 'connection-secret:conn-2')).toThrow(ConnectionSecretDecryptionError)
  })

  it('detects tampering with any segment', () => {
    const parts = encryptConnectionSecret(PLAINTEXT, AAD).split('.')
    const flip = (value: string) => (value.startsWith('A') ? 'B' : 'A') + value.slice(1)
    for (const index of [2, 3, 4]) {
      const tampered = [...parts]
      tampered[index] = flip(tampered[index])
      expect(() => decryptConnectionSecret(tampered.join('.'), AAD)).toThrow(ConnectionSecretDecryptionError)
    }
  })

  it('rejects malformed or unknown-version input', () => {
    expect(() => decryptConnectionSecret('not-a-token', AAD)).toThrow(ConnectionSecretDecryptionError)
    expect(() => decryptConnectionSecret('v9.k1.a.b.c', AAD)).toThrow(ConnectionSecretDecryptionError)
  })

  it('fails closed when no key is configured', () => {
    delete process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY
    expect(isConnectionEncryptionConfigured()).toBe(false)
    expect(() => encryptConnectionSecret(PLAINTEXT, AAD)).toThrow(ConnectionEncryptionNotConfiguredError)
  })

  it('rejects a key that is not exactly 32 bytes', () => {
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(isConnectionEncryptionConfigured()).toBe(false)
    expect(() => encryptConnectionSecret(PLAINTEXT, AAD)).toThrow(ConnectionEncryptionNotConfiguredError)
  })

  it('supports key rotation: old ciphertext still decrypts via the previous key, new writes use the current key', () => {
    const oldToken = encryptConnectionSecret(PLAINTEXT, AAD) // key id k1

    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY = OTHER_TEST_ENCRYPTION_KEY
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_ID = 'k2'
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS = TEST_ENCRYPTION_KEY
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_PREVIOUS_ID = 'k1'

    expect(decryptConnectionSecret(oldToken, AAD)).toBe(PLAINTEXT)
    const newToken = encryptConnectionSecret(PLAINTEXT, AAD)
    expect(newToken.split('.')[1]).toBe('k2')
    expect(decryptConnectionSecret(newToken, AAD)).toBe(PLAINTEXT)
  })

  it('cannot decrypt after the key is replaced with no previous key (unknown key id)', () => {
    const token = encryptConnectionSecret(PLAINTEXT, AAD)
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY = OTHER_TEST_ENCRYPTION_KEY
    process.env.PROVIDER_CONNECTION_ENCRYPTION_KEY_ID = 'k2'
    expect(() => decryptConnectionSecret(token, AAD)).toThrow(ConnectionSecretDecryptionError)
  })

  it('error messages never contain the plaintext, the ciphertext or the key', () => {
    const token = encryptConnectionSecret(PLAINTEXT, AAD)
    let message = ''
    try {
      decryptConnectionSecret(token, 'wrong-aad')
    } catch (error) {
      message = String((error as Error).message) + String((error as Error).stack)
    }
    expect(message).not.toContain('at-test-plaintext-value')
    expect(message).not.toContain(token)
    expect(message).not.toContain(TEST_ENCRYPTION_KEY)
  })
})
