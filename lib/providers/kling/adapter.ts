export interface KlingContentItemFirstFrame {
  type: 'first_frame'
  url: string
}

export interface KlingContentItemPrompt {
  type: 'prompt'
  text: string
}

export type KlingContentItem = KlingContentItemFirstFrame | KlingContentItemPrompt

export interface KlingSettings {
  resolution?: '720p' | '1080p' | '4K'
  duration?: 5 | 10
  audio?: 'off' | 'on'
  multi_shot?: boolean
  aspect_ratio?: '16:9' | '9:16' | '1:1'
}

export interface KlingOptions {
  callback_url?: string
  external_task_id?: string
  watermark_info?: {
    enabled: boolean
  }
}

export interface KlingRequestPayload {
  contents: KlingContentItem[]
  settings?: KlingSettings
  options?: KlingOptions
}

export interface KlingTextToVideoPayload {
  prompt: string
  settings?: KlingSettings
  options?: KlingOptions
}

export interface KlingSubmitResponse {
  task_id: string
}

export interface KlingOutput {
  type: string
  url: string
}

export interface KlingTaskItem {
  id: string
  external_id?: string
  status: 'submitted' | 'processing' | 'succeeded' | 'failed'
  message?: string
  outputs?: KlingOutput[]
  created_at: number
  updated_at: number
}

export interface KlingTaskResponse {
  data: KlingTaskItem[]
}

export class KlingAdapter {
  private apiUrl = 'https://api-singapore.klingai.com' // Current Base
  
  constructor(private apiKey: string) {}

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
  }

  private async handleHttpError(res: Response): Promise<never> {
    let errorDetail = ''
    try {
      const errorJson = await res.json()
      const parts: string[] = []
      if (errorJson?.code !== undefined) parts.push(`code: ${errorJson.code}`)
      if (errorJson?.message) parts.push(`message: ${errorJson.message}`)
      if (errorJson?.request_id) parts.push(`request_id: ${errorJson.request_id}`)
      if (parts.length > 0) {
        errorDetail = ` (${parts.join(', ')})`
      }
    } catch {
      // ignore json parse error
    }
    throw new Error(`Kling API HTTP error: ${res.statusText || res.status}${errorDetail}`)
  }

  async submitImageToVideo(prompt: string, imageUrl: string, externalTaskId: string, callbackUrl?: string, settings: KlingSettings = {}, restModelId: string = 'kling-v3'): Promise<KlingSubmitResponse> {
        const isLegacy26 = restModelId === 'kling-v2-6'
    
    let path = '/image-to-video/kling-3.0'
    let body: any = {
      contents: [
        { type: 'prompt', text: prompt },
        { type: 'first_frame', url: imageUrl }
      ],
      settings: {
        resolution: settings.resolution || '720p',
        duration: settings.duration || 5,
        audio: settings.audio || 'off',
        multi_shot: settings.multi_shot || false
      },
      options: {
        external_task_id: externalTaskId,
        callback_url: callbackUrl,
        watermark_info: { enabled: false }
      }
    }

    if (isLegacy26) {
      path = '/v1/videos/image2video'
      body = {
        model_name: 'kling-v2-6',
        prompt,
        image: imageUrl,
        duration: String(settings.duration || 5),
        mode: settings.resolution === '1080p' ? 'pro' : 'std',
        sound: settings.audio || 'off',
        callback_url: callbackUrl || '',
        external_task_id: externalTaskId || ''
      }
    }

    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      await this.handleHttpError(res)
    }

    const data = await res.json()
    const task_id = data.data?.id || data.data?.task_id
    if (!task_id) {
       throw new Error(`Kling API structure error: ${JSON.stringify(data)}`)
    }

    return { task_id }
  }

  async submitTextToVideo(prompt: string, externalTaskId: string, callbackUrl?: string, settings: KlingSettings = {}, restModelId: string = 'kling-v3'): Promise<KlingSubmitResponse> {
        const isLegacy26 = restModelId === 'kling-v2-6'
    
    let path = '/text-to-video/kling-3.0'
    let body: any = {
      prompt,
      settings: {
        resolution: settings.resolution || '720p',
        duration: settings.duration || 5,
        audio: settings.audio || 'off',
        multi_shot: settings.multi_shot || false,
        aspect_ratio: settings.aspect_ratio || '16:9'
      },
      options: {
        external_task_id: externalTaskId,
        callback_url: callbackUrl,
        watermark_info: { enabled: false }
      }
    }

    if (isLegacy26) {
      path = '/v1/videos/text2video'
      body = {
        model_name: 'kling-v2-6',
        prompt,
        duration: String(settings.duration || 5),
        mode: settings.resolution === '1080p' ? 'pro' : 'std',
        sound: settings.audio || 'off',
        aspect_ratio: settings.aspect_ratio || '16:9',
        callback_url: callbackUrl || '',
        external_task_id: externalTaskId || ''
      }
    }

    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      await this.handleHttpError(res)
    }

    const data = await res.json()
    const task_id = data.data?.id || data.data?.task_id
    if (!task_id) {
       throw new Error(`Kling API structure error: ${JSON.stringify(data)}`)
    }

    return { task_id }
  }

  async getTaskStatus(taskId: string): Promise<KlingTaskItem> {
    const res = await fetch(`${this.apiUrl}/tasks?task_ids=${taskId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!res.ok) {
      throw new Error(`Kling API status read error: ${res.statusText}`)
    }

    const data = await res.json() as KlingTaskResponse
    const item = data.data?.[0]
    
    if (!item) {
      throw new Error('Task not found in Kling response')
    }

    return item
  }
}