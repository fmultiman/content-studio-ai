import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listPrimitivesForProject, PORTAL_PROJECT_REF } from '@/lib/creative/primitives/discovery'
import { isStaticChannelPiece, staticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIMITIVE_FILE_IDS = ['afa6868e-a2d6-473d-9df7-bbf713ad8b02', '3f593474-05c0-4de3-a537-de50a1abb906']

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    const search = new URL(request.url).searchParams
    const projectId = search.get('projectId')
    const editorialContentId = search.get('editorialContentId')
    const channelPieceId = search.get('channelPieceId')
    if (!projectId || !editorialContentId || !channelPieceId || ![projectId, editorialContentId, channelPieceId].every((id) => UUID_RE.test(id))) return NextResponse.json({ error: 'Contexto static invalido.' }, { status: 400 })

    const [{ data: project, error: projectError }, { data: editorialContent, error: editorialError }, { data: channelPiece, error: channelPieceError }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).eq('user_id', user.id).single(),
      supabase.from('editorial_contents').select('*').eq('id', editorialContentId).eq('user_id', user.id).single(),
      supabase.from('channel_pieces').select('*').eq('id', channelPieceId).eq('user_id', user.id).single(),
    ])
    if (projectError || !project) return NextResponse.json({ error: 'Project nao encontrado ou nao autorizado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
    if (editorialError || !editorialContent || editorialContent.project_id !== project.id) return NextResponse.json({ error: 'EditorialContent nao encontrado neste Project.', code: 'EDITORIAL_CONTENT_NOT_FOUND' }, { status: 404 })
    if (channelPieceError || !channelPiece || channelPiece.editorial_content_id !== editorialContent.id) return NextResponse.json({ error: 'ChannelPiece nao encontrada neste EditorialContent.', code: 'CHANNEL_PIECE_NOT_FOUND' }, { status: 404 })
    const target = staticAuthoringTarget(channelPiece.channel, channelPiece.format)
    if (!target || !isStaticChannelPiece(channelPiece.channel, channelPiece.format)) return NextResponse.json({ error: 'Este ChannelPiece pertence ao modo timeline.', code: 'TIMELINE_CONTEXT' }, { status: 409 })

    let production = null
    if (editorialContent.production_id) {
      const result = await supabase.from('productions').select('*').eq('id', editorialContent.production_id).eq('project_id', project.id).eq('user_id', user.id).single()
      if (result.error || !result.data) return NextResponse.json({ error: 'Production nao encontrada.', code: 'PRODUCTION_NOT_FOUND' }, { status: 404 })
      production = result.data
    }
    const projectIdentity = normalizeProjectIdentity(project.identity)
    if (!projectIdentity) return NextResponse.json({ error: 'Project sem identidade valida.', code: 'PROJECT_IDENTITY_REQUIRED' }, { status: 409 })

    const { data: primitiveFiles } = await supabase.from('library_files').select('id').in('id', PRIMITIVE_FILE_IDS).eq('project_id', project.id).eq('user_id', user.id)
    const catalog = primitiveFiles?.length === PRIMITIVE_FILE_IDS.length ? listPrimitivesForProject(PORTAL_PROJECT_REF) : null
    return NextResponse.json({ project, production, editorialContent, channelPiece, target, projectIdentity, primitiveProjectRef: catalog?.found ? PORTAL_PROJECT_REF : null, primitives: catalog?.found ? catalog.primitives.map(({ key, display_name, category, version, project_ref }) => ({ key, display_name, category, version, project_ref })) : [] })
  } catch (error) {
    console.error('[Static Authoring Context] GET error:', error)
    return NextResponse.json({ error: 'Erro interno ao carregar contexto static.' }, { status: 500 })
  }
}
