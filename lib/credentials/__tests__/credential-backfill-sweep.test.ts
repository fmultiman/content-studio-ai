import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeDb, type Access, type FakeOptions, type Row, type Tables } from './helpers/two-table-fake'

// FUTURE_059 Slice 3B — the operator sweep and migration-completeness report. Dummy keys and an in-memory fake only. The sweep is
// never run by anything but these tests and the guarded operator route.

const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [U1, U2, U3, U4, U5, U6, U7] = [1, 2, 3, 4, 5, 6, 7].map(id)
const SECRETS = {
  u1Openai: 'sk-DUMMY-sweep-u1-openai', u1Gemini: 'gemini-DUMMY-sweep-u1', u3Kling: 'kling-DUMMY-sweep-u3',
  u4Encrypted: 'sk-DUMMY-sweep-u4-enc', u5Same: 'sk-DUMMY-sweep-u5', u6Legacy: 'sk-DUMMY-sweep-u6-old', u6Encrypted: 'sk-DUMMY-sweep-u6-new',
  u7Legacy: 'sk-DUMMY-sweep-u7-legacy', u7Encrypted: 'sk-DUMMY-sweep-u7-enc',
}

type Store = typeof import('../api-credential-store')
type Sweep = typeof import('../credential-backfill-sweep')
type Crypto = typeof import('../byok-crypto')
let store: Store
let sweep: Sweep
let crypto: Crypto
let tables: Tables
let access: Access[]
let logs: string[]

const settingsRow = (userId: string, legacy: Partial<Record<'openai' | 'gemini' | 'nano_banana' | 'kling', string>> = {}, extra: Row = {}): Row => ({
  user_id: userId, openai_api_key: legacy.openai ?? null, gemini_api_key: legacy.gemini ?? null, nanobanana_api_key: legacy.nano_banana ?? null, kling_api_key: legacy.kling ?? null, replicate_api_key: null, ...extra,
})
function encrypted(userId: string, secret: string, provider: 'openai' = 'openai', source = 'user_entry'): Row {
  const e = crypto.encryptCredential({ userId, provider, secret })
  return { id: `enc-${userId}-${provider}`, user_id: userId, provider, ciphertext: e.token, key_id: e.keyId, format_version: 1, secret_version: 1, source }
}
function tampered(row: Row): Row {
  const parts = row.ciphertext.split('.')
  parts[4] = (parts[4][0] === 'A' ? 'B' : 'A') + parts[4].slice(1)
  return { ...row, ciphertext: parts.join('.') }
}

function dataset(): { settings: Row[]; enc: Row[] } {
  return {
    settings: [
      settingsRow(U1, { openai: SECRETS.u1Openai, gemini: SECRETS.u1Gemini }, { replicate_api_key: 'rep-DUMMY-ignored' }),
      settingsRow(U2),
      settingsRow(U3, { kling: SECRETS.u3Kling }),
      settingsRow(U4),
      settingsRow(U5, { openai: SECRETS.u5Same }),
      settingsRow(U6, { openai: SECRETS.u6Legacy }),
      settingsRow(U7, { openai: SECRETS.u7Legacy }),
    ],
    enc: [
      encrypted(U4, SECRETS.u4Encrypted),
      encrypted(U5, SECRETS.u5Same),
      encrypted(U6, SECRETS.u6Encrypted),
      tampered(encrypted(U7, SECRETS.u7Encrypted)),
    ],
  }
}

function setup(options: { failures?: FakeOptions['failures']; beforeBackfill?: FakeOptions['beforeBackfill']; data?: { settings: Row[]; enc: Row[] } } = {}) {
  const data = options.data ?? dataset()
  tables = { user_settings: data.settings, provider_api_credentials: data.enc }
  access = []
  const client = makeDb('operator', tables, access, { failures: options.failures, beforeBackfill: options.beforeBackfill })
  store.__setPrivilegedCredentialClientForTests(client)
  return client
}

const mode = (value: string) => vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', value)
const withKey = () => vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
const writes = () => access.filter((a) => ['upsert', 'update', 'delete'].includes(a.op) || a.op.startsWith('rpc:'))
const encRow = (userId: string, provider = 'openai') => tables.provider_api_credentials.find((r) => r.user_id === userId && r.provider === provider)

beforeEach(async () => {
  for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'PROVIDER_CONNECTION_ENCRYPTION_KEY']) vi.stubEnv(name, '')
  vi.resetModules()
  store = await import('../api-credential-store')
  sweep = await import('../credential-backfill-sweep')
  crypto = await import('../byok-crypto')
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

describe('dry run (the default) = the migration-completeness diagnostic', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('classifies every pair, per provider, with counts only — and writes nothing at all', async () => {
    const client = setup()
    const report = await sweep.runCredentialSweep(client) // no options: dry run is the default
    expect(report).toMatchObject({ dryRun: true, mode: 'dual', done: true, nextCursor: null, stopped: null, usersScanned: 7, startedAfter: null })
    expect(report.providers.openai).toMatchObject({ legacyConfigured: 4, encryptedPresent: 4, legacyOnly: 1, verified: 1, divergent: 1, integrityErrors: 1, encryptedOnly: 1, migrated: 0 })
    expect(report.providers.gemini).toMatchObject({ legacyConfigured: 1, legacyOnly: 1, encryptedPresent: 0 })
    expect(report.providers.kling).toMatchObject({ legacyConfigured: 1, legacyOnly: 1 })
    expect(report.providers.nano_banana).toMatchObject({ legacyConfigured: 0, legacyOnly: 0 })
    expect(report.totals).toMatchObject({ legacyConfigured: 6, encryptedPresent: 4, legacyOnly: 3, verified: 1, divergent: 1, integrityErrors: 1, encryptedOnly: 1, migrated: 0, failed: 0 })
    expect(report.cutoverReady).toBe(false)
    expect(writes()).toEqual([])
  })

  it('covers inactive accounts: owners who never read anything are classified (and listed by the scan)', async () => {
    const report = await sweep.runCredentialSweep(setup())
    expect(report.usersScanned).toBe(7) // includes U2 (no credentials) and U3/U1 (legacy-only, never read)
  })

  it('ignores Replicate (never migrated)', async () => {
    const report = await sweep.runCredentialSweep(setup())
    expect(Object.keys(report.providers).sort()).toEqual(['gemini', 'kling', 'nano_banana', 'openai'])
  })

  it('reports cut-over readiness only for a complete dry run from the start, and only when everything is clean', async () => {
    const clean = setup({ data: { settings: [settingsRow(U1, { openai: SECRETS.u5Same }), settingsRow(U2)], enc: [encrypted(U1, SECRETS.u5Same)] } })
    const report = await sweep.runCredentialSweep(clean)
    expect(report.cutoverReady).toBe(true)
    // resumed or partial scans never claim readiness
    const partial = await sweep.runCredentialSweep(clean, { batchSize: 1, maxBatches: 1 })
    expect(partial.done).toBe(false)
    expect(partial.cutoverReady).toBeNull()
    const resumed = await sweep.runCredentialSweep(clean, { cursor: U1 })
    expect(resumed.cutoverReady).toBeNull()
  })

  it('every blocking condition makes the gate false: legacy-only, integrity error, divergence', async () => {
    for (const data of [
      { settings: [settingsRow(U1, { openai: SECRETS.u5Same })], enc: [] },
      { settings: [settingsRow(U1, { openai: SECRETS.u5Same })], enc: [tampered(encrypted(U1, SECRETS.u5Same))] },
      { settings: [settingsRow(U1, { openai: SECRETS.u5Same })], enc: [encrypted(U1, SECRETS.u6Encrypted)] },
    ]) expect((await sweep.runCredentialSweep(setup({ data }))).cutoverReady).toBe(false)
  })

  it('an empty database is not "ready"', async () => {
    expect((await sweep.runCredentialSweep(setup({ data: { settings: [], enc: [] } }))).cutoverReady).toBeNull()
  })

  it('works in legacy mode when a key is staged (readiness check before activation) but never migrates there', async () => {
    mode('legacy')
    const report = await sweep.runCredentialSweep(setup(), { dryRun: true })
    expect(report.mode).toBe('legacy')
    expect(report.totals.legacyOnly).toBe(3)
    expect(writes()).toEqual([])
  })
})

describe('pre-flight and stop conditions', () => {
  it('no BYOK key: stops before reading anything', async () => {
    mode('dual')
    withKey() // the fixtures are encrypted with a key; the run itself then has none
    const client = setup()
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', '')
    const report = await sweep.runCredentialSweep(client, { dryRun: false })
    expect(report.stopped).toBe('encryption_not_configured')
    expect(report.pages).toBe(0)
    expect(access).toEqual([])
  })

  it('execution outside dual mode is refused before any read (legacy writes would not keep the encrypted copy current)', async () => {
    withKey()
    for (const value of ['', 'legacy', 'encrypted']) {
      mode(value)
      access.length = 0
      const report = await sweep.runCredentialSweep(setup(), { dryRun: false })
      expect(report.stopped, value).toBe('mode_must_be_dual')
      expect(access, value).toEqual([])
    }
  })

  it('rejects a malformed cursor', async () => {
    mode('dual'); withKey()
    await expect(sweep.runCredentialSweep(setup(), { cursor: 'not-a-uuid' })).rejects.toBeInstanceOf(RangeError)
  })

  it('batch size and batch count are clamped', async () => {
    mode('dual'); withKey()
    const many = { settings: Array.from({ length: 30 }, (_, n) => settingsRow(id(100 + n))), enc: [] as Row[] }
    const report = await sweep.runCredentialSweep(setup({ data: many }), { batchSize: 1000, maxBatches: 1000 })
    expect(report.pages).toBeLessThanOrEqual(20)
    expect(report.usersScanned).toBe(30)
    const first = await sweep.runCredentialSweep(setup({ data: { settings: many.settings.map((r) => ({ ...r })), enc: [] } }), { batchSize: 1000, maxBatches: 1 })
    expect(first.usersScanned).toBe(25) // MAX_SWEEP_BATCH_SIZE
    expect(first.done).toBe(false)
  })
})

describe('execution', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('migrates only legacy-only credentials; existing, divergent and corrupted encrypted rows are never touched', async () => {
    const client = setup()
    const before = JSON.stringify(tables.provider_api_credentials)
    const report = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(report).toMatchObject({ dryRun: false, done: true, stopped: null })
    expect(report.totals).toMatchObject({ migrated: 3, legacyOnly: 3, failed: 0, raced: 0, legacyChanged: 0, divergent: 1, integrityErrors: 1 })
    expect(report.cutoverReady).toBeNull() // an executing run never claims readiness
    for (const [user, provider, secret] of [[U1, 'openai', SECRETS.u1Openai], [U1, 'gemini', SECRETS.u1Gemini], [U3, 'kling', SECRETS.u3Kling]] as const) {
      const row = encRow(user, provider)!
      expect(row).toMatchObject({ source: 'legacy_backfill', secret_version: 1, format_version: 1 })
      expect(crypto.decryptCredential({ userId: user, provider, token: row.ciphertext })).toBe(secret)
      expect(JSON.stringify(row)).not.toContain(secret)
    }
    for (const user of [U4, U5, U6, U7]) expect(JSON.stringify(encRow(user))).toBe(JSON.stringify(JSON.parse(before).find((r: Row) => r.user_id === user)))
    expect(encRow(U2)).toBeUndefined()
  })

  it('is idempotent: a second run migrates nothing, and a clean dry run afterwards sees the new rows as verified', async () => {
    const client = setup()
    await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    const snapshot = JSON.stringify(tables.provider_api_credentials)
    const second = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(second.totals).toMatchObject({ migrated: 0, legacyOnly: 0, verified: 4 })
    expect(JSON.stringify(tables.provider_api_credentials)).toBe(snapshot)
    const verifyRun = await sweep.runCredentialSweep(client)
    expect(verifyRun.totals).toMatchObject({ legacyOnly: 0, verified: 4, divergent: 1, integrityErrors: 1 })
    expect(verifyRun.cutoverReady).toBe(false) // divergence and corruption still block cut-over
  })

  it('reaches cut-over readiness after a clean sweep followed by a clean dry run', async () => {
    const client = setup({ data: { settings: [settingsRow(U1, { openai: SECRETS.u1Openai, kling: SECRETS.u3Kling }), settingsRow(U2)], enc: [] } })
    expect((await sweep.runCredentialSweep(client, { dryRun: false })).totals.migrated).toBe(2)
    expect((await sweep.runCredentialSweep(client)).cutoverReady).toBe(true)
  })

  it('is resumable: paging with small batches reaches the same result as one big run, and each cursor continues exactly where the last stopped', async () => {
    const client = setup()
    const merged = { migrated: 0, legacyOnly: 0, verified: 0, users: 0 }
    let cursor: string | null = null
    let runs = 0
    do {
      const report = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 2, maxBatches: 1, cursor })
      expect(report.stopped).toBeNull()
      merged.migrated += report.totals.migrated
      merged.legacyOnly += report.totals.legacyOnly
      merged.verified += report.totals.verified
      merged.users += report.usersScanned
      cursor = report.nextCursor
      runs += 1
    } while (cursor && runs < 10)
    expect(runs).toBe(4) // 7 owners in pages of 2
    expect(merged).toMatchObject({ migrated: 3, legacyOnly: 3, verified: 1, users: 7 })
    expect(encRow(U1, 'openai')).toBeDefined()
  })

  it('a replay of the same page after an interruption is harmless', async () => {
    const client = setup()
    const first = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 3, maxBatches: 1 })
    const replay = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 3, maxBatches: 1 })
    expect(first.totals.migrated).toBe(3)
    expect(replay.totals.migrated).toBe(0)
    expect(tables.provider_api_credentials.filter((r) => r.source === 'legacy_backfill')).toHaveLength(3)
  })

  it('partial failure: stops after consecutive failures, reports the resume point, and a later run finishes the job', async () => {
    const client = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc', times: 3 }] })
    const stopped = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25, failureThreshold: 3 })
    expect(stopped.stopped).toBe('failure_threshold')
    expect(stopped.done).toBe(false)
    expect(stopped.totals).toMatchObject({ failed: 3, migrated: 0 })
    expect(stopped.nextCursor).toBe(null) // the first failure was at the first owner: resuming must retry from the very beginning (done:false + null cursor)
    const resumed = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25, cursor: stopped.nextCursor })
    expect(resumed.stopped).toBeNull()
    expect(resumed.totals.migrated).toBe(3)
  })

  it('the resume point never skips an owner whose migration failed, even when later owners succeed', async () => {
    // U3's Kling migration fails once; the run goes on (single failure) through pages [U1,U2] [U3,U4] [U5,U6] and ends mid-scan
    const client = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc', times: 1, match: (args) => args.p_user_id === U3 }] })
    const page = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 2, maxBatches: 3 })
    expect(page.done).toBe(false)
    expect(page.totals).toMatchObject({ failed: 1, migrated: 2 })
    expect(page.nextCursor).toBe(U2) // the last owner completed BEFORE the failing one, not the end of the last page
    const resumed = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 2, maxBatches: 5, cursor: page.nextCursor })
    expect(resumed.done).toBe(true)
    expect(resumed.totals.migrated).toBe(1) // U3's Kling credential, retried
    expect(encRow(U3, 'kling')).toBeDefined()
  })

  it('a single failure is counted, the sweep continues, and the failed pair is retried by the next run', async () => {
    const client = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc', times: 1 }] })
    const first = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(first.stopped).toBeNull()
    expect(first.totals).toMatchObject({ failed: 1, migrated: 2 })
    const second = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(second.totals).toMatchObject({ migrated: 1, failed: 0 })
  })

  it('a database outage while paging stops the sweep without writing', async () => {
    const client = setup({ failures: [{ table: 'user_settings', op: 'select' }] })
    const report = await sweep.runCredentialSweep(client, { dryRun: false })
    expect(report.stopped).toBe('store_failure')
    expect(writes()).toEqual([])
  })

  it('a legacy value changed or removed after it was read is counted and NOT written', async () => {
    const client = setup({ beforeBackfill: (args, t) => { if (args.p_user_id === U1 && args.p_provider === 'openai') t.user_settings[0].openai_api_key = null } })
    const report = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(report.totals).toMatchObject({ legacyChanged: 1, migrated: 2 })
    expect(encRow(U1, 'openai')).toBeUndefined()
  })

  it('a row that appears first (user write or lazy migration elsewhere) is counted as raced and left untouched', async () => {
    const userRow = encrypted(U1, 'sk-DUMMY-user-wrote-this')
    const client = setup({ beforeBackfill: (args, t) => { if (args.p_user_id === U1 && args.p_provider === 'openai') t.provider_api_credentials.push(userRow) } })
    const report = await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 })
    expect(report.totals.raced).toBe(1)
    expect(JSON.stringify(encRow(U1, 'openai'))).toBe(JSON.stringify(userRow))
  })
})

describe('no secret in reports, errors or logs', () => {
  beforeEach(() => { mode('dual'); withKey() })

  it('the report holds counts and a cursor only, even after a failing execution', async () => {
    const client = setup({ failures: [{ table: 'provider_api_credentials', op: 'rpc', times: 1 }] })
    const reports = [
      await sweep.runCredentialSweep(client),
      await sweep.runCredentialSweep(client, { dryRun: false, batchSize: 25 }),
      await sweep.runCredentialSweep(client),
    ]
    const text = JSON.stringify(reports) + logs.join('\n')
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret)
    for (const row of tables.provider_api_credentials) expect(text).not.toContain(row.ciphertext)
    expect(text).not.toContain(BYOK_KEY)
    expect(text).not.toContain('DUMMY')
    for (const report of reports) {
      expect(Object.keys(report).sort()).toEqual(['cutoverReady', 'done', 'dryRun', 'mode', 'nextCursor', 'pages', 'providers', 'startedAfter', 'stopped', 'totals', 'usersScanned'])
    }
  })

  it('the sweep itself logs nothing', async () => {
    await sweep.runCredentialSweep(setup(), { dryRun: false, batchSize: 25 })
    expect(logs.filter((line) => !line.startsWith('[credential-store]') && !line.startsWith('[credential-backfill] lazy'))).toEqual([])
  })
})

describe('never runs by itself', () => {
  it('importing the modules performs no database call, no log, no timer', async () => {
    mode('dual'); withKey()
    const client = setup()
    vi.resetModules()
    const store2 = await import('../api-credential-store')
    store2.__setPrivilegedCredentialClientForTests(client)
    await import('../credential-backfill-sweep')
    await import('../credential-backfill')
    expect(access).toEqual([])
    expect(logs).toEqual([])
    expect(tables.provider_api_credentials).toHaveLength(4)
    store2.__setPrivilegedCredentialClientForTests(null)
  })

  it('the operator client never falls back to a browser-session client and fails closed without a service role', async () => {
    store.__setPrivilegedCredentialClientForTests(null)
    expect(() => store.createOperatorPrivilegedClient()).toThrowError(/indispon/i)
    try { store.createOperatorPrivilegedClient() } catch (error) { expect(error).toMatchObject({ code: 'PROVIDER_CREDENTIAL_UNAVAILABLE', reason: 'store_client_unavailable' }) }
  })
})

// A type-level guard that the sweep accepts a SupabaseClient only (no owner/provider input path exists)
const _typecheck: (client: SupabaseClient) => Promise<unknown> = (client) => import('../credential-backfill-sweep').then((m) => m.runCredentialSweep(client))
void _typecheck
