import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — Settings → API through the REAL credential store with the
// privileged client separated from the browser-session client. Behaviour users see is unchanged (configure,
// status, replace, remove); the secret column is never read or written through the session client; no response
// or log carries a key. Dummy keys, in-memory fakes: 0 provider calls.

const session = vi.hoisted(() => ({ client: null as unknown, userId: 'user-a' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session.client }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))

const DUMMY = { openai: 'sk-DUMMY-openai-settings', kling: 'kling-DUMMY-settings', gemini: 'gemini-DUMMY-settings' }
const LEAKY_DB_MESSAGE = 'permission denied for column openai_api_key sk-DUMMY-LEAK-IN-DB'

type Store = typeof import('@/lib/credentials/api-credential-store')
let store: Store

const sessionOps: string[] = []
const privilegedOps: Array<{ op: string; payload?: unknown; filters?: Record<string, unknown>; columns?: string }> = []

function sessionClient(userId: string, nanobananaBaseUrl: string | null = null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            sessionOps.push(`select:${columns}`)
            return { data: columns === 'user_id' ? { user_id: userId } : { nanobanana_base_url: nanobananaBaseUrl }, error: null }
          },
        }),
      }),
      upsert: async () => {
        sessionOps.push('upsert')
        return { error: null }
      },
      update: () => ({
        eq: async () => {
          sessionOps.push('update')
          return { error: null }
        },
      }),
    })),
  }
}

function privilegedClient(options: { row?: Record<string, unknown> | null; error?: string } = {}) {
  const failure = options.error ? { message: options.error } : null
  return {
    from: vi.fn(() => ({
      select: (columns: string) => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            privilegedOps.push({ op: 'select', columns, filters: { [column]: value } })
            return { data: failure ? null : options.row ?? null, error: failure }
          },
        }),
      }),
      upsert: async (payload: unknown) => {
        privilegedOps.push({ op: 'upsert', payload })
        return { error: failure }
      },
      update: (payload: unknown) => ({
        eq: async (column: string, value: unknown) => {
          privilegedOps.push({ op: 'update', payload, filters: { [column]: value } })
          return { error: failure }
        },
      }),
    })),
  } as unknown as SupabaseClient
}

const put = (provider: string, body: unknown) =>
  new NextRequest(`http://localhost/api/settings/providers/${provider}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const del = (provider: string) => new NextRequest(`http://localhost/api/settings/providers/${provider}`, { method: 'DELETE' })
const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) })

let errorLog: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.resetModules()
  sessionOps.length = 0
  privilegedOps.length = 0
  store = await import('@/lib/credentials/api-credential-store')
  store.__setCredentialStoreCallerClientHarnessForTests(false)
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  session.client = sessionClient('user-a')
})
afterEach(() => {
  store.__setPrivilegedCredentialClientForTests(null)
  store.__setCredentialStoreCallerClientHarnessForTests(true)
  vi.restoreAllMocks()
})

describe('GET /api/settings/providers', () => {
  const ROW = { user_id: 'user-a', openai_api_key: DUMMY.openai, gemini_api_key: DUMMY.gemini, nanobanana_api_key: null, kling_api_key: DUMMY.kling, replicate_api_key: null }

  it('returns statuses only; the secret columns are read by the privileged client, never the session client', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient({ row: ROW }))
    const { GET } = await import('@/app/api/settings/providers/route')
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(Object.fromEntries(Object.entries(payload.providers).map(([k, v]) => [k, (v as { status: string }).status]))).toEqual({
      openai: 'configured', nano_banana: 'missing', kling: 'configured', replicate: 'missing', gemini: 'configured',
    })
    const body = JSON.stringify(payload)
    for (const key of Object.values(DUMMY)) expect(body).not.toContain(key)
    expect(sessionOps.filter((op) => /api_key/.test(op))).toEqual([])
    expect(sessionOps).toContain('select:user_id')
    expect(privilegedOps.map((o) => o.filters)).toEqual([{ user_id: 'user-a' }])
  })

  it('a store failure shows "unavailable" for every provider, not "missing", without leaking the database message', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient({ error: LEAKY_DB_MESSAGE }))
    const { GET } = await import('@/app/api/settings/providers/route')
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    for (const entry of Object.values(payload.providers) as Array<{ status: string }>) expect(entry.status).toBe('unavailable')
    expect(JSON.stringify(payload)).not.toContain('sk-DUMMY')
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('sk-DUMMY')
  })

  it('requires authentication and reads nothing without it', async () => {
    session.client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }) }, from: vi.fn() }
    store.__setPrivilegedCredentialClientForTests(privilegedClient({ row: ROW }))
    const { GET } = await import('@/app/api/settings/providers/route')
    expect((await GET()).status).toBe(401)
    expect(privilegedOps).toEqual([])
  })
})

describe('PUT /api/settings/providers/[provider]', () => {
  it('writes through the privileged client for the SESSION user, ignores a body-supplied owner, and returns status only', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient())
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(put('openai', { apiKey: ` ${DUMMY.openai} `, userId: 'user-evil', user_id: 'user-evil' }), ctx('openai'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ provider: 'openai', status: 'configured' })
    expect(JSON.stringify(payload)).not.toContain(DUMMY.openai)
    expect(privilegedOps).toEqual([{ op: 'upsert', payload: { user_id: 'user-a', openai_api_key: DUMMY.openai } }])
    expect(sessionOps).toEqual([])
  })

  it('NanoBanana keeps its non-secret base URL in the same write', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient())
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(put('nano_banana', { apiKey: 'nb-DUMMY-settings', baseUrl: 'https://nb.example.test' }), ctx('nano_banana'))
    expect(response.status).toBe(200)
    expect(privilegedOps[0].payload).toEqual({ user_id: 'user-a', nanobanana_api_key: 'nb-DUMMY-settings', nanobanana_base_url: 'https://nb.example.test' })
  })

  it('a failed save answers 500 with a static message and logs no key or database text; it never claims success', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient({ error: LEAKY_DB_MESSAGE }))
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(put('openai', { apiKey: DUMMY.openai }), ctx('openai'))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ error: 'Nao foi possivel salvar a credencial' })
    const everything = JSON.stringify([payload, errorLog.mock.calls])
    for (const forbidden of [DUMMY.openai, 'sk-DUMMY', LEAKY_DB_MESSAGE]) expect(everything).not.toContain(forbidden)
  })

  it('refuses an unknown provider and an empty key before any write', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient())
    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    expect((await PUT(put('__proto__', { apiKey: 'x' }), ctx('__proto__'))).status).toBe(400)
    expect((await PUT(put('openai', { apiKey: '   ' }), ctx('openai'))).status).toBe(400)
    expect(privilegedOps).toEqual([])
  })
})

describe('DELETE /api/settings/providers/[provider]', () => {
  it('nulls exactly the session user column through the privileged client and returns status only', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient())
    const { DELETE } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await DELETE(del('gemini'), ctx('gemini'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provider: 'gemini', status: 'missing' })
    expect(privilegedOps).toEqual([{ op: 'update', payload: { gemini_api_key: null }, filters: { user_id: 'user-a' } }])
    expect(sessionOps).toEqual([])
  })

  it('a failed removal answers 500 and does not claim the credential is gone', async () => {
    store.__setPrivilegedCredentialClientForTests(privilegedClient({ error: LEAKY_DB_MESSAGE }))
    const { DELETE } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await DELETE(del('openai'), ctx('openai'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Nao foi possivel remover a credencial' })
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('sk-DUMMY')
  })

  it('without a privileged client the write fails closed and the browser-session client is never used for the secret', async () => {
    const { createServiceRoleSupabase } = await import('@/lib/supabase/service-role')
    vi.mocked(createServiceRoleSupabase).mockImplementation(() => {
      throw new Error('SERVICE_ROLE_NOT_CONFIGURED')
    })
    const { DELETE, PUT } = await import('@/app/api/settings/providers/[provider]/route')
    expect((await DELETE(del('openai'), ctx('openai'))).status).toBe(500)
    expect((await PUT(put('openai', { apiKey: DUMMY.openai }), ctx('openai'))).status).toBe(500)
    expect(sessionOps).toEqual([])
  })
})
