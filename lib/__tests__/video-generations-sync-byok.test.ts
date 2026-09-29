import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/video-downloader', () => ({ downloadAndStoreVideo: vi.fn() }))

const constructedApiKeys: string[] = []
const getTaskStatus = vi.fn()

vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    constructor(apiKey: string) {
      constructedApiKeys.push(apiKey)
    }
    getTaskStatus = (...args: unknown[]) => getTaskStatus(...args)
  },
}))

function buildSupabase(userId: string, klingApiKey: string | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === 'user_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: klingApiKey !== null ? { kling_api_key: klingApiKey } : null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'video_generations') {
        return {
          // First provider status "processing" is recorded with a compare-and-swap update.
          update: () => ({
            eq: () => ({
              in: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'gen-1', user_id: userId, project_id: 'p1', status: 'processing', task_id: 'kling-task-1' },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'gen-1', user_id: userId, project_id: 'p1', status: 'submitted', task_id: 'kling-task-1' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  }
}

async function callSync() {
  const { POST } = await import('@/app/api/video-generations/[id]/sync/route')
  return POST(new NextRequest('http://localhost/api/video-generations/gen-1/sync', { method: 'POST' }), {
    params: Promise.resolve({ id: 'gen-1' }),
  })
}

describe('/api/video-generations/[id]/sync — user_byok', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    constructedApiKeys.length = 0
    process.env.KLING_API_KEY = 'platform-level-key'
  })

  afterEach(() => {
    delete process.env.KLING_API_KEY
    vi.unstubAllEnvs()
  })

  it.each(['production', 'development', 'test'])(
    'missing user Kling key → typed 422 and zero Kling calls in %s, despite KLING_API_KEY being set',
    async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', null) as any)

      const response = await callSync()
      const payload = await response.json()

      expect(response.status).toBe(422)
      expect(payload).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', provider: 'kling' })
      expect(constructedApiKeys).toEqual([])
      expect(getTaskStatus).not.toHaveBeenCalled()
      expect(JSON.stringify(payload)).not.toContain('platform-level-key')
    },
  )

  it('configured user key → the adapter is constructed with the USER key', async () => {
    vi.mocked(server.createClient).mockResolvedValue(buildSupabase('user-1', 'kling-user-key') as any)
    getTaskStatus.mockResolvedValue({ id: 'kling-task-1', status: 'processing', created_at: 1, updated_at: 1 })

    const response = await callSync()

    expect(response.status).toBe(200)
    expect(constructedApiKeys).toEqual(['kling-user-key'])
    expect(getTaskStatus).toHaveBeenCalledWith('kling-task-1')
    expect(JSON.stringify(await response.json())).not.toContain('kling-user-key')
  })
})
