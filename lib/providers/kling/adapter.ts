import * as crypto from 'crypto'

export interface KlingI2VPayload {
  model_name: string
  image: string
  prompt: string
  duration?: '5' | '10'
  callback_url?: string
}

export interface KlingT2VPayload {
  model_name: string
  prompt: string
  duration?: '5' | '10'
  callback_url?: string
}

export interface KlingSubmitResponse {
  code: number
  message: string
  data: {
    task_id: string
  }
}

export interface KlingTaskStatus {
  task_id: string
  task_status: 'submitted' | 'processing' | 'succeed' | 'failed'
  task_status_msg: string
  created_at: number
  updated_at: number
  task_result?: {
    videos: Array<{
      id: string
      url: string
      duration: string
    }>
  }
}

export interface KlingQueryResponse {
  code: number
  message: string
  data: KlingTaskStatus
}

function generateKlingToken(ak: string, sk: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: ak,
    exp: Math.floor(Date.now() / 1000) + 1800,
    nbf: Math.floor(Date.now() / 1000) - 5,
  }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signatureInput = `${encodedHeader}.${encodedPayload}`

  const signature = crypto.createHmac('sha256', sk).update(signatureInput).digest('base64url')

  return `${signatureInput}.${signature}`
}

export class KlingAdapter {
  private apiUrl = 'https://api.klingai.com/v1'

  constructor(private ak: string, private sk: string) {}

  private getHeaders(): Record<string, string> {
    const token = generateKlingToken(this.ak, this.sk)
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }
  }

  async submitImageToVideo(payload: KlingI2VPayload): Promise<KlingSubmitResponse> {
    const res = await fetch(`${this.apiUrl}/videos/image2video`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
        throw new Error(`Kling API error: ${res.statusText}`)
    }

    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(`Kling API business error: ${data.message}`)
    }

    return data
  }
  
  async submitTextToVideo(payload: KlingT2VPayload): Promise<KlingSubmitResponse> {
    const res = await fetch(`${this.apiUrl}/videos/text2video`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
        throw new Error(`Kling API error: ${res.statusText}`)
    }

    const data = await res.json()
    if (data.code !== 0) {
      throw new Error(`Kling API business error: ${data.message}`)
    }

    return data
  }

  async getTaskStatus(taskId: string, internalMode: 'image_to_video' | 'text_to_video'): Promise<KlingQueryResponse> {
    const endpointMode = internalMode === 'image_to_video' ? 'image2video' : 'text2video'
    const res = await fetch(`${this.apiUrl}/videos/${endpointMode}/${taskId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    // If text2video, wait. Wait, does Kling have separate task endpoints for T2V vs I2V?
    // Actually, Kling AI API tasks can usually be queried by the specific path they were submitted to.
    // I should support dynamic route if so.
    if (!res.ok) {
      throw new Error(`Kling API status read error: ${res.statusText}`)
    }

    const data = await res.json()
    return data
  }
}
