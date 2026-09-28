import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { KlingAdapter } from '@/lib/providers/kling/adapter'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: generation, error } = await supabase
      .from('video_generations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !generation) {
      return NextResponse.json({ error: 'Generation not found' }, { status: 404 })
    }

    if (generation.status === 'succeeded' || generation.status === 'failed') {
      return NextResponse.json({ generation })
    }

    if (!generation.task_id) {
       return NextResponse.json({ error: 'No task_id associated' }, { status: 400 })
    }

    const apiKey = process.env.KLING_API_KEY

    if (!apiKey) {
      return NextResponse.json({ error: 'KLING_API_KEY is not configured' }, { status: 500 })
    }

    const klingAdapter = new KlingAdapter(apiKey)
    const taskItem = await klingAdapter.getTaskStatus(generation.task_id)
    
    const taskStatus = taskItem.status
    if (taskStatus === 'succeeded') {
      const videoOutput = taskItem.outputs?.find(o => o.type === 'video')
      const videoUrl = videoOutput?.url
      if (!videoUrl) {
         return NextResponse.json({ generation }) // wait for url?
      }

      const prefix = `${generation.user_id}/videos/ai/${generation.project_id}`
      const { storagePath, publicUrl, mime, size } = await downloadAndStoreVideo(videoUrl, prefix)

      const { data: updated, error: updateError } = await supabase.from('video_generations').update({
        status: 'succeeded',
        storage_path: storagePath,
        public_url: publicUrl,
        result_metadata: { mime, size, ...taskItem }
      }).eq('id', generation.id).select().single()

      if (updateError) throw updateError
      return NextResponse.json({ generation: updated })

    } else if (taskStatus === 'failed') {
      const { data: updated, error: updateError } = await supabase.from('video_generations').update({
        status: 'failed',
        error_details: { message: taskItem.message || 'Provider failed', payload: taskItem }
      }).eq('id', generation.id).select().single()
      
      if (updateError) throw updateError
      return NextResponse.json({ generation: updated })
    }

    return NextResponse.json({ generation })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
