import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LEAK, makeDb, type Access, type FakeOptions, type Row, type Tables } from './helpers/two-table-fake'

// FUTURE_059 Slice 3B — lazy migrate-on-read in `dual` mode and the atomic backfill core. Dummy keys and an in-memory fake of
// both tables and of the database function only; no real database, key or provider. (The function's row-lock behaviour under
// real concurrent transactions is proven by the PGlite and opt-in local-stack suites.)

const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const LEGACY = 'sk-DUMMY-backfill-legacy-a'
const NEWER = 'sk-DUMMY-backfill-newer-a'
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

type Store = typeof import('../api-credential-store')
type Backfill = typeof import('../credential-backfill')
type Crypto = typeof import('../byok-crypto')
let store: Store
let backfill: Backfill
let crypto: Crypto
let tables: Tables
let access: Access[]
let logs: string[]
let rpcArgs: Array<Record<string, unknown>>

function setup(options: { failures?: FakeOptions['failures']; beforeBackfill?: FakeOptions['beforeBackfill']; sessionUser?: string; settings?: Row[]; encrypted?: Row[] } = {}) {
  tables = {
    user_settings: options.settings ?? [
      { user_id: A, openai_api_key: LEGACY, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: 'rep-DUMMY-a' },
      { user_id: B, openai_api_key: null, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null },
    ],
    provider_api_credentials: options.encrypted ?? [],
  }
  access = []
  rpcArgs = []
  const caller = makeDb('caller', tables, access, { sessionUser: options.sessionUser ?? A })
  const base = makeDb('privileged', tables, access, { failures: options.failures, beforeBackfill: options.beforeBackfill }) as any
  const privileged = new Proxy(base, {
    get(target, prop) {
      if (prop === 'rpc') return (fn: string, args: Record<string, unknown>) => { rpcArgs.push(args); return target.rpc(fn, args) }
      return target[prop]
    },
  }) as SupabaseClient
  store.__setPrivilegedCredentialClientForTests(privileged)
  return { caller, privileged }
}

const mode = (value: string) => vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', value)
const withKey = () => vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
const rpcCalls = () => access.filter((a) => a.op.startsWith('rpc:'))
const encryptedRows = (userId = A) => tables.provider_api_credentials.filter((r) => r.user_id === userId)
const read = (caller: SupabaseClient, userId = A, provider: 'openai' | 'gemini' | 'replicate' = 'openai') => store.readStoredApiCredential(caller, { userId, provider })
/** A real encrypted row, as a user write in dual mode would leave it. */
function encryptedFor(userId: string, provider: 'openai', secret: string, source = 'user_entry'): Row {
  const encrypted = crypto.encryptCredential({ userId, provider, secret })
  return { id: 'e1', user_id: userId, provider, ciphertext: encrypted.token, key_id: encrypted.keyId, format_version: 1, secret_version: 1, source }
}

beforeEach(async () => {
  for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
  vi.resetModules()
  store = await import('../api-credential-store')
  backfill = await import('../credential-backfill')
  crypto = await import('../byok-crypto')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
})
afterEach(() => {
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  backfill.__resetLazyBackfillStateForTests()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('lazy migration on a dual-mode read', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('migrates a legacy-only credential: the read returns the same secret, an encrypted row appears, later reads use it', async () => {
    const { caller } = setup()
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: LEGACY })
    const [row] = encryptedRows()
    expect(row).toMatchObject({ provider: 'openai', source: 'legacy_backfill', secret_version: 1, format_version: 1, key_id: 'byok1' })
    expect(JSON.stringify(row)).not.toContain(LEGACY)
    expect(crypto.decryptCredential({ userId: A, provider: 'openai', token: row.ciphertext })).toBe(LEGACY)

    tables.user_settings[0].openai_api_key = NEWER // prove the second read is served from the encrypted copy
    rpcArgs.length = 0
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: LEGACY })
    expect(rpcArgs).toEqual([])
  })

  it('never sends the plaintext key to the database: only its SHA-256 and the ciphertext', async () => {
    const { caller } = setup()
    await read(caller)
    expect(rpcArgs).toHaveLength(1)
    const text = JSON.stringify(rpcArgs[0])
    expect(text).not.toContain(LEGACY)
    expect(rpcArgs[0]).toMatchObject({ p_user_id: A, p_provider: 'openai', p_expected_legacy_sha256: sha(LEGACY), p_key_id: 'byok1', p_format_version: 1 })
  })

  it('an existing encrypted record is left alone: no migration call, no overwrite', async () => {
    const { caller } = setup({ encrypted: [] })
    tables.provider_api_credentials.push(encryptedFor(A, 'openai', NEWER))
    const before = JSON.stringify(tables.provider_api_credentials)
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: NEWER })
    expect(rpcCalls()).toEqual([])
    expect(JSON.stringify(tables.provider_api_credentials)).toBe(before)
  })

  it('no legacy credential: missing, and nothing is migrated', async () => {
    const { caller } = setup({ sessionUser: B })
    await expect(read(caller, B)).resolves.toEqual({ status: 'missing' })
    expect(rpcCalls()).toEqual([])
    expect(tables.provider_api_credentials).toEqual([])
  })

  it('a corrupted encrypted record is an explicit error: no legacy fallback, no migration over it', async () => {
    const { caller } = setup()
    const row = encryptedFor(A, 'openai', NEWER)
    const parts = row.ciphertext.split('.')
    parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
    row.ciphertext = parts.join('.')
    tables.provider_api_credentials.push(row)
    await expect(read(caller)).rejects.toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'decryption_failed' })
    expect(rpcCalls()).toEqual([])
    expect(tables.provider_api_credentials).toHaveLength(1)
    expect(tables.provider_api_credentials[0].ciphertext).toBe(row.ciphertext)
  })

  it('a record bound to another owner or provider is an explicit error and is never migrated over', async () => {
    const { caller } = setup()
    const foreign = encryptedFor(B, 'openai', NEWER)
    tables.provider_api_credentials.push({ ...foreign, user_id: A }) // B's ciphertext stored under A
    await expect(read(caller)).rejects.toMatchObject({ reason: 'decryption_failed' })
    expect(rpcCalls()).toEqual([])
  })

  it('without the BYOK master key the read fails as a configuration error before any fallback or migration', async () => {
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', '')
    const { caller } = setup()
    await expect(read(caller)).rejects.toMatchObject({ reason: 'encryption_not_configured' })
    expect(rpcCalls()).toEqual([])
    await expect(backfill.backfillLegacyCredential(store.createOperatorPrivilegedClient(), { userId: A, provider: 'openai', legacySecret: LEGACY })).rejects.toMatchObject({ reason: 'encryption_not_configured' })
  })

  it('Replicate and other unsupported providers are never migrated', async () => {
    const { caller } = setup()
    await expect(read(caller, A, 'replicate')).resolves.toEqual({ status: 'configured', secret: 'rep-DUMMY-a' })
    expect(rpcCalls()).toEqual([])
    await expect(backfill.backfillLegacyCredential(store.createOperatorPrivilegedClient(), { userId: A, provider: 'replicate', legacySecret: 'x' })).resolves.toBe('unsupported_provider')
  })

  it('a session for another owner reaches no privileged call at all (ownership is proven before any fallback)', async () => {
    const { caller } = setup()
    access.length = 0
    await expect(read(caller, B)).resolves.toEqual({ status: 'missing' })
    expect(access.filter((a) => a.client === 'privileged')).toEqual([])
  })

  it('is idempotent: repeating the read or the core call changes nothing', async () => {
    const { caller, privileged } = setup()
    await read(caller)
    const snapshot = JSON.stringify(tables.provider_api_credentials)
    await read(caller)
    await expect(backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY })).resolves.toBe('exists')
    await expect(backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY })).resolves.toBe('exists')
    expect(JSON.stringify(tables.provider_api_credentials)).toBe(snapshot)
    expect(encryptedRows()).toHaveLength(1)
  })

  it('a blank legacy value is not migrated', async () => {
    const { privileged } = setup()
    await expect(backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: '   ' })).resolves.toBe('blank')
    expect(rpcCalls()).toEqual([])
  })
})

describe('concurrency safeguards', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('simultaneous reads in one process coalesce into ONE migration attempt', async () => {
    const { caller } = setup()
    const results = await Promise.all([read(caller), read(caller), read(caller)])
    for (const result of results) expect(result).toEqual({ status: 'configured', secret: LEGACY })
    expect(rpcCalls()).toHaveLength(1)
    expect(encryptedRows()).toHaveLength(1)
  })

  it('simultaneous migrations from different processes: exactly one insert, the others report "exists"', async () => {
    const { privileged } = setup()
    const outcomes = await Promise.all([1, 2, 3].map(() => backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY })))
    expect(outcomes.filter((o) => o === 'inserted')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'exists')).toHaveLength(2)
    expect(encryptedRows()).toHaveLength(1)
  })

  it('replacement DURING the migration (legacy changed): the newer credential wins and is never overwritten', async () => {
    const { caller } = setup({
      beforeBackfill: (_args, t) => {
        // the user replaces the credential after the app read LEGACY and before the database decides
        t.provider_api_credentials.push(encryptedFor(A, 'openai', NEWER))
        t.user_settings[0].openai_api_key = NEWER
      },
    })
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: LEGACY }) // this read's own snapshot
    expect(encryptedRows()).toHaveLength(1)
    expect(encryptedRows()[0].source).toBe('user_entry')
    expect(crypto.decryptCredential({ userId: A, provider: 'openai', token: encryptedRows()[0].ciphertext })).toBe(NEWER)
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: NEWER })
  })

  it('replacement DURING the migration (encrypted copy written first, legacy still old): the user row is not overwritten', async () => {
    const { caller } = setup({ beforeBackfill: (_args, t) => { t.provider_api_credentials.push(encryptedFor(A, 'openai', NEWER)) } })
    await read(caller)
    expect(encryptedRows()).toHaveLength(1)
    expect(crypto.decryptCredential({ userId: A, provider: 'openai', token: encryptedRows()[0].ciphertext })).toBe(NEWER)
    expect(encryptedRows()[0].source).toBe('user_entry')
  })

  it('removal DURING the migration: the removed credential is not resurrected', async () => {
    const { caller } = setup({ beforeBackfill: (_args, t) => { t.user_settings[0].openai_api_key = null } })
    await read(caller) // returned the pre-removal snapshot
    expect(encryptedRows()).toEqual([])
    await expect(read(caller)).resolves.toEqual({ status: 'missing' })
  })

  it('a stale snapshot (any change to the legacy value) is refused by the hash comparison', async () => {
    const { privileged } = setup()
    tables.user_settings[0].openai_api_key = `${LEGACY} ` // even a whitespace difference is a different credential
    await expect(backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY })).resolves.toBe('legacy_changed')
    expect(encryptedRows()).toEqual([])
  })

  it('a missing settings row is reported and nothing is written', async () => {
    const { privileged } = setup({ settings: [] })
    await expect(backfill.backfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY })).resolves.toBe('no_settings_row')
    expect(tables.provider_api_credentials).toEqual([])
  })
})

describe('failure handling: a failed migration never changes what the read returns', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('a failed encrypted write: the read still resolves the legacy credential, nothing is stored, the log is code-only', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc' }] })
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: LEGACY })
    expect(tables.provider_api_credentials).toEqual([])
    expect(logs).toContain('[credential-backfill] lazy outcome=failed reason=store_failure provider=openai')
    const text = logs.join('\n')
    for (const forbidden of [LEGACY, LEAK, BYOK_KEY]) expect(text).not.toContain(forbidden)
  })

  it('a failing migration backs off: no retry storm, and a later attempt succeeds', async () => {
    const { privileged } = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc', times: 1 }] })
    let clock = 1_000_000
    const attempt = () => backfill.lazyBackfillLegacyCredential(privileged, { userId: A, provider: 'openai', legacySecret: LEGACY }, { now: () => clock })
    await expect(attempt()).resolves.toBe('failed')
    await expect(attempt()).resolves.toBe('cooling_down')
    expect(rpcCalls()).toHaveLength(1)
    clock += 61_000
    await expect(attempt()).resolves.toBe('inserted')
    expect(rpcCalls()).toHaveLength(2)
  })

  it('a missing database function (migration not applied) is a failed attempt, not a failed read', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc' }] })
    await expect(read(caller)).resolves.toMatchObject({ status: 'configured', secret: LEGACY })
  })

  it('resolveProviderExecution stays ready with the legacy credential when the migration fails', async () => {
    const { caller } = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc' }] })
    const { resolveProviderExecution } = await import('../provider-execution')
    await expect(resolveProviderExecution(caller, { userId: A, provider: 'openai' })).resolves.toMatchObject({ status: 'ready', secret: LEGACY, credentialSource: 'user' })
  })

  it('resolveProviderExecution is unchanged by a successful migration', async () => {
    const { caller } = setup()
    const { resolveProviderExecution } = await import('../provider-execution')
    await expect(resolveProviderExecution(caller, { userId: A, provider: 'openai' })).resolves.toMatchObject({ status: 'ready', secret: LEGACY })
    await expect(resolveProviderExecution(caller, { userId: A, provider: 'openai' })).resolves.toMatchObject({ status: 'ready', secret: LEGACY })
    expect(encryptedRows()).toHaveLength(1)
  })
})

describe('inactive modes never reach the encrypted store', () => {
  it.each([[''], ['legacy'], ['bogus'], ['true']])('mode %j: zero encrypted-store calls, zero migration, no key needed', async (value) => {
    mode(value)
    const { caller } = setup()
    await expect(read(caller)).resolves.toEqual({ status: 'configured', secret: LEGACY })
    await expect(store.readStoredApiCredentialStatuses(caller, A)).resolves.toMatchObject({ openai: 'configured' })
    expect(access.filter((a) => a.table === 'provider_api_credentials')).toEqual([])
    expect(logs).toEqual([])
  })

  it('encrypted mode does not migrate on read: the legacy column is not consulted at all', async () => {
    mode('encrypted')
    withKey()
    const { caller } = setup()
    await expect(read(caller)).resolves.toEqual({ status: 'missing' })
    expect(rpcCalls()).toEqual([])
  })
})
