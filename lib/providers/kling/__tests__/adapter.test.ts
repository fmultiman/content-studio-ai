import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KlingAdapter } from '../adapter'

describe('Kling Adapter - Task Query and Create Response Parsing', () => {
  const MOCK_API_KEY = 'mock_api_key'
  let adapter: KlingAdapter
  let fetchMock: any

  beforeEach(() => {
    fetchMock = vi.fn()
    global.fetch = fetchMock
    adapter = new KlingAdapter(MOCK_API_KEY)
  })

  it('submits I2V using correct contents/settings envelope and parses data.data.id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        message: 'success',
        data: {
          id: 'test-i2v-task-123',
          status: 'submitted',
          external_id: 'ext-uuid'
        }
      })
    })

    const res = await adapter.submitImageToVideo('my motion', 'http://img.png', 'ext-uuid')
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-singapore.klingai.com/image-to-video/kling-3.0',
      expect.objectContaining({ method: 'POST' })
    )
    
    expect(res.task_id).toBe('test-i2v-task-123')
  })

  it('submits T2V using correct endpoint and parses data.data.id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          id: 'test-t2v-task-444'
        }
      })
    })

    const res = await adapter.submitTextToVideo('cinematic scene', 'ext-uuid')
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-singapore.klingai.com/text-to-video/kling-3.0',
      expect.objectContaining({ method: 'POST' })
    )
    
    expect(res.task_id).toBe('test-t2v-task-444')
  })

  it('queries task status using ?task_ids= and parses submitted/processing from data array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'task-123',
            status: 'processing',
            created_at: 1000,
            updated_at: 1000
          }
        ]
      })
    })

    const result = await adapter.getTaskStatus('task-123')
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-singapore.klingai.com/tasks?task_ids=task-123',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result.status).toBe('processing')
    expect(result.id).toBe('task-123')
  })

  it('queries task status and parses succeeded with video outputs', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'task-success',
            status: 'succeeded',
            outputs: [
              { type: 'video', url: 'https://kling-video.test/result.mp4' }
            ],
            created_at: 1000,
            updated_at: 2000
          }
        ]
      })
    })

    const result = await adapter.getTaskStatus('task-success')
    expect(result.status).toBe('succeeded')
    expect(result.outputs?.find(o => o.type === 'video')?.url).toBe('https://kling-video.test/result.mp4')
  })

  it('queries task status and parses failed with message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'task-fail',
            status: 'failed',
            message: 'Image validation failed',
            created_at: 1000,
            updated_at: 2000
          }
        ]
      })
    })

    const result = await adapter.getTaskStatus('task-fail')
    expect(result.status).toBe('failed')
    expect(result.message).toBe('Image validation failed')
  })

  it('throws an error if task is not found in data array', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: []
      })
    })

    await expect(adapter.getTaskStatus('task-missing')).rejects.toThrow('Task not found in Kling response')
  })
})
