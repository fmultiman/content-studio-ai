import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/fake-db'
import {
  applyBackfill,
  deriveOccurredAt,
  formatPlan,
  HISTORICAL_PROOFS,
  loadAndPlanBackfill,
  planBackfill,
  toInsertSql,
  verifyProofRow,
} from '@/lib/usage/historical-proofs'
import { videoGenerationUsageKey } from '@/lib/usage/provider-usage-recorder'
import { completeVideoGeneration } from '@/lib/video-generation/completion'

// USAGE_SETTINGS_POLISH_AND_HISTORICAL_PROOFS_V1 — the bounded import of THREE
// verified historical usage facts. No provider is contacted; every row below is
// an in-memory fixture shaped like the trusted database row.

const ROOT = process.cwd()
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRODUCTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CONNECTION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const [I2V, T2V, MCP] = HISTORICAL_PROOFS
const I2V_OBJECT_MS = Date.parse('2026-09-28T07:38:26.381Z')
const T2V_OBJECT_MS = Date.parse('2026-09-28T20:58:46.861Z')

const restRow = (proof: typeof I2V, objectMs: number, createdAt: string, overrides: Record<string, unknown> = {}) => ({
  id: proof.generationId,
  user_id: OWNER,
  project_id: PROJECT,
  production_id: PRODUCTION,
  provider: 'kling',
  transport: null, // legacy rows: REST by definition
  connection_id: null,
  mode: proof.operation,
  model: 'kling-v3',
  task_id: proof.providerTaskId,
  status: 'succeeded',
  storage_path: `${OWNER}/videos/ai/${PROJECT}/${objectMs}-xjzk8p.mp4`,
  created_at: createdAt,
  result_metadata: {},
  request_config: { duration: 5, resolution: '720p', audio: 'off', multi_shot: false, aspect_ratio: '9:16' },
  ...overrides,
})

const rowI2V = (overrides: Record<string, unknown> = {}) => restRow(I2V, I2V_OBJECT_MS, '2026-09-28T07:29:54.352Z', overrides)
const rowT2V = (overrides: Record<string, unknown> = {}) => restRow(T2V, T2V_OBJECT_MS, '2026-09-28T20:56:55.158Z', overrides)
const rowMcp = (overrides: Record<string, unknown> = {}) => ({
  id: MCP.generationId,
  user_id: OWNER,
  project_id: PROJECT,
  production_id: PRODUCTION,
  provider: 'kling',
  transport: 'mcp',
  connection_id: CONNECTION,
  mode: 'text_to_video',
  model: 'kling-video-v3_0',
  task_id: 'opaque-mcp-generation-id',
  status: 'succeeded',
  storage_path: `${OWNER}/videos/ai/${PROJECT}/${MCP.generationId}.mp4`,
  created_at: '2026-09-29T19:59:43.047Z',
  result_metadata: { completed_at: '2026-09-29T20:01:46.620Z', provider_state: 'COMPLETED', transport: 'mcp', provider_task_id: 'opaque-mcp-generation-id' },
  request_config: { audio: 'off', duration: 3, multi_shot: false, resolution: '720p', aspect_ratio: '16:9', output_count: 1 },
  ...overrides,
})

const threeRows = () => [rowI2V(), rowT2V(), rowMcp()]
const dbWith = (rows: Array<Record<string, any>>) => createFakeDb({ seed: { video_generations: rows, provider_usage_events: [] } }) as any
const ledger = (db: any) => db.tables.provider_usage_events as Array<Record<string, any>>
const eventFor = (db: any, id: string) => ledger(db).find((event) => event.resource_id === id)!

describe('the allowlist', () => {
  it('is exactly three distinct generations, and nothing else is in scope', () => {
    expect(HISTORICAL_PROOFS).toHaveLength(3)
    expect(new Set(HISTORICAL_PROOFS.map((proof) => proof.generationId)).size).toBe(3)
    expect(HISTORICAL_PROOFS.map((proof) => [proof.transport, proof.operation])).toEqual([
      ['rest', 'image_to_video'],
      ['rest', 'text_to_video'],
      ['mcp', 'text_to_video'],
    ])
  })

  it('no owner, project or connection id is hard-coded: the only UUIDs in the importer are the three generation ids', () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    const allowed = new Set(HISTORICAL_PROOFS.map((proof) => proof.generationId))
    for (const file of ['lib/usage/historical-proofs.ts', 'scripts/backfill-verified-provider-usage-proofs.mjs']) {
      const found = readFileSync(join(ROOT, file), 'utf8').match(uuid) ?? []
      expect(found.filter((id) => !allowed.has(id.toLowerCase()))).toEqual([])
    }
  })

  it('does not embed raw account balances (only the observed delta is a fact worth storing)', () => {
    const text = readFileSync(join(ROOT, 'lib/usage/historical-proofs.ts'), 'utf8') + readFileSync(join(ROOT, 'scripts/backfill-verified-provider-usage-proofs.mjs'), 'utf8')
    expect(text).not.toMatch(/48896|48878/)
  })
})

describe('dry run (the default) writes nothing', () => {
  it('plans three verified, missing events and touches neither table', async () => {
    const db = dbWith(threeRows())
    const plan = await loadAndPlanBackfill(db)

    expect(plan.ok).toBe(true)
    expect(plan.toInsert).toHaveLength(3)
    expect(plan.alreadyPresent).toBe(0)
    expect(plan.statuses.map((status) => status.state)).toEqual(['missing', 'missing', 'missing'])
    expect(ledger(db)).toHaveLength(0)
    expect(db.log.filter((entry: string) => /^(insert|upsert|update|delete):/.test(entry))).toEqual([])
  })

  it('reports each event with redacted owner/project ids', async () => {
    const plan = await loadAndPlanBackfill(dbWith(threeRows()))
    const report = formatPlan(plan, 'dry-run')
    expect(report).toContain('DRY-RUN')
    expect(report).toContain('candidates=3 missing=3 already_present=0 ok=true')
    expect(report).not.toContain(OWNER)
    expect(report).not.toContain(PROJECT)
    expect(report).toContain('3 units (provider_reported)')
    expect(report).toContain('18 credits (balance_delta)')
  })
})

describe('verification blocks the whole import when a fact does not match', () => {
  const cases: Array<[string, (rows: Record<string, any>[]) => Record<string, any>[], RegExp]> = [
    ['an expected generation is missing', (rows) => rows.filter((row) => row.id !== T2V.generationId), /generation not found/],
    ['a generation is not succeeded', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, status: 'failed' } : row)), /status is "failed"/],
    ['a generation is still processing', (rows) => rows.map((row) => (row.id === MCP.generationId ? { ...row, status: 'processing' } : row)), /status is "processing"/],
    ['a REST proof row is actually MCP', (rows) => rows.map((row) => (row.id === T2V.generationId ? { ...row, transport: 'mcp' } : row)), /transport is "mcp", expected "rest"/],
    ['the MCP proof row is actually REST', (rows) => rows.map((row) => (row.id === MCP.generationId ? { ...row, transport: 'rest', connection_id: null } : row)), /transport is "rest", expected "mcp"/],
    ['the operation differs', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, mode: 'text_to_video' } : row)), /operation is "text_to_video", expected "image_to_video"/],
    ['the known provider task differs', (rows) => rows.map((row) => (row.id === T2V.generationId ? { ...row, task_id: '999' } : row)), /provider task id does not match/],
    ['the MCP model differs', (rows) => rows.map((row) => (row.id === MCP.generationId ? { ...row, model: 'kling-video-v3_0_turbo' } : row)), /model is "kling-video-v3_0_turbo"/],
    ['the MCP settings differ (duration)', (rows) => rows.map((row) => (row.id === MCP.generationId ? { ...row, request_config: { ...row.request_config, duration: 10 } } : row)), /request duration does not match/],
    ['the provider is not Kling', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, provider: 'openai' } : row)), /provider is "openai"/],
    ['a row has no owner', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, user_id: null } : row)), /row has no owner/],
    ['the MCP row has no connection', (rows) => rows.map((row) => (row.id === MCP.generationId ? { ...row, connection_id: null } : row)), /MCP row has no connection/],
    ['the stored result is outside the owner namespace', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, storage_path: `someone-else/videos/ai/${PROJECT}/${I2V_OBJECT_MS}-x.mp4` } : row)), /outside the owner namespace/],
    ['no reliable completion time exists', (rows) => rows.map((row) => (row.id === I2V.generationId ? { ...row, storage_path: `${OWNER}/videos/ai/${PROJECT}/random-name.mp4` } : row)), /no reliable historical completion time/],
  ]

  it.each(cases)('%s → nothing is planned for insertion and applying is refused', async (_name, mutate, message) => {
    const db = dbWith(mutate(threeRows()))
    const plan = await loadAndPlanBackfill(db)

    expect(plan.ok).toBe(false)
    expect(plan.statuses.some((status) => status.state === 'invalid' && status.problems.some((problem) => message.test(problem)))).toBe(true)
    await expect(applyBackfill(db, plan)).rejects.toThrow(/refusing to apply/)
    expect(() => toInsertSql(plan)).toThrow(/refusing to emit SQL/)
    expect(ledger(db)).toHaveLength(0)
  })

  it('a valid row set has no problems', () => {
    for (const [row, proof] of [[rowI2V(), I2V], [rowT2V(), T2V], [rowMcp(), MCP]] as const) expect(verifyProofRow(row, proof)).toEqual([])
  })
})

describe('the imported events', () => {
  async function applied() {
    const db = dbWith(threeRows())
    const plan = await loadAndPlanBackfill(db)
    await applyBackfill(db, plan)
    return db
  }

  it('REST image-to-video: 3 units, provider_reported, Kling API', async () => {
    const event = eventFor(await applied(), I2V.generationId)
    expect(event).toMatchObject({ provider: 'kling', transport: 'rest', operation: 'image_to_video', quantity: 3, unit: 'units', measurement_source: 'provider_reported', connection_id: null })
  })

  it('REST text-to-video: 3 units, provider_reported', async () => {
    const event = eventFor(await applied(), T2V.generationId)
    expect(event).toMatchObject({ transport: 'rest', operation: 'text_to_video', quantity: 3, unit: 'units', measurement_source: 'provider_reported' })
  })

  it('MCP text-to-video: 18 credits as a BALANCE DELTA — never presented as provider-reported', async () => {
    const event = eventFor(await applied(), MCP.generationId)
    expect(event).toMatchObject({ transport: 'mcp', operation: 'text_to_video', model: 'kling-video-v3_0', quantity: 18, unit: 'credits', measurement_source: 'balance_delta', connection_id: CONNECTION })
    expect(event.measurement_source).not.toBe('provider_reported')
  })

  it('owner, project, production and connection come from the trusted row, not from the importer', async () => {
    const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const rows = [rowI2V({ user_id: OTHER, storage_path: `${OTHER}/videos/ai/${PROJECT}/${I2V_OBJECT_MS}-x.mp4` }), rowT2V(), rowMcp()]
    const db = dbWith(rows)
    await applyBackfill(db, await loadAndPlanBackfill(db))
    expect(eventFor(db, I2V.generationId).user_id).toBe(OTHER)
    expect(eventFor(db, T2V.generationId).user_id).toBe(OWNER)
    expect(eventFor(db, MCP.generationId)).toMatchObject({ user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, connection_id: CONNECTION })
  })

  it('carries historical-import metadata: what makes it historical, the evidence, and how the time was derived', async () => {
    const db = await applied()
    expect(eventFor(db, I2V.generationId).provider_metadata).toMatchObject({
      historical_import: true,
      historical_evidence: 'verified_real_provider_proof',
      occurred_at_source: 'storage_object_timestamp',
      provider_billing: { charge_type: 'unit', package_type: 'video' },
    })
    expect(eventFor(db, T2V.generationId).provider_metadata).toMatchObject({ historical_import: true, historical_evidence: 'verified_real_provider_proof' })
    expect(eventFor(db, T2V.generationId).provider_metadata.provider_billing).toBeUndefined()
    expect(eventFor(db, MCP.generationId).provider_metadata).toMatchObject({
      historical_import: true,
      historical_evidence: 'verified_single_generation_balance_delta',
      occurred_at_source: 'result_metadata.completed_at',
      measurement: 'balance_before_minus_balance_after',
    })
    // The non-secret request settings are kept, and nothing sensitive is.
    expect(eventFor(db, MCP.generationId).provider_metadata.request).toMatchObject({ duration: 3, resolution: '720p', audio: 'off', multi_shot: false })
    expect(JSON.stringify(ledger(db))).not.toMatch(/token|secret|password|api[_-]?key|X-Amz|signature|48896|48878/i)
  })

  it('occurred_at is the historical completion time, never the import time', async () => {
    const db = await applied()
    expect(eventFor(db, I2V.generationId).occurred_at).toBe('2026-09-28T07:38:26.381Z')
    expect(eventFor(db, T2V.generationId).occurred_at).toBe('2026-09-28T20:58:46.861Z')
    expect(eventFor(db, MCP.generationId).occurred_at).toBe('2026-09-29T20:01:46.620Z')
    for (const event of ledger(db)) expect(Date.parse(event.occurred_at)).toBeLessThan(Date.now() - 60_000)
  })

  it('the completion time is derived only from stored data and only when plausible', () => {
    expect(deriveOccurredAt(rowMcp())).toEqual({ at: new Date('2026-09-29T20:01:46.620Z'), source: 'result_metadata.completed_at' })
    expect(deriveOccurredAt(rowI2V())).toEqual({ at: new Date(I2V_OBJECT_MS), source: 'storage_object_timestamp' })
    // Before the row existed, or more than 24 h after it: not a completion time.
    expect(deriveOccurredAt(rowI2V({ created_at: '2026-09-28T07:40:00.000Z' }))).toBeNull()
    expect(deriveOccurredAt(rowI2V({ created_at: '2026-09-20T00:00:00.000Z' }))).toBeNull()
    expect(deriveOccurredAt(rowI2V({ storage_path: null }))).toBeNull()
  })

  it('uses the SAME idempotency key as the normal completion recorder', async () => {
    const db = await applied()
    for (const proof of HISTORICAL_PROOFS) {
      expect(eventFor(db, proof.generationId).idempotency_key).toBe(`video_generation:${proof.generationId}:completed`)
      expect(eventFor(db, proof.generationId).idempotency_key).toBe(videoGenerationUsageKey(proof.generationId))
    }
  })

  it('a later duplicate completion of the same generation cannot append a parallel event or rewrite the imported one', async () => {
    const db = await applied()
    await completeVideoGeneration(db, { generationId: MCP.generationId, taskId: 'opaque-mcp-generation-id', transport: 'mcp', resultUrl: 'https://cdn.example.test/v.mp4' }, { download: vi.fn() as any })
    expect(ledger(db)).toHaveLength(3)
    expect(eventFor(db, MCP.generationId)).toMatchObject({ quantity: 18, unit: 'credits', measurement_source: 'balance_delta' })
    expect(eventFor(db, MCP.generationId).provider_metadata.historical_import).toBe(true)
  })
})

describe('idempotency', () => {
  it('apply → check → apply again: 3 inserted, then 0 missing / 3 present, then still exactly 3 rows', async () => {
    const db = dbWith(threeRows())

    const first = await loadAndPlanBackfill(db)
    expect(first.toInsert).toHaveLength(3)
    await applyBackfill(db, first)
    expect(ledger(db)).toHaveLength(3)

    const check = await loadAndPlanBackfill(db)
    expect(check.ok).toBe(true)
    expect(check.toInsert).toHaveLength(0)
    expect(check.alreadyPresent).toBe(3)
    expect(check.statuses.map((status) => status.state)).toEqual(['present', 'present', 'present'])

    // A stale plan applied again is still harmless: ON CONFLICT DO NOTHING.
    await applyBackfill(db, first)
    await applyBackfill(db, await loadAndPlanBackfill(db))
    expect(ledger(db)).toHaveLength(3)
  })

  it('a partially present ledger only receives the missing events', async () => {
    const db = dbWith(threeRows())
    await applyBackfill(db, planBackfill(threeRows(), new Set(), [MCP]))
    expect(ledger(db)).toHaveLength(1)

    const plan = await loadAndPlanBackfill(db)
    expect(plan.alreadyPresent).toBe(1)
    expect(plan.toInsert.map((event) => event.proof.generationId)).toEqual([I2V.generationId, T2V.generationId])
    await applyBackfill(db, plan)
    expect(ledger(db)).toHaveLength(3)
  })
})

describe('nothing unverified or unlisted is imported', () => {
  it('a failed request, and any other generation, never enters the ledger', async () => {
    const failedSibling = rowT2V({ id: 'f7c87270-936e-4f3b-8c51-612ad8a68f27', status: 'failed', task_id: null, storage_path: null })
    const unlisted = rowMcp({ id: '00000000-0000-4000-8000-000000000001', task_id: 'another-task' })
    const db = dbWith([...threeRows(), failedSibling, unlisted])
    await applyBackfill(db, await loadAndPlanBackfill(db))

    expect(ledger(db).map((event) => event.resource_id).sort()).toEqual(HISTORICAL_PROOFS.map((proof) => proof.generationId).sort())
    expect(ledger(db).some((event) => event.resource_id === failedSibling.id || event.resource_id === unlisted.id)).toBe(false)
  })
})

describe('offline SQL emitter (for operators who can only run SQL)', () => {
  const plan = () => planBackfill(threeRows(), new Set())

  it('emits ONE idempotent INSERT with the same three events', () => {
    const sql = toInsertSql(plan())!
    expect(sql.match(/^INSERT INTO provider_usage_events/gm)).toHaveLength(1)
    expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING;$/)
    expect(sql.match(/video_generation:[0-9a-f-]{36}:completed/g)).toHaveLength(3)
    expect(sql).toContain("'balance_delta'")
    expect(sql).toContain("'provider_reported'")
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/)
  })

  it('emits nothing when everything is already present', () => {
    const existing = new Set(HISTORICAL_PROOFS.map((proof) => videoGenerationUsageKey(proof.generationId)))
    expect(toInsertSql(planBackfill(threeRows(), existing))).toBeNull()
  })

  it('escapes quotes so a value can never break out of its literal', () => {
    const rows = threeRows().map((row) => (row.id === MCP.generationId ? { ...row, model: "kling'; DROP TABLE video_generations; --" } : row))
    // A row like that fails verification first, so the emitter refuses; the escape is proven on a permissive proof.
    expect(() => toInsertSql(planBackfill(rows, new Set()))).toThrow()
    const permissive = { ...MCP, expectedModel: "kling'; DROP TABLE video_generations; --" }
    const sql = toInsertSql(planBackfill(rows, new Set(), [permissive]))!
    expect(sql).toContain("'kling''; DROP TABLE video_generations; --'")
  })
})

describe('CLI (offline mode — no network, never writes)', () => {
  // The real environment, with any server credential explicitly removed: the CLI must work (or refuse) without one.
  const withoutServerCredentials = () => ({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined })

  const run = (payload: unknown, extraArgs: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'usage-proofs-'))
    const file = join(dir, 'rows.json')
    writeFileSync(file, JSON.stringify(payload))
    return spawnSync(process.execPath, [join(ROOT, 'scripts/backfill-verified-provider-usage-proofs.mjs'), '--from-json', file, ...extraArgs], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 60_000,
      env: withoutServerCredentials(),
    })
  }

  it('dry-runs the three proofs and emits the idempotent SQL', () => {
    const result = run({ generations: threeRows(), existingKeys: [] }, ['--emit-sql'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('DRY-RUN')
    expect(result.stdout).toContain('candidates=3 missing=3 already_present=0 ok=true')
    expect(result.stdout).toContain('ON CONFLICT (idempotency_key) DO NOTHING')
    // The human report redacts owner/project ids; the SQL naturally carries the ids it inserts.
    const report = result.stdout.split('INSERT INTO')[0]
    expect(report).not.toContain(OWNER)
    expect(report).not.toContain(PROJECT)
  })

  it('a second look after the import reports 0 missing / 3 present and emits nothing', () => {
    const keys = HISTORICAL_PROOFS.map((proof) => videoGenerationUsageKey(proof.generationId))
    const result = run({ generations: threeRows(), existingKeys: keys }, ['--emit-sql'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('candidates=3 missing=0 already_present=3 ok=true')
    expect(result.stdout).toContain('-- nothing to insert')
  })

  it('exits non-zero and emits no SQL when a proof does not verify', () => {
    const result = run({ generations: threeRows().filter((row) => row.id !== I2V.generationId), existingKeys: [] }, ['--emit-sql'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('generation not found')
    expect(result.stdout).not.toContain('INSERT INTO')
  })

  it('refuses --apply in offline mode', () => {
    const result = run({ generations: threeRows(), existingKeys: [] }, ['--apply'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/offline mode never writes/)
  })

  it('online mode without a server credential refuses to start (and never prints one)', () => {
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/backfill-verified-provider-usage-proofs.mjs')], {
      encoding: 'utf8',
      cwd: ROOT,
      timeout: 60_000,
      env: withoutServerCredentials(),
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/SUPABASE_SERVICE_ROLE_KEY are required/)
  })
})
