import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { presignImageObject } from '@/lib/storage/image-storage'
import { isUuid } from '@/lib/library/production-scope'
import { clampLimit, decodeCursor, encodeCursor, keysetFilter } from '@/lib/library/browse-query'
import { I2V_SOURCE_MIME_TYPES } from '@/lib/video-generation/i2v-source'

// VIDEO_I2V_SOURCE_BROWSER_V1 — "Geradas por IA".
//
// Bounded, Project-scoped page of the caller's OWN generated images (`images`), newest first, for the
// Image -> Video source chooser. It is the only place that chooser reads `images` from:
//   - projectId is REQUIRED and must be the caller's own Project
//   - only images that carry a stored object AND a verified I2V-compatible MIME (PNG / JPEG)
//   - keyset cursor on (created_at DESC, id DESC); default 48, max 100 (same contract as the Library browse)
//   - `image_url` is deliberately NOT selected: legacy rows hold multi-megabyte data URLs in it
//   - the display URL is a short-lived signed URL, produced only for a key proven to be the owner's image object
// Production is CONTEXT, never a filter: Image -> Production is only sometimes derivable, so an image whose
// Production cannot be derived is still listed. It is reported only when exactly one Production is derivable.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TITLE_MAX = 80

function titleOf(userInput: string | null): string {
  const first = (userInput ?? '').split('\n')[0].trim()
  if (!first) return 'Imagem gerada'
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trim()}…` : first
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

    const cursor = decodeCursor(params.get('cursor'))
    if (cursor === null) return NextResponse.json({ error: 'Cursor inválido.', code: 'INVALID_CURSOR' }, { status: 400 })
    const limit = clampLimit(params.get('limit'))

    let query = supabase
      .from('images')
      .select('id, user_input, created_at, mime_type, storage_path, thumbnail_path')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .not('storage_path', 'is', null)
      .in('mime_type', [...I2V_SOURCE_MIME_TYPES])
    if (cursor !== 'none') query = query.or(keysetFilter(cursor))

    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
    if (error) return NextResponse.json({ error: 'Não foi possível carregar as imagens.', code: 'BROWSE_FAILED' }, { status: 500 })

    const rows = data ?? []
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const nextCursor = rows.length > limit && last?.created_at ? encodeCursor({ createdAt: last.created_at as string, id: last.id as string }) : null

    // Production context: ONE batched read for the page (never per image).
    const productionByImage = new Map<string, Set<string>>()
    if (page.length > 0) {
      const { data: drafts } = await supabase
        .from('image_drafts')
        .select('current_image_id, production_id')
        .eq('user_id', user.id)
        .in('current_image_id', page.map((row) => row.id as string))
        .not('production_id', 'is', null)
      for (const draft of drafts ?? []) {
        if (!draft.current_image_id || !draft.production_id) continue
        const set = productionByImage.get(draft.current_image_id as string) ?? new Set<string>()
        set.add(draft.production_id as string)
        productionByImage.set(draft.current_image_id as string, set)
      }
    }

    // Bounded fan-out: at most `limit` (<= 100) presigns, each only for a key proven to be this owner's.
    const images = await Promise.all(
      page.map(async (row) => {
        const thumbnailKey = row.thumbnail_path && isTrustedImageStoragePath(user.id, row.thumbnail_path, 'thumbnail') ? row.thumbnail_path : null
        const displayUrl = thumbnailKey
          ? await presignImageObject(user.id, thumbnailKey, 'thumbnail').catch(() => null)
          : await presignImageObject(user.id, row.storage_path, 'original').catch(() => null)
        const candidates = productionByImage.get(row.id as string)
        return {
          id: row.id as string,
          name: titleOf(row.user_input as string | null),
          created_at: row.created_at as string,
          mime_type: row.mime_type as string,
          thumbnail_url: displayUrl,
          production_id: candidates && candidates.size === 1 ? [...candidates][0] : null,
        }
      }),
    )

    return NextResponse.json({ images, nextCursor, limit }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Images Browse] error:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
