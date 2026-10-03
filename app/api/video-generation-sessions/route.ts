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

    const productionId = new URL(req.url).searchParams.get('productionId')
    if (!isUuid(productionId)) {
      return NextResponse.json({ error: 'productionId must be a UUID.', code: 'INVALID_PRODUCTION_ID' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('video_generation_sessions')
      .select(SESSION_COLUMNS)
      .eq('user_id', user.id)
      .eq('production_id', productionId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(SESSION_LIMITS.listMax)
    if (error) {
      return NextResponse.json({ error: 'Não foi possível carregar as sessões agora.', code: 'STORE_UNAVAILABLE' }, { status: 503 })
    }

    return NextResponse.json({ sessions: ((data ?? []) as unknown as SessionRow[]).map(toSessionResponse) })
  } catch {
    return NextResponse.json({ error: 'Erro interno ao listar as sessões.', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
