import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST as createGeneration } from '@/app/api/video-generations/route'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'

// Mocks
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))

// Lifecycle writes are server-owned: the route reads with the user session and writes
// through the service role. In these fixtures both are the same in-memory client.
function useClient(client: unknown) {
  vi.mocked(server.createClient).mockResolvedValue(client as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(client as any)
}

const constructedApiKeys: string[] = []
let submitImageToVideo: (...args: unknown[]) => unknown
let submitTextToVideo: (...args: unknown[]) => unknown

vi.mock('@/lib/providers/kling/adapter', () => {
  return {
    KlingAdapter: class {
      constructor(apiKey: string) {
        constructedApiKeys.push(apiKey)
      }
      submitImageToVideo = (...args: unknown[]) => submitImageToVideo(...args)
      submitTextToVideo = (...args: unknown[]) => submitTextToVideo(...args)
      getTaskStatus = vi.fn().mockResolvedValue({
        status: 'succeeded', outputs: [{ type: 'video', url: 'http://kling.test/video.mp4' }]
      })
    }
  }
})

/** Mocks the `user_settings` table's Kling-credential lookup used by resolveProviderCredential(). */
function mockUserSettingsTable(klingApiKey: string | null) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({
          data: klingApiKey !== null ? { kling_api_key: klingApiKey } : null,
          error: null,
        }),
      }),
    }),
  }
}

/** The caller's own production inside the given project (the route verifies it before doing anything). */
function mockProductionsTable(owned = true) {
  return {
    select: () => ({
      eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: owned ? { id: 'p2' } : null, error: null }) }) }) }),
    }),
  }
}

describe('Video Generation API Domain & T2V Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    constructedApiKeys.length = 0
    submitImageToVideo = vi.fn().mockResolvedValue({ task_id: 'mock-kling-123' })
    submitTextToVideo = vi.fn().mockResolvedValue({ task_id: 'mock-kling-text-123' })
    delete process.env.KLING_API_KEY
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // I2V
  it('I2V rejects execution if missing all source ids', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'image_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/required for image_to_video/)
  })

  it('I2V avoids both sources at same time', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'image_to_video', prompt: 'test', sourceImageId: 'a', sourceLibraryFileId: 'b' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/exactly one source/)
  })

  // T2V
  it('T2V rejects payloads if source_image_id is present', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test', sourceImageId: 'stale-id' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/must be absent for text_to_video/)
  })

  it('T2V rejects payloads if source_library_file_id is present', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test', sourceLibraryFileId: 'stale-id' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/must be absent for text_to_video/)
  })

  it('accepts and passes shared settings explicitly, resolving the authenticated user Kling credential', async () => {
    const mockInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-456' } })
    const mockUpdateSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-456', status: 'submitted' } })

    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') {
          return mockUserSettingsTable('user1-kling-key')
        }
        if (table === 'video_generations') {
          return {
            insert: vi.fn((payload) => {
              expect(payload.request_config.duration).toBe(10)
              expect(payload.request_config.resolution).toBe('1080p')
              expect(payload.request_config.audio).toBe('on')
              expect(payload.request_config.multi_shot).toBe(true)
              expect(payload.request_config.aspect_ratio).toBeUndefined()
              // Credential must never enter the persisted generation record.
              expect(JSON.stringify(payload)).not.toContain('user1-kling-key')
              return { select: () => ({ single: mockInsertSelectSingle }) }
            }),
            update: () => ({ eq: () => ({ select: () => ({ single: mockUpdateSelectSingle }) }) })
          }
        }
        if (table === 'images') {
           return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: { image_url: 'x', storage_path: 'y' } }) }) }) }) }) }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'image_to_video', prompt: 'test', sourceImageId: 'stale-id', duration: 10, resolution: '1080p', audio: 'on', multi_shot: true })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.generation.id).toBe('gen-456')
    // The configured user credential must reach the Kling adapter server-side.
    expect(constructedApiKeys).toEqual(['user1-kling-key'])
    expect(submitImageToVideo).toHaveBeenCalledTimes(1)
  })

  it('T2V rejects invalid aspect ratios', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test', aspect_ratio: '4:3' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Unsupported aspect_ratio/)
  })

  it('I2V rejects aspect ratio injection', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'image_to_video', prompt: 'test', aspect_ratio: '16:9', sourceImageId: 'a' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/aspect_ratio is not supported/)
  })

  it('T2V succeeds without source images and properly inserts null sources', async () => {
    const mockInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-123' } })
    const mockUpdateSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-123', status: 'submitted' } })

    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') {
          return mockUserSettingsTable('user1-kling-key')
        }
        if (table === 'video_generations') {
          return {
            insert: vi.fn((payload) => {
              expect(payload.source_image_id).toBeNull()
              expect(payload.source_library_file_id).toBeNull()
              expect(payload.mode).toBe('text_to_video')
              return { select: () => ({ single: mockInsertSelectSingle }) }
            }),
            update: vi.fn((payload) => {
              expect(payload.status).toBe('submitted')
              return { eq: () => ({ select: () => ({ single: mockUpdateSelectSingle }) }) }
            })
          }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.generation.id).toBe('gen-123')
  })

  // ─── AI_PROVIDER_CREDENTIALS_BYOK_V1 — Kling credential resolution ─────────

  it('returns a typed missing-credential failure and makes zero provider calls when the user has no Kling key', async () => {
    const insertSpy = vi.fn()
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') {
          return mockUserSettingsTable(null)
        }
        if (table === 'video_generations') {
          return { insert: insertSpy }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('PROVIDER_NOT_CONFIGURED')
    expect(json.provider).toBe('kling')

    // Zero provider calls, zero created records.
    expect(constructedApiKeys).toEqual([])
    expect(submitTextToVideo).not.toHaveBeenCalled()
    expect(submitImageToVideo).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('does not fall back to a Production platform env credential when the user has no Kling key', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.KLING_API_KEY = 'platform-level-key'

    const insertSpy = vi.fn()
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') {
          return mockUserSettingsTable(null)
        }
        if (table === 'video_generations') {
          return { insert: insertSpy }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('PROVIDER_NOT_CONFIGURED')

    expect(constructedApiKeys).toEqual([])
    expect(insertSpy).not.toHaveBeenCalled()

    delete process.env.KLING_API_KEY
  })

  it.each(['development', 'test'])(
    'does not use KLING_API_KEY as a BYOK fallback in %s either (env path removed entirely)',
    async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv)
      process.env.KLING_API_KEY = 'platform-level-key'

      const insertSpy = vi.fn()
      const mockSupabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
        from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
          if (table === 'user_settings') return mockUserSettingsTable(null)
          if (table === 'video_generations') return { insert: insertSpy }
          return {}
        })
      }
      useClient(mockSupabase)

      const req = new NextRequest('http://test.com/api', {
        method: 'POST',
        body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
      })

      const res = await createGeneration(req)
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('PROVIDER_NOT_CONFIGURED')
      expect(constructedApiKeys).toEqual([])
      expect(submitTextToVideo).not.toHaveBeenCalled()
      expect(insertSpy).not.toHaveBeenCalled()
    },
  )

  it('a client-supplied executionMode / credentialSource is REJECTED and cannot enable platform-funded Kling execution', async () => {
    process.env.KLING_API_KEY = 'platform-level-key'
    const insertSpy = vi.fn()
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') return mockUserSettingsTable(null)
        if (table === 'video_generations') return { insert: insertSpy }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test',
        executionMode: 'content_studio_credits', execution_mode: 'content_studio_credits', credentialSource: 'platform',
      })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNSUPPORTED_FIELD')
    expect(constructedApiKeys).toEqual([])
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('never persists the credential or execution provenance secrets in the generation record or provider metadata', async () => {
    const persisted: unknown[] = []
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') return mockUserSettingsTable('secret-kling-key-123')
        if (table === 'video_generations') {
          return {
            insert: vi.fn((payload) => {
              persisted.push(payload)
              return { select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'gen-9' } }) }) }
            }),
            update: vi.fn((payload) => {
              persisted.push(payload)
              return { eq: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'gen-9', status: 'submitted' } }) }) }) }
            }),
          }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(200)
    expect(constructedApiKeys).toEqual(['secret-kling-key-123'])
    expect(persisted.length).toBeGreaterThan(0)
    expect(JSON.stringify(persisted)).not.toContain('secret-kling-key-123')
    expect(JSON.stringify(await res.json())).not.toContain('secret-kling-key-123')
  })

  it('does not resolve User B credential when User A has no key configured (per-user isolation)', async () => {
    // The mock only "has" a credential for user "owner"; it asserts the exact
    // userId the route filters by, mirroring the RLS `eq('user_id', ...)`
    // scoping enforced in the real database.
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-b' } } }) },
      from: vi.fn((table) => {
        if (table === 'productions') return mockProductionsTable()
        if (table === 'user_settings') {
          return {
            select: () => ({
              eq: (_col: string, value: string) => ({
                maybeSingle: () => Promise.resolve({
                  data: value === 'owner' ? { kling_api_key: 'owner-secret' } : null,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'video_generations') {
          return { insert: vi.fn() }
        }
        return {}
      })
    }
    useClient(mockSupabase)

    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.code).toBe('PROVIDER_NOT_CONFIGURED')
    expect(constructedApiKeys).toEqual([])
  })
})
