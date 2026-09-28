import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { KlingAdapter } from '@/lib/providers/kling/adapter'
import { createPresignedReadUrl } from '@/lib/storage/s3'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { projectId, productionId, mode, prompt, sourceImageId, sourceLibraryFileId, duration = '5' } = body

    if (!projectId || !productionId || !mode || !prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (mode === 'image_to_video') {
      if (!sourceImageId && !sourceLibraryFileId) {
        return NextResponse.json({ error: 'sourceImageId or sourceLibraryFileId is required for image_to_video.' }, { status: 400 })
      }
      if (sourceImageId && sourceLibraryFileId) {
        return NextResponse.json({ error: 'Provide exactly one source: sourceImageId OR sourceLibraryFileId.' }, { status: 400 })
      }
    } else if (mode === 'text_to_video') {
      if (sourceImageId || sourceLibraryFileId) {
        return NextResponse.json({ error: 'sourceImageId and sourceLibraryFileId must be absent for text_to_video.' }, { status: 400 })
      }
    }

    let resolvedSourceUrl = ''

    if (mode === 'image_to_video') {
      if (sourceImageId) {
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
        if (image.storage_path) {
          const presigned = await createPresignedReadUrl(image.storage_path)
          resolvedSourceUrl = presigned || image.image_url
        } else {
          resolvedSourceUrl = image.image_url
        }
      } else if (sourceLibraryFileId) {
        const { data: file, error: fileError } = await supabase
          .from('library_files')
          .select('*')
          .eq('id', sourceLibraryFileId)
          .eq('user_id', user.id)
          .eq('project_id', projectId)
          .single()

        if (fileError || !file) {
          return NextResponse.json({ error: 'Source library file not found or not owned by user in this project' }, { status: 403 })
        }
        if (file.storage_path) {
          const presigned = await createPresignedReadUrl(file.storage_path)
          resolvedSourceUrl = presigned || file.public_url || ''
        } else {
          resolvedSourceUrl = file.public_url || ''
        }
      }
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
        source_library_file_id: sourceLibraryFileId || null,
        status: 'queued',
        provider: 'kling',
        model: 'kling-v3',
        request_config: { duration }
      })
      .select()
      .single()

    if (dbError || !generation) {
      throw new Error(`Failed to create generation record: ${dbError?.message}`)
    }

    // Prepare Provider Adapter
    const apiKey = process.env.KLING_API_KEY

    if (!apiKey) {
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

      throw new Error('KLING_API_KEY is not configured')
    }

    const klingAdapter = new KlingAdapter(apiKey)
    let submitRes
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/kling/callback`
    const externalTaskId = generation.id

    try {
      if (mode === 'image_to_video') {
        submitRes = await klingAdapter.submitImageToVideo(
          prompt,
          resolvedSourceUrl,
          externalTaskId,
          callbackUrl
        )
      } else {
        submitRes = await klingAdapter.submitTextToVideo(
          prompt,
          externalTaskId,
          callbackUrl
        )
      }

      // Update provider status
      const { data: submittedGen, error: updateError } = await supabase
        .from('video_generations')
        .update({
          status: 'submitted',
          task_id: submitRes.task_id,
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

    const signedGenerations = await Promise.all(
      (generations || []).map(async (gen) => {
        if (gen.status === 'succeeded' && gen.storage_path) {
          const presigned = await createPresignedReadUrl(gen.storage_path)
          if (presigned) {
            return { ...gen, public_url: presigned }
          }
        }
        return gen
      })
    )

    return NextResponse.json({ generations: signedGenerations })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
