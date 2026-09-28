import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

// This route replaces the previous client-side call that sent the user's
// plaintext OpenAI key straight from the browser to api.openai.com. Moving
// it server-side is the fix; these tests lock in that the browser never
// needs (or can send) the secret, and that the server resolves it itself.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
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
  return new NextRequest('http://localhost/api/prompts/generate-image-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/prompts/generate-image-prompt', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a typed missing-credential error and never calls OpenAI when unconfigured', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import('@/app/api/prompts/generate-image-prompt/route')
    const response = await POST(makeRequest({ userInput: 'capa editorial' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe('PROMPT_PROVIDER_NOT_CONFIGURED')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves the credential server-side and returns the generated prompt without echoing the secret', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', 'sk-server-only') as any)
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'a clean editorial cover, soft lighting' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { POST } = await import('@/app/api/prompts/generate-image-prompt/route')
    const response = await POST(makeRequest({ userInput: 'capa editorial' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.prompt).toContain('editorial cover')
    expect(JSON.stringify(payload)).not.toContain('sk-server-only')
  })

  it('requires authentication', async () => {
    vi.mocked(server.createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('no session') }) },
    } as any)

    const { POST } = await import('@/app/api/prompts/generate-image-prompt/route')
    const response = await POST(makeRequest({ userInput: 'x' }))
    expect(response.status).toBe(401)
  })
})
