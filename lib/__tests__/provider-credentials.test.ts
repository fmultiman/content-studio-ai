import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  resolveProviderCredential,
  getProviderConfigurationStatuses,
  resolveOpenAiCredentialWithLegacyPlatformFallback,
  isAiProvider,
} from '@/lib/credentials/provider-credentials'

function buildSupabaseStub(rowsByUserId: Record<string, Record<string, unknown>>) {
  return {
    from: vi.fn(() => ({
      select: vi.fn((columns: string) => ({
        eq: vi.fn((_col: string, userId: string) => ({
          maybeSingle: vi.fn(async () => {
            const row = rowsByUserId[userId]
            return { data: row ?? null, error: null }
          }),
        })),
      })),
    })),
  }
}

describe('resolveProviderCredential', () => {
  it('returns configured with the secret when the user has a saved key', async () => {
    const supabase = buildSupabaseStub({ 'user-1': { kling_api_key: 'secret-123' } })
    const result = await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'kling' })
    expect(result).toEqual({ status: 'configured', secret: 'secret-123' })
  })

  it('returns missing when no row exists for the user', async () => {
    const supabase = buildSupabaseStub({})
    const result = await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'kling' })
    expect(result).toEqual({ status: 'missing' })
  })

  it('returns missing when the stored value is an empty/whitespace string', async () => {
    const supabase = buildSupabaseStub({ 'user-1': { kling_api_key: '   ' } })
    const result = await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'kling' })
    expect(result).toEqual({ status: 'missing' })
  })

  it('never resolves User B credential when resolving for User A (multi-user isolation)', async () => {
    const supabase = buildSupabaseStub({ 'user-b': { kling_api_key: 'user-b-secret' } })
    const result = await resolveProviderCredential(supabase as any, { userId: 'user-a', provider: 'kling' })
    expect(result).toEqual({ status: 'missing' })
  })

  it('scopes resolution independently per provider column', async () => {
    const supabase = buildSupabaseStub({
      'user-1': { openai_api_key: 'openai-secret', kling_api_key: null, nanobanana_api_key: 'nb-secret' },
    })
    expect(await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'openai' }))
      .toEqual({ status: 'configured', secret: 'openai-secret' })
    expect(await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'kling' }))
      .toEqual({ status: 'missing' })
    expect(await resolveProviderCredential(supabase as any, { userId: 'user-1', provider: 'nano_banana' }))
      .toEqual({ status: 'configured', secret: 'nb-secret' })
  })
})

describe('getProviderConfigurationStatuses', () => {
  it('reports configured/missing per provider without ever including the secret value', async () => {
    const supabase = buildSupabaseStub({
      'user-1': { openai_api_key: 'sk-abc', nanobanana_api_key: null, kling_api_key: 'kling-abc', replicate_api_key: null },
    })
    const statuses = await getProviderConfigurationStatuses(supabase as any, 'user-1')
    expect(statuses).toEqual({
      openai: 'configured',
      nano_banana: 'missing',
      kling: 'configured',
      replicate: 'missing',
    })
    expect(JSON.stringify(statuses)).not.toContain('sk-abc')
    expect(JSON.stringify(statuses)).not.toContain('kling-abc')
  })
})

describe('resolveOpenAiCredentialWithLegacyPlatformFallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.OPENAI_API_KEY
  })

  it('prefers the user credential over the platform env fallback', async () => {
    process.env.OPENAI_API_KEY = 'platform-key'
    const supabase = buildSupabaseStub({ 'user-1': { openai_api_key: 'user-key' } })
    const result = await resolveOpenAiCredentialWithLegacyPlatformFallback(supabase as any, 'user-1')
    expect(result).toEqual({ status: 'configured', secret: 'user-key' })
  })

  it('falls back to the platform env key when the user has none (legacy exception, OpenAI only)', async () => {
    process.env.OPENAI_API_KEY = 'platform-key'
    const supabase = buildSupabaseStub({})
    const result = await resolveOpenAiCredentialWithLegacyPlatformFallback(supabase as any, 'user-1')
    expect(result).toEqual({ status: 'configured', secret: 'platform-key' })
  })

  it('returns missing when neither the user nor the platform has a key', async () => {
    delete process.env.OPENAI_API_KEY
    const supabase = buildSupabaseStub({})
    const result = await resolveOpenAiCredentialWithLegacyPlatformFallback(supabase as any, 'user-1')
    expect(result).toEqual({ status: 'missing' })
  })
})

describe('isAiProvider', () => {
  it('accepts the known provider ids and rejects everything else', () => {
    expect(isAiProvider('openai')).toBe(true)
    expect(isAiProvider('nano_banana')).toBe(true)
    expect(isAiProvider('kling')).toBe(true)
    expect(isAiProvider('replicate')).toBe(true)
    expect(isAiProvider('anthropic')).toBe(false)
    expect(isAiProvider('')).toBe(false)
  })
})
