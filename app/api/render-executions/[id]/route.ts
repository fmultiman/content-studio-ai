import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { RenderExecutionSummary } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

function createRenderExecutionReadClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * User-safe projection only. Deliberately EXCLUDES: claimed_by,
 * lease_expires_at, attempt, max_attempts, retry_of_execution_id,
 * idempotency_key, input_schema_version, input_snapshot, output_bucket,
 * output_storage_path, error_detail. None of those are product-facing per
 * PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §16/§17 -- worker/lease
 * internals, the full render input, and raw diagnostic detail are never
 * returned to the browser.
 */
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

/**
 * GET /api/render-executions/:id
 *
 * Authenticated, ownership-scoped (user_id = auth.uid(), same single-owner
 * model as every other table in this schema -- no team/membership concept
 * exists to authorize by "associated Project" beyond that). No signed URL
 * is generated here: this phase never produces an output, so there is
 * nothing yet to retrieve (Task 9 explicitly prefers not adding output
 * retrieval behavior before an output exists).
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const executionReader = createRenderExecutionReadClient()
    if (!executionReader) {
      console.error('[Render Execution GET] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' }, { status: 503 })
    }

    const { data, error } = await executionReader
      .from('render_executions')
      // `slide` is a safe projection of the frozen static snapshot's slide
      // reference ({ id, index, total }) — never the snapshot itself.
      .select(`${SAFE_COLUMNS}, slide:input_snapshot->slide`)
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Execucao de renderizacao nao encontrada.' }, { status: 404 })
    }

    const execution = data as unknown as RenderExecutionSummary
    if ((execution.kind ?? 'video') === 'video' && execution.status === 'completed') {
      const { data: libraryFile } = await executionReader
        .from('library_files')
        .select('id')
        .eq('user_id', user.id)
        .eq('source_render_execution_id', execution.id)
        .eq('origin', 'studio_render')
        .eq('kind', 'video')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      execution.saved_to_library = Boolean(libraryFile)
      execution.library_file_id = libraryFile?.id ?? null
    }
    return NextResponse.json({ execution })
  } catch (error) {
    console.error('[Render Execution GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
