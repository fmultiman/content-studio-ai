import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SESSION_COLUMNS, SESSION_LIMITS, isUuid, toSessionResponse, type SessionRow } from '@/lib/video-generation/session'

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1
//
// GET /api/video-generation-sessions?productionId=<uuid>
// The authenticated user's Sessions of ONE Production, most recently edited first (id breaks ties, so the order is
// deterministic). Read-only: it never creates, normalizes or touches anything. Reads use the user session, so RLS
// (own rows only) is enforced by the database in addition to the explicit user_id filter.
// Creating/updating a Session is PUT/PATCH on /api/video-generation-sessions/[id].
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const all = url.searchParams.get('all') === 'true'
    const productionId = url.searchParams.get('productionId')
    if (!all && !isUuid(productionId)) {
      return NextResponse.json({ error: 'productionId must be a UUID.', code: 'INVALID_PRODUCTION_ID' }, { status: 400 })
    }

    let query = supabase
      .from('video_generation_sessions')
      .select(SESSION_COLUMNS)
      .eq('user_id', user.id)

    if (productionId) {
      query = query.eq('production_id', productionId)
    }

    // One extra row tells whether the cap cut the list (`hasMore`), so no screen presents a truncated list as the complete one.
    const { data, error } = await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(SESSION_LIMITS.listMax + 1)
    if (error) {
      return NextResponse.json({ error: 'Não foi possível carregar as sessões agora.', code: 'STORE_UNAVAILABLE' }, { status: 503 })
    }

    const fetched = (data ?? []) as unknown as SessionRow[]
    const hasMore = fetched.length > SESSION_LIMITS.listMax
    const rows = hasMore ? fetched.slice(0, SESSION_LIMITS.listMax) : fetched
    return NextResponse.json({ sessions: rows.map(toSessionResponse), hasMore })
  } catch {
    return NextResponse.json({ error: 'Erro interno ao listar as sessões.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
