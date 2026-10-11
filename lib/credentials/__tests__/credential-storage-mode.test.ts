import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CREDENTIAL_STORAGE_MODE_ENV, DEFAULT_CREDENTIAL_STORAGE_MODE, describeCredentialStorage, getCredentialStorageMode } from '../credential-storage-mode'

// FUTURE_059 Slice 3A — the operating mode defaults to LEGACY and nothing activates by accident.

const KEY = Buffer.alloc(32, 21).toString('base64')
const CONNECTION_KEY = Buffer.alloc(32, 7).toString('base64')

beforeEach(() => {
  for (const name of [CREDENTIAL_STORAGE_MODE_ENV, 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
})
afterEach(() => vi.unstubAllEnvs())

describe('mode resolution', () => {
  it('the default is legacy', () => {
    expect(DEFAULT_CREDENTIAL_STORAGE_MODE).toBe('legacy')
    expect(getCredentialStorageMode({})).toBe('legacy')
    expect(getCredentialStorageMode()).toBe('legacy')
  })

  it.each([['legacy', 'legacy'], ['dual', 'dual'], ['encrypted', 'encrypted'], ['  Dual ', 'dual'], ['ENCRYPTED', 'encrypted']])('%j -> %s', (value, expected) => {
    expect(getCredentialStorageMode({ [CREDENTIAL_STORAGE_MODE_ENV]: value })).toBe(expected)
  })

  it.each([[''], ['   '], ['true'], ['1'], ['on'], ['enabled'], ['encrypt'], ['dual,encrypted'], ['migrate'], ['LEGACY-ONLY']])('%j never activates anything: the effective mode is legacy', (value) => {
    expect(getCredentialStorageMode({ [CREDENTIAL_STORAGE_MODE_ENV]: value })).toBe('legacy')
  })

  it('reads the environment at call time (a redeploy is the whole switch)', () => {
    expect(getCredentialStorageMode()).toBe('legacy')
    vi.stubEnv(CREDENTIAL_STORAGE_MODE_ENV, 'dual')
    expect(getCredentialStorageMode()).toBe('dual')
    vi.stubEnv(CREDENTIAL_STORAGE_MODE_ENV, '')
    expect(getCredentialStorageMode()).toBe('legacy')
  })
})

describe('diagnostic', () => {
  it('legacy without a BYOK key: the key is not required, nothing is flagged', () => {
    expect(describeCredentialStorage()).toEqual({ mode: 'legacy', invalidModeValue: false, encryptionKey: 'not_required' })
  })

  it('a typo is visible instead of silent: effective mode stays legacy and the value is flagged', () => {
    expect(describeCredentialStorage({ [CREDENTIAL_STORAGE_MODE_ENV]: 'encrpyted' })).toMatchObject({ mode: 'legacy', invalidModeValue: true })
  })

  it('reports the BYOK key state classes only, never a key', () => {
    vi.stubEnv(CREDENTIAL_STORAGE_MODE_ENV, 'dual')
    expect(describeCredentialStorage().encryptionKey).toBe('missing')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', KEY)
    const described = describeCredentialStorage()
    expect(described).toEqual({ mode: 'dual', invalidModeValue: false, encryptionKey: 'configured' })
    expect(JSON.stringify(described)).not.toContain(KEY)
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', CONNECTION_KEY)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', CONNECTION_KEY)
    expect(describeCredentialStorage().encryptionKey).toBe('reuses_connection_key')
  })

  it('legacy mode with a key already staged by an operator reports it as configured (so activation can be checked first)', () => {
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', KEY)
    expect(describeCredentialStorage()).toEqual({ mode: 'legacy', invalidModeValue: false, encryptionKey: 'configured' })
  })
})
