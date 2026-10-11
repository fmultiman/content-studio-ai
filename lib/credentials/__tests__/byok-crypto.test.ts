import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelopeCodec } from '@/lib/security/aes-gcm-envelope'
import {
  BYOK_CREDENTIAL_FORMAT_VERSION,
  ByokDecryptionError,
  ByokEncryptionNotConfiguredError,
  ByokPayloadError,
  decryptCredential,
  describeByokKey,
  encryptCredential,
  isByokEncryptionConfigured,
} from '../byok-crypto'

// FUTURE_059 Slice 3A — BYOK credential encryption. Dummy keys and dummy secrets only.

const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const BYOK_KEY_2 = Buffer.alloc(32, 22).toString('base64')
const CONNECTION_KEY = Buffer.alloc(32, 7).toString('base64')
const SECRET = 'sk-DUMMY-byok-secret-0001'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const NAMES = ['BYOK_CREDENTIAL_ENCRYPTION_KEY', 'BYOK_CREDENTIAL_ENCRYPTION_KEY_ID', 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS', 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID', 'PROVIDER_CONNECTION_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY_ID']
beforeEach(() => { for (const name of NAMES) vi.stubEnv(name, '') })
afterEach(() => vi.unstubAllEnvs())

const withKey = () => vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)

/** A codec with the BYOK key, to forge tokens with arbitrary AAD/payload (an attacker holding the ciphertext, not the key, cannot). */
const rawCodec = createEnvelopeCodec({ keyEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY', keyIdEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_ID', previousKeyEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS', previousKeyIdEnv: 'BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID', defaultKeyId: 'byok1' })

describe('round trip and format', () => {
  it('encrypts to a versioned, key-id-tagged envelope that does not contain the secret and decrypts back', () => {
    withKey()
    const encrypted = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    expect(encrypted.token).not.toContain(SECRET)
    expect(encrypted.token).not.toContain(Buffer.from(SECRET).toString('base64url'))
    expect(encrypted.formatVersion).toBe(BYOK_CREDENTIAL_FORMAT_VERSION)
    expect(encrypted.keyId).toBe('byok1')
    const parts = encrypted.token.split('.')
    expect(parts).toHaveLength(5)
    expect(parts[0]).toBe('v1')
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(12)
    expect(decryptCredential({ userId: A, provider: 'openai', token: encrypted.token })).toBe(SECRET)
  })

  it('uses a unique nonce per encryption', () => {
    withKey()
    const first = encryptCredential({ userId: A, provider: 'openai', secret: SECRET }).token
    const second = encryptCredential({ userId: A, provider: 'openai', secret: SECRET }).token
    expect(first).not.toBe(second)
    expect(first.split('.')[2]).not.toBe(second.split('.')[2])
  })

  it('records a custom key id', () => {
    withKey()
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY_ID', 'prod-2026-10')
    expect(encryptCredential({ userId: A, provider: 'gemini', secret: SECRET }).keyId).toBe('prod-2026-10')
  })
})

describe('ownership, provider and format binding', () => {
  it('a ciphertext copied to another user does not decrypt', () => {
    withKey()
    const { token } = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    expect(() => decryptCredential({ userId: B, provider: 'openai', token })).toThrow(ByokDecryptionError)
  })

  it('a ciphertext copied to another provider does not decrypt', () => {
    withKey()
    const { token } = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    for (const provider of ['gemini', 'nano_banana', 'kling'] as const) {
      expect(() => decryptCredential({ userId: A, provider, token })).toThrow(ByokDecryptionError)
    }
  })

  it('a token sealed under a different credential FORMAT version does not decrypt as v1', () => {
    withKey()
    const forged = rawCodec.encrypt(JSON.stringify({ v: 1, secret: SECRET }), `byok-credential:v2:${A}:openai`)
    expect(() => decryptCredential({ userId: A, provider: 'openai', token: forged })).toThrow(ByokDecryptionError)
  })

  it('a token sealed for the Kling connection purpose does not decrypt as a BYOK credential', () => {
    withKey()
    const forged = rawCodec.encrypt(JSON.stringify({ v: 1, secret: SECRET }), 'connection-secret:conn-1')
    expect(() => decryptCredential({ userId: A, provider: 'openai', token: forged })).toThrow(ByokDecryptionError)
  })
})

describe('integrity: tampered, malformed and unsupported tokens', () => {
  it.each([2, 3, 4])('tampering with segment %i is rejected', (index) => {
    withKey()
    const parts = encryptCredential({ userId: A, provider: 'openai', secret: SECRET }).token.split('.')
    parts[index] = (parts[index][0] === 'A' ? 'B' : 'A') + parts[index].slice(1)
    expect(() => decryptCredential({ userId: A, provider: 'openai', token: parts.join('.') })).toThrow(ByokDecryptionError)
  })

  it('rejects an invalid nonce, an unknown version, an unknown key id and garbage', () => {
    withKey()
    const parts = encryptCredential({ userId: A, provider: 'openai', secret: SECRET }).token.split('.')
    const variants = [
      [parts[0], parts[1], 'AAAA', parts[3], parts[4]],
      ['v9', ...parts.slice(1)],
      [parts[0], 'other-key', ...parts.slice(2)],
      parts.slice(0, 4),
    ]
    for (const variant of variants) expect(() => decryptCredential({ userId: A, provider: 'openai', token: variant.join('.') })).toThrow(ByokDecryptionError)
    for (const token of ['', 'garbage', '....', 'v1.byok1.a.b.c']) expect(() => decryptCredential({ userId: A, provider: 'openai', token })).toThrow(ByokDecryptionError)
  })

  it('rejects a payload that authenticates but is not a v1 credential document', () => {
    withKey()
    const aad = `byok-credential:v1:${A}:openai`
    for (const payload of ['not json', '"string"', 'null', '[]', '{}', '{"v":2,"secret":"x"}', '{"v":1}', '{"v":1,"secret":42}', '{"v":1,"secret":"   "}', '{"v":1,"secret":""}']) {
      const token = rawCodec.encrypt(payload, aad)
      expect(() => decryptCredential({ userId: A, provider: 'openai', token }), payload).toThrow(ByokPayloadError)
    }
  })
})

describe('key configuration and separation', () => {
  it('without a key: diagnostics say so, encrypt and decrypt fail closed with a static error', () => {
    expect(describeByokKey()).toBe('missing')
    expect(isByokEncryptionConfigured()).toBe(false)
    expect(() => encryptCredential({ userId: A, provider: 'openai', secret: SECRET })).toThrow(ByokEncryptionNotConfiguredError)
    expect(() => decryptCredential({ userId: A, provider: 'openai', token: 'v1.byok1.a.b.c' })).toThrow(ByokEncryptionNotConfiguredError)
  })

  it('an invalid (wrong length) key counts as not configured', () => {
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', 'definitely-not-32-bytes')
    expect(describeByokKey()).toBe('missing')
  })

  it('refuses to share the Kling connection master key', () => {
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', CONNECTION_KEY)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', CONNECTION_KEY)
    expect(describeByokKey()).toBe('reuses_connection_key')
    expect(isByokEncryptionConfigured()).toBe(false)
    expect(() => encryptCredential({ userId: A, provider: 'openai', secret: SECRET })).toThrow(ByokEncryptionNotConfiguredError)
  })

  it('a distinct BYOK key next to a configured connection key is accepted, and neither key decrypts the other purpose', () => {
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', CONNECTION_KEY)
    withKey()
    expect(describeByokKey()).toBe('configured')
    const { token } = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    // The connection key cannot open a BYOK token even with the right AAD.
    const connectionCodec = createEnvelopeCodec({ keyEnv: 'PROVIDER_CONNECTION_ENCRYPTION_KEY', keyIdEnv: 'X_ID', previousKeyEnv: 'X_P', previousKeyIdEnv: 'X_PI', defaultKeyId: 'byok1' })
    expect(() => connectionCodec.decrypt(token, `byok-credential:v1:${A}:openai`)).toThrow()
  })

  it('supports rotation: tokens made under the previous key still decrypt, new ones use the current id', () => {
    withKey()
    const old = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY_2)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY_ID', 'byok2')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS', BYOK_KEY)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID', 'byok1')
    expect(decryptCredential({ userId: A, provider: 'openai', token: old.token })).toBe(SECRET)
    expect(encryptCredential({ userId: A, provider: 'openai', secret: SECRET }).keyId).toBe('byok2')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS', '') // previous key removed: old tokens are no longer readable
    expect(() => decryptCredential({ userId: A, provider: 'openai', token: old.token })).toThrow(ByokDecryptionError)
  })
})

describe('no secret in errors', () => {
  it('every error is static and serialises without the secret, the token or the key', () => {
    withKey()
    const { token } = encryptCredential({ userId: A, provider: 'openai', secret: SECRET })
    const failures: unknown[] = []
    for (const run of [
      () => decryptCredential({ userId: B, provider: 'openai', token }),
      () => decryptCredential({ userId: A, provider: 'openai', token: `${token}x` }),
      () => rawCodec.encrypt('not json', 'x') && decryptCredential({ userId: A, provider: 'openai', token: rawCodec.encrypt('not json', `byok-credential:v1:${A}:openai`) }),
    ]) {
      try { run() } catch (error) { failures.push(error) }
    }
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', '')
    try { encryptCredential({ userId: A, provider: 'openai', secret: SECRET }) } catch (error) { failures.push(error) }
    expect(failures).toHaveLength(4)
    const text = failures.map((error) => JSON.stringify({ name: (error as Error).name, message: (error as Error).message, code: (error as { code?: string }).code, stack: (error as Error).stack })).join('\n')
    for (const forbidden of [SECRET, token, BYOK_KEY]) expect(text).not.toContain(forbidden)
    expect(failures.every((error) => !('cause' in (error as object)))).toBe(true)
  })
})
