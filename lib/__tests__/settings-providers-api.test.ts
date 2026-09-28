import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

function buildAuthedSupabase(userId: string, options: {
  upsert?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  userSettingsRow?: Record<string, unknown> | null
} = {}) {
  const upsert = options.upsert ?? vi.fn().mockResolvedValue({ error: null })
  const update = options.update ?? vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: options.userSettingsRow ?? null, error: null }),
        })),
      })),
      upsert,
      update,
    })),
  }
}

describe('/api/settings/providers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('GET returns status only — never the raw secret value', async () => {
    const supabase = buildAuthedSupabase('user-1', {
      userSettingsRow: { openai_api_key: 'sk-should-never-leak', nanobanana_api_key: null, kling_api_key: 'kling-should-never-leak', replicate_api_key: null, nanobanana_base_url: 'https://example.test' },
    })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { GET } = await import('@/app/api/settings/providers/route')
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.providers.openai.status).toBe('configured')
    expect(payload.providers.kling.status).toBe('configured')
    expect(payload.providers.nano_banana.status).toBe('missing')

    const raw = JSON.stringify(payload)
    expect(raw).not.toContain('sk-should-never-leak')
    expect(raw).not.toContain('kling-should-never-leak')
  })

  it('GET requires authentication', async () => {
    const supabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('no session') }) } }
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { GET } = await import('@/app/api/settings/providers/route')
    const response = await GET()
    expect(response.status).toBe(401)
  })
})

describe('/api/settings/providers/[provider]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  function makeRequest(body: Record<string, unknown>, method: 'PUT' | 'DELETE' = 'PUT') {
    return new NextRequest('http://localhost/api/settings/providers/kling', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify(body) : undefined,
    })
  }

  it('PUT saves a credential and returns only { provider, status } — never the secret', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = buildAuthedSupabase('user-1', { upsert })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(makeRequest({ apiKey: 'kling-real-secret' }), { params: Promise.resolve({ provider: 'kling' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ provider: 'kling', status: 'configured' })
    expect(JSON.stringify(payload)).not.toContain('kling-real-secret')

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', kling_api_key: 'kling-real-secret' }),
      { onConflict: 'user_id' },
    )
  })

  it('PUT rejects an unknown provider id', async () => {
    const supabase = buildAuthedSupabase('user-1')
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(makeRequest({ apiKey: 'x' }), { params: Promise.resolve({ provider: 'anthropic' }) })
    expect(response.status).toBe(400)
  })

  it('PUT rejects an empty api key', async () => {
    const supabase = buildAuthedSupabase('user-1')
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(makeRequest({ apiKey: '   ' }), { params: Promise.resolve({ provider: 'kling' }) })
    expect(response.status).toBe(400)
  })

  it('PUT requires authentication', async () => {
    const supabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('no session') }) } }
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(makeRequest({ apiKey: 'x' }), { params: Promise.resolve({ provider: 'kling' }) })
    expect(response.status).toBe(401)
  })

  it('DELETE clears the credential and returns status "missing"', async () => {
    const eqSpy = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: eqSpy }))
    const supabase = buildAuthedSupabase('user-1', { update })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { DELETE } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await DELETE(makeRequest({}, 'DELETE'), { params: Promise.resolve({ provider: 'kling' }) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ provider: 'kling', status: 'missing' })
    expect(update).toHaveBeenCalledWith({ kling_api_key: null })
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('replacing a credential does not leak the previous value in the response', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = buildAuthedSupabase('user-1', {
      upsert,
      userSettingsRow: { kling_api_key: 'old-secret' },
    })
    vi.mocked(server.createClient).mockResolvedValue(supabase as any)

    const { PUT } = await import('@/app/api/settings/providers/[provider]/route')
    const response = await PUT(makeRequest({ apiKey: 'new-secret' }), { params: Promise.resolve({ provider: 'kling' }) })
    const payload = await response.json()

    expect(payload).toEqual({ provider: 'kling', status: 'configured' })
    const raw = JSON.stringify(payload)
    expect(raw).not.toContain('old-secret')
    expect(raw).not.toContain('new-secret')
  })
})
