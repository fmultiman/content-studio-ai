import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { presignLibraryRead } from '@/lib/storage/library-storage'
import { isUuid, resolveOwnedProductionContext } from '@/lib/library/production-scope'
import {
  clampLimit,
  combineOrGroups,
  decodeCursor,
  encodeCursor,
  escapeLike,
  keysetFilter,
  normalizeSearch,
  parseFormat,
  parseKind,
  parseProductionFilter,
  parseScope,
} from '@/lib/library/browse-query'

// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1
//
// Scalable, bounded Library browse (the boundary /arquivos and the future I2V source browser build on).
// GET /api/library-files still returns everything for its existing callers; this one never does:
//   - projectId is REQUIRED and must be the caller's own Project
//   - production: all (default) | unscoped | <uuid of a Production of THAT Project>
//   - folder (exact path, independent of Production), kind, q (name search), trash,
//     scope (arquivos | gallery), format (i2v-image: PNG/JPEG, image-reference: PNG/JPEG/WebP)
//   - order: created_at DESC, id DESC; keyset cursor; default 48, max 100 per page
// Signed URLs are created only for the rows of the returned page (<= 100), never for the whole Library.

function normalizeFolder(folder: unknown) {
  if (typeof folder !== 'string' || !folder.trim()) return null
  const normalized = folder.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/g, '') : '/'
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const params = new URL(request.url).searchParams

    const projectId = params.get('projectId')
    if (!isUuid(projectId)) return NextResponse.json({ error: 'Selecione um Projeto.', code: 'PROJECT_REQUIRED' }, { status: 400 })
    const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle()
    if (projectError || !project) return NextResponse.json({ error: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })

    const production = parseProductionFilter(params.get('production'))
    if (!production) return NextResponse.json({ error: 'Filtro de Production inválido.', code: 'INVALID_PRODUCTION_FILTER' }, { status: 400 })
    if (production.mode === 'one') {
      // A Production of another Project (or another user) is refused, not silently empty.
      const owned = await resolveOwnedProductionContext(supabase, { userId: user.id, projectId, productionId: production.productionId })
      if (!owned.ok) return NextResponse.json({ error: 'Production não encontrada neste Projeto.', code: 'PRODUCTION_NOT_FOUND' }, { status: 404 })
    }

    const kind = parseKind(params.get('kind'))
    if (!kind) return NextResponse.json({ error: 'Tipo inválido.', code: 'INVALID_KIND' }, { status: 400 })

    const scope = parseScope(params.get('scope'))
    if (!scope) return NextResponse.json({ error: 'Escopo inválido.', code: 'INVALID_SCOPE' }, { status: 400 })
    const mimeAllowList = parseFormat(params.get('format'))
    if (!mimeAllowList) return NextResponse.json({ error: 'Formato inválido.', code: 'INVALID_FORMAT' }, { status: 400 })

    const cursor = decodeCursor(params.get('cursor'))
    if (cursor === null) return NextResponse.json({ error: 'Cursor inválido.', code: 'INVALID_CURSOR' }, { status: 400 })

    const limit = clampLimit(params.get('limit'))
    const search = normalizeSearch(params.get('q'))
    const folder = normalizeFolder(params.get('folder'))
    const trash = params.get('trash') === 'true'
    // "Arquivos" semantics: Creative Editor still renders saved to a piece live in Galeria, not in Arquivos.
    const hideStudioImages = scope === 'arquivos'

    let query = supabase
      .from('library_files')
      .select('*')
      .eq('user_id', user.id)
      .eq('project_id', projectId)

    query = trash ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
    if (production.mode === 'one') query = query.eq('production_id', production.productionId)
    if (production.mode === 'unscoped') query = query.is('production_id', null)
    if (folder) query = query.eq('folder', folder)
    if (scope === 'gallery') {
      // Galeria = Creative Editor image outputs. Fixed server-side; the browser cannot widen it.
      query = query.eq('origin', 'studio_render').eq('kind', 'image')
    } else if (kind !== 'all') {
      query = query.eq('kind', kind)
    }
    if (mimeAllowList !== 'none') query = query.in('mime_type', [...mimeAllowList])
    if (search) query = query.ilike('name', `%${escapeLike(search)}%`)

    const orGroups: string[] = []
    if (hideStudioImages) orGroups.push('origin.neq.studio_render,kind.neq.image')
    if (cursor !== 'none') orGroups.push(keysetFilter(cursor))
    const combined = combineOrGroups(orGroups)
    if (combined) query = query.or(combined)

    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
    if (error) return NextResponse.json({ error: 'Não foi possível carregar os arquivos.', code: 'BROWSE_FAILED' }, { status: 500 })

    const rows = data ?? []
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor = rows.length > limit && last?.created_at ? encodeCursor({ createdAt: last.created_at as string, id: last.id as string }) : null

    // Bounded fan-out: at most `limit` (<= 100) presigns, each only for a key proven to be this owner's.
    const files = await Promise.all(
      page.map(async (file) => {
        const signedUrl = await presignLibraryRead(file).catch(() => null)
        return { ...file, public_url: signedUrl || file.public_url, thumbnail_url: signedUrl || file.thumbnail_url }
      }),
    )

    return NextResponse.json({ files, nextCursor, limit }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Library Browse] error:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
