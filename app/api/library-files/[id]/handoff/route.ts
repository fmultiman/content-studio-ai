import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadHandoffTargets, resolveHandoffLibraryFile } from '@/lib/library/handoff'
import { HANDOFF_MEDIA_ERROR_COPY } from '@/lib/creative/handoff/media-handoff'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// GET /api/library-files/:id/handoff -> the existing, compatible authoring targets for ONE saved
// LibraryFile (same Project only). Read-only: nothing is created, promoted or mutated.

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const resolved = await resolveHandoffLibraryFile(supabase, user.id, id)
    if (!resolved.ok) {
      return NextResponse.json({ error: HANDOFF_MEDIA_ERROR_COPY[resolved.code], code: resolved.code }, { status: resolved.code === 'INVALID_REQUEST' ? 400 : 404 })
    }
    return NextResponse.json(await loadHandoffTargets(supabase, user.id, resolved))
  } catch (cause) {
    console.error('[Library handoff targets] error:', cause instanceof Error ? cause.message : cause)
    return NextResponse.json({ error: 'Não foi possível carregar os destinos.', code: 'TARGETS_UNAVAILABLE' }, { status: 500 })
  }
}
