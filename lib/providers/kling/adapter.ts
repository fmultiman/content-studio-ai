export interface KlingContentItemImage {
  type: 'image'
  source: 'url' | 'base64'
  id: 'first_frame' | 'last_frame'
  url?: string
  content?: string
}

export interface KlingContentItemText {
  type: 'text'
  source: 'prompt'
  text: string
}

export type KlingContentItem = KlingContentItemImage | KlingContentItemText

export interface KlingSettings {
  resolution?: '720p' | '1080p' | '4K'
  duration?: 5 | 10
  audio?: boolean
  multi_shot?: boolean
}

export interface KlingOptions {
  callback_url?: string
  external_task_id?: string
}

export interface KlingRequestPayload {
  contents: KlingContentItem[]
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

  async submitImageToVideo(prompt: string, imageUrl: string, externalTaskId: string, callbackUrl?: string): Promise<KlingSubmitResponse> {
    const payload: KlingRequestPayload = {
      contents: [
        { type: 'image', source: 'url', id: 'first_frame', url: imageUrl },
        { type: 'text', source: 'prompt', text: prompt }
      ],
      settings: {
        resolution: '720p',
        duration: 5,
        audio: false,
        multi_shot: false
      },
      options: {
        external_task_id: externalTaskId,
        callback_url: callbackUrl
      }
    }

    const res = await fetch(`${this.apiUrl}/image-to-video/kling-3.0`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
        throw new Error(`Kling API HTTP error: ${res.statusText}`)
    }

    const data = await res.json()
    const task_id = data.data?.id
    if (!task_id) {
       throw new Error(`Kling API structure error: ${JSON.stringify(data)}`)
    }

    return { task_id }
  }

  async submitTextToVideo(prompt: string, externalTaskId: string, callbackUrl?: string): Promise<KlingSubmitResponse> {
    const payload: KlingRequestPayload = {
      contents: [
        { type: 'text', source: 'prompt', text: prompt }
      ],
      settings: {
        resolution: '720p',
        duration: 5,
        audio: false,
        multi_shot: false
      },
      options: {
        external_task_id: externalTaskId,
        callback_url: callbackUrl
      }
    }

    const res = await fetch(`${this.apiUrl}/text-to-video/kling-3.0`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
        throw new Error(`Kling API HTTP error: ${res.statusText}`)
    }

    const data = await res.json()
    const task_id = data.data?.id
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