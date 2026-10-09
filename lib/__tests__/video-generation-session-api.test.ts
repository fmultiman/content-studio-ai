import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from './helpers/fake-db'
import { REST_CONNECTION_REF, accountConnectionRef } from '@/lib/video-generation/connection-ref'
import { SESSION_LIMITS } from '@/lib/video-generation/session'
import { attemptToWorkingState } from '@/lib/video-generation/working-state'
import { restoreEnvironment, simulateEnvironment } from '@/lib/providers/__tests__/policy-env'

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1
//
// Session create/get/patch/list contract: tenant isolation, server-owned writes, optimistic concurrency, working
// state validation and "read is read". Everything is in memory; there is no provider anywhere in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SESSION_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2'
const USER_A = 'user-a'
const USER_B = 'user-b'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const PRODUCTION = '22222222-2222-4222-8222-222222222222'
const OTHER_PRODUCTION = '33333333-3333-4333-8333-333333333333' // same user, SAME project
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_PRODUCTION = '55555555-5555-4555-8555-555555555555'
const FOREIGN_PROJECT = '66666666-6666-4666-8666-666666666666'
const FOREIGN_PRODUCTION = '77777777-7777-4777-8777-777777777777'
const CONNECTION_ID = '88888888-8888-4888-8888-888888888888'
const IMG = '99999999-9999-4999-8999-999999999999'
const LIB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const selection = (over: Record<string, unknown> = {}) => ({
  connectionRef: REST_CONNECTION_REF,
  operation: 'text_to_video',
  modelId: 'kling-v2-6',
  duration: 5,
  resolution: '720p',
  aspectRatio: '16:9',
  audio: 'off',
  multiShot: false,
  asmr: null,
  audioPrompt: null,
  musicPrompt: null,
  ...over,
})
const state = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, prompt: 'a red fox running', source: null, selection: selection(), ...over })

let clock = 0
const stamp = (n: number) => `2026-05-01T10:00:00.${String(n).padStart(6, '0')}+00:00`

function makeDb(sessions: any[] = []) {
  return createFakeDb({
    seed: {
      productions: [
        { id: PRODUCTION, project_id: PROJECT, user_id: USER_A },
        { id: OTHER_PRODUCTION, project_id: PROJECT, user_id: USER_A },
        { id: OTHER_PROJECT_PRODUCTION, project_id: OTHER_PROJECT, user_id: USER_A },
        { id: FOREIGN_PRODUCTION, project_id: FOREIGN_PROJECT, user_id: USER_B },
      ],
      video_generation_sessions: sessions,
      video_generations: [],
    },
    // Column default + BEFORE UPDATE trigger of scripts/049: updated_at moves on every write.
    onInsert: { video_generation_sessions: (row) => { row.updated_at ??= stamp(++clock) } },
    onUpdate: { video_generation_sessions: (row) => { row.updated_at = stamp(++clock) } },
  }) as any
}

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  user_id: USER_A,
  project_id: PROJECT,
  production_id: PRODUCTION,
  working_prompt: 'a red fox running',
  working_config: { schemaVersion: 1, source: null, selection: selection() },
  created_at: stamp(1),
  updated_at: stamp(1),
  ...over,
})

/**
 * The user-session client: reads like the authenticated role (scripts/049 grants it SELECT only), and every write
 * attempt through it fails loudly - so any passing write below necessarily went through the service role.
 */
function signIn(db: any, userId: string | null = USER_A) {
  const from = (table: string) => {
    const builder = db.from(table)
    for (const method of ['insert', 'update', 'upsert', 'delete']) {
      builder[method] = () => { throw new Error(`user session attempted ${method} on ${table}`) }
    }
    return builder
  }
  vi.mocked(server.createClient).mockResolvedValue({
    from,
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) },
  } as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (method: string, body: unknown, url = `http://localhost/api/video-generation-sessions/${SESSION}`) =>
  new NextRequest(url, { method, body: typeof body === 'string' ? body : JSON.stringify(body) })

const put = async (body: unknown, id = SESSION) => (await import('@/app/api/video-generation-sessions/[id]/route')).PUT(jsonReq('PUT', body), ctx(id))
const patch = async (body: unknown, id = SESSION) => (await import('@/app/api/video-generation-sessions/[id]/route')).PATCH(jsonReq('PATCH', body), ctx(id))
const get = async (id = SESSION) => (await import('@/app/api/video-generation-sessions/[id]/route')).GET(new NextRequest(`http://localhost/api/video-generation-sessions/${id}`), ctx(id))
const list = async (query: string) => (await import('@/app/api/video-generation-sessions/route')).GET(new NextRequest(`http://localhost/api/video-generation-sessions${query}`))

const createBody = (over: Record<string, unknown> = {}) => ({ projectId: PROJECT, productionId: PRODUCTION, workingState: state(), ...over })
const writes = (db: any) => db.log.filter((entry: string) => /^(insert|update|upsert|delete):/.test(entry))

beforeEach(() => {
  vi.clearAllMocks()
  clock = 100 // trigger stamps stay above every seeded token
})

// ===========================================================================
describe('PUT /api/video-generation-sessions/[id] — idempotent create', () => {
  it('requires authentication', async () => {
    const db = makeDb()
    signIn(db, null)
    expect((await put(createBody())).status).toBe(401)
    expect(writes(db)).toEqual([])
  })

  it('creates the Session at the client-chosen id, server-stamps the owner and splits prompt from config', async () => {
    const db = makeDb()
    signIn(db)

    const response = await put(createBody())
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.created).toBe(true)
    expect(body.session).toMatchObject({ id: SESSION, projectId: PROJECT, productionId: PRODUCTION, workingState: state() })
    expect(db.tables.video_generation_sessions).toHaveLength(1)
    const row = db.tables.video_generation_sessions[0]
    expect(row).toMatchObject({ id: SESSION, user_id: USER_A, project_id: PROJECT, production_id: PRODUCTION, working_prompt: 'a red fox running' })
    // One authority: the prompt lives ONLY in working_prompt, never duplicated inside working_config.
    expect(row.working_config).toEqual({ schemaVersion: 1, source: null, selection: selection() })
    expect(row.working_config).not.toHaveProperty('prompt')
  })

  it('never returns internal fields (owner id, raw columns)', async () => {
    signIn(makeDb())
    const body = await (await put(createBody())).json()
    expect(Object.keys(body.session).sort()).toEqual(['createdAt', 'id', 'productionId', 'projectId', 'updatedAt', 'workingState'])
    expect(JSON.stringify(body)).not.toContain(USER_A)
  })

  it('a legitimate repeat by the same owner is idempotent: stored Session returned UNCHANGED, no second row, no write', async () => {
    const db = makeDb()
    signIn(db)
    const first = await (await put(createBody())).json()
    const writesAfterFirst = writes(db).length

    // The retry carries a different (older) draft: PUT must NOT turn into an overwrite that bypasses the version check.
    const second = await put(createBody({ workingState: state({ prompt: 'an OLDER draft' }) }))
    const secondBody = await second.json()

    expect(second.status).toBe(200)
    expect(secondBody.created).toBe(false)
    expect(secondBody.session).toEqual(first.session)
    expect(db.tables.video_generation_sessions).toHaveLength(1)
    expect(db.tables.video_generation_sessions[0].working_prompt).toBe('a red fox running')
    expect(writes(db)).toHaveLength(writesAfterFirst)
  })

  it('the same id for another Production of the same owner is a scope mismatch (ownership cannot move)', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)
    for (const scope of [
      { productionId: OTHER_PRODUCTION }, // same Project, other Production
      { projectId: OTHER_PROJECT, productionId: OTHER_PROJECT_PRODUCTION }, // other Project
    ]) {
      const response = await put(createBody(scope))
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('SESSION_SCOPE_MISMATCH')
    }
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ project_id: PROJECT, production_id: PRODUCTION })
    expect(writes(db)).toEqual([])
  })

  it("another user's session id behaves as not found: no row is read, replaced or leaked", async () => {
    const db = makeDb([sessionRow({ user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: FOREIGN_PRODUCTION, working_prompt: 'B SECRET' })])
    signIn(db, USER_A)

    const response = await put(createBody())
    const text = await response.text()

    expect(response.status).toBe(404)
    expect(JSON.parse(text).code).toBe('SESSION_NOT_FOUND')
    expect(text).not.toContain('B SECRET')
    expect(db.tables.video_generation_sessions).toHaveLength(1)
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ user_id: USER_B, working_prompt: 'B SECRET' })
  })

  it.each([
    ['a Production of another user', { projectId: FOREIGN_PROJECT, productionId: FOREIGN_PRODUCTION }],
    ['a Production that belongs to a different Project', { projectId: OTHER_PROJECT, productionId: PRODUCTION }],
    ['an unknown Production', { productionId: '12121212-1212-4212-8212-121212121212' }],
  ])('rejects %s and creates nothing', async (_name, scope) => {
    const db = makeDb()
    signIn(db)
    const response = await put(createBody(scope))
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('PRODUCTION_NOT_FOUND')
    expect(db.tables.video_generation_sessions).toHaveLength(0)
  })

  it.each(['not-a-uuid', '123', ''])('rejects a malformed session id (%j)', async (id) => {
    const db = makeDb()
    signIn(db)
    expect((await put(createBody(), id)).status).toBe(400)
    expect(writes(db)).toEqual([])
  })
})

// ===========================================================================
describe('working state validation (PUT and PATCH share one gate, built on the 036A V1 schema)', () => {
  const longText = (n: number) => 'x'.repeat(n)
  const invalid: Array<[string, unknown, number, string]> = [
    ['unsupported schema version', state({ schemaVersion: 2 }), 400, 'UNSUPPORTED_SCHEMA_VERSION'],
    ['missing schema version', (() => { const { schemaVersion: _drop, ...rest } = state(); return rest })(), 400, 'INVALID_WORKING_STATE'],
    ['malformed connectionRef', state({ selection: selection({ connectionRef: 'kling:account:not-a-uuid' }) }), 400, 'INVALID_WORKING_STATE'],
    ['arbitrary connectionRef string', state({ selection: selection({ connectionRef: 'https://evil.example/token' }) }), 400, 'INVALID_WORKING_STATE'],
    ['unknown source type', state({ source: { type: 'upload', id: IMG } }), 400, 'INVALID_WORKING_STATE'],
    ['source without id', state({ source: { type: 'library' } }), 400, 'INVALID_WORKING_STATE'],
    ['source id that is not a UUID', state({ source: { type: 'library', id: 'https://signed.example/x.png?sig=1' } }), 400, 'INVALID_WORKING_STATE'],
    ['malformed config (duration is a string)', state({ selection: selection({ duration: '5' }) }), 400, 'INVALID_WORKING_STATE'],
    ['malformed config (unknown operation)', state({ selection: selection({ operation: 'video_to_video' }) }), 400, 'INVALID_WORKING_STATE'],
    ['malformed config (unknown resolution)', state({ selection: selection({ resolution: '8k' }) }), 400, 'INVALID_WORKING_STATE'],
    ['prompt is not a string', state({ prompt: 42 }), 400, 'INVALID_WORKING_STATE'],
    ['oversized prompt', state({ prompt: longText(SESSION_LIMITS.promptMaxChars + 1) }), 400, 'INVALID_WORKING_STATE'],
    ['oversized working config', state({ selection: selection({ audioPrompt: longText(SESSION_LIMITS.configMaxBytes + 1) }) }), 400, 'INVALID_WORKING_STATE'],
    ['null state', null, 400, 'INVALID_WORKING_STATE'],
    ['array state', [], 400, 'INVALID_WORKING_STATE'],
  ]

  it.each(invalid)('PUT rejects %s and writes nothing', async (_name, workingState, status, code) => {
    const db = makeDb()
    signIn(db)
    const response = await put(createBody({ workingState }))
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(writes(db)).toEqual([])
  })

  it.each(invalid)('PATCH rejects %s and leaves the Session untouched', async (_name, workingState, status, code) => {
    const db = makeDb([sessionRow()])
    signIn(db)
    const response = await patch({ expectedUpdatedAt: stamp(1), workingState })
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(writes(db)).toEqual([])
    expect(db.tables.video_generation_sessions[0]).toEqual(sessionRow())
  })

  it('rejects a request body above the byte cap (413) before touching the database', async () => {
    const db = makeDb()
    signIn(db)
    const response = await put(JSON.stringify({ ...createBody(), padding: longText(SESSION_LIMITS.bodyMaxBytes + 1) }))
    expect(response.status).toBe(413)
    expect(writes(db)).toEqual([])
  })

  it.each([['invalid JSON', '{nope'], ['an array body', '[]'], ['a scalar body', '7']])('rejects %s', async (_name, raw) => {
    signIn(makeDb())
    expect((await put(raw)).status).toBe(400)
    expect((await patch(raw)).status).toBe(400)
  })

  it('rejects unknown top-level body fields (PUT is strict)', async () => {
    const db = makeDb()
    signIn(db)
    expect((await put({ ...createBody(), status: 'succeeded' })).status).toBe(400)
    expect(writes(db)).toEqual([])
  })

  it('stores only the validated document: unknown nested keys are stripped, not persisted', async () => {
    const db = makeDb()
    signIn(db)
    const polluted = state({ selection: selection({ providerSecret: 'SHOULD-NOT-PERSIST' }), extra: { big: 'blob' } })
    expect((await put(createBody({ workingState: polluted }))).status).toBe(201)
    expect(JSON.stringify(db.tables.video_generation_sessions[0])).not.toContain('SHOULD-NOT-PERSIST')
    expect(db.tables.video_generation_sessions[0].working_config).not.toHaveProperty('extra')
  })
})

// ===========================================================================
describe('working state round-trip (what is saved is exactly what is read back)', () => {
  const roundTrip = async (workingState: unknown) => {
    const db = makeDb()
    signIn(db)
    expect((await put(createBody({ workingState }))).status).toBe(201)
    return (await (await get()).json()).session.workingState
  }

  it('keeps the prompt byte-exact (whitespace, newlines, unicode, emoji, leading/trailing space)', async () => {
    const prompt = '  Uma raposa ruiva corre — “na neve” 🦊\n\n\tlinha 2   \n'
    expect((await roundTrip(state({ prompt }))).prompt).toBe(prompt)
  })

  it('keeps an empty prompt (a Session may exist before the user wrote anything)', async () => {
    expect((await roundTrip(state({ prompt: '' }))).prompt).toBe('')
  })

  it('keeps every advanced field (MCP audio/music prompts, ASMR, multi-shot, audio, account connection)', async () => {
    const advanced = state({
      selection: selection({
        connectionRef: accountConnectionRef(CONNECTION_ID),
        modelId: 'kling-video-v3_0',
        duration: 10,
        resolution: '1080p',
        aspectRatio: '9:16',
        audio: 'on',
        multiShot: true,
        asmr: true,
        audioPrompt: '  crisp footsteps ',
        musicPrompt: 'lo-fi',
      }),
    })
    expect(await roundTrip(advanced)).toEqual(advanced)
  })

  it.each([
    ['library', { type: 'library', id: LIB }],
    ['generated', { type: 'generated', id: IMG }],
  ])('keeps the durable I2V source identity (%s) — an id, never a URL', async (_name, source) => {
    const i2v = state({ source, selection: selection({ operation: 'image_to_video' }) })
    const read = await roundTrip(i2v)
    expect(read).toEqual(i2v)
    expect(JSON.stringify(read.source)).not.toMatch(/https?:/)
  })

  it('a T2V state carries no source (no stale selection)', async () => {
    const read = await roundTrip(state({ source: null }))
    expect(read.source).toBeNull()
    expect(read.selection.operation).toBe('text_to_video')
  })

  it('a working state rebuilt from a historical attempt (036A) round-trips unchanged', async () => {
    const fromAttempt = attemptToWorkingState({
      prompt: 'from a legacy attempt',
      mode: 'image_to_video',
      model: 'kling-v2-6',
      transport: 'mcp',
      connection_id: CONNECTION_ID,
      source_library_file_id: LIB,
      request_config: { duration: 5, resolution: '720p', aspect_ratio: '16:9', audio: 'off', multi_shot: false, audio_prompt: 'a', music_prompt: 'b', asmr: true },
    })
    expect(await roundTrip(fromAttempt)).toEqual(fromAttempt)
  })

  it('a stored document this version cannot read (e.g. a future schema) reads back as workingState null, never as a guess', async () => {
    const db = makeDb([sessionRow({ working_config: { schemaVersion: 2, source: null, selection: selection() } })])
    signIn(db)
    const body = await (await get()).json()
    expect(body.session.workingState).toBeNull()
    expect(body.session.id).toBe(SESSION)
  })
})

// ===========================================================================
describe('GET /api/video-generation-sessions/[id] — read is read', () => {
  it('requires authentication', async () => {
    signIn(makeDb([sessionRow()]), null)
    expect((await get()).status).toBe(401)
  })

  it('returns the owner’s Session and performs NO write (not even updated_at)', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)
    const before = JSON.parse(JSON.stringify(db.tables))

    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.session).toMatchObject({ id: SESSION, projectId: PROJECT, productionId: PRODUCTION, updatedAt: stamp(1), workingState: state() })
    expect(writes(db)).toEqual([])
    expect(db.tables).toEqual(before)
  })

  it("user A cannot read user B's Session", async () => {
    const db = makeDb([sessionRow({ user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: FOREIGN_PRODUCTION, working_prompt: 'B SECRET' })])
    signIn(db, USER_A)
    const response = await get()
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('B SECRET')
  })

  it.each([['a nonexistent id', '12121212-1212-4212-8212-121212121212'], ['a malformed id', 'nope']])('%s is 404 (never 500)', async (_name, id) => {
    signIn(makeDb())
    expect((await get(id)).status).toBe(404)
  })

  it('hydrating does not create attempts, library files or authoring entities', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)
    await get()
    await list(`?productionId=${PRODUCTION}`)
    expect(db.log.filter((entry: string) => !entry.startsWith('select:'))).toEqual([])
    expect(db.tables.video_generations).toHaveLength(0)
  })
})

// ===========================================================================
describe('PATCH /api/video-generation-sessions/[id] — optimistic concurrency', () => {
  it('the correct token updates the working state and yields a NEW token', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)

    const response = await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'edited prompt' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.session.workingState.prompt).toBe('edited prompt')
    expect(body.session.updatedAt).not.toBe(stamp(1))
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ working_prompt: 'edited prompt', updated_at: body.session.updatedAt })
  })

  it('a stale token is a 409 carrying the current Session, and nothing is overwritten (no last-write-wins)', async () => {
    const db = makeDb([sessionRow({ working_prompt: 'NEWER', updated_at: stamp(7) })])
    signIn(db)

    const response = await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'OLD AUTOSAVE' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('SESSION_VERSION_CONFLICT')
    expect(body.session).toMatchObject({ id: SESSION, updatedAt: stamp(7) })
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ working_prompt: 'NEWER', updated_at: stamp(7) })
  })

  it('two writers from the same version: the first wins, the second gets 409 and can retry with the fresh token', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)

    const first = await (await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'writer 1' }) })).json()
    const second = await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'writer 2' }) })
    expect(second.status).toBe(409)
    expect(db.tables.video_generation_sessions[0].working_prompt).toBe('writer 1')

    const retry = await patch({ expectedUpdatedAt: first.session.updatedAt, workingState: state({ prompt: 'writer 2' }) })
    expect(retry.status).toBe(200)
    expect(db.tables.video_generation_sessions[0].working_prompt).toBe('writer 2')
  })

  it('a missing or malformed token is rejected without writing', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)
    expect((await patch({ workingState: state() })).status).toBe(400)
    expect((await patch({ expectedUpdatedAt: 5, workingState: state() })).status).toBe(400)
    expect((await patch({ expectedUpdatedAt: '', workingState: state() })).status).toBe(400)
    expect(writes(db)).toEqual([])
  })

  it("user A cannot PATCH user B's Session — 404 (not 409: no existence or version oracle), row untouched", async () => {
    const db = makeDb([sessionRow({ user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: FOREIGN_PRODUCTION, working_prompt: 'B SECRET' })])
    signIn(db, USER_A)

    for (const token of [stamp(1), 'wrong-token']) {
      const response = await patch({ expectedUpdatedAt: token, workingState: state({ prompt: 'hijack' }) })
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('B SECRET')
    }
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ user_id: USER_B, working_prompt: 'B SECRET' })
  })

  it('a nonexistent Session is 404', async () => {
    signIn(makeDb())
    expect((await patch({ expectedUpdatedAt: stamp(1), workingState: state() })).status).toBe(404)
  })

  it.each(['id', 'userId', 'user_id', 'projectId', 'project_id', 'productionId', 'production_id'])(
    'cannot change %s: the field is rejected outright',
    async (field) => {
      const db = makeDb([sessionRow()])
      signIn(db)
      const response = await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'x' }), [field]: field.startsWith('user') ? USER_B : OTHER_PRODUCTION })
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('IMMUTABLE_FIELD')
      expect(db.tables.video_generation_sessions[0]).toEqual(sessionRow())
    },
  )

  it('an accepted PATCH writes ONLY the working columns: owner, scope and id stay exactly as they were', async () => {
    const db = makeDb([sessionRow()])
    signIn(db)
    await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'p2' }) })
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ id: SESSION, user_id: USER_A, project_id: PROJECT, production_id: PRODUCTION, created_at: stamp(1) })
  })

  it('editing a Session never touches a submitted attempt', async () => {
    const attempt = { id: 'gen-1', user_id: USER_A, session_id: SESSION, prompt: 'SUBMITTED PROMPT', request_config: { duration: 5 }, model: 'kling-v2-6', status: 'succeeded' }
    const db = createFakeDb({
      seed: { productions: [{ id: PRODUCTION, project_id: PROJECT, user_id: USER_A }], video_generation_sessions: [sessionRow()], video_generations: [attempt] },
      onUpdate: { video_generation_sessions: (row) => { row.updated_at = stamp(++clock) } },
    }) as any
    signIn(db)
    await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'a totally different draft', selection: selection({ modelId: 'other-model', duration: 10 }) }) })
    expect(db.tables.video_generations[0]).toEqual(attempt)
    expect(db.log).not.toContain('update:video_generations')
  })
})

// ===========================================================================
describe('GET /api/video-generation-sessions?productionId — list', () => {
  const rows = () => [
    sessionRow({ id: SESSION, updated_at: stamp(5) }),
    sessionRow({ id: SESSION_2, updated_at: stamp(9) }),
    sessionRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3', updated_at: stamp(9) }), // ties with SESSION_2 -> id breaks it
    sessionRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaad4', production_id: OTHER_PRODUCTION, updated_at: stamp(20) }),
    sessionRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaae5', user_id: USER_B, project_id: FOREIGN_PROJECT, production_id: PRODUCTION, working_prompt: 'B SECRET', updated_at: stamp(30) }),
  ]

  it('requires authentication and a valid productionId', async () => {
    signIn(makeDb(rows()), null)
    expect((await list(`?productionId=${PRODUCTION}`)).status).toBe(401)
    signIn(makeDb(rows()))
    for (const query of ['', '?productionId=nope', '?productionId=']) expect((await list(query)).status).toBe(400)
  })

  it('lists only the caller’s Sessions of that Production, most recently edited first, ties broken by id', async () => {
    const db = makeDb(rows())
    signIn(db)
    const response = await list(`?productionId=${PRODUCTION}`)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.sessions.map((s: any) => s.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac3', SESSION_2, SESSION])
    expect(JSON.stringify(body)).not.toContain('B SECRET')
    expect(writes(db)).toEqual([])
  })

  it('an empty Production lists no Sessions', async () => {
    signIn(makeDb(rows()))
    expect((await (await list(`?productionId=${FOREIGN_PRODUCTION}`)).json()).sessions).toEqual([])
  })

  it('lists all caller Sessions across Productions when all=true, maintaining recency and tenant isolation', async () => {
    const db = makeDb(rows())
    signIn(db)
    const response = await list('?all=true')
    const body = await response.json()
    expect(response.status).toBe(200)
    // USER_A has sessions in PRODUCTION and OTHER_PRODUCTION, but not FOREIGN_PRODUCTION (USER_B)
    expect(body.sessions).toHaveLength(4)
    expect(JSON.stringify(body)).not.toContain('B SECRET')
  })
})

// ===========================================================================
// FUTURE-050 (test 20): the provider-execution policy must never touch authoring state. Session autosave (PATCH)
// and reads keep working in Preview, where paid execution is denied, and they perform no provider-execution check.
describe('Session autosave in Preview (provider execution disabled)', () => {
  afterEach(() => restoreEnvironment())

  it('PATCH persists the edit and returns a new token while the environment is Preview', async () => {
    simulateEnvironment('preview')
    const db = makeDb([sessionRow()])
    signIn(db)

    const response = await patch({ expectedUpdatedAt: stamp(1), workingState: state({ prompt: 'edited in preview' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.session.workingState.prompt).toBe('edited in preview')
    expect(db.tables.video_generation_sessions[0]).toMatchObject({ working_prompt: 'edited in preview' })
    expect((await get()).status).toBe(200)
  })
})
