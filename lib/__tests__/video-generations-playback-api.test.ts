import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET as getPlaybackUrl } from '@/app/api/video-generations/[id]/playback-url/route'
import * as server from '@/lib/supabase/server'
import * as s3 from '@/lib/storage/s3'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(),
}))

describe('GET /api/video-generations/[id]/playback-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('valid generation returns playback URL inline and no credentials exposed', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'gen-1', user_id: 'user-1', status: 'succeeded', storage_path: 's3/path.mp4' },
                error: null
              })
            })
          })
        })
      })
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(s3.createPresignedReadUrl).mockResolvedValue('https://fake-s3-url.com/play')

    const req = new Request('http://localhost/api/video-generations/b6c59c5d-222a-4f51-b016-5bc77b94dbba/playback-url')
    const res = await getPlaybackUrl(req, { params: Promise.resolve({ id: 'b6c59c5d-222a-4f51-b016-5bc77b94dbba' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.url).toBe('https://fake-s3-url.com/play')
    expect(json).toHaveProperty('expiresAt')
    // No credentials sent
    expect(json).not.toHaveProperty('awsAccessKey')
    expect(json).not.toHaveProperty('path')
  })

  it('unauthorized access rejected', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }) },
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)

    const req = new Request('http://localhost/api/video-generations/b6c59c5d-222a-4f51-b016-5bc77b94dbba/playback-url')
    const res = await getPlaybackUrl(req, { params: Promise.resolve({ id: 'b6c59c5d-222a-4f51-b016-5bc77b94dbba' }) })

    expect(res.status).toBe(401)
  })

  it('wrong-project access remains rejected (not found)', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              // Simulated row level security / user eq check miss
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null
              })
            })
          })
        })
      })
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)

    const req = new Request('http://localhost/api/video-generations/b6c59c5d-222a-4f51-b016-5bc77b94dbba/playback-url')
    const res = await getPlaybackUrl(req, { params: Promise.resolve({ id: 'b6c59c5d-222a-4f51-b016-5bc77b94dbba' }) })
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.code).toBe('NOT_FOUND')
  })
})