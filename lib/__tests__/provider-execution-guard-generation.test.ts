import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// FUTURE-050 — Generation / text-provider routes and transports in an environment that may not spend.
// A blocked request must leave NOTHING behind: no Attempt, no queued generation, no credential read, no provider
// HTTP call, no usage event. Mocked transport only: 0 paid calls.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  resolveProvider: vi.fn(),
  freeze: vi.fn(),
  serviceRole: vi.fn(),
  providerFetch: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: mocks.serviceRole }))
vi.mock('@/lib/credentials/provider-execution', () => ({ resolveProviderExecution: mocks.resolveProvider }))
vi.mock('@/lib/image-generation/execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/image-generation/execution')>()),
  freezeAndClaimImageAttempt: mocks.freeze,
}))

import { restoreEnvironment, simulateEnvironment, type SimulatedEnvironment } from '@/lib/providers/__tests__/policy-env'
import { ProviderExecutionDisabledError } from '@/lib/providers/execution-policy'
import { KlingMcpTransport, KlingRestTransport } from '@/lib/video-generation/transport'

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const ROUTES = [
  { name: 'OpenAI image generation (canonical Session)', path: '/api/openai/generate-image', load: () => import('@/app/api/openai/generate-image/route'), body: { prompt: 'a fox', sessionId: 's', clientRequestId: 'c' }, provider: 'openai' },
  { name: 'OpenAI image generation (legacy)', path: '/api/openai/generate-image', load: () => import('@/app/api/openai/generate-image/route'), body: { prompt: 'a fox' }, provider: 'openai' },
  { name: 'Nano Banana image generation', path: '/api/nanobanana/generate', load: () => import('@/app/api/nanobanana/generate/route'), body: { prompt: 'a fox', sessionId: 's', clientRequestId: 'c' }, provider: 'nano_banana' },
  { name: 'Kling video generation', path: '/api/video-generations', load: () => import('@/app/api/video-generations/route'), body: { projectId: 'p', productionId: 'q', prompt: 'a fox', clientRequestId: 'c' }, provider: 'kling' },
  { name: 'OpenAI image evaluation (legacy evaluator)', path: '/api/evaluate-image', load: () => import('@/app/api/evaluate-image/route'), body: { imageUrl: 'https://example.test/i.png', prompt: 'x' }, provider: 'openai' },
  { name: 'OpenAI prompt generation', path: '/api/prompts/generate-image-prompt', load: () => import('@/app/api/prompts/generate-image-prompt/route'), body: { userInput: 'a fox' }, provider: 'openai' },
  { name: 'OpenAI prompt translation', path: '/api/prompts/translate', load: () => import('@/app/api/prompts/translate/route'), body: { prompt: 'a fox' }, provider: 'openai' },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.from.mockImplementation(() => { throw new Error('DATABASE_TOUCHED_BEFORE_GUARD') })
  mocks.serviceRole.mockImplementation(() => { throw new Error('SERVICE_ROLE_TOUCHED_BEFORE_GUARD') })
  mocks.resolveProvider.mockResolvedValue({ status: 'provider_not_configured', code: 'PROVIDER_NOT_CONFIGURED', provider: 'x', executionMode: 'user_byok' })
  vi.stubGlobal('fetch', mocks.providerFetch)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  restoreEnvironment()
  vi.unstubAllGlobals()
})

const BLOCKED: SimulatedEnvironment[] = ['preview', 'test', 'unknown', 'local']

describe.each(BLOCKED)('generation routes refuse paid execution in %s', (environment) => {
  beforeEach(() => simulateEnvironment(environment))

  it.each(ROUTES)('17/18/19. $name: 403 + typed code, 0 provider calls, nothing created', async ({ path, load, body, provider }) => {
    const { POST } = await load()
    const response = await POST(post(path, body) as never)
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toMatchObject({ code: 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT', environment, provider })
    expect(payload.error).not.toMatch(/KEY|SUPABASE|VERCEL|secret/i)
    expect(mocks.providerFetch).not.toHaveBeenCalled() // no provider HTTP call, no usage-producing request
    expect(mocks.resolveProvider).not.toHaveBeenCalled() // no credential read
    expect(mocks.freeze).not.toHaveBeenCalled() // no Attempt frozen/claimed
    expect(mocks.serviceRole).not.toHaveBeenCalled() // no queued generation / task row
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('outbound-boundary backstops', () => {
  it('Kling REST transport.submit throws before any provider HTTP request in Preview', async () => {
    simulateEnvironment('preview')
    const transport = new KlingRestTransport('k')
    await expect(transport.submit({ prompt: 'p', generationId: 'g', request: { operation: 'text_to_video', model: 'kling-v3', duration: 5, resolution: '720p' } } as never)).rejects.toBeInstanceOf(ProviderExecutionDisabledError)
    expect(mocks.providerFetch).not.toHaveBeenCalled()
  })

  it('Kling MCP transport.submit throws before any token is read or file uploaded in Preview', async () => {
    simulateEnvironment('preview')
    const tokens = { get: vi.fn(), refresh: vi.fn() }
    const transport = new KlingMcpTransport(tokens)
    await expect(transport.submit({ prompt: 'p', generationId: 'g', request: { operation: 'text_to_video', model: 'kling-video-v3_0' } } as never)).rejects.toBeInstanceOf(ProviderExecutionDisabledError)
    expect(tokens.get).not.toHaveBeenCalled()
    expect(mocks.providerFetch).not.toHaveBeenCalled()
  })

  it('the credential resolver itself never releases a secret in Preview, but still serves status reads', async () => {
    simulateEnvironment('preview')
    const real = await vi.importActual<typeof import('@/lib/credentials/provider-execution')>('@/lib/credentials/provider-execution')
    const db = { from: () => { throw new Error('CREDENTIAL_TABLE_READ') } } as never
    await expect(real.resolveProviderExecution(db, { userId: 'u', provider: 'gemini' })).rejects.toBeInstanceOf(ProviderExecutionDisabledError)
    // status_read passes the policy and proceeds to the credential lookup (which this stub then refuses).
    await expect(real.resolveProviderExecution(db, { userId: 'u', provider: 'kling', purpose: 'status_read' })).rejects.toThrow('CREDENTIAL_TABLE_READ')
  })
})

describe('Production still reaches the provider boundary', () => {
  it('21. Production passes the guard: the route proceeds to credential resolution (mocked: not configured)', async () => {
    simulateEnvironment('production')
    const { POST } = await import('@/app/api/prompts/translate/route')
    const response = await POST(post('/api/prompts/translate', { prompt: 'a fox' }) as never)
    expect(response.status).not.toBe(403)
    expect(mocks.resolveProvider).toHaveBeenCalledTimes(1)
    expect(mocks.providerFetch).not.toHaveBeenCalled()
  })
})

describe('test harness: default fetch refuses real provider hosts', () => {
  it('a test that does not mock fetch cannot reach a provider by accident', async () => {
    vi.unstubAllGlobals() // back to the harness default
    await expect(fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })).rejects.toThrow(/real provider call/)
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models')).rejects.toThrow(/real provider call/)
    await expect(fetch('https://api-singapore.klingai.com/tasks')).rejects.toThrow(/real provider call/)
    await expect(fetch('https://api.nanobananaapi.ai/api/v1/x')).rejects.toThrow(/real provider call/)
  })
})
