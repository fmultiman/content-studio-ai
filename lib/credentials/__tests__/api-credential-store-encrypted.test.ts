import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LEAK, makeDb, type Access, type Failure, type Row, type Tables } from './helpers/two-table-fake'

// FUTURE_059 Slice 3A — the credential store in legacy / dual / encrypted modes, against an in-memory fake of both tables.
// Dummy keys and dummy secrets only; no real database, key or provider.

const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const CONNECTION_KEY = Buffer.alloc(32, 7).toString('base64')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const SECRET_A = 'sk-DUMMY-owner-a-openai'
const SECRET_A2 = 'sk-DUMMY-owner-a-openai-REPLACED'
const SECRET_B = 'sk-DUMMY-owner-b-openai'
const LEGACY_A = 'sk-DUMMY-legacy-a-openai'

type Store = typeof import('../api-credential-store')
let store: Store
let tables: Tables
let access: Access[]
let logs: string[]

function setup(options: { sessionUser?: string; failures?: Failure[]; settings?: Row[]; encrypted?: Row[] } = {}) {
  tables = {
    user_settings: options.settings ?? [
      { user_id: A, openai_api_key: LEGACY_A, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: 'rep-DUMMY-a', nanobanana_base_url: 'https://default.example' },
      { user_id: B, openai_api_key: null, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null },
    ],
    provider_api_credentials: options.encrypted ?? [],
  }
  access = []
  const caller = makeDb('caller', tables, access, { sessionUser: options.sessionUser ?? A })
  const privileged = makeDb('privileged', tables, access, { failures: options.failures })
  store.__setPrivilegedCredentialClientForTests(privileged)
  return { caller, privileged }
}

const mode = (value: string) => vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', value)
const withKey = () => vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
const touched = (table: string) => access.filter((a) => a.table === table)
const encryptedRow = (userId: string, provider: string) => tables.provider_api_credentials.find((r) => r.user_id === userId && r.provider === provider)

beforeEach(async () => {
  for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'BYOK_CREDENTIAL_ENCRYPTION_KEY_ID', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
  vi.resetModules()
  store = await import('../api-credential-store')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
})
afterEach(() => {
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------------------------------------------------

describe('legacy mode (default): behaviour is unchanged and the encrypted store is never touched', () => {
  it('unset mode + no BYOK key: read, status, write and remove use only user_settings', async () => {
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY_A })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'configured', replicate: 'configured', gemini: 'missing' })
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'gemini', secret: 'gemini-DUMMY-legacy', nanobananaBaseUrl: undefined })
    expect(tables.user_settings[0].gemini_api_key).toBe('gemini-DUMMY-legacy')
    await store.removeStoredApiCredential(caller, { userId: A, provider: 'gemini' })
    expect(tables.user_settings[0].gemini_api_key).toBeNull()
    expect(touched('provider_api_credentials')).toEqual([])
    expect(tables.provider_api_credentials).toEqual([])
    expect(logs).toEqual([])
  })

  it.each([[''], ['legacy'], ['bogus'], ['true'], ['encrpyted']])('mode %j is legacy even when a BYOK key is present or garbage', async (value) => {
    mode(value)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', 'garbage-not-a-key')
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY_A })
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    expect(tables.user_settings[0].openai_api_key).toBe(SECRET_A)
    expect(touched('provider_api_credentials')).toEqual([])
  })

  it('a database failure is still unavailable (Slice 1 semantics), never missing', async () => {
    const { caller } = setup({ failures: [{ table: 'user_settings', op: 'select' }] })
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'store_failure' })
  })
})

describe('dual mode', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('a user with no encrypted row falls back to the legacy value, and logs only a code', async () => {
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY_A })
    // Slice 3B: the fallback also migrates the credential lazily; both log lines are code-only
    expect(logs).toEqual(['[credential-store] read outcome=legacy_fallback provider=openai', '[credential-backfill] lazy outcome=inserted provider=openai'])
    expect(encryptedRow(A, 'openai')).toMatchObject({ source: 'legacy_backfill', secret_version: 1 })
    expect(logs.join('\n')).not.toContain(LEGACY_A)
  })

  it('write stores ciphertext (not the key) AND the legacy column; read prefers the encrypted copy', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    const row = encryptedRow(A, 'openai')!
    expect(row).toMatchObject({ user_id: A, provider: 'openai', key_id: 'byok1', format_version: 1, secret_version: 1, source: 'user_entry' })
    expect(JSON.stringify(row)).not.toContain(SECRET_A)
    expect(row.ciphertext.split('.')).toHaveLength(5)
    expect(tables.user_settings[0].openai_api_key).toBe(SECRET_A)

    tables.user_settings[0].openai_api_key = LEGACY_A // legacy diverges: the encrypted copy must win
    logs.length = 0
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_A })
    expect(logs).toEqual([])
  })

  it('replacement bumps the version and re-encrypts with a fresh nonce', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    const first = encryptedRow(A, 'openai')!.ciphertext
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A2 })
    const row = encryptedRow(A, 'openai')!
    expect(row.secret_version).toBe(2)
    expect(row.ciphertext).not.toBe(first)
    expect(tables.provider_api_credentials.filter((r) => r.user_id === A)).toHaveLength(1)
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_A2 })
  })

  it('removal clears both stores, so the dual-mode fallback cannot resurrect an old key', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    await store.removeStoredApiCredential(caller, { userId: A, provider: 'openai' })
    expect(encryptedRow(A, 'openai')).toBeUndefined()
    expect(tables.user_settings[0].openai_api_key).toBeNull()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
  })

  it('removal clears the legacy column BEFORE deleting the encrypted row (no resurrection if the second step fails)', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'delete' }] })
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    await expect(store.removeStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'store_failure' })
    expect(tables.user_settings[0].openai_api_key).toBeNull()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_A }) // still consistently configured; the user retries
  })

  it('statuses merge both stores per provider', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'gemini', secret: 'gemini-DUMMY' })
    tables.user_settings[0].gemini_api_key = null // encrypted-only provider
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toEqual({ openai: 'configured', gemini: 'configured', nano_banana: 'missing', kling: 'missing', replicate: 'configured' })
  })
})

describe('encrypted mode', () => {
  beforeEach(() => { mode('encrypted'); withKey() })

  it('ignores the legacy column entirely: no encrypted row means missing', async () => {
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'missing', replicate: 'configured' })
    expect(logs.filter((line) => line.includes('legacy_fallback'))).toEqual([])
  })

  it('write is encrypted-only: ciphertext stored, legacy column cleared, NanoBanana base URL still saved', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })
    expect(tables.user_settings[0].openai_api_key).toBeNull()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'nano_banana', secret: 'nb-DUMMY', nanobananaBaseUrl: 'https://nb.example.test' })
    expect(tables.user_settings[0]).toMatchObject({ nanobanana_api_key: null, nanobanana_base_url: 'https://nb.example.test' })
    expect(JSON.stringify(tables.provider_api_credentials)).not.toContain(SECRET_A)
    expect(JSON.stringify(tables.provider_api_credentials)).not.toContain('nb-DUMMY')
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_A })
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'nano_banana' })).resolves.toEqual({ status: 'configured', secret: 'nb-DUMMY' })
  })

  it('a first-time owner without a settings row gets one, so the ownership proof works on the next read', async () => {
    const { caller } = setup({ sessionUser: C, settings: [], encrypted: [] })
    await store.writeStoredApiCredential(caller, { userId: C, provider: 'kling', secret: 'kling-DUMMY' })
    expect(tables.user_settings.map((r) => r.user_id)).toEqual([C])
    await expect(store.readStoredApiCredential(caller, { userId: C, provider: 'kling' })).resolves.toEqual({ status: 'configured', secret: 'kling-DUMMY' })
  })

  it('removal deletes the encrypted row', async () => {
    const { caller } = setup()
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'gemini', secret: 'gemini-DUMMY' })
    await store.removeStoredApiCredential(caller, { userId: A, provider: 'gemini' })
    expect(tables.provider_api_credentials).toEqual([])
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'gemini' })).resolves.toEqual({ status: 'missing' })
  })

  it('a failure on the legacy side AFTER the encrypted write is unavailable, and the new encrypted credential is already stored', async () => {
    const { caller } = setup()
    const base = makeDb('privileged', tables, access)
    let settingsUpserts = 0
    const privileged = {
      from(table: string) {
        const builder = (base as any).from(table)
        if (table === 'user_settings') {
          const upsert = builder.upsert.bind(builder)
          // 1st user_settings upsert = ensure-row; 2nd = the legacy clear/set that follows the encrypted write
          builder.upsert = async (...args: any[]) => (++settingsUpserts === 2 ? { error: { message: LEAK } } : upsert(...args))
        }
        return builder
      },
    } as unknown as SupabaseClient
    store.__setPrivilegedCredentialClientForTests(privileged)
    await expect(store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })).rejects.toMatchObject({ reason: 'store_failure' })
    expect(encryptedRow(A, 'openai')).toBeDefined()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: SECRET_A })
    expect(logs.join('\n')).not.toContain(LEAK)
  })
})

describe.each([['dual'], ['encrypted']])('integrity and ownership in %s mode', (activeMode) => {
  beforeEach(() => { mode(activeMode); withKey() })

  async function seed() {
    const ctx = setup()
    await store.writeStoredApiCredential(ctx.caller, { userId: A, provider: 'openai', secret: SECRET_A })
    return ctx
  }

  it('tampered ciphertext is unavailable (decryption_failed) and NEVER falls back to the legacy value', async () => {
    const { caller } = await seed()
    tables.user_settings[0].openai_api_key = LEGACY_A // a tempting fallback exists
    const row = encryptedRow(A, 'openai')!
    const parts = row.ciphertext.split('.')
    parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
    row.ciphertext = parts.join('.')
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'decryption_failed', provider: 'openai' })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'unavailable' })
    expect(logs.join('\n')).not.toContain(LEGACY_A)
    expect(logs.join('\n')).not.toContain(SECRET_A)
  })

  it('a row copied to another user or another provider does not decrypt (owner/provider binding)', async () => {
    const { caller } = await seed()
    const stolen = encryptedRow(A, 'openai')!.ciphertext
    tables.user_settings.push({ user_id: C, openai_api_key: null })
    tables.provider_api_credentials.push({ id: 'x1', user_id: C, provider: 'openai', ciphertext: stolen, key_id: 'byok1', format_version: 1, secret_version: 1, source: 'user_entry' })
    tables.provider_api_credentials.push({ id: 'x2', user_id: A, provider: 'gemini', ciphertext: stolen, key_id: 'byok1', format_version: 1, secret_version: 1, source: 'user_entry' })
    const asC = makeDb('caller', tables, access, { sessionUser: C })
    await expect(store.readStoredApiCredential(asC, { userId: C, provider: 'openai' })).rejects.toMatchObject({ reason: 'decryption_failed' })
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'gemini' })).rejects.toMatchObject({ reason: 'decryption_failed' })
  })

  it('an unsupported stored format version or a malformed row is unavailable (payload_invalid), not missing', async () => {
    const { caller } = await seed()
    encryptedRow(A, 'openai')!.format_version = 2
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'payload_invalid' })
    encryptedRow(A, 'openai')!.format_version = 1
    encryptedRow(A, 'openai')!.ciphertext = 42
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'payload_invalid' })
  })

  it('an unknown key id (rotation incomplete) is unavailable (decryption_failed)', async () => {
    const { caller } = await seed()
    const parts = encryptedRow(A, 'openai')!.ciphertext.split('.')
    parts[1] = 'retired-key'
    encryptedRow(A, 'openai')!.ciphertext = parts.join('.')
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'decryption_failed' })
  })

  it('ownership isolation: a session for A asking for B gets missing and the privileged client is not used', async () => {
    const { caller } = await seed()
    access.length = 0
    await expect(store.readStoredApiCredential(caller, { userId: B, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
    expect(access.filter((a) => a.client === 'privileged')).toEqual([])
    await expect(store.readStoredApiCredentialStatuses(caller, B)).resolves.toEqual({ openai: 'missing', gemini: 'missing', nano_banana: 'missing', kling: 'missing', replicate: 'missing' })
  })

  it('B never receives A credential even if A stored one and B has a legacy-less row', async () => {
    await seed()
    const asB = makeDb('caller', tables, access, { sessionUser: B })
    await expect(store.readStoredApiCredential(asB, { userId: B, provider: 'openai' })).resolves.toEqual({ status: 'missing' })
  })

  it('a database failure on the encrypted table is store_failure (not missing, not a fallback)', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'select' }] })
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'store_failure' })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toEqual({ openai: 'unavailable', gemini: 'unavailable', nano_banana: 'unavailable', kling: 'unavailable', replicate: 'unavailable' })
    expect(logs.join('\n')).not.toContain(LEAK)
  })

  it('a failed encrypted write is store_failure and stores nothing', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'upsert' }] })
    await expect(store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })).rejects.toMatchObject({ reason: 'store_failure' })
    expect(tables.provider_api_credentials).toEqual([])
    expect(tables.user_settings[0].openai_api_key).toBe(LEGACY_A) // the legacy value is untouched when the encrypted write fails
  })

  it('Replicate always uses the legacy store and never needs the BYOK key', async () => {
    const { caller } = setup()
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', '')
    access.length = 0
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'replicate' })).resolves.toEqual({ status: 'configured', secret: 'rep-DUMMY-a' })
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'replicate', secret: 'rep-DUMMY-new' })
    expect(tables.user_settings[0].replicate_api_key).toBe('rep-DUMMY-new')
    expect(touched('provider_api_credentials')).toEqual([])
  })
})

describe('active mode without a usable master key is a configuration failure, never "missing"', () => {
  it.each([['dual'], ['encrypted']])('%s + no BYOK key', async (activeMode) => {
    mode(activeMode)
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'encryption_not_configured' })
    await expect(store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toEqual({ openai: 'unavailable', gemini: 'unavailable', nano_banana: 'unavailable', kling: 'unavailable', replicate: 'unavailable' })
    expect(tables.provider_api_credentials).toEqual([])
    expect(tables.user_settings[0].openai_api_key).toBe(LEGACY_A)
  })

  it('a BYOK key equal to the Kling connection key is refused the same way', async () => {
    mode('dual')
    vi.stubEnv('PROVIDER_CONNECTION_ENCRYPTION_KEY', CONNECTION_KEY)
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', CONNECTION_KEY)
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
  })

  it('rolling the mode back to legacy restores normal operation without any key', async () => {
    mode('encrypted')
    const { caller } = setup()
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
    mode('legacy')
    await expect(store.readStoredApiCredential(caller, { userId: A, provider: 'openai' })).resolves.toEqual({ status: 'configured', secret: LEGACY_A })
  })
})

describe('no secret leaves the store', () => {
  it('logs, thrown errors and rejected promises never contain a key, ciphertext or database message', async () => {
    mode('dual')
    withKey()
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'upsert', times: 1 }] })
    const errors: unknown[] = []
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A }).catch((e) => errors.push(e))
    await store.writeStoredApiCredential(caller, { userId: A, provider: 'openai', secret: SECRET_A }) // succeeds
    const row = encryptedRow(A, 'openai')!
    const parts = row.ciphertext.split('.')
    const goodToken = row.ciphertext
    parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1)
    row.ciphertext = parts.join('.')
    await store.readStoredApiCredential(caller, { userId: A, provider: 'openai' }).catch((e) => errors.push(e))
    await store.readStoredApiCredentialStatuses(caller, A)
    const text = [...logs, ...errors.map((e) => JSON.stringify({ n: (e as Error).name, m: (e as Error).message, c: (e as any).code, r: (e as any).reason, s: (e as Error).stack }))].join('\n')
    for (const forbidden of [SECRET_A, LEGACY_A, LEAK, goodToken, row.ciphertext, BYOK_KEY]) expect(text).not.toContain(forbidden)
    expect(errors).toHaveLength(2)
    expect(logs.every((line) => line.startsWith('[credential-store]'))).toBe(true)
  })
})
