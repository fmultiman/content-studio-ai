import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { completeVideoGeneration, failVideoGeneration } from '@/lib/video-generation/completion'
import * as crypto from 'crypto'

// The shared completion downloads and re-uploads the video: give it the same headroom as the poller.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    
    // Webhook Verification
    const webhookSecret = process.env.KLING_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('KLING_WEBHOOK_SECRET is not configured')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const webhookId = req.headers.get('webhook-id')
    const webhookTimestamp = req.headers.get('webhook-timestamp')
    const webhookSignatureHeader = req.headers.get('webhook-signature')

    if (!webhookId || !webhookTimestamp || !webhookSignatureHeader) {
      return NextResponse.json({ error: 'Missing webhook headers' }, { status: 400 })
    }

    // Check Timestamp (tolerant +- 5 min)
    const timestampUnix = parseInt(webhookTimestamp, 10)
    const nowUnix = Math.floor(Date.now() / 1000)
    if (Math.abs(nowUnix - timestampUnix) > 300) {
      return NextResponse.json({ error: 'Webhook timestamp expired or too far in future' }, { status: 400 })
    }

    // Verify signatures
    const secretB64 = webhookSecret.replace(/^whsec_/, '')
    const secretBytes = Buffer.from(secretB64, 'base64')
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`
    const expectedSignatureBytes = crypto.createHmac('sha256', secretBytes).update(signedContent).digest()
    const expectedSignature = expectedSignatureBytes.toString('base64')

    // Signatures might look like: "v1,signature1 v1,signature2"
    const parsedSignatures = webhookSignatureHeader.split(' ').map(s => s.trim().split(','))
    let isValid = false
    
    for (const [version, signatureValue] of parsedSignatures) {
      if (version === 'v1') {
        const providedSignatureBytes = Buffer.from(signatureValue, 'base64')
        if (
          providedSignatureBytes.length === expectedSignatureBytes.length &&
          crypto.timingSafeEqual(providedSignatureBytes, expectedSignatureBytes)
        ) {
          isValid = true
          break
        }
      }
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
    }

    // Payload Parsing
    let payload: any = {}
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    // Kling test callback / ping?
    if (payload.type === 'ping' || payload.ping) {
      return NextResponse.json({ success: true, message: 'Test callback received' })
    }

    // Usually callbacks have tasks wrapped in data or directly sent
    const data = payload.data || payload
    // Kling callback matches query tasks item structure directly or inside data
    const taskId = data.id || data.task_id // favor standard `id`
    const status = data.status || data.task_status // "succeeded", "failed", "processing"

    if (!taskId) {
      // Could be a test webhook without task_id
      return NextResponse.json({ success: true, message: 'Verified signature, but no task_id found' })
    }

    // Service role client to bypass RLS for external provider callback
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    const supabase = createSupabaseClient(supabaseUrl, supabaseServiceKey)

    const { data: generation, error: getError } = await supabase
      .from('video_generations')
      .select('*')
      .eq('task_id', taskId)
      .single()

    if (getError || !generation) {
      console.warn(`Callback received for unknown task_id: ${taskId}`)
      return NextResponse.json({ success: true, warning: 'Unknown task_id ignored' })
    }

    // The webhook secret authenticates KLING'S REST webhooks only. A row that
    // belongs to another transport (MCP has no callbacks) is never completed
    // from here, even with a valid signature.
    if ((generation.transport ?? 'rest') !== 'rest') {
      return NextResponse.json({ success: true, warning: 'Ignored: not a REST generation' })
    }

    if (generation.status === 'succeeded' || generation.status === 'failed') {
      return NextResponse.json({ success: true, warning: 'Already resolved' })
    }

    // Signature is already verified above; from here on the shared, idempotent
    // completion boundary does the work (identity check, app-owned storage,
    // compare-and-swap terminal transition).
    const identity = { generationId: generation.id, taskId: String(taskId), transport: 'rest' as const }

    if (status === 'succeeded') {
      let videoUrl = ''

      const outputs = data.outputs || []
      const videoOutput = outputs.find((o: any) => o.type === 'video')
      if (videoOutput?.url) {
        videoUrl = videoOutput.url
      } else if (data.result?.videos?.[0]?.url) { // fallback
        videoUrl = data.result.videos[0].url
      } else if (data.video_url) { // legacy fallback
        videoUrl = data.video_url
      }

      if (!videoUrl) {
        await failVideoGeneration(supabase, {
          ...identity,
          code: 'PROVIDER_RESULT_MISSING',
          message: 'Missing video URL in payload',
        })
        return NextResponse.json({ success: true })
      }

      await completeVideoGeneration(supabase, { ...identity, resultUrl: videoUrl, providerState: 'succeeded' })
    } else if (status === 'failed') {
      await failVideoGeneration(supabase, {
        ...identity,
        code: 'PROVIDER_FAILED',
        message: data.error?.message || data.message || 'Provider reported failure',
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Kling callback error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
