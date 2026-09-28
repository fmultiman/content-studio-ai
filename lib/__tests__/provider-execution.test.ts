import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveProviderExecution,
  checkContentStudioCreditsEntitlement,
  isProviderExecutionMode,
  DEFAULT_PROVIDER_EXECUTION_MODE,
} from '@/lib/credentials/provider-execution'
import { resolvePlatformCredential } from '@/lib/credentials/platform-credentials'
import { PROVIDER_METADATA, primaryConnectionMethod } from '@/lib/credentials/provider-metadata'
import { AI_PROVIDERS } from '@/lib/credentials/provider-credentials'

function buildSupabaseStub(rowsByUserId: Record<string, Record<string, unknown>>) {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn((_col: string, userId: string) => ({
        maybeSingle: vi.fn(async () => ({ data: rowsByUserId[userId] ?? null, error: null })),
      })),
    })),
  }))
  return { from }
}

describe('resolveProviderExecution — user_byok (default, active)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'platform-openai-key'
    process.env.KLING_API_KEY = 'platform-kling-key'
  })
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.KLING_API_KEY
    vi.unstubAllEnvs()
  })

  it('defaults to user_byok', () => {
    expect(DEFAULT_PROVIDER_EXECUTION_MODE).toBe('user_byok')
  })

  it('resolves a configured OpenAI user credential with source "user"', async () => {
    const supabase = buildSupabaseStub({ u1: { openai_api_key: 'sk-user' } })
    const result = await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'openai' })
    expect(result).toEqual({
      status: 'ready',
      provider: 'openai',
      executionMode: 'user_byok',
      credentialSource: 'user',
      secret: 'sk-user',
    })
  })

  it('resolves a configured Kling user credential with source "user"', async () => {
    const supabase = buildSupabaseStub({ u1: { kling_api_key: 'kling-user' } })
    const result = await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'kling', mode: 'user_byok' })
    expect(result).toMatchObject({ status: 'ready', credentialSource: 'user', secret: 'kling-user', executionMode: 'user_byok' })
  })

  it('resolves a configured Nano Banana user credential', async () => {
    const supabase = buildSupabaseStub({ u1: { nanobanana_api_key: 'nb-user' } })
    const result = await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'nano_banana' })
    expect(result).toMatchObject({ status: 'ready', credentialSource: 'user', secret: 'nb-user' })
  })

  it('missing OpenAI credential → PROVIDER_NOT_CONFIGURED, even with OPENAI_API_KEY set in the environment', async () => {
    const supabase = buildSupabaseStub({})
    const result = await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'openai' })
    expect(result).toEqual({
      status: 'provider_not_configured',
      code: 'PROVIDER_NOT_CONFIGURED',
      provider: 'openai',
      executionMode: 'user_byok',
    })
    expect(JSON.stringify(result)).not.toContain('platform-openai-key')
  })

  it('missing Kling credential → PROVIDER_NOT_CONFIGURED, even with KLING_API_KEY set (any NODE_ENV)', async () => {
    const supabase = buildSupabaseStub({})
    for (const env of ['production', 'development', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      const result = await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'kling' })
      expect(result.status).toBe('provider_not_configured')
      expect(JSON.stringify(result)).not.toContain('platform-kling-key')
    }
  })

  it('user_byok with a missing credential never transitions into platform mode', async () => {
    const supabase = buildSupabaseStub({})
    const entitlement = vi.fn().mockResolvedValue({ allowed: true })
    const result = await resolveProviderExecution(
      supabase as any,
      { userId: 'u1', provider: 'openai', mode: 'user_byok' },
      { checkEntitlement: entitlement },
    )
    expect(result.status).toBe('provider_not_configured')
    expect(result).not.toHaveProperty('credentialSource')
    expect(entitlement).not.toHaveBeenCalled()
  })

  it('User A cannot resolve User B credential', async () => {
    const supabase = buildSupabaseStub({ 'user-b': { openai_api_key: 'sk-b', kling_api_key: 'kling-b' } })
    for (const provider of ['openai', 'kling'] as const) {
      const result = await resolveProviderExecution(supabase as any, { userId: 'user-a', provider })
      expect(result.status).toBe('provider_not_configured')
    }
  })
})

describe('resolveProviderExecution — content_studio_credits (prepared, not enabled)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'platform-openai-key'
    process.env.KLING_API_KEY = 'platform-kling-key'
  })
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.KLING_API_KEY
  })

  it('the execution mode exists and is validated', () => {
    expect(isProviderExecutionMode('user_byok')).toBe(true)
    expect(isProviderExecutionMode('content_studio_credits')).toBe(true)
    expect(isProviderExecutionMode('platform')).toBe(false)
    expect(isProviderExecutionMode(undefined)).toBe(false)
    expect(isProviderExecutionMode({ mode: 'content_studio_credits' })).toBe(false)
  })

  it('the default entitlement check denies everyone (no billing system exists)', async () => {
    expect(await checkContentStudioCreditsEntitlement({ userId: 'u1', provider: 'kling' })).toEqual({ allowed: false })
  })

  it('fails closed with a typed NOT_ENABLED result, without a platform secret, even when the platform credential exists', async () => {
    const supabase = buildSupabaseStub({ u1: { kling_api_key: 'kling-user' } })
    const result = await resolveProviderExecution(supabase as any, {
      userId: 'u1',
      provider: 'kling',
      mode: 'content_studio_credits',
    })
    expect(result).toEqual({
      status: 'not_enabled',
      code: 'CONTENT_STUDIO_CREDITS_NOT_ENABLED',
      provider: 'kling',
      executionMode: 'content_studio_credits',
    })
    expect(JSON.stringify(result)).not.toContain('platform-kling-key')
    expect(JSON.stringify(result)).not.toContain('kling-user')
  })

  it('does not read the user credential store at all — credits mode is not a user-credential path', async () => {
    const supabase = buildSupabaseStub({ u1: { openai_api_key: 'sk-user' } })
    await resolveProviderExecution(supabase as any, { userId: 'u1', provider: 'openai', mode: 'content_studio_credits' })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('the platform credential is not read unless entitlement allows (zero platform spend today)', async () => {
    const supabase = buildSupabaseStub({})
    const result = await resolveProviderExecution(
      supabase as any,
      { userId: 'u1', provider: 'openai', mode: 'content_studio_credits' },
      { checkEntitlement: vi.fn().mockResolvedValue({ allowed: false }) },
    )
    expect(result.status).toBe('not_enabled')
    expect(result).not.toHaveProperty('secret')
  })

  it('platform credential source is distinct from the user source once a future entitlement allows it', async () => {
    const supabase = buildSupabaseStub({ u1: { openai_api_key: 'sk-user' } })
    const result = await resolveProviderExecution(
      supabase as any,
      { userId: 'u1', provider: 'openai', mode: 'content_studio_credits' },
      { checkEntitlement: vi.fn().mockResolvedValue({ allowed: true }) },
    )
    expect(result).toEqual({
      status: 'ready',
      provider: 'openai',
      executionMode: 'content_studio_credits',
      credentialSource: 'platform',
      secret: 'platform-openai-key',
    })
  })

  it('reports a typed error when entitlement allows but no platform credential is configured', async () => {
    delete process.env.KLING_API_KEY
    const supabase = buildSupabaseStub({})
    const result = await resolveProviderExecution(
      supabase as any,
      { userId: 'u1', provider: 'kling', mode: 'content_studio_credits' },
      { checkEntitlement: vi.fn().mockResolvedValue({ allowed: true }) },
    )
    expect(result).toMatchObject({ status: 'platform_credential_unavailable', code: 'PLATFORM_CREDENTIAL_UNAVAILABLE' })
  })
})

describe('platform credential boundary', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.KLING_API_KEY
  })

  it('resolves only providers with a platform credential mapping', () => {
    process.env.OPENAI_API_KEY = 'a'
    process.env.KLING_API_KEY = 'b'
    expect(resolvePlatformCredential('openai')).toEqual({ status: 'available', secret: 'a' })
    expect(resolvePlatformCredential('kling')).toEqual({ status: 'available', secret: 'b' })
    expect(resolvePlatformCredential('nano_banana')).toEqual({ status: 'unavailable' })
    expect(resolvePlatformCredential('replicate')).toEqual({ status: 'unavailable' })
  })

  it('treats blank env values as unavailable', () => {
    process.env.OPENAI_API_KEY = '   '
    expect(resolvePlatformCredential('openai')).toEqual({ status: 'unavailable' })
  })
})

describe('provider metadata (domain concepts kept separate)', () => {
  it('describes every provider with connection methods and transports independent of execution mode', () => {
    for (const provider of AI_PROVIDERS) {
      const meta = PROVIDER_METADATA[provider]
      expect(meta.connectionMethods).toEqual(['api_key'])
      expect(meta.transports).toEqual(['rest'])
      expect(primaryConnectionMethod(provider)).toBe('api_key')
      expect(meta).not.toHaveProperty('executionMode')
    }
  })

  it('Replicate has credential storage but no execution path', () => {
    expect(PROVIDER_METADATA.replicate.executionImplemented).toBe(false)
    expect(PROVIDER_METADATA.kling.executionImplemented).toBe(true)
  })
})
