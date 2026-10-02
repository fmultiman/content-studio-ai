import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveProjectImageDisplayFile } from '@/lib/library/display-file'

// CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1
//
// GET /api/library-files/:id/display?projectId=<Project>
// One owned, active image LibraryFile of that Project as the editors display it (signed read URL). Read-only.
// The editors' pickers use it so that what they cache for the Canvas is never the raw, unsigned table row.

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const resolved = await resolveProjectImageDisplayFile(supabase, user.id, { fileId: id, projectId: new URL(request.url).searchParams.get('projectId') })
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.code === 'INVALID_REQUEST' ? 'Pedido inválido.' : 'Arquivo não encontrado neste Projeto.', code: resolved.code },
        { status: resolved.code === 'INVALID_REQUEST' ? 400 : 404 },
      )
    }
    return NextResponse.json({ file: resolved.file })
  } catch (cause) {
    console.error('[Library display file] error:', cause instanceof Error ? cause.message : cause)
    return NextResponse.json({ error: 'Não foi possível carregar o arquivo.', code: 'INVALID_REQUEST' }, { status: 500 })
  }
}
