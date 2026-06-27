import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSingle = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

function makeRequest(prompt = 'A clean editorial image prompt') {
  return new Request('http://localhost/api/prompts/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
}

function setupSupabase(openaiApiKey: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mockSingle.mockResolvedValue({ data: { openai_api_key: openaiApiKey }, error: null })
  mockEq.mockReturnValue({ single: mockSingle })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
}

describe('/api/prompts/translate', () => {
  let POST: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.OPENAI_API_KEY
    const mod = await import('../../app/api/prompts/translate/route')
    POST = mod.POST
  })

  it('returns structured provider-not-configured error without calling OpenAI', async () => {
    setupSupabase(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      code: 'PROMPT_PROVIDER_NOT_CONFIGURED',
      error: 'Tradução indisponível sem provedor configurado.',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('translates with a configured provider and returns Portuguese text', async () => {
    setupSupabase('sk-test')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Uma capa editorial limpa em um estúdio claro.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.translatedPrompt).toBe('Uma capa editorial limpa em um estúdio claro.')
  })

  it('returns structured provider failure when OpenAI fails', async () => {
    setupSupabase('sk-test')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'provider failed' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const response = await POST(makeRequest())
    const payload = await response.json()

    expect(response.status).toBe(429)
    expect(payload.code).toBe('PROMPT_PROVIDER_FAILED')
  })
})
