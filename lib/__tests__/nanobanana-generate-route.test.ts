import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

function buildSupabase(userId: string, nanobananaApiKey: string | null, insertResult: { data: any; error: any } = { data: { id: 'task-row-1' }, error: null }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === 'user_settings') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: nanobananaApiKey !== null ? { nanobanana_api_key: nanobananaApiKey } : null,
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'generation_tasks') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue(insertResult),
            })),
          })),
        }
      }
      return {}
    }),
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/nanobanana/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/nanobanana/generate — BYOK credential resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://content.multihuman.com.br'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects with zero provider calls when the user has no NanoBanana key configured', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import('@/app/api/nanobanana/generate/route')
    const response = await POST(makeRequest({ prompt: 'a red bicycle' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/não configurada/)
    expect(payload).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', provider: 'nano_banana' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a client-supplied execution mode cannot force platform-funded execution (and there is no platform NanoBanana credential)', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import('@/app/api/nanobanana/generate/route')
    const response = await POST(
      makeRequest({ prompt: 'a red bicycle', executionMode: 'content_studio_credits', credentialSource: 'platform' }),
    )

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('submits to NanoBanana using the resolved user credential (existing flow remains functional)', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', 'nb-secret') as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'ext-task-1' } }), { status: 200 }),
    )

    const { POST } = await import('@/app/api/nanobanana/generate/route')
    const response = await POST(makeRequest({ prompt: 'a red bicycle' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.externalTaskId).toBe('ext-task-1')

    const [, requestInit] = fetchSpy.mock.calls[0]
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer nb-secret' })
    expect(JSON.stringify(payload)).not.toContain('nb-secret')
  })
})
