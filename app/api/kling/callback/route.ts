import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json()
    // Validation strategy: Ideally Kling signs the payload or URL
    // For now we assume typical payload { data: { task_id, task_status, task_result: { videos: [...] } } }
    
    // Fallback signature/token - wait for exact signature config
    // Actually, Kling standard webhook payload:
    const data = rawBody.data || rawBody
    const taskId = data.task_id
    const status = data.task_status // "succeed", "failed", "processing"

    if (!taskId) {
      return NextResponse.json({ error: 'Missing task_id' }, { status: 400 })
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

    if (generation.status === 'completed' || generation.status === 'failed') {
      // Idempotency: skip if already completed
      return NextResponse.json({ success: true, warning: 'Already resolved' })
    }

    if (status === 'succeed' || status === 'completed') { // adjust based on actual Kling payload
      let videoUrl = ''
      if (data.task_result?.videos?.[0]?.url) {
        videoUrl = data.task_result.videos[0].url
      } else {
        videoUrl = data.video_url || '' // fallback heuristic
      }

      if (!videoUrl) {
         // Maybe it's missing the URL or we parse it wrong
         await supabase.from('video_generations').update({
           status: 'failed',
           error_details: { message: 'Missing video URL in payload', payload: data }
         }).eq('id', generation.id)
         return NextResponse.json({ success: true })
      }

      // Download and S3 Upload
      const prefix = `${generation.user_id}/videos/ai/${generation.project_id}`
      const { storagePath, publicUrl, mime, size } = await downloadAndStoreVideo(videoUrl, prefix)

      await supabase.from('video_generations').update({
        status: 'completed',
        storage_path: storagePath,
        public_url: publicUrl,
        result_metadata: { mime, size, ...data }
      }).eq('id', generation.id)

    } else if (status === 'failed') {
      await supabase.from('video_generations').update({
        status: 'failed',
        error_details: { message: data.task_status_msg || 'Provider reported failure', payload: data }
      }).eq('id', generation.id)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Kling callback error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
