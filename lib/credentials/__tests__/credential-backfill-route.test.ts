import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { restoreEnvironment, simulateEnvironment, type SimulatedEnvironment } from '@/lib/providers/__tests__/policy-env'
import { makeDb, type Access, type Row, type Tables } from './helpers/two-table-fake'

// FUTURE_059 Slice 3B — the internal operator route in front of the sweep. It is disabled unless an operator secret is
// provisioned, never reachable by a normal user or client, and returns counts only. Dummy keys, fake database only.

const OPERATOR_SECRET = 'operator-secret-DUMMY-0123456789abcdef0123456789'
const BYOK_KEY = Buffer.alloc(32, 21).toString('base64')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [U1, U2] = [1, 2].map(id)
const LEGACY = 'sk-DUMMY-route-legacy-u1'

type Store = typeof import('../api-credential-store')
let store: Store
let tables: Tables
let access: Access[]
let logs: string[]

function setup() {
  tables = {
    user_settings: [
      { user_id: U1, openai_api_key: LEGACY, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null } as Row,
      { user_id: U2, openai_api_key: null, gemini_api_key: null, nanobanana_api_key: null, kling_api_key: null, replicate_api_key: null } as Row,
    ],
    provider_api_credentials: [],
  }
  access = []
  store.__setPrivilegedCredentialClientForTests(makeDb('operator', tables, access))
}

const call = async (body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${OPERATOR_SECRET}` }, method = 'POST') => {
  const { POST } = await import('@/app/api/internal/credential-backfill/route')
  void method
  return POST(new NextRequest('http://localhost/api/internal/credential-backfill', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }))
}

beforeEach(async () => {
  for (const name of ['PROVIDER_API_CREDENTIAL_MODE', 'BYOK_CREDENTIAL_ENCRYPTION_KEY', 'CREDENTIAL_BACKFILL_OPERATOR_SECRET']) vi.stubEnv(name, '')
  vi.resetModules()
  store = await import('../api-credential-store')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')) })
})
afterEach(() => {
  restoreEnvironment() // first: the store test seams refuse to run while VITEST is simulated away
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('disabled by default and closed to anyone without the operator secret', () => {
  it('no secret provisioned (the Production default): 503 and the database is never touched', async () => {
    setup()
    const response = await call({})
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('CREDENTIAL_BACKFILL_NOT_CONFIGURED')
    expect(access).toEqual([])
  })

  it('a too-short secret counts as not configured', async () => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', 'short')
    setup()
    expect((await call({}, { authorization: 'Bearer short' })).status).toBe(503)
    expect(access).toEqual([])
  })

  it.each([[{}], [{ authorization: 'Bearer wrong' }], [{ authorization: OPERATOR_SECRET }], [{ authorization: `bearer ${OPERATOR_SECRET}` }], [{ 'x-operator-token': OPERATOR_SECRET }]])('credentials %j are rejected with 401 before any database access', async (headers) => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', OPERATOR_SECRET)
    setup()
    const response = await call({}, headers as Record<string, string>)
    expect(response.status).toBe(401)
    expect(access).toEqual([])
  })

  it('only POST exists (no GET trigger by link or prefetch)', async () => {
    const route = await import('@/app/api/internal/credential-backfill/route')
    expect(Object.keys(route).filter((name) => ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(name))).toEqual([])
  })

  it.each<SimulatedEnvironment>(['preview', 'local', 'unknown'])('refuses to run in a %s runtime (403)', async (environment) => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', OPERATOR_SECRET)
    setup()
    simulateEnvironment(environment)
    const response = await call({})
    expect(response.status).toBe(403)
    expect(access).toEqual([])
  })

  it('a production-class runtime is allowed', async () => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', OPERATOR_SECRET)
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    simulateEnvironment('production')
    expect((await call({})).status).toBe(200)
  })
})

describe('request validation: the body can never name an owner, a provider or a credential', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', OPERATOR_SECRET)
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
  })

  it.each([
    [{ userId: U1 }], [{ user_id: U1 }], [{ provider: 'openai' }], [{ secret: 'x' }], [{ ciphertext: 'x' }], [{ ownerId: U1 }], [{ dryRun: true, extra: 1 }],
    [{ batchSize: 0 }], [{ batchSize: 26 }], [{ batchSize: 1.5 }], [{ batchSize: '5' }], [{ maxBatches: 21 }], [{ maxBatches: -1 }],
    [{ cursor: 'not-a-uuid' }], [{ cursor: 42 }], [{ dryRun: 'false' }], [{ dryRun: 0 }],
  ])('rejects %j with 400 and does nothing', async (body) => {
    const response = await call(body)
    expect(response.status).toBe(400)
    expect(access).toEqual([])
  })

  it('rejects a non-object body', async () => {
    expect((await call([1, 2])).status).toBe(400)
    expect((await call('text')).status).toBe(400)
    expect(access).toEqual([])
  })

  it('executing requires BOTH dryRun:false AND the exact confirmation phrase', async () => {
    for (const body of [{ dryRun: false }, { dryRun: false, confirm: 'yes' }, { dryRun: false, confirm: true }, { confirm: 'migrate-legacy-credentials', dryRun: 'false' }]) {
      const response = await call(body)
      expect([400]).toContain(response.status)
    }
    expect(access).toEqual([])
    expect(tables.provider_api_credentials).toEqual([])
  })
})

describe('behaviour', () => {
  beforeEach(() => {
    vi.stubEnv('CREDENTIAL_BACKFILL_OPERATOR_SECRET', OPERATOR_SECRET)
  })

  it('an empty body is a dry run: a counts-only completeness report and no write', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json()
    expect(payload).toMatchObject({ ok: true, report: { dryRun: true, mode: 'dual', done: true, usersScanned: 2, totals: { legacyOnly: 1, migrated: 0 }, cutoverReady: false } })
    expect(access.filter((a) => ['upsert', 'update', 'delete'].includes(a.op) || a.op.startsWith('rpc:'))).toEqual([])
    expect(JSON.stringify(payload)).not.toContain(LEGACY)
  })

  it('a confirmed execution in dual mode migrates, reports counts, and logs a code-only summary', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    const response = await call({ dryRun: false, confirm: 'migrate-legacy-credentials', batchSize: 5 })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.report.totals).toMatchObject({ migrated: 1, failed: 0 })
    expect(tables.provider_api_credentials).toHaveLength(1)
    expect(JSON.stringify(payload)).not.toContain(LEGACY)
    expect(logs.join('\n')).not.toContain(LEGACY)
    expect(logs.some((line) => line.startsWith('[credential-backfill] sweep dryRun=false mode=dual users=2 legacyOnly=1 migrated=1'))).toBe(true)
  })

  it('execution outside dual mode is 409 and reads nothing', async () => {
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    const response = await call({ dryRun: false, confirm: 'migrate-legacy-credentials' })
    expect(response.status).toBe(409)
    expect((await response.json()).report.stopped).toBe('mode_must_be_dual')
    expect(access).toEqual([])
  })

  it('no BYOK key is 409 (a configuration stop), not a silent success', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    setup()
    const response = await call({})
    expect(response.status).toBe(409)
    expect((await response.json()).report.stopped).toBe('encryption_not_configured')
    expect(access).toEqual([])
  })

  it('resumes from a returned cursor', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    setup()
    const first = (await (await call({ batchSize: 1, maxBatches: 1 })).json()).report
    expect(first).toMatchObject({ done: false, nextCursor: U1, usersScanned: 1 })
    const second = (await (await call({ batchSize: 1, maxBatches: 1, cursor: first.nextCursor })).json()).report
    expect(second).toMatchObject({ startedAfter: U1, usersScanned: 1 })
  })

  it('a database failure is a controlled error with no database text', async () => {
    vi.stubEnv('PROVIDER_API_CREDENTIAL_MODE', 'dual')
    vi.stubEnv('BYOK_CREDENTIAL_ENCRYPTION_KEY', BYOK_KEY)
    tables = { user_settings: [], provider_api_credentials: [] }
    access = []
    store.__setPrivilegedCredentialClientForTests(makeDb('operator', tables, access, { failures: [{ table: 'user_settings', op: 'select' }] }))
    const response = await call({})
    const payload = await response.json()
    expect(payload.report.stopped).toBe('store_failure')
    expect(JSON.stringify(payload)).not.toContain('DUMMY')
  })
})
