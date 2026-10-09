import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabaseOrNull } from '@/lib/supabase/service-role'
import { createPresignedReadUrl } from '@/lib/storage/s3'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

function createRenderExecutionReadClient() {
  return createServiceRoleSupabaseOrNull()
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido.', code: 'INVALID_EXECUTION_ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const disposition = searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline'

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const executionReader = createRenderExecutionReadClient()
    if (!executionReader) {
      console.error('[Render Executions output-url] Supabase admin credential is not configured')
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })
    }

    const { data: execution, error } = await executionReader
      .from('render_executions')
      .select('id, user_id, status, output_storage_path, kind')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !execution) {
      return NextResponse.json({ error: 'Execucao nao encontrada ou acesso negado.', code: 'NOT_FOUND' }, { status: 404 })
    }

    if (execution.status !== 'completed') {
      return NextResponse.json({ error: 'Apenas execucoes concluidas possuem arquivo de saida.', code: 'EXECUTION_NOT_COMPLETED' }, { status: 409 })
    }

    if (!execution.output_storage_path) {
      return NextResponse.json({ error: 'Execucao sem caminho de saida valido.', code: 'MISSING_OUTPUT_STORAGE_PATH' }, { status: 500 })
    }
    
    // For extreme safety, ensure it doesn't try to presign any arbitrary string
    const allowedPrefix = `users/${user.id}/renders/scratch/${id}/`
    if (!execution.output_storage_path.startsWith(allowedPrefix)) {
      console.error('[Render Executions output-url] Output storage path is outside scratch boundary:', execution.output_storage_path)
      return NextResponse.json({ error: 'Output storage path security constraint violation.', code: 'INVALID_STORAGE_PATH' }, { status: 500 })
    }

    const extension = execution.kind === 'static_still' ? 'png' : 'mp4'
    const filename = disposition === 'attachment' ? `render-${id}.${extension}` : undefined
    const url = await createPresignedReadUrl(execution.output_storage_path, { disposition, filename })

    if (!url) {
      return NextResponse.json({ error: 'Storage S3 nao esta configurado no ambiente Vercel.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    }

    return NextResponse.json({ url, expiresAt: new Date(Date.now() + 3600000).toISOString() })
  } catch (error) {
    console.error('[Render Executions output-url] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
