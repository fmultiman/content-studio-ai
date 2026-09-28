import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'
import * as crypto from 'crypto'

// Assuming a standard Svix-like / Kling signature vector
function generateTestSignature(secretB64: string, webhookId: string, timestamp: string, rawBody: string) {
  const secretBytes = Buffer.from(secretB64, 'base64')
  const signedContent = `${webhookId}.${timestamp}.${rawBody}`
  const signature = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  return `v1,${signature}`
}

describe('Kling Webhook Signature Verification', () => {
  const secretPrefix = 'whsec_'
  const rawSecret = 'bXlzZWNyZXRiYXNlNjRzdHJpbmc=' // "mysecretbase64string"
  const webhookId = 'msg_12345'
  const rawBody = JSON.stringify({ type: 'ping', data: { task_id: 'test' } })

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KLING_WEBHOOK_SECRET = `${secretPrefix}${rawSecret}`
  })

  it('accepts valid v1 signature and returns success', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signatureHeader = generateTestSignature(rawSecret, webhookId, timestamp, rawBody)

    const req = new NextRequest('http://localhost/api/kling/callback', {
      method: 'POST',
      body: rawBody,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signatureHeader,
      }
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it('rejects expired timestamps', async () => {
    const timestamp = (Math.floor(Date.now() / 1000) - 600).toString() // 10 minutes ago
    const signatureHeader = generateTestSignature(rawSecret, webhookId, timestamp, rawBody)

    const req = new NextRequest('http://localhost/api/kling/callback', {
      method: 'POST',
      body: rawBody,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signatureHeader,
      }
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/timestamp expired/)
  })

  it('rejects invalid signature payloads', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const signatureHeader = generateTestSignature(rawSecret, webhookId, timestamp, '{"other":"body"}')

    const req = new NextRequest('http://localhost/api/kling/callback', {
      method: 'POST',
      body: rawBody,
      headers: {
        'webhook-id': webhookId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signatureHeader,
      }
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Invalid webhook signature/)
  })
})
