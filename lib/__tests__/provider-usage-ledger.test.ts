import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'

// AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1 — data layer.
//
// The ledger is append-only, server-written, tenant-private, idempotent, and it
// never invents a number: unknown usage is stored as unknown, not as 0.
// No provider is called anywhere in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import * as server from '@/lib/supabase/server'
import {
  InvalidUsageEventError,
  recordProviderUsageEvent,
  toUsageEventRow,
  videoGenerationUsageEvent,
  videoGenerationUsageKey,
} from '@/lib/usage/provider-usage-recorder'
import { completeVideoGeneration, failVideoGeneration } from '@/lib/video-generation/completion'
import { syncGenerationWithProvider } from '@/lib/video-generation/polling'
import type { KlingVideoTransport } from '@/lib/video-generation/transport'

const ROOT = process.cwd()
const NOW = new Date('2026-09-29T12:00:00.000Z')
const CONNECTION_ID = '11111111-1111-4111-8111-111111111111'
const RESULT_URL = 'https://cdn.example.test/temp/result.mp4'
const stored = () => ({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/gen-1.mp4', mime: 'video/mp4', size: 10 })
const events = (db: any) => db.tables.provider_usage_events as Array<Record<string, any>>

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    user_id: 'user-a',
    project_id: 'proj-1',
    production_id: 'prod-1',
    provider: 'kling',
    mode: 'text_to_video',
    model: 'kling-video-v3_0',
    status: 'processing',
    task_id: 'task-1',
    transport: 'mcp',
    connection_id: CONNECTION_ID,
    request_config: { duration: 3, resolution: '720p', audio: 'off', multi_shot: false, aspect_ratio: '16:9', output_count: 1 },
    created_at: NOW.toISOString(),
    next_poll_at: NOW.toISOString(),
    poll_attempts: 1,
    ...overrides,
  }
}

const dbWith = (rows: Array<Record<string, unknown>>) => createFakeDb({ seed: { video_generations: rows, provider_usage_events: [] } }) as any
const identity = (overrides: Record<string, unknown> = {}) => ({ generationId: 'gen-1', taskId: 'task-1', transport: 'mcp' as const, ...overrides })

describe('recording a usage event', () => {
  it('the server can create an event, with provider/transport/connection/project provenance persisted', async () => {
    const db = dbWith([])
    await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation(), null, NOW))

    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({
      user_id: 'user-a',
      project_id: 'proj-1',
      production_id: 'prod-1',
      provider: 'kling',
      transport: 'mcp',
      connection_id: CONNECTION_ID,
      operation: 'text_to_video',
      model: 'kling-video-v3_0',
      resource_type: 'video_generation',
      resource_id: 'gen-1',
      provider_task_id: 'task-1',
      occurred_at: NOW.toISOString(),
    })
    // The exact non-secret settings that were sent are kept: consumption depends on them.
    expect(events(db)[0].provider_metadata).toEqual({ request: { duration: 3, resolution: '720p', audio: 'off', multi_shot: false, aspect_ratio: '16:9', output_count: 1 } })
  })

  it('quantity, unit and measurement source persist exactly as given (units are never converted)', async () => {
    const db = dbWith([])
    await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation({ id: 'g-a', transport: 'rest', connection_id: null }), { quantity: 3, unit: 'units', source: 'provider_reported' }))
    await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation({ id: 'g-b' }), { quantity: 18, unit: 'credits', source: 'balance_delta' }))

    expect(events(db).map((e) => [e.quantity, e.unit, e.measurement_source])).toEqual([
      [3, 'units', 'provider_reported'],
      [18, 'credits', 'balance_delta'],
    ])
  })

  it('UNKNOWN usage is stored as unknown — NULL quantity, NULL unit, source "unknown" — never as 0', async () => {
    const db = dbWith([])
    await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation(), null))
    const row = events(db)[0]
    expect(row.quantity).toBeNull()
    expect(row.unit).toBeNull()
    expect(row.measurement_source).toBe('unknown')
    expect(row.quantity).not.toBe(0)
  })

  it('a legacy generation without a transport is recorded as REST (the only transport that existed)', () => {
    expect(videoGenerationUsageEvent(generation({ transport: undefined, connection_id: undefined }), null).transport).toBe('rest')
  })

  it('a duplicate of the same provider charge is a no-op: one event, the original untouched', async () => {
    const db = dbWith([])
    const first = videoGenerationUsageEvent(generation(), { quantity: 3, unit: 'units', source: 'provider_reported' })
    await recordProviderUsageEvent(db, first)
    await recordProviderUsageEvent(db, first)
    // Even a later attempt with a different number cannot rewrite history (a correction is a NEW event).
    await recordProviderUsageEvent(db, videoGenerationUsageEvent(generation(), { quantity: 99, unit: 'units', source: 'estimated' }))

    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({ quantity: 3, measurement_source: 'provider_reported', idempotency_key: videoGenerationUsageKey('gen-1') })
  })

  it.each([
    ['a negative quantity', { quantity: -1, unit: 'units', source: 'provider_reported' }],
    ['NaN', { quantity: Number.NaN, unit: 'units', source: 'provider_reported' }],
    ['Infinity', { quantity: Number.POSITIVE_INFINITY, unit: 'credits', source: 'provider_reported' }],
    ['an unknown unit', { quantity: 1, unit: 'dollars', source: 'provider_reported' }],
    ['a measured quantity with source "unknown"', { quantity: 1, unit: 'units', source: 'unknown' }],
  ])('refuses %s instead of storing a wrong number', (_name, measurement) => {
    expect(() => toUsageEventRow({ ...videoGenerationUsageEvent(generation()), measurement: measurement as any })).toThrow(InvalidUsageEventError)
  })
})

describe('completion appends exactly one usage event', () => {
  it('REST: a provider-reported quantity (when the provider gave one) becomes ONE event', async () => {
    const db = dbWith([generation({ transport: 'rest', connection_id: null })])
    const result = await completeVideoGeneration(
      db,
      { ...identity({ transport: 'rest' }), resultUrl: RESULT_URL, usage: { quantity: 3, unit: 'units', source: 'provider_reported' } },
      { download: async () => stored(), now: () => NOW },
    )

    expect(result.outcome).toBe('completed')
    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({ transport: 'rest', connection_id: null, quantity: 3, unit: 'units', measurement_source: 'provider_reported', resource_id: 'gen-1' })
  })

  it('MCP: the provider supplies no task-level cost, so the event records the execution with UNKNOWN usage (nothing invented)', async () => {
    const db = dbWith([generation()])
    await completeVideoGeneration(db, { ...identity(), resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })

    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({ transport: 'mcp', connection_id: CONNECTION_ID, quantity: null, unit: null, measurement_source: 'unknown' })
  })

  it('a duplicate completion (webhook retry / overlapping poll) does not create a second event', async () => {
    const db = dbWith([generation()])
    const params = { ...identity(), resultUrl: RESULT_URL }
    await completeVideoGeneration(db, params, { download: async () => stored(), now: () => NOW })
    await completeVideoGeneration(db, params, { download: async () => stored(), now: () => NOW })
    await Promise.all([
      completeVideoGeneration(db, params, { download: async () => stored(), now: () => NOW }),
      completeVideoGeneration(db, params, { download: async () => stored(), now: () => NOW }),
    ])
    expect(events(db)).toHaveLength(1)
  })

  it('a duplicate delivery repairs a missing event (the process died between the terminal write and the ledger write)', async () => {
    const db = dbWith([generation()])
    await completeVideoGeneration(db, { ...identity(), resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })
    db.tables.provider_usage_events.length = 0

    await completeVideoGeneration(db, { ...identity(), resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })
    expect(events(db)).toHaveLength(1)
    // The repaired event keeps the ORIGINAL completion time, not "now".
    expect(events(db)[0].occurred_at).toBe(NOW.toISOString())
  })

  it('a ledger failure never undoes a durable completion', async () => {
    const db = dbWith([generation()])
    const original = db.from
    db.from = (table: string) => {
      const builder = original.call(db, table)
      if (table === 'provider_usage_events') builder.upsert = () => ({ then: (resolve: any) => resolve({ data: null, error: { message: 'store down' } }) })
      return builder
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const result = await completeVideoGeneration(db, { ...identity(), resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })

    expect(result.outcome).toBe('completed')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'succeeded', storage_path: 'user-a/videos/ai/proj-1/gen-1.mp4' })
    // Only the error class is logged.
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/store down/)
    consoleError.mockRestore()
  })

  it('a FAILED generation records no usage (nothing is known to have been consumed)', async () => {
    const db = dbWith([generation()])
    await failVideoGeneration(db, { ...identity(), code: 'PROVIDER_REJECTED', message: 'no' })
    expect(events(db)).toHaveLength(0)
  })

  it('an identity mismatch completes nothing and records nothing', async () => {
    const db = dbWith([generation()])
    await completeVideoGeneration(db, { ...identity({ taskId: 'someone-elses-task' }), resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })
    expect(events(db)).toHaveLength(0)
    expect(db.tables.video_generations[0].status).toBe('processing')
  })
})

describe('the MCP / REST poll paths (mocked provider)', () => {
  const transportReturning = (transport: 'mcp' | 'rest', status: any): KlingVideoTransport =>
    ({ transport, submit: vi.fn(), getStatus: vi.fn(async () => status) }) as any

  it('poll completion without a provider-reported quantity: one event, unknown usage — the number is never guessed', async () => {
    const db = dbWith([generation()])
    await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning('mcp', { state: 'succeeded', resultUrl: RESULT_URL, rawState: 'COMPLETED' }), {
      schedule: true,
      now: () => NOW,
      download: async () => stored(),
    })
    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({ quantity: null, unit: null, measurement_source: 'unknown', transport: 'mcp' })
  })

  it('a transport that DOES report task usage has it recorded once, in its own unit and as provider-reported', async () => {
    const db = dbWith([generation({ transport: 'rest', connection_id: null })])
    const status = { state: 'succeeded', resultUrl: RESULT_URL, rawState: 'succeeded', usage: { quantity: 3, unit: 'units', source: 'provider_reported' } }
    const options = { schedule: false, now: () => NOW, download: async () => stored() }
    await syncGenerationWithProvider(db, db.tables.video_generations[0], transportReturning('rest', status), options)
    await syncGenerationWithProvider(db, { ...db.tables.video_generations[0], status: 'processing' }, transportReturning('rest', status), options)
    expect(events(db)).toHaveLength(1)
    expect(events(db)[0]).toMatchObject({ transport: 'rest', quantity: 3, unit: 'units', measurement_source: 'provider_reported' })
  })
})

describe('migration 044 — append-only, server-written, tenant-private', () => {
  const FILE = '044_create_provider_usage_events.sql'
  const RAW = readFileSync(join(ROOT, 'scripts', FILE), 'utf8')
  const SQL = RAW.replace(/--.*$/gm, '')

  it('is the only 044, and earlier migrations are untouched', () => {
    const numbered = readdirSync(join(ROOT, 'scripts')).filter((name) => /^\d{3}_.*\.sql$/.test(name))
    expect(numbered.filter((name) => name.startsWith('044_'))).toEqual([FILE])
    for (const earlier of ['039_create_video_generations.sql', '042_video_generation_transport_provenance.sql', '043_video_generations_server_owned_writes.sql']) expect(numbered).toContain(earlier)
  })

  it('enables RLS with a single owner-read SELECT policy and no write policy', () => {
    expect(SQL).toMatch(/ALTER TABLE provider_usage_events ENABLE ROW LEVEL SECURITY/i)
    const policies = SQL.match(/CREATE POLICY[^;]*;/gi) ?? []
    expect(policies).toHaveLength(1)
    expect(policies[0]).toMatch(/FOR SELECT/i)
    expect(policies[0]).toMatch(/auth\.uid\(\)\s*=\s*user_id/i)
  })

  it('authenticated users can only SELECT: an authenticated client cannot forge, change or delete an event', () => {
    expect(SQL).toMatch(/REVOKE ALL ON TABLE provider_usage_events FROM PUBLIC, anon, authenticated, service_role/i)
    const grants = (SQL.match(/GRANT[^;]*;/gi) ?? []).map((statement) => statement.replace(/\s+/g, ' ').trim())
    expect(grants).toEqual([
      'GRANT SELECT ON TABLE provider_usage_events TO authenticated;',
      'GRANT SELECT, INSERT ON TABLE provider_usage_events TO service_role;',
    ])
  })

  it('the ledger is append-only even for the server: no UPDATE, DELETE or TRUNCATE is ever granted', () => {
    expect(SQL).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b/i)
  })

  it('stores provider-native quantities: nullable quantity+unit with a shape constraint, a unit vocabulary and a source vocabulary', () => {
    expect(SQL).toMatch(/quantity NUMERIC CHECK \(quantity IS NULL OR quantity >= 0\)/i)
    expect(SQL).toMatch(/quantity IS NULL AND unit IS NULL AND measurement_source = 'unknown'/i)
    expect(SQL).toMatch(/quantity IS NOT NULL AND unit IS NOT NULL AND measurement_source <> 'unknown'/i)
    for (const unit of ['credits', 'units', 'input_tokens', 'output_tokens', 'images', 'seconds', 'requests', 'characters']) expect(SQL).toContain(`'${unit}'`)
    for (const source of ['provider_reported', 'balance_delta', 'estimated', 'derived', 'manual_import', 'unknown']) expect(SQL).toContain(`'${source}'`)
  })

  it('one provider charge = one event (unique idempotency key) and it is not billing: no price, currency or balance column', () => {
    expect(SQL).toMatch(/CONSTRAINT provider_usage_events_idempotency_key UNIQUE \(idempotency_key\)/i)
    expect(SQL).not.toMatch(/\b(price|currency|amount_cents|cost|balance|wallet)\b/i)
  })

  it('deleting a project/production/connection keeps the history (SET NULL), deleting the user removes it', () => {
    expect(SQL).toMatch(/project_id UUID REFERENCES projects\(id\) ON DELETE SET NULL/i)
    expect(SQL).toMatch(/connection_id UUID REFERENCES provider_connections\(id\) ON DELETE SET NULL/i)
    expect(SQL).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/i)
  })
})

describe('no application code writes the ledger except the server recorder', () => {
  const files: Array<{ path: string; text: string }> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push({ path: full.slice(ROOT.length + 1).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') })
    }
  }
  for (const dir of ['app', 'lib', 'components']) walk(join(ROOT, dir))

  it('only the recorder, the admin-only historical importer and the read-only settings route reference the table', () => {
    expect(files.filter((file) => file.text.includes('provider_usage_events')).map((file) => file.path).sort()).toEqual([
      'app/api/settings/usage/route.ts',
      'lib/usage/historical-proofs.ts',
      'lib/usage/provider-usage-recorder.ts',
    ])
  })

  it('the historical importer is admin-only: no route, page or component imports it', () => {
    const importers = files.filter((file) => /^(app|components)\//.test(file.path) && file.text.includes('historical-proofs'))
    expect(importers.map((file) => file.path)).toEqual([])
  })

  it('the settings route only reads: no insert/upsert/update/delete', () => {
    // Code only: the route's own comments mention the service role to explain why it is NOT used.
    const route = files.find((file) => file.path === 'app/api/settings/usage/route.ts')!.text.replace(/\/\/.*$/gm, '')
    expect(route).not.toMatch(/\.(insert|upsert|update|delete)\(/)
    expect(route).not.toMatch(/service-role|createServiceRoleSupabase/)
  })

  it('the recorder is never imported by a client component', () => {
    const offenders = files.filter((file) => /^['"]use client['"]/m.test(file.text) && file.text.includes('provider-usage-recorder'))
    expect(offenders.map((file) => file.path)).toEqual([])
  })
})

describe('GET /api/settings/usage — tenant-private read', () => {
  const eventRow = (overrides: Record<string, unknown>) => ({
    id: 'e1',
    user_id: 'user-a',
    occurred_at: '2026-09-29T12:00:00.000Z',
    provider: 'kling',
    transport: 'mcp',
    operation: 'text_to_video',
    model: 'kling-video-v3_0',
    quantity: null,
    unit: null,
    measurement_source: 'unknown',
    project_id: 'proj-1',
    connection_id: CONNECTION_ID,
    provider_task_id: 'SECRET-TASK-ID',
    provider_metadata: { request: { duration: 3 } },
    idempotency_key: 'video_generation:g:completed',
    ...overrides,
  })

  function signIn(db: any, userId: string | null = 'user-a') {
    vi.mocked(server.createClient).mockResolvedValue({
      from: db.from,
      auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    } as any)
  }
  const get = async () => (await import('@/app/api/settings/usage/route')).GET()

  beforeEach(() => vi.clearAllMocks())

  it('requires authentication', async () => {
    signIn(createFakeDb() as any, null)
    expect((await get()).status).toBe(401)
  })

  it('tenant A never receives tenant B usage (or their project/connection names)', async () => {
    const db = createFakeDb({
      seed: {
        provider_usage_events: [
          eventRow({ id: 'a1' }),
          eventRow({ id: 'b1', user_id: 'user-b', project_id: 'proj-b', connection_id: null, transport: 'rest' }),
        ],
        projects: [{ id: 'proj-1', name: 'Projeto A' }, { id: 'proj-b', name: 'Projeto do outro usuário' }],
        provider_connections: [],
      },
    }) as any
    signIn(db)
    const body = await (await get()).json()

    expect(body.events.map((event: any) => event.id)).toEqual(['a1'])
    expect(JSON.stringify(body)).not.toMatch(/proj-b|outro usuário|user-b/)
  })

  it('returns display columns only: no provider task id, metadata or idempotency key', async () => {
    const db = createFakeDb({ seed: { provider_usage_events: [eventRow({})], projects: [{ id: 'proj-1', name: 'Projeto A' }], provider_connections: [] } }) as any
    signIn(db)
    const body = await (await get()).json()
    expect(Object.keys(body.events[0]).sort()).toEqual(
      ['connection_id', 'historical_import', 'id', 'measurement_source', 'model', 'occurred_at', 'operation', 'project_id', 'provider', 'quantity', 'transport', 'unit'].sort(),
    )
    expect(JSON.stringify(body)).not.toMatch(/SECRET-TASK-ID|idempotency|provider_metadata/)
    expect(body.projects).toEqual({ 'proj-1': 'Projeto A' })
  })

  it('exposes only a boolean "historical_import" derived from provider_metadata — the metadata itself never leaves the server', async () => {
    const db = createFakeDb({
      seed: {
        provider_usage_events: [
          eventRow({ id: 'imported', provider_metadata: { historical_import: true, historical_evidence: 'verified_real_provider_proof', provider_billing: { charge_type: 'unit' } } }),
          eventRow({ id: 'live', provider_metadata: { request: { duration: 3 } } }),
        ],
        projects: [],
        provider_connections: [],
      },
    }) as any
    signIn(db)
    const raw = await (await get()).json()
    const byId = Object.fromEntries(raw.events.map((event: any) => [event.id, event]))
    expect(byId.imported.historical_import).toBe(true)
    expect(byId.live.historical_import).toBe(false)
    expect(JSON.stringify(raw)).not.toMatch(/verified_real_provider_proof|charge_type|provider_billing/)
  })

  it('keeps unknown usage as null (not 0) and normalises a NUMERIC that arrives as a string', async () => {
    const db = createFakeDb({
      seed: {
        provider_usage_events: [
          eventRow({ id: 'unknown' }),
          eventRow({ id: 'known', quantity: '18', unit: 'credits', measurement_source: 'balance_delta' }),
        ],
        projects: [],
        provider_connections: [],
      },
    }) as any
    signIn(db)
    const byId = Object.fromEntries((await (await get()).json()).events.map((event: any) => [event.id, event]))
    expect(byId.unknown.quantity).toBeNull()
    expect(byId.known.quantity).toBe(18)
    expect(byId.known.unit).toBe('credits')
  })

  it('names the account connection from the user’s own connection row (membership label), and never invents one', async () => {
    const db = createFakeDb({
      seed: {
        provider_usage_events: [eventRow({ id: 'known-conn' }), eventRow({ id: 'gone', connection_id: null })],
        projects: [],
        provider_connections: [{ id: CONNECTION_ID, user_id: 'user-a', provider: 'kling', connection_method: 'mcp_oauth', status: 'connected', scopes: [], capabilities: { membership: { label: 'Pro' } }, last_checked_at: null }],
      },
    }) as any
    signIn(db)
    const body = await (await get()).json()
    expect(body.connections).toEqual({ [CONNECTION_ID]: 'Minha conta Kling — Pro' })
  })

  it('reports hasMore beyond the 200-event window', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => eventRow({ id: `e${index}` }))
    const db = createFakeDb({ seed: { provider_usage_events: rows, projects: [], provider_connections: [] } }) as any
    signIn(db)
    const body = await (await get()).json()
    expect(body.events).toHaveLength(200)
    expect(body.hasMore).toBe(true)
  })

  it('a store failure is a 503 with a specific code — never an empty history that reads as "no usage"', async () => {
    const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, then: (resolve: any) => resolve({ data: null, error: { message: 'down' } }) }
    vi.mocked(server.createClient).mockResolvedValue({ from: () => chain, auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) } } as any)
    const response = await get()
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe('USAGE_UNAVAILABLE')
  })
})
