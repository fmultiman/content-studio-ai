import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as server from '@/lib/supabase/server'

// AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1
// Every current OpenAI execution route runs in `user_byok`: a configured user
// key is used; a missing one is PROVIDER_NOT_CONFIGURED with zero provider
// calls. The platform OPENAI_API_KEY must never stand in.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const PLATFORM_KEY = 'sk-platform-must-never-be-used'
const USER_KEY = 'sk-user-owned-key'

function buildSupabase(userId: string, openaiApiKey: string | null, tables: Record<string, unknown> = {}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn((table: string) => {
      const builder: any = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'then') return undefined
            if (prop === 'maybeSingle' && table === 'user_settings') {
              return async () => ({
                data: openaiApiKey !== null ? { openai_api_key: openaiApiKey } : null,
                error: null,
              })
            }
            if (prop === 'single' || prop === 'maybeSingle') {
              return async () => ({ data: tables[table] ?? null, error: null })
            }
            return () => builder
          },
        },
      )
      return builder
    }),
  }
}

interface RouteCase {
  name: string
  module: string
  body: Record<string, unknown>
  tables?: Record<string, unknown>
  /** Prompt routes keep their legacy UI-facing `code`; the typed status is in `providerCode`. */
  typedCodeField: 'code' | 'providerCode'
}

const CASES: RouteCase[] = [
  { name: 'prompts/translate', module: '@/app/api/prompts/translate/route', body: { prompt: 'a red bicycle' }, typedCodeField: 'providerCode' },
  { name: 'prompts/generate-image-prompt', module: '@/app/api/prompts/generate-image-prompt/route', body: { userInput: 'capa editorial' }, typedCodeField: 'providerCode' },
  { name: 'evaluate-image', module: '@/app/api/evaluate-image/route', body: { generatedPrompt: 'p', imageUrl: 'https://img.test/a.png' }, typedCodeField: 'code' },
  { name: 'posts/generate-feed-text', module: '@/app/api/posts/generate-feed-text/route', body: { description: 'lançamento' }, typedCodeField: 'code' },
  { name: 'videos/generate-scene-prompt', module: '@/app/api/videos/generate-scene-prompt/route', body: { description: 'cena' }, typedCodeField: 'code' },
  {
    name: 'channel-pieces/generate-body',
    module: '@/app/api/channel-pieces/generate-body/route',
    body: { editorialContentId: 'ec-1', channel: 'instagram', format: 'feed' },
    tables: {
      editorial_contents: { title: 't', body: 'b', ai_context: '', project_id: 'p-1', production_id: null },
      projects: { name: 'n', description: '', context: '' },
    },
    typedCodeField: 'code',
  },
]

function jsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe.each(CASES)('OpenAI route $name — user_byok', (routeCase) => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.OPENAI_API_KEY = PLATFORM_KEY
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENAI_API_KEY
  })

  it('missing user key → PROVIDER_NOT_CONFIGURED, zero OpenAI calls, env key untouched', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null, routeCase.tables) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import(/* @vite-ignore */ routeCase.module)
    const response = await POST(jsonRequest('http://localhost/api/x', routeCase.body))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.provider).toBe('openai')
    expect(payload[routeCase.typedCodeField]).toBe('PROVIDER_NOT_CONFIGURED')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(JSON.stringify(payload)).not.toContain(PLATFORM_KEY)
  })

  it('a client-supplied execution mode cannot enable platform-funded execution', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null, routeCase.tables) as any)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { POST } = await import(/* @vite-ignore */ routeCase.module)
    const forgedBody = { ...routeCase.body, executionMode: 'content_studio_credits', credentialSource: 'platform' }
    const response = await POST(jsonRequest('http://localhost/api/x', forgedBody))

    // Either rejected as an unknown field (400) or treated as user_byok → not configured (400).
    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('configured user key → the provider is called with the USER key, not the platform key', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', USER_KEY, routeCase.tables) as any)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'stubbed provider response' } }), { status: 500 }))

    const { POST } = await import(/* @vite-ignore */ routeCase.module)
    const response = await POST(jsonRequest('http://localhost/api/x', routeCase.body))
    await response.text()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${USER_KEY}`)
    expect(headers.Authorization).not.toContain(PLATFORM_KEY)
  })
})
