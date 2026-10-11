import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_1 — a credential store that cannot be READ is not a provider that is NOT
// CONFIGURED. Routes answer one retryable 503 with a stable code, close any claimed Attempt/Review, make zero provider
// calls and never fall back to another credential. Mocked transport, dummy keys: 0 paid calls.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  resolveProvider: vi.fn(),
  freeze: vi.fn(),
  fail: vi.fn(),
  serviceRole: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: mocks.serviceRole }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/image-generation/execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-generation/execution')>()),
  freezeAndClaimImageAttempt: mocks.freeze,
  failImageAttempt: mocks.fail,
}))

import { ProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const ROUTES = [
  { name: 'OpenAI image generation (canonical Session)', path: '/api/openai/generate-image', load: () => import('@/app/api/openai/generate-image/route'), body: { prompt: 'a fox', sessionId: 's', clientRequestId: 'c' }, provider: 'openai', attempt: true },
  { name: 'OpenAI image generation (legacy)', path: '/api/openai/generate-image', load: () => import('@/app/api/openai/generate-image/route'), body: { prompt: 'a fox' }, provider: 'openai', attempt: false },
  { name: 'Nano Banana (canonical Session)', path: '/api/nanobanana/generate', load: () => import('@/app/api/nanobanana/generate/route'), body: { prompt: 'a fox', sessionId: 's', clientRequestId: 'c' }, provider: 'nano_banana', attempt: true },
  { name: 'Nano Banana (legacy)', path: '/api/nanobanana/generate', load: () => import('@/app/api/nanobanana/generate/route'), body: { prompt: 'a fox' }, provider: 'nano_banana', attempt: false },
  { name: 'OpenAI prompt generation', path: '/api/prompts/generate-image-prompt', load: () => import('@/app/api/prompts/generate-image-prompt/route'), body: { userInput: 'a fox' }, provider: 'openai', attempt: false },
  { name: 'OpenAI prompt translation', path: '/api/prompts/translate', load: () => import('@/app/api/prompts/translate/route'), body: { prompt: 'a fox' }, provider: 'openai', attempt: false },
] as const

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.from.mockReturnValue({})
  mocks.freeze.mockResolvedValue({ claimed: true, attempt: { id: 'attempt-1' } })
  mocks.fail.mockResolvedValue(undefined)
  mocks.resolveProvider.mockRejectedValue(new ProviderCredentialUnavailableError('store_failure', 'openai'))
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe.each(ROUTES)('$name — credential store unavailable', ({ path, load, body, attempt }) => {
  it('answers a retryable 503 PROVIDER_CREDENTIAL_UNAVAILABLE, never "not configured", with zero provider calls', async () => {
    const { POST } = await load()
    const response = await POST(post(path, body))
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.code === 'PROVIDER_CREDENTIAL_UNAVAILABLE' || payload.error === 'PROVIDER_CREDENTIAL_UNAVAILABLE').toBe(true)
    expect(JSON.stringify(payload)).not.toMatch(/PROVIDER_NOT_CONFIGURED|PROMPT_PROVIDER_NOT_CONFIGURED|não configurad|nao configurad/i)
    expect(fetchSpy).not.toHaveBeenCalled()
    if (attempt) {
      expect(mocks.freeze).toHaveBeenCalledTimes(1)
      // The claimed Attempt is closed so the user can retry; it is not left pending.
      expect(mocks.fail).toHaveBeenCalledTimes(1)
      expect(mocks.fail.mock.calls[0][0]).toMatchObject({ id: 'attempt-1' })
    }
  })

  it('still reports "not configured" for a credential that is genuinely missing', async () => {
    mocks.resolveProvider.mockResolvedValue({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED', provider: 'openai', executionMode: 'user_byok' })
    const { POST } = await load()
    const response = await POST(post(path, body))
    expect([400, 422]).toContain(response.status)
    expect(JSON.stringify(await response.json())).toMatch(/NOT_CONFIGURED/)
  })
})

describe('every resolver call site maps a credential-store failure', () => {
  const ROOT = process.cwd()
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full)
    }
    return out
  }
  const sources = [...walk(join(ROOT, 'app/api')), ...walk(join(ROOT, 'lib/reviews'))].map((file) => ({
    path: file.slice(ROOT.length + 1).split(String.fromCharCode(92)).join('/'),
    text: readFileSync(file, 'utf8'),
  }))
  const callers = sources.filter((file) => file.text.includes('resolveProviderExecution('))

  it('finds the known call sites', () => {
    expect(callers.length).toBeGreaterThanOrEqual(14)
  })

  it.each(callers.map((file) => [file.path, file.text] as const))('%s handles ProviderCredentialUnavailableError', (path, text) => {
    // The NanoBanana callback intentionally lets any failure become a retryable 503 (the provider calls back again).
    if (path === 'app/api/nanobanana/callback/route.ts') {
      expect(text).toMatch(/status: 503/)
      return
    }
    expect(text).toMatch(/providerCredentialUnavailableResponse|isProviderCredentialUnavailableError/)
  })
})
