import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as server from '@/lib/supabase/server'
import { GEMINI_IMAGE_GENERATION_FLAG } from '@/lib/providers/gemini/image-feature'

// FUTURE-064 Slice B — GET /api/settings/providers exposes a server-derived, browser-safe availability class for official
// Gemini image generation. Mocked auth; no provider call.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const authed = (settings: Record<string, unknown> | null = {}) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
  from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: settings, error: null }) })) })) })),
})

const get = async () => {
  const { GET } = await import('@/app/api/settings/providers/route')
  const response = await GET()
  return { response, payload: await response.json() }
}

beforeEach(() => {
  vi.resetModules()
  vi.mocked(server.createClient).mockResolvedValue(authed({ gemini_api_key: 'gemini-secret-must-not-leak', openai_api_key: null }) as any)
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/settings/providers — imageGeneration.gemini', () => {
  it('is OFF by default (the Production state) and says why', async () => {
    const { response, payload } = await get()
    expect(response.status).toBe(200)
    expect(payload.imageGeneration.gemini).toEqual({ available: false, reason: 'release_switch_off' })
  })

  it('is ON when the switch is set and the runtime may spend (mocked harness), independent of the credential status', async () => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
    const { payload } = await get()
    expect(payload.imageGeneration.gemini).toEqual({ available: true, reason: 'available' })
    expect(payload.providers.gemini.status).toBe('configured')
  })

  it('a configured key does not enable the capability, and an enabled capability does not need a key to be reported', async () => {
    vi.mocked(server.createClient).mockResolvedValue(authed({ gemini_api_key: null }) as any)
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
    const { payload } = await get()
    expect(payload.providers.gemini.status).toBe('missing')
    expect(payload.imageGeneration.gemini.available).toBe(true)
    vi.unstubAllEnvs()
    vi.mocked(server.createClient).mockResolvedValue(authed({ gemini_api_key: 'x' }) as any)
    vi.resetModules()
    const again = await get()
    expect(again.payload.providers.gemini.status).toBe('configured')
    expect(again.payload.imageGeneration.gemini.available).toBe(false)
  })

  it.each(['1', 'true', 'TRUE', 'Enabled', ' enabled', ''])('stays OFF for the boolean-ish value %j', async (value) => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, value)
    expect((await get()).payload.imageGeneration.gemini.available).toBe(false)
  })

  it('never exposes the variable name, its value or any secret', async () => {
    vi.stubEnv(GEMINI_IMAGE_GENERATION_FLAG, 'enabled')
    const { payload } = await get()
    const raw = JSON.stringify(payload.imageGeneration)
    expect(raw).not.toMatch(/CONTENT_STUDIO|GEMINI_IMAGE_GENERATION|"enabled"/)
    expect(JSON.stringify(payload)).not.toContain('gemini-secret-must-not-leak')
    expect(Object.keys(payload.imageGeneration.gemini).sort()).toEqual(['available', 'reason'])
  })

  it('still requires authentication', async () => {
    vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } } as any)
    const { response, payload } = await get()
    expect(response.status).toBe(401)
    expect(payload.imageGeneration).toBeUndefined()
  })
})
