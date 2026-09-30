import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'
import { normalizeTaskDetails, queryNanoBananaTask } from '@/lib/providers/nanobanana/task-details'

// NANOBANANA_CALLBACK_AUTHENTICATION_V1 — adversarial + regression tests.
// In-memory DB; the provider is a stubbed global fetch. No real provider, storage or paid call exists here.

vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ uploadImageToS3: vi.fn(), createPresignedReadUrl: vi.fn() }))

import * as serviceRole from '@/lib/supabase/service-role'
import * as server from '@/lib/supabase/server'
import { uploadImageToS3 } from '@/lib/storage/s3'
import { GET as STATUS } from '@/app/api/nanobanana/status/[taskId]/route'
import { POST as CALLBACK } from '@/app/api/nanobanana/callback/route'
import { NANOBANANA_RESULT_IMAGE_POLICY, parseRemoteImageUrl } from '@/lib/security/safe-remote-image'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const TASK_ROW = '44444444-4444-4444-8444-444444444444'
const OTHER_ROW = '55555555-5555-4555-8555-555555555555'
const PROVIDER_TASK = '9e4286b7b27960dfeb8e1d279b50b28d'
const OTHER_PROVIDER_TASK = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OWNER_KEY = 'OWNER-NANO-KEY-SECRET'
const OTHER_KEY = 'OTHER-USER-NANO-KEY-SECRET'
const TRUSTED_URL = 'https://tempfile.aiquickdraw.com/r/9e4286b7b27960dfeb8e1d279b50b28d_1756467493.jpg'
const ATTACKER_URL = 'https://attacker.example.test/pixel.png'

let db: FakeDb
let providerCalls: Array<{ url: string; init: RequestInit }>
let providerAnswer: () => Promise<Response>
let warn: ReturnType<typeof vi.spyOn>
let consoleError: ReturnType<typeof vi.spyOn>
let consoleLog: ReturnType<typeof vi.spyOn>

const row = (overrides: Record<string, unknown> = {}) => ({
  id: TASK_ROW,
  user_id: OWNER,
  project_id: PROJECT,
  task_id: PROVIDER_TASK,
  provider: 'nanobanana',
  status: 'processing',
  image_url: null,
  error_message: null,
  callback_received_at: null,
  ...overrides,
})

function seed(tasks: Array<Record<string, unknown>> = [row()], settings: Array<Record<string, unknown>> = [{ user_id: OWNER, nanobanana_api_key: OWNER_KEY }, { user_id: OTHER_USER, nanobanana_api_key: OTHER_KEY }]) {
  db = createFakeDb({ seed: { generation_tasks: tasks, user_settings: settings }, generatedId: [] })
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db as never)
}

const providerSays = (data: Record<string, unknown>, code = 200) => async () =>
  new Response(JSON.stringify({ code, msg: 'success', data: { taskId: PROVIDER_TASK, ...data } }), { status: 200 })

const SUCCESS = { successFlag: 1, response: { resultImageUrl: TRUSTED_URL }, errorCode: null, errorMessage: null }
const GENERATING = { successFlag: 0, response: null }
const FAILED = { successFlag: 3, errorCode: 501, errorMessage: 'Generation failed upstream' }

// The unsigned provider callback, as documented, plus whatever an attacker adds to it.
const callbackBody = (extra: Record<string, unknown> = {}, taskId = PROVIDER_TASK) => ({
  code: 200,
  msg: 'Image generated successfully.',
  data: { taskId, info: { resultImageUrl: ATTACKER_URL } },
  ...extra,
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  CALLBACK(new Request('http://localhost/api/nanobanana/callback', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never)

const task = (id = TASK_ROW) => db.tables.generation_tasks.find((entry) => entry.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  providerCalls = []
  providerAnswer = providerSays(SUCCESS)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    providerCalls.push({ url, init })
    return providerAnswer()
  }))
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  seed()
})

const noMutation = (id = TASK_ROW, expected: Record<string, unknown> = {}) => {
  const current = task(id)
  expect(current.status).toBe(expected.status ?? 'processing')
  expect(current.image_url).toBe(expected.image_url ?? null)
  expect(current.callback_received_at).toBe(expected.callback_received_at ?? null)
}

describe('the callback body is never authoritative — the provider answer is', () => {
  it('a forged "success" callback with an attacker URL cannot set image_url while the provider says the task is still generating', async () => {
    providerAnswer = providerSays(GENERATING)
    const response = await post(callbackBody())
    expect(response.status).toBe(503) // retryable: the provider will call again
    noMutation()
  })

  it('image_url comes from the PROVIDER query, never from the callback body', async () => {
    const response = await post(callbackBody())
    expect(response.status).toBe(200)
    expect(task()).toMatchObject({ status: 'completed', image_url: TRUSTED_URL })
    expect(JSON.stringify(db.tables.generation_tasks)).not.toContain('attacker.example.test')
  })

  it('a callback that claims failure cannot fail a task the provider says succeeded; one that claims success cannot hide a provider failure', async () => {
    await post({ code: 501, msg: 'Failed', data: { taskId: PROVIDER_TASK } })
    expect(task()).toMatchObject({ status: 'completed', image_url: TRUSTED_URL })

    seed()
    providerAnswer = providerSays(FAILED)
    await post(callbackBody())
    expect(task()).toMatchObject({ status: 'failed', image_url: null, error_message: 'Generation failed upstream' })
  })

  it('body user_id / project_id / row id / status / image fields cannot redirect the mutation', async () => {
    seed([row(), row({ id: OTHER_ROW, user_id: OTHER_USER, task_id: OTHER_PROVIDER_TASK, project_id: null })])
    const response = await post(callbackBody({ user_id: OTHER_USER, userId: OTHER_USER, project_id: 'x', projectId: 'x', id: OTHER_ROW, status: 'completed', image_url: ATTACKER_URL, storagePath: 'users/x/images/y/original.png', provider: 'other' }))
    expect(response.status).toBe(200)
    expect(task(TASK_ROW)).toMatchObject({ status: 'completed', user_id: OWNER, project_id: PROJECT, image_url: TRUSTED_URL })
    expect(task(OTHER_ROW)).toMatchObject({ status: 'processing', image_url: null, user_id: OTHER_USER })
    // The provider was asked with the OWNER's own credential, never another user's.
    expect(providerCalls).toHaveLength(1)
    expect((providerCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OWNER_KEY}`)
  })

  it('a provider answer about a DIFFERENT task id mutates nothing', async () => {
    providerAnswer = async () => new Response(JSON.stringify({ code: 200, data: { taskId: OTHER_PROVIDER_TASK, ...SUCCESS } }), { status: 200 })
    const response = await post(callbackBody())
    expect(response.status).toBe(200)
    noMutation()
  })

  it('a provider "success" whose URL is not on the provider result host is treated as a failed result, never stored', async () => {
    providerAnswer = providerSays({ successFlag: 1, response: { resultImageUrl: ATTACKER_URL } })
    await post(callbackBody())
    expect(task()).toMatchObject({ status: 'failed', image_url: null })
    expect(task().error_message).toBe('Resultado do provedor indisponível.')
  })
})

describe('invalid callbacks mutate nothing and trigger nothing', () => {
  it.each([
    ['invalid JSON', '{not json', 400],
    ['a JSON array', '[]', 400],
    ['a missing data object', JSON.stringify({ code: 200 }), 400],
    ['a missing taskId', JSON.stringify({ code: 200, data: {} }), 400],
    ['a non-string taskId', JSON.stringify({ data: { taskId: 12345 } }), 400],
    ['a taskId with path/URL characters', JSON.stringify({ data: { taskId: '../../etc/passwd' } }), 400],
    ['an overlong taskId', JSON.stringify({ data: { taskId: 'a'.repeat(200) } }), 400],
    ['an oversized body', JSON.stringify({ data: { taskId: PROVIDER_TASK }, pad: 'x'.repeat(70 * 1024) }), 413],
  ])('%s → bounded error, zero provider call, zero DB mutation, zero image ingestion', async (_name, body, status) => {
    const response = await post(body)
    expect(response.status).toBe(status)
    expect(providerCalls).toHaveLength(0)
    noMutation()
    expect(uploadImageToS3).not.toHaveBeenCalled()
  })

  it('an unknown task id is acknowledged like any other (no existence hint) and costs the provider nothing', async () => {
    const response = await post(callbackBody({}, 'f'.repeat(32)))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(providerCalls).toHaveLength(0)
    noMutation()
  })

  it('a task of another provider with the same id is not matched', async () => {
    seed([row({ provider: 'kling' })])
    expect((await post(callbackBody())).status).toBe(200)
    expect(providerCalls).toHaveLength(0)
    noMutation()
  })

  it('never downloads or ingests any image and never calls a generation endpoint', async () => {
    await post(callbackBody())
    expect(uploadImageToS3).not.toHaveBeenCalled()
    for (const call of providerCalls) {
      expect(call.init.method).toBe('GET')
      expect(call.url).toMatch(/^https:\/\/api\.nanobananaapi\.ai\/api\/v1\/nanobanana\/record-info\?taskId=/)
      expect(call.url).not.toMatch(/generate/)
    }
  })
})

describe('terminal state, duplicates and replay', () => {
  it.each(['completed', 'failed'])('a %s task is never re-opened, overwritten or re-queried (conflicting replay is ignored)', async (status) => {
    seed([row({ status, image_url: status === 'completed' ? TRUSTED_URL : null, error_message: status === 'failed' ? 'original failure' : null, callback_received_at: '2026-09-30T00:00:00.000Z' })])
    providerAnswer = providerSays({ ...SUCCESS, response: { resultImageUrl: 'https://tempfile.aiquickdraw.com/r/DIFFERENT.jpg' } })
    const response = await post(callbackBody())
    expect(response.status).toBe(200)
    expect(providerCalls).toHaveLength(0)
    expect(task()).toMatchObject({
      status,
      image_url: status === 'completed' ? TRUSTED_URL : null,
      error_message: status === 'failed' ? 'original failure' : null,
      callback_received_at: '2026-09-30T00:00:00.000Z',
    })
  })

  it('an exact duplicate legitimate delivery is idempotent: one provider query, one transition, identical result', async () => {
    expect((await post(callbackBody())).status).toBe(200)
    const first = { ...task() }
    expect((await post(callbackBody())).status).toBe(200)
    expect(providerCalls).toHaveLength(1)
    expect(task()).toEqual(first)
  })

  it('concurrent duplicate deliveries transition the task once (processing → terminal is guarded)', async () => {
    const responses = await Promise.all([post(callbackBody()), post(callbackBody()), post(callbackBody())])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(task()).toMatchObject({ status: 'completed', image_url: TRUSTED_URL })
    expect(db.log.filter((entry) => entry === 'update:generation_tasks').length).toBeGreaterThanOrEqual(1)
  })

  it('a completed task can never go back to processing', async () => {
    await post(callbackBody())
    providerAnswer = providerSays(GENERATING)
    await post(callbackBody())
    expect(task().status).toBe('completed')
  })
})

describe('provider and credential failures are safe', () => {
  it.each([
    ['a network failure', async () => { throw new Error('ECONNRESET 10.0.0.9') }],
    ['a provider 500', async () => new Response('boom', { status: 500 })],
    ['an unusable body', async () => new Response('<html>', { status: 200 })],
    ['a rejected credential (401)', async () => new Response('{}', { status: 401 })],
    ['a body-level error code', providerSays(SUCCESS, 401)],
  ])('%s → retryable 503, task untouched', async (_name, answer) => {
    providerAnswer = answer as () => Promise<Response>
    const response = await post(callbackBody())
    expect(response.status).toBe(503)
    noMutation()
    expect(JSON.stringify(await response.json())).not.toMatch(/10\.0\.0\.9|OWNER-NANO/)
  })

  it('an owner with NO Nano Banana credential is acknowledged, the task is untouched, and there is no platform fallback', async () => {
    process.env.NANOBANANA_API_KEY = 'PLATFORM-KEY-MUST-NOT-BE-USED'
    seed([row()], [{ user_id: OWNER, nanobanana_api_key: null }, { user_id: OTHER_USER, nanobanana_api_key: OTHER_KEY }])
    const response = await post(callbackBody())
    expect(response.status).toBe(200)
    expect(providerCalls).toHaveLength(0)
    noMutation()
    delete process.env.NANOBANANA_API_KEY
  })
})

describe('secrets and logs', () => {
  it('no response or log line ever contains a credential, the callback URL/body or the provider result URL', async () => {
    const responses = [await post(callbackBody()), await post('{bad'), await post(callbackBody({}, 'f'.repeat(32)))]
    const logged = JSON.stringify([...warn.mock.calls, ...consoleError.mock.calls, ...consoleLog.mock.calls])
    const bodies = JSON.stringify(await Promise.all(responses.map((response) => response.clone().text())))
    for (const text of [logged, bodies]) {
      expect(text).not.toContain(OWNER_KEY)
      expect(text).not.toContain(OTHER_KEY)
      expect(text).not.toContain('tempfile.aiquickdraw.com')
      expect(text).not.toContain('attacker.example.test')
    }
  })

  it('the provider key goes only into the Authorization header of the record-info request', async () => {
    await post(callbackBody())
    const call = providerCalls[0]
    expect(call.url).not.toContain(OWNER_KEY)
    expect(JSON.stringify(call.init.body ?? null)).not.toContain(OWNER_KEY)
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${OWNER_KEY}`)
  })
})

describe('the legitimate Nano Banana flow still works end to end', () => {
  it('callback → reconciled task → /imagens status poll → a URL the upload-image ingestion policy accepts', async () => {
    await post(callbackBody())

    vi.mocked(server.createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
      from: db.from,
    } as never)
    const status = await STATUS(new Request('http://localhost/x') as never, { params: Promise.resolve({ taskId: TASK_ROW }) })
    const payload = await status.json()
    expect(payload).toMatchObject({ id: TASK_ROW, status: 'completed', imageUrl: TRUSTED_URL })
    // The same host policy that protects ingestion (STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1) accepts it: intact.
    expect(() => parseRemoteImageUrl(payload.imageUrl, NANOBANANA_RESULT_IMAGE_POLICY)).not.toThrow()
  })

  it('a provider failure is surfaced to the owner through the same status route', async () => {
    providerAnswer = providerSays(FAILED)
    await post(callbackBody())
    vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) }, from: db.from } as never)
    const payload = await (await STATUS(new Request('http://localhost/x') as never, { params: Promise.resolve({ taskId: TASK_ROW }) })).json()
    expect(payload).toMatchObject({ status: 'failed', errorMessage: 'Generation failed upstream' })
  })

  it('the status route still refuses another user’s task', async () => {
    vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: OTHER_USER } }, error: null }) }, from: db.from } as never)
    const response = await STATUS(new Request('http://localhost/x') as never, { params: Promise.resolve({ taskId: TASK_ROW }) })
    expect(response.status).toBe(404)
  })
})

describe('provider task-details normalization (lib/providers/nanobanana/task-details)', () => {
  const ok = (data: Record<string, unknown>) => ({ code: 200, msg: 'success', data: { taskId: 'T', ...data } })

  it('maps every documented successFlag', () => {
    expect(normalizeTaskDetails(ok({ successFlag: 0 }), 'T')).toEqual({ ok: true, task: { state: 'generating' } })
    expect(normalizeTaskDetails(ok({ successFlag: 1, response: { resultImageUrl: 'https://x/y.jpg' } }), 'T')).toEqual({ ok: true, task: { state: 'succeeded', resultImageUrl: 'https://x/y.jpg' } })
    expect(normalizeTaskDetails(ok({ successFlag: 2, errorMessage: 'nope' }), 'T')).toEqual({ ok: true, task: { state: 'failed', message: 'nope' } })
    expect(normalizeTaskDetails(ok({ successFlag: 3 }), 'T')).toEqual({ ok: true, task: { state: 'failed', message: 'A geração falhou no provedor.' } })
  })

  it('binds the answer to the requested task and rejects malformed/unknown shapes', () => {
    expect(normalizeTaskDetails(ok({ successFlag: 1, response: { resultImageUrl: 'https://x' } }), 'OTHER')).toEqual({ ok: false, reason: 'TASK_MISMATCH' })
    expect(normalizeTaskDetails(null, 'T')).toEqual({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    expect(normalizeTaskDetails({ code: 500, data: { taskId: 'T', successFlag: 1 } }, 'T')).toEqual({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    expect(normalizeTaskDetails(ok({ successFlag: 1 }), 'T')).toMatchObject({ ok: true, task: { state: 'unusable' } })
    expect(normalizeTaskDetails(ok({ successFlag: 9 }), 'T')).toMatchObject({ ok: true, task: { state: 'unusable' } })
    expect(normalizeTaskDetails(ok({ successFlag: 2, errorMessage: 'x'.repeat(1000) }), 'T')).toMatchObject({ task: { message: 'x'.repeat(200) } })
  })

  it('queryNanoBananaTask is a bounded, credentialed GET that does not follow redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok({ successFlag: 0 })), { status: 200 }))
    await queryNanoBananaTask('KEY', 'T', { fetchImpl: fetchImpl as never })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.nanobananaapi.ai/api/v1/nanobanana/record-info?taskId=T')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
