import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { KlingAdapter } from '@/lib/providers/kling/adapter'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { projectId, productionId, mode, prompt, sourceImageId, duration = '5' } = body

    if (!projectId || !productionId || !mode || !prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (mode === 'image_to_video' && !sourceImageId) {
      return NextResponse.json({ error: 'sourceImageId is required for image_to_video' }, { status: 400 })
    }

    let resolvedSourceUrl = ''

    if (mode === 'image_to_video') {
      const { data: image, error: imageError } = await supabase
        .from('images')
        .select('*')
        .eq('id', sourceImageId)
        .eq('user_id', user.id)
        .eq('project_id', projectId)
        .single()

      if (imageError || !image) {
        return NextResponse.json({ error: 'Source image not found or not owned by user in this project' }, { status: 403 })
      }
      resolvedSourceUrl = image.image_url
    }

    // Insert queued state
    const { data: generation, error: dbError } = await supabase
      .from('video_generations')
      .insert({
        user_id: user.id,
        project_id: projectId,
        production_id: productionId,
        mode,
        prompt,
        source_image_id: sourceImageId || null,
        status: 'queued',
        provider: 'kling',
        model: 'kling-v1', // standard Kling 1.0 or Kling 1.5, we will configure in adapter if needed.
        request_config: { duration }
      })
      .select()
      .single()

    if (dbError || !generation) {
      throw new Error(`Failed to create generation record: ${dbError?.message}`)
    }

    // Prepare Provider Adapter
    const ak = process.env.KLING_API_AK
    const sk = process.env.KLING_API_SK

    if (!ak || !sk) {
      // Allow mocking/testing locally if keys are missing
      if (process.env.NODE_ENV !== 'production') {
        const { error: mockDbError } = await supabase
          .from('video_generations')
          .update({
            status: 'submitted',
            task_id: `mock-task-${Date.now()}`
          })
          .eq('id', generation.id)

        if (mockDbError) throw mockDbError

        return NextResponse.json({ generation: { ...generation, status: 'submitted' } })
      }

      throw new Error('Kling API credentials are not configured')
    }

    const klingAdapter = new KlingAdapter(ak, sk)
    let submitRes
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/kling/callback`

    try {
      if (mode === 'image_to_video') {
        submitRes = await klingAdapter.submitImageToVideo({
          model_name: 'kling-v1',
          image: resolvedSourceUrl,
          prompt,
          duration,
          callback_url: callbackUrl,
        })
      } else {
        submitRes = await klingAdapter.submitTextToVideo({
          model_name: 'kling-v1',
          prompt,
          duration,
          callback_url: callbackUrl,
        })
      }

      // Update provider status
      const { data: submittedGen, error: updateError } = await supabase
        .from('video_generations')
        .update({
          status: 'submitted',
          task_id: submitRes.data.task_id,
          provider_metadata: submitRes,
        })
        .eq('id', generation.id)
        .select()
        .single()

      if (updateError) {
        throw new Error(`Failed to update task_id: ${updateError.message}`)
      }

      return NextResponse.json({ generation: submittedGen })
    } catch (klingError: any) {
      console.error('Kling provider failure:', klingError)
      await supabase
        .from('video_generations')
        .update({
          status: 'failed',
          error_details: { message: klingError.message }
        })
        .eq('id', generation.id)
      return NextResponse.json({ error: 'Provider submission failed', details: klingError.message }, { status: 500 })
    }

  } catch (error: any) {
    console.error('Create video generation route error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const productionId = searchParams.get('productionId')
    const projectId = searchParams.get('projectId')

    let query = supabase.from('video_generations').select('*').eq('user_id', user.id).order('created_at', { ascending: false })

    if (productionId) {
      query = query.eq('production_id', productionId)
    }

    if (projectId) {
      query = query.eq('project_id', projectId)
    }

    const { data: generations, error } = await query

    if (error) {
      throw error
    }

    return NextResponse.json({ generations })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
