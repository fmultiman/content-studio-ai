import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as createGeneration } from '@/app/api/video-generations/route'
import { NextRequest } from 'next/server'
import * as server from '@/lib/supabase/server'

// Mocks
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/providers/kling/adapter', () => {
  return {
    KlingAdapter: class {
      submitImageToVideo = vi.fn().mockResolvedValue({ task_id: 'mock-kling-123' })
      submitTextToVideo = vi.fn().mockResolvedValue({ task_id: 'mock-kling-text-123' })
      getTaskStatus = vi.fn().mockResolvedValue({
        status: 'succeeded', outputs: [{ type: 'video', url: 'http://kling.test/video.mp4' }]
      })
    }
  }
})

describe('Video Generation API Domain & T2V Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KLING_API_KEY = 'mock-key'
  })

  // I2V
  it('I2V rejects execution if missing all source ids', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test', sourceLibraryFileId: 'stale-id' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/must be absent for text_to_video/)
  })

  it('accepts and passes shared settings explicitly', async () => {
    const mockInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-456' } })
    const mockUpdateSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'gen-456', status: 'submitted' } })
    
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) },
      from: vi.fn((table) => {
        if (table === 'video_generations') {
          return {
            insert: vi.fn((payload) => {
              expect(payload.request_config.duration).toBe(10)
              expect(payload.request_config.resolution).toBe('1080p')
              expect(payload.request_config.audio).toBe('on')
              expect(payload.request_config.multi_shot).toBe(true)
              expect(payload.request_config.aspect_ratio).toBeUndefined()
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'image_to_video', prompt: 'test', sourceImageId: 'stale-id', duration: 10, resolution: '1080p', audio: 'on', multi_shot: true })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.generation.id).toBe('gen-456')
  })

  it('T2V rejects invalid aspect ratios', async () => {
    const mockSupabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user1' } } }) }
    }
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
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
    vi.mocked(server.createClient).mockResolvedValue(mockSupabase as any)
    
    const req = new NextRequest('http://test.com/api', {
      method: 'POST',
      body: JSON.stringify({ projectId: 'p1', productionId: 'p2', mode: 'text_to_video', prompt: 'test' })
    })

    const res = await createGeneration(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.generation.id).toBe('gen-123')
  })
})
