import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveReceivedMedia } from '@/lib/library/handoff'
import { HANDOFF_MEDIA_ERROR_COPY, type ReceivingTarget } from '@/lib/creative/handoff/media-handoff'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1
//
// GET /api/library-files/:id/handoff-media?editor=static&projectId&editorialContentId&channelPieceId
// GET /api/library-files/:id/handoff-media?editor=video&draftId
// The receiving editor's revalidation of "Mídia recebida". The query names the editor's REAL authoring target;
// the receiving Project is derived on the server from it (Static: Project -> EditorialContent -> ChannelPiece
// chain; Video: the owner-scoped VideoDraft). A Project in the query is never an authority on its own, and
// `editor` is only a routing discriminator. Read-only: it never writes, never promotes and never touches
// authoring; the editor decides, on an explicit user action, whether to use the file.

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS: Record<string, number> = { INVALID_REQUEST: 400, NOT_FOUND: 404, NO_PROJECT: 409, PROJECT_MISMATCH: 409, TARGET_NOT_FOUND: 404, UNSUPPORTED_KIND: 422 }

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const search = new URL(request.url).searchParams
    const editor = search.get('editor')
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    if (editor !== 'static' && editor !== 'video') {
      return NextResponse.json({ error: HANDOFF_MEDIA_ERROR_COPY.INVALID_REQUEST, code: 'INVALID_REQUEST' }, { status: 400 })
    }

    // Missing parameters stay undefined-as-empty so the domain layer rejects them as INVALID_REQUEST.
    const target: ReceivingTarget = editor === 'static'
      ? { editor, projectId: search.get('projectId') ?? '', editorialContentId: search.get('editorialContentId') ?? '', channelPieceId: search.get('channelPieceId') ?? '' }
      : { editor, draftId: search.get('draftId') ?? '' }
    const resolved = await resolveReceivedMedia(supabase, user.id, { fileId: id, target })
    if (!resolved.ok) return NextResponse.json({ error: HANDOFF_MEDIA_ERROR_COPY[resolved.code], code: resolved.code }, { status: STATUS[resolved.code] ?? 400 })
    return NextResponse.json({ file: resolved.file })
  } catch (cause) {
    console.error('[Library handoff media] error:', cause instanceof Error ? cause.message : cause)
    return NextResponse.json({ error: HANDOFF_MEDIA_ERROR_COPY.INVALID_REQUEST, code: 'INVALID_REQUEST' }, { status: 500 })
  }
}
