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

    const res = await adapter.submitImageToVideo('my motion', 'http://img.png', 'ext-uuid', 'http://callback')
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-singapore.klingai.com/image-to-video/kling-3.0',
      expect.objectContaining({ 
        method: 'POST',
        body: JSON.stringify({
          contents: [
            { type: 'prompt', text: 'my motion' },
            { type: 'first_frame', url: 'http://img.png' }
          ],
          settings: {
            resolution: '720p',
            duration: 5,
            audio: 'off',
            multi_shot: false
          },
          options: {
            external_task_id: 'ext-uuid',
            callback_url: 'http://callback',
            watermark_info: { enabled: false }
          }
        })
      })
    )
    
    expect(res.task_id).toBe('test-i2v-task-123')
  })

  it('submits T2V using top-level prompt, settings.aspect_ratio, and NO contents[]', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          id: 'test-t2v-task-444'
        }
      })
    })

    const res = await adapter.submitTextToVideo('cinematic scene', 'ext-uuid', 'http://callback')
    
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-singapore.klingai.com/text-to-video/kling-3.0',
      expect.objectContaining({ 
        method: 'POST',
        body: JSON.stringify({
          prompt: 'cinematic scene',
          settings: {
            resolution: '720p',
            duration: 5,
            audio: 'off',
            multi_shot: false,
            aspect_ratio: '16:9'
          },
          options: {
            external_task_id: 'ext-uuid',
            callback_url: 'http://callback',
            watermark_info: { enabled: false }
          }
        })
      })
    )
    
    // Explicitly verify the contract invariants
    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(calledBody.prompt).toBe('cinematic scene')
    expect(calledBody.contents).toBeUndefined()
    expect(calledBody.settings.aspect_ratio).toBe('16:9')
    expect(res.task_id).toBe('test-t2v-task-444')
  })

  it('submits T2V with explicit settings: 5s, 720p, 9:16, audio off, multi_shot false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 200,
        data: {
          id: 'test-t2v-task-555'
        }
      })
    })

    const res = await adapter.submitTextToVideo('tropical forest at sunrise', 'ext-task-916', 'http://callback', {
      duration: 5,
      resolution: '720p',
      aspect_ratio: '9:16',
      audio: 'off',
      multi_shot: false
    })

    const calledBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(calledBody).toEqual({
      prompt: 'tropical forest at sunrise',
      settings: {
        resolution: '720p',
        duration: 5,
        audio: 'off',
        multi_shot: false,
        aspect_ratio: '9:16'
      },
      options: {
        external_task_id: 'ext-task-916',
        callback_url: 'http://callback',
        watermark_info: { enabled: false }
      }
    })
    expect(calledBody.contents).toBeUndefined()
    expect(res.task_id).toBe('test-t2v-task-555')
  })

  it('preserves structured error details (code, message, request_id) when API returns HTTP 400', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        code: 1102,
        message: 'Invalid parameter prompt',
        request_id: 'req_kling_err_999'
      })
    })

    await expect(
      adapter.submitTextToVideo('test', 'task-1')
    ).rejects.toThrow('Kling API HTTP error: Bad Request (code: 1102, message: Invalid parameter prompt, request_id: req_kling_err_999)')
  })

  it('falls back to statusText when error body cannot be parsed as JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('Not JSON')
      }
    })

    await expect(
      adapter.submitTextToVideo('test', 'task-1')
    ).rejects.toThrow('Kling API HTTP error: Bad Gateway')
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
