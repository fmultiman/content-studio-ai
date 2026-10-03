import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/video-generation/session'

// VIDEO_GENERATION_VISIBILITY_TERMINOLOGY_AND_LEGACY_REUSE_V1
//
// Minimal secure endpoint to fetch an existing Generation (Attempt) by ID, explicitly
// for seeding "Reuse Settings".
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'id must be a UUID.', code: 'INVALID_ID' }, { status: 400 })
    }

    const searchParams = req.nextUrl.searchParams
    const projectId = searchParams.get('projectId')
    const productionId = searchParams.get('productionId')

    if (!projectId || !productionId) {
      return NextResponse.json({ error: 'Context required.', code: 'MISSING_CONTEXT' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('video_generations')
      .select('id, project_id, production_id, prompt, mode, model, transport, connection_id, source_image_id, source_library_file_id, request_config')
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .eq('production_id', productionId)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Não foi possível carregar a geração.', code: 'STORE_UNAVAILABLE' }, { status: 503 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Geração não encontrada no contexto atual.', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({
      generation: {
        id: data.id,
        project_id: data.project_id,
        production_id: data.production_id,
        prompt: data.prompt,
        mode: data.mode,
        model: data.model,
        transport: data.transport,
        connection_id: data.connection_id,
        source_image_id: data.source_image_id,
        source_library_file_id: data.source_library_file_id,
        request_config: data.request_config,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro interno.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
