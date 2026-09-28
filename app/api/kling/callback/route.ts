import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import * as crypto from 'crypto'

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

    const supabase = await createClient()

    const { data: generation, error: getError } = await supabase
      .from('video_generations')
      .select('*')
      .eq('task_id', taskId)
      .single()

    if (getError || !generation) {
      console.warn(`Callback received for unknown task_id: ${taskId}`)
      return NextResponse.json({ success: true, warning: 'Unknown task_id ignored' })
    }

    if (generation.status === 'succeeded' || generation.status === 'failed') {
      return NextResponse.json({ success: true, warning: 'Already resolved' })
    }

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
         await supabase.from('video_generations').update({
           status: 'failed',
           error_details: { message: 'Missing video URL in payload', payload: data }
         }).eq('id', generation.id)
         return NextResponse.json({ success: true })
      }

      const prefix = `${generation.user_id}/videos/ai/${generation.project_id}`
      const { storagePath, publicUrl, mime, size } = await downloadAndStoreVideo(videoUrl, prefix)

      await supabase.from('video_generations').update({
        status: 'succeeded',
        storage_path: storagePath,
        public_url: publicUrl,
        result_metadata: { mime, size, ...data }
      }).eq('id', generation.id)

    } else if (status === 'failed') {
      await supabase.from('video_generations').update({
        status: 'failed',
        error_details: { message: data.error?.message || 'Provider reported failure', payload: data }
      }).eq('id', generation.id)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Kling callback error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
