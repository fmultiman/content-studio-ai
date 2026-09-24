import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { RenderExecutionSummary } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function createRenderExecutionReadClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const SAFE_COLUMNS = [
  'id',
  // Static Render Worker V1: discriminator + static subject. Never the snapshot.
  'kind',
  'channel_piece_id',
  'video_draft_id',
  'status',
  'attempt',
  'queued_at',
  'claimed_at',
  'completed_at',
  'failed_at',
  'output_mime_type',
  'output_size_bytes',
  'output_duration_ms',
  'output_width',
  'output_height',
  'error_code',
  'error_message',
].join(', ')

/** Static Render Worker V1: how far back the Creative Editor rehydrates slide renders. */
const STATIC_HYDRATION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/render-executions?channelPieceId=... (Static Render Worker V1)
 *
 * Recent STATIC executions for one owned ChannelPiece, newest first, with
 * the safe `slide` projection so the Creative Editor can rebind each result
 * to the slide that produced it after a refresh. Ownership: the session
 * user must own the ChannelPiece AND the rows (double-scoped).
 */
async function listStaticExecutionsForChannelPiece(channelPieceId: string) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

  const { data: channelPiece } = await supabase.from('channel_pieces').select('id').eq('id', channelPieceId).eq('user_id', user.id).maybeSingle()
  if (!channelPiece) return NextResponse.json({ error: 'ChannelPiece nao encontrada.' }, { status: 404 })

  const executionReader = createRenderExecutionReadClient()
  if (!executionReader) return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })

  const since = new Date(Date.now() - STATIC_HYDRATION_WINDOW_MS).toISOString()
  const { data, error } = await executionReader
    .from('render_executions')
    .select(`${SAFE_COLUMNS}, slide:input_snapshot->slide`)
    .eq('user_id', user.id)
    .eq('kind', 'static_still')
    .eq('channel_piece_id', channelPieceId)
    .gte('queued_at', since)
    .order('queued_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: 'Erro ao buscar execucoes.' }, { status: 500 })

  // Authoring Usability Completion V1 — server-authoritative "Salvo nesta
  // peça": an execution is attached when a live LibraryFile it produced
  // (source_render_execution_id) is linked to THIS piece by a
  // ChannelPieceMedia row. Survives reload; never browser memory.
  const executions = (data ?? []) as unknown as { id: string }[]
  const attached = new Set<string>()
  if (executions.length > 0) {
    const { data: renderFiles } = await supabase
      .from('library_files')
      .select('id, source_render_execution_id')
      .eq('user_id', user.id)
      .in('source_render_execution_id', executions.map((execution) => execution.id))
      .is('deleted_at', null)
    const fileToExecution = new Map((renderFiles ?? []).map((file) => [file.id as string, file.source_render_execution_id as string]))
    if (fileToExecution.size > 0) {
      const { data: media } = await supabase
        .from('channel_piece_media')
        .select('library_file_id')
        .eq('user_id', user.id)
        .eq('channel_piece_id', channelPieceId)
        .in('library_file_id', [...fileToExecution.keys()])
      for (const row of media ?? []) {
        const executionId = fileToExecution.get(row.library_file_id as string)
        if (executionId) attached.add(executionId)
      }
    }
  }
  return NextResponse.json({ executions: executions.map((execution) => ({ ...execution, attached_to_piece: attached.has(execution.id) })) })
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const channelPieceId = searchParams.get('channelPieceId')
    if (channelPieceId !== null) {
      if (!UUID_RE.test(channelPieceId)) return NextResponse.json({ error: 'channelPieceId invalido.' }, { status: 400 })
      return listStaticExecutionsForChannelPiece(channelPieceId)
    }
    const videoDraftId = searchParams.get('videoDraftId')
    
    if (!videoDraftId || !UUID_RE.test(videoDraftId)) {
      return NextResponse.json({ error: 'videoDraftId invalido ou ausente.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const executionReader = createRenderExecutionReadClient()
    if (!executionReader) {
      console.error('[Render Executions List GET] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })
    }

    const { data, error } = await executionReader
      .from('render_executions')
      .select(SAFE_COLUMNS)
      .eq('video_draft_id', videoDraftId)
      .eq('user_id', user.id)
      .order('queued_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Erro ao buscar execucoes.' }, { status: 500 })
    }

    const execution = data as unknown as RenderExecutionSummary | null
    return NextResponse.json({ execution })
  } catch (error) {
    console.error('[Render Executions List GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
