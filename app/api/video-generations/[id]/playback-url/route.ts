import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID inválido.', code: 'INVALID_GENERATION_ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const disposition = searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline'

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { data: generation, error } = await supabase
      .from('video_generations')
      .select('id, user_id, status, storage_path')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !generation) {
      return NextResponse.json({ error: 'Geração não encontrada ou acesso negado.', code: 'NOT_FOUND' }, { status: 404 })
    }

    if (generation.status !== 'succeeded') {
      return NextResponse.json({ error: 'Apenas gerações concluídas possuem arquivo de saída.', code: 'GENERATION_NOT_COMPLETED' }, { status: 409 })
    }

    if (!generation.storage_path) {
      return NextResponse.json({ error: 'Geração sem caminho de saída válido.', code: 'MISSING_STORAGE_PATH' }, { status: 500 })
    }
    
    const extension = 'mp4'
    const filename = disposition === 'attachment' ? `video-ai-${id}.${extension}` : undefined
    const url = await createPresignedReadUrl(generation.storage_path, { disposition, filename })

    if (!url) {
      return NextResponse.json({ error: 'Storage S3 não está configurado.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    }

    return NextResponse.json({ url, expiresAt: new Date(Date.now() + 3600000).toISOString() })
  } catch (error) {
    console.error('[Video Generations playback-url] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
