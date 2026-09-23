import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { RenderExecutionSummary } from '@/lib/types'

/**
 * GET /api/gallery/video-outputs
 *
 * Phase 2I — Production Video Operational Closure (Task B1).
 *
 * ROOT CAUSE this route closes: the Gallery previously queried
 * `render_executions` directly from the browser via the authenticated
 * Supabase client. That table's RLS deliberately grants the browser role no
 * SELECT policy (worker/lease internals, the frozen input snapshot, and raw
 * error detail are never meant to reach the client) — so every real
 * production load of the Gallery received a `403 permission denied for
 * table render_executions`. The fix is server authority, not loosening the
 * table's permissions: this route runs with the service-role client (same
 * pattern already used by GET /api/render-executions and
 * GET /api/render-executions/:id), authenticates the user from their
 * session, and returns only a narrow, safe projection of their OWN
 * completed executions.
 *
 * Deliberately excludes: claimed_by, lease_expires_at, attempt,
 * max_attempts, idempotency_key, input_schema_version, input_snapshot,
 * output_bucket, output_storage_path, error_detail — none of those are
 * Gallery-facing (the actual playable/downloadable URL is obtained
 * separately, per-item, from GET /api/render-executions/:id/output-url,
 * which already enforces its own ownership + scratch-path boundary).
 *
 * Only `status = 'completed'` rows are returned — queued/claimed/failed
 * executions must never be counted as generated outputs.
 */

function createRenderExecutionReadClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const SAFE_COLUMNS = ['id', 'video_draft_id', 'status', 'queued_at', 'completed_at'].join(', ')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const executionReader = createRenderExecutionReadClient()
    if (!executionReader) {
      console.error('[Gallery Video Outputs GET] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })
    }

    const { data, error } = await executionReader
      .from('render_executions')
      .select(SAFE_COLUMNS)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      // Static Render Worker V1: static PNG scratch renders are not Gallery
      // video outputs (and have no video_draft_id to federate by).
      .eq('kind', 'video')
      .order('completed_at', { ascending: false })

    if (error) {
      console.error('[Gallery Video Outputs GET] query error:', error)
      return NextResponse.json({ error: 'Erro ao buscar outputs de video.' }, { status: 500 })
    }

    const executions = (data ?? []) as unknown as Pick<
      RenderExecutionSummary,
      'id' | 'video_draft_id' | 'status' | 'queued_at' | 'completed_at'
    >[]

    return NextResponse.json({ executions })
  } catch (error) {
    console.error('[Gallery Video Outputs GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
