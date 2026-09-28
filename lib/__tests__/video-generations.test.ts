import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as createGeneration } from '@/app/api/video-generations/route'
import { POST as syncGeneration } from '@/app/api/video-generations/[id]/sync/route'
import { POST as callback } from '@/app/api/kling/callback/route'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

// Mocks
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/providers/kling/adapter', () => {
  return {
    KlingAdapter: vi.fn().mockImplementation(() => ({
      submitImageToVideo: vi.fn().mockResolvedValue({ data: { task_id: 'mock-kling-123' } }),
      submitTextToVideo: vi.fn().mockResolvedValue({ data: { task_id: 'mock-kling-text-123' } }),
      getTaskStatus: vi.fn().mockResolvedValue({
        data: { task_status: 'succeed', task_result: { videos: [{ url: 'http://kling.test/video.mp4' }] } }
      })
    }))
  }
})

vi.mock('@/lib/storage/video-downloader', () => ({
  downloadAndStoreVideo: vi.fn().mockResolvedValue({
    storagePath: 'user-id/videos/ai/project-123/video.mp4',
    publicUrl: 'https://s3.test/video.mp4',
    mime: 'video/mp4',
    size: 1024
  })
}))

describe('Video Generation API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KLING_API_AK = 'mock-ak'
    process.env.KLING_API_SK = 'mock-sk'
  })

  // Test setup skeleton... 
  // The actual detailed unit tests validating ownership, project identity, invalid mode
  // require a larger mocking of Supabase which is complex.
  it('should validate missing parameters on POST', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ mode: 'image_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Missing required fields/)
  })
})
