import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from './helpers/fake-db'

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1
//
// Generate <-> Session lineage and server-owned Generate idempotency. The provider is a recording fake: NO real
// provider call, no network, no credits anywhere in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(async () => 'https://s3.example.test/signed.mp4?sig=1'),
  headS3Object: vi.fn(),
  readS3Object: vi.fn(),
}))
vi.mock('@/lib/provider-connections/token-store', () => ({
  getValidAccessToken: vi.fn(async () => 'MCP-ACCESS-TOKEN-SECRET'),
  forceRefreshAccessToken: vi.fn(async () => 'MCP-REFRESHED-TOKEN-SECRET'),
}))

const restCalls: Array<{ kind: string; args: any[] }> = []
let restFailure: Error | null = null
vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    submitImageToVideo = async (...args: any[]) => { restCalls.push({ kind: 'i2v', args }); if (restFailure) throw restFailure; return { task_id: `rest-task-${restCalls.length}` } }
    submitTextToVideo = async (...args: any[]) => { restCalls.push({ kind: 't2v', args }); if (restFailure) throw restFailure; return { task_id: `rest-task-${restCalls.length}` } }
    getTaskStatus = async () => ({ id: 'x', status: 'processing', created_at: 1, updated_at: 1 })
  },
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'

const USER_A = 'user-a'
const USER_B = 'user-b'
const PROJECT = 'proj-1'
const PRODUCTION = 'prod-1'
const OTHER_PRODUCTION = 'prod-2' // same user, same project
const OTHER_PROJECT = 'proj-2'
const OTHER_PROJECT_PRODUCTION = 'prod-3'
const FOREIGN_PROJECT = 'proj-b'
const FOREIGN_PRODUCTION = 'prod-b'
const SESSION_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const SESSION_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const SESSION_EMPTY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const SESSION_OTHER_PRODUCTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const SESSION_OTHER_PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const SESSION_FOREIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const KEY_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02'

const NOW = '2026-05-01T10:00:00.000000+00:00'
const sessionRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: USER_A,
  project_id: PROJECT,
  production_id: PRODUCTION,
  working_prompt: 'STALE AUTOSAVED DRAFT',
  working_config: { schemaVersion: 1, source: null, selection: { connectionRef: 'kling:api', operation: 'text_to_video', modelId: 'STALE-MODEL', duration: 10, resolution: '1080p', aspectRatio: '9:16', audio: 'on', multiShot: true, asmr: null, audioPrompt: null, musicPrompt: null } },
  created_at: NOW,
  updated_at: NOW,
  ...over,
})

function makeDb(over: { generations?: any[]; sessions?: any[]; klingKeys?: string[] } = {}) {
  return createFakeDb({
    seed: {
      user_settings: (over.klingKeys ?? [USER_A, USER_B]).map((user_id) => ({ user_id, kling_api_key: `key-of-${user_id}` })),
      provider_connections: [],
      productions: [
        { id: PRODUCTION, project_id: PROJECT, user_id: USER_A },
        { id: OTHER_PRODUCTION, project_id: PROJECT, user_id: USER_A },
        { id: OTHER_PROJECT_PRODUCTION, project_id: OTHER_PROJECT, user_id: USER_A },
        { id: FOREIGN_PRODUCTION, project_id: FOREIGN_PROJECT, user_id: USER_B },
      ],
      video_generation_sessions: over.sessions ?? [
        sessionRow(SESSION_1),
        sessionRow(SESSION_2),
        sessionRow(SESSION_EMPTY),
        sessionRow(SESSION_OTHER_PRODUCTION, { production_id: OTHER_PRODUCTION }),
        sessionRow(SESSION_OTHER_PROJECT, { project_id: OTHER_PROJECT, production_id: OTHER_PROJECT_PRODUCTION }),
        sessionRow(SESSION_FOREIGN, { user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: FOREIGN_PRODUCTION }),
      ],
      video_generations: over.generations ?? [],
      library_files: [],
    },
  }) as any
}

function signIn(db: any, userId: string | null = USER_A, fromOverride?: (table: string) => any) {
  vi.mocked(server.createClient).mockResolvedValue({
    from: fromOverride ?? db.from,
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) },
  } as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
}

const post = async (body: Record<string, unknown>) =>
  (await import('@/app/api/video-generations/route')).POST(new NextRequest('http://localhost/api/video-generations', { method: 'POST', body: JSON.stringify(body) }))
const getList = async (query = '') =>
  (await import('@/app/api/video-generations/route')).GET(new NextRequest(`http://localhost/api/video-generations${query}`))

const base = { projectId: PROJECT, productionId: PRODUCTION, mode: 'text_to_video', prompt: 'a red fox running' }
const generations = (db: any) => db.tables.video_generations as any[]
const submitted = () => restCalls.length

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  restCalls.length = 0
  restFailure = null
  process.env.NEXT_PUBLIC_APP_URL = 'https://content.example.test'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => consoleError.mockRestore())

// ===========================================================================
describe('Generate with sessionId — lineage and ownership', () => {
  it('a valid Session links the new attempt (session_id) and provider submit happens once', async () => {
    const db = makeDb()
    signIn(db)

    const response = await post({ ...base, sessionId: SESSION_1 })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(generations(db)).toHaveLength(1)
    expect(generations(db)[0]).toMatchObject({ user_id: USER_A, project_id: PROJECT, production_id: PRODUCTION, session_id: SESSION_1, status: 'submitted' })
    expect(body.generation.session_id).toBe(SESSION_1)
    expect(submitted()).toBe(1)
  })

  it('without sessionId the legacy path is unchanged: session_id NULL, still works', async () => {
    const db = makeDb()
    signIn(db)
    for (const extra of [{}, { sessionId: null }]) {
      expect((await post({ ...base, ...extra })).status).toBe(200)
    }
    expect(generations(db).map((g) => g.session_id ?? null)).toEqual([null, null])
    expect(submitted()).toBe(2)
  })

  it('the REQUEST BODY is the attempt authority: the Session’s stored draft/config is never used to build the submission', async () => {
    const db = makeDb()
    signIn(db)

    await post({ ...base, prompt: 'prompt confirmed at Generate time', model: 'kling-v2-6', duration: 5, resolution: '720p', sessionId: SESSION_1 })

    const row = generations(db)[0]
    expect(row.prompt).toBe('prompt confirmed at Generate time')
    expect(row.model).toBe('kling-v2-6')
    expect(row.request_config).toMatchObject({ duration: 5, resolution: '720p' })
    expect(JSON.stringify(restCalls)).toContain('prompt confirmed at Generate time')
    expect(JSON.stringify(restCalls)).not.toContain('STALE AUTOSAVED DRAFT')
    expect(JSON.stringify(restCalls)).not.toContain('STALE-MODEL')
    // Generate neither reads nor writes the Session's working state.
    expect(db.log).not.toContain('update:video_generation_sessions')
    expect(db.tables.video_generation_sessions.find((s: any) => s.id === SESSION_1).working_prompt).toBe('STALE AUTOSAVED DRAFT')
    const route = readFileSync(join(process.cwd(), 'app/api/video-generations/route.ts'), 'utf8')
    expect(route).not.toMatch(/working_prompt|working_config/)
  })

  it.each([
    ['another user’s Session', SESSION_FOREIGN, 404, 'SESSION_NOT_FOUND'],
    ['a nonexistent Session', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 404, 'SESSION_NOT_FOUND'],
    ['a same-user Session of another Production (same Project)', SESSION_OTHER_PRODUCTION, 409, 'SESSION_SCOPE_MISMATCH'],
    ['a same-user Session of another Project', SESSION_OTHER_PROJECT, 409, 'SESSION_SCOPE_MISMATCH'],
  ])('rejects %s — no attempt, no provider call', async (_name, sessionId, status, code) => {
    const db = makeDb()
    signIn(db)
    const response = await post({ ...base, sessionId })
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(generations(db)).toHaveLength(0)
    expect(submitted()).toBe(0)
  })

  it.each(['nope', 42, {}, ''])('rejects a malformed sessionId (%j)', async (sessionId) => {
    const db = makeDb()
    signIn(db)
    // '' is falsy but present: it is still a malformed id, never silently "no session".
    const response = await post({ ...base, sessionId })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_SESSION_ID')
    expect(generations(db)).toHaveLength(0)
    expect(submitted()).toBe(0)
  })

  it('Session 1 → Attempt A and B share the Session; Session 2 stays empty (lineage is by session_id only)', async () => {
    const db = makeDb()
    signIn(db)
    await post({ ...base, prompt: 'attempt A', sessionId: SESSION_1 })
    await post({ ...base, prompt: 'attempt B', sessionId: SESSION_1 })
    await post({ ...base, prompt: 'standalone legacy attempt' })

    expect(generations(db).map((g) => [g.prompt, g.session_id ?? null])).toEqual([
      ['attempt A', SESSION_1],
      ['attempt B', SESSION_1],
      ['standalone legacy attempt', null],
    ])
    expect(generations(db).filter((g) => g.session_id === SESSION_2)).toEqual([])
  })

  it('nothing re-parents an attempt: no video-generation route exports PATCH/PUT, and session_id is written only on POST insert', () => {
    const root = join(process.cwd(), 'app/api/video-generations')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry === 'route.ts') files.push(full)
      }
    }
    walk(root)
    expect(files.length).toBeGreaterThan(3)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/export\s+(async\s+)?function\s+(PATCH|PUT)\b/)
      const writesSessionId = /session_id/.test(text.replace(/\/\/.*$/gm, ''))
      expect(writesSessionId, file).toBe(file.endsWith(join('video-generations', 'route.ts')))
    }
  })
})

// ===========================================================================
describe('GET /api/video-generations?sessionId — attempts of a Session', () => {
  const attempt = (id: string, createdAt: string, over: Record<string, unknown> = {}) => ({
    id, user_id: USER_A, project_id: PROJECT, production_id: PRODUCTION, session_id: SESSION_1, mode: 'text_to_video', prompt: id, model: 'm', status: 'succeeded',
    request_fingerprint: 'INTERNAL-HASH', library_file_id: null, storage_path: null, created_at: createdAt, ...over,
  })

  it('lists exactly the Session’s attempts, newest first, with id breaking created_at ties (deterministic)', async () => {
    const db = makeDb({
      generations: [
        attempt('gen-a', '2026-05-01T10:00:00.000Z'),
        attempt('gen-c', '2026-05-01T10:00:02.000Z'),
        attempt('gen-b2', '2026-05-01T10:00:01.000Z'),
        attempt('gen-b1', '2026-05-01T10:00:01.000Z'), // ties with gen-b2
        attempt('gen-other-session', '2026-05-01T10:00:05.000Z', { session_id: SESSION_2 }),
        attempt('gen-legacy', '2026-05-01T10:00:06.000Z', { session_id: null }),
        attempt('gen-foreign', '2026-05-01T10:00:07.000Z', { user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: FOREIGN_PRODUCTION }),
      ],
    })
    signIn(db)

    const response = await getList(`?sessionId=${SESSION_1}`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.generations.map((g: any) => g.id)).toEqual(['gen-c', 'gen-b2', 'gen-b1', 'gen-a'])
  })

  it('a Session may have 0 attempts', async () => {
    signIn(makeDb())
    const response = await getList(`?sessionId=${SESSION_EMPTY}`)
    expect(response.status).toBe(200)
    expect((await response.json()).generations).toEqual([])
  })

  it.each([
    ['another user’s Session', SESSION_FOREIGN, 404],
    ['a nonexistent Session', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 404],
    ['a malformed id', 'nope', 400],
  ])('%s → %i, never another tenant’s attempts', async (_name, sessionId, status) => {
    const db = makeDb({ generations: [attempt('gen-foreign', NOW, { user_id: USER_B, session_id: SESSION_FOREIGN, prompt: 'B SECRET' })] })
    signIn(db)
    const response = await getList(`?sessionId=${sessionId}`)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('B SECRET')
  })

  it('without the filter the list is unchanged (every attempt of the caller, legacy included)', async () => {
    const db = makeDb({ generations: [attempt('gen-a', NOW), attempt('gen-legacy', NOW, { session_id: null })] })
    signIn(db)
    const body = await (await getList()).json()
    expect(body.generations.map((g: any) => g.id).sort()).toEqual(['gen-a', 'gen-legacy'])
  })

  it('never echoes the internal request fingerprint, and a GET writes nothing', async () => {
    const db = makeDb({ generations: [attempt('gen-a', NOW)] })
    signIn(db)
    const text = await (await getList(`?sessionId=${SESSION_1}`)).text()
    expect(text).not.toContain('INTERNAL-HASH')
    expect(text).not.toContain('request_fingerprint')
    expect(db.log.filter((entry: string) => !entry.startsWith('select:'))).toEqual([])
  })
})

// ===========================================================================
describe('Generate idempotency — one logical submit, one attempt, one provider call', () => {
  const keyed = (extra: Record<string, unknown> = {}) => ({ ...base, clientRequestId: KEY, ...extra })

  it('1. first request with a key creates ONE attempt and invokes the provider ONCE', async () => {
    const db = makeDb()
    signIn(db)

    const response = await post(keyed())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.idempotentReplay).toBeUndefined()
    expect(generations(db)).toHaveLength(1)
    expect(generations(db)[0]).toMatchObject({ user_id: USER_A, client_request_id: KEY, status: 'submitted' })
    expect(typeof generations(db)[0].request_fingerprint).toBe('string')
    expect(submitted()).toBe(1)
    // The internal fingerprint is never part of the response.
    expect(JSON.stringify(body)).not.toContain('request_fingerprint')
  })

  it('2. an exact retry with the same key returns the SAME attempt: no second row, provider NOT called again', async () => {
    const db = makeDb()
    signIn(db)
    const first = await (await post(keyed({ sessionId: SESSION_1 }))).json()

    const retry = await post(keyed({ sessionId: SESSION_1 }))
    const retryBody = await retry.json()

    expect(retry.status).toBe(200)
    expect(retryBody.idempotentReplay).toBe(true)
    expect(retryBody.generation.id).toBe(first.generation.id)
    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(1)
    expect(JSON.stringify(retryBody)).not.toContain('request_fingerprint')
  })

  it('a replay is insensitive to key order and unknown extra fields (the fingerprint is canonical)', async () => {
    const db = makeDb()
    signIn(db)
    await post({ prompt: base.prompt, mode: base.mode, productionId: PRODUCTION, projectId: PROJECT, clientRequestId: KEY })
    const retry = await post({ ...keyed(), somethingUnrelated: true })
    expect((await retry.json()).idempotentReplay).toBe(true)
    expect(submitted()).toBe(1)
  })

  it.each([
    ['a different prompt', { prompt: 'a DIFFERENT prompt' }],
    ['a different model', { model: 'kling-v2-6' }],
    ['a different duration', { duration: 10 }],
    ['a different mode/source', { mode: 'image_to_video', sourceImageId: 'img-1' }],
    ['a different Session', { sessionId: SESSION_2 }],
    ['a different Production', { productionId: OTHER_PRODUCTION }],
    ['a different connection pointer', { connectionRef: 'kling:account:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }],
  ])('3. the same key with %s is a safe 409 — the first attempt is NOT returned as if this request had been sent', async (_name, change) => {
    const db = makeDb()
    signIn(db)
    await post(keyed())
    const before = JSON.parse(JSON.stringify(generations(db)))

    const response = await post(keyed(change))

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(generations(db)).toEqual(before)
    expect(submitted()).toBe(1)
  })

  it('4. keys never cross users: user B reusing user A’s key creates B’s own attempt and cannot see A’s', async () => {
    const db = makeDb()
    signIn(db, USER_A)
    const a = await (await post(keyed())).json()

    signIn(db, USER_B)
    const bResponse = await post({ projectId: FOREIGN_PROJECT, productionId: FOREIGN_PRODUCTION, mode: 'text_to_video', prompt: 'B prompt', clientRequestId: KEY })
    const b = await bResponse.json()

    expect(bResponse.status).toBe(200)
    expect(b.idempotentReplay).toBeUndefined()
    expect(b.generation.id).not.toBe(a.generation.id)
    expect(generations(db).map((g) => [g.user_id, g.client_request_id])).toEqual([[USER_A, KEY], [USER_B, KEY]])
    expect(submitted()).toBe(2)
    // ...and the same payload from B is not mistaken for A's attempt either.
    expect(JSON.stringify(b)).not.toContain(a.generation.id)
  })

  it('5a. an in-flight attempt (queued, no task yet) replays as-is: it never invites a second paid submit', async () => {
    const fingerprintOf = async () => {
      const probe = makeDb()
      signIn(probe)
      await post(keyed())
      return generations(probe)[0].request_fingerprint as string
    }
    const fingerprint = await fingerprintOf()
    restCalls.length = 0
    const db = makeDb({ generations: [{ id: 'gen-inflight', user_id: USER_A, project_id: PROJECT, production_id: PRODUCTION, status: 'queued', task_id: null, client_request_id: KEY, request_fingerprint: fingerprint, prompt: base.prompt }] })
    signIn(db)

    const response = await post(keyed())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ idempotentReplay: true, outcomeUnknown: false, generation: { id: 'gen-inflight', status: 'queued' } })
    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(0)
  })

  it('5b. unknown provider outcome (network ambiguity) is recoverable: the retry returns the recorded attempt, flagged outcomeUnknown, and never submits again', async () => {
    const db = makeDb()
    signIn(db)
    restFailure = new Error('socket hang up') // not an HTTP answer from Kling -> the job may exist (and be billed)

    const first = await post(keyed())
    expect(first.status).toBe(502)
    expect((await first.json()).code).toBe('SUBMIT_OUTCOME_UNKNOWN')
    expect(submitted()).toBe(1)

    restFailure = null
    const retry = await post(keyed())
    const body = await retry.json()

    expect(retry.status).toBe(200)
    expect(body).toMatchObject({ idempotentReplay: true, outcomeUnknown: true, generation: { status: 'failed' } })
    expect(body.generation.error_details).toMatchObject({ outcome_unknown: true })
    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(1)
  })

  it('5c. a definitively refused submit is also one logical attempt: the same key returns it; a deliberate new try needs a new key', async () => {
    const db = makeDb()
    signIn(db)
    restFailure = new Error('Kling API HTTP error 400: bad prompt')

    expect((await post(keyed())).status).toBe(500)
    restFailure = null
    const replay = await (await post(keyed())).json()
    expect(replay).toMatchObject({ idempotentReplay: true, generation: { status: 'failed' } })
    expect(submitted()).toBe(1)

    const fresh = await post(keyed({ clientRequestId: KEY_2 }))
    expect(fresh.status).toBe(200)
    expect(generations(db)).toHaveLength(2)
    expect(submitted()).toBe(2)
  })

  it('6a. a concurrent duplicate that loses the insert race settles on the winner’s row: provider called once in total', async () => {
    const db = makeDb()
    signIn(db)
    const [one, two] = await Promise.all([post(keyed()), post(keyed())])
    const bodies = [await one.json(), await two.json()]

    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(1)
    expect(bodies.map((b) => b.generation.id)).toEqual([generations(db)[0].id, generations(db)[0].id])
    expect(bodies.filter((b) => b.idempotentReplay === true)).toHaveLength(1)
  })

  it('6b. losing the insert race AFTER the pre-check passed (unique violation) replays the winner without a provider call', async () => {
    const probe = makeDb()
    signIn(probe)
    await post(keyed())
    const winner = JSON.parse(JSON.stringify(generations(probe)[0]))
    restCalls.length = 0

    // The winner row exists, but the first pre-check read misses it (the race window).
    const db = makeDb({ generations: [winner] })
    let missed = false
    signIn(db, USER_A, (table: string) => {
      const builder = db.from(table)
      if (table === 'video_generations' && !missed) {
        const originalMaybeSingle = builder.maybeSingle
        builder.maybeSingle = () => { missed = true; return Promise.resolve({ data: null, error: null }) }
        void originalMaybeSingle
      }
      return builder
    })

    const response = await post(keyed())
    const body = await response.json()

    expect(missed).toBe(true)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ idempotentReplay: true, generation: { id: winner.id } })
    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(0)
  })

  it('7. if the key cannot be checked the request fails closed (503): nothing is created or submitted', async () => {
    const db = makeDb()
    signIn(db, USER_A, (table: string) => {
      const builder = db.from(table)
      if (table === 'video_generations') builder.maybeSingle = () => Promise.resolve({ data: null, error: { message: 'down' } })
      return builder
    })
    const response = await post(keyed())
    expect(response.status).toBe(503)
    expect(generations(db)).toHaveLength(0)
    expect(submitted()).toBe(0)
  })

  it.each(['nope', 42, {}, ''])('rejects a malformed clientRequestId (%j) before any work', async (clientRequestId) => {
    const db = makeDb()
    signIn(db)
    const response = await post({ ...base, clientRequestId })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_CLIENT_REQUEST_ID')
    expect(generations(db)).toHaveLength(0)
    expect(submitted()).toBe(0)
  })

  it('a request rejected BEFORE an attempt exists does not burn the key: the same key works once the cause is fixed', async () => {
    const db = makeDb({ klingKeys: [] }) // no Kling credential yet
    signIn(db)
    const refused = await post(keyed())
    expect(refused.status).toBe(422)
    expect(generations(db)).toHaveLength(0)

    db.tables.user_settings.push({ user_id: USER_A, kling_api_key: 'now-configured' })
    const retry = await post(keyed())
    expect(retry.status).toBe(200)
    expect(retry.status === 200 && (await retry.json()).idempotentReplay).toBeUndefined()
    expect(generations(db)).toHaveLength(1)
    expect(submitted()).toBe(1)
  })

  it('9. LEGACY (no key): behavior is explicitly unchanged — two identical requests are two attempts and two provider calls', async () => {
    const db = makeDb()
    signIn(db)
    expect((await post(base)).status).toBe(200)
    expect((await post(base)).status).toBe(200)
    expect(generations(db)).toHaveLength(2)
    expect(generations(db).map((g) => g.client_request_id ?? null)).toEqual([null, null])
    expect(generations(db).map((g) => g.request_fingerprint ?? null)).toEqual([null, null])
    // The legacy insert is byte-identical to the pre-036B row: none of the new columns is even sent.
    for (const row of generations(db)) {
      for (const column of ['session_id', 'client_request_id', 'request_fingerprint']) expect(row).not.toHaveProperty(column)
    }
    expect(submitted()).toBe(2)
  })

  it('a replay never resolves credentials or the provider: the check happens before any of that', async () => {
    const db = makeDb()
    signIn(db)
    await post(keyed())
    const userSettingsReadsBefore = db.log.filter((entry: string) => entry === 'select:user_settings').length
    await post(keyed())
    expect(db.log.filter((entry: string) => entry === 'select:user_settings')).toHaveLength(userSettingsReadsBefore)
  })
})
