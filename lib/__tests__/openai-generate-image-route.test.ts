import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/storage/s3', () => ({
  uploadImageToS3: vi.fn().mockResolvedValue(null),
  createPresignedReadUrl: vi.fn().mockResolvedValue(null),
}))

function buildSupabase(userId: string, openaiApiKey: string | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: openaiApiKey !== null ? { openai_api_key: openaiApiKey } : null,
            error: null,
          }),
        })),
      })),
    })),
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/openai/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/openai/generate-image — BYOK credential resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENAI_API_KEY
  })

  it('resolves the user OpenAI credential and calls the OpenAI Images API with it', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', 'sk-user-key') as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'https://openai.test/image.png' }] }), { status: 200 }),
    )

    const { POST } = await import('@/app/api/openai/generate-image/route')
    const response = await POST(makeRequest({ prompt: 'a red bicycle' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.imageUrl).toBe('https://openai.test/image.png')

    const [, requestInit] = fetchSpy.mock.calls[0]
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-user-key' })
    expect(JSON.stringify(payload)).not.toContain('sk-user-key')
  })

  it('falls back to the platform env key when the user has none configured (documented legacy exception)', async () => {
    process.env.OPENAI_API_KEY = 'sk-platform-fallback'
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'https://openai.test/image.png' }] }), { status: 200 }),
    )

    const { POST } = await import('@/app/api/openai/generate-image/route')
    const response = await POST(makeRequest({ prompt: 'a red bicycle' }))
    expect(response.status).toBe(200)

    const [, requestInit] = fetchSpy.mock.calls[0]
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-platform-fallback' })
  })

  it('returns 400 when neither the user nor the platform has a key', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import('@/app/api/openai/generate-image/route')
    const response = await POST(makeRequest({ prompt: 'a red bicycle' }))
    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
