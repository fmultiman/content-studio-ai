import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabaseOrNull } from '@/lib/supabase/service-role'
import { isUuid } from '@/lib/library/production-scope'
import { loadGalleryOutputs } from '@/lib/gallery/outputs-data'
import {
  clampGalleryLimit,
  decodeGalleryCursor,
  filterFingerprint,
  GALLERY_OUTPUT_TYPES,
  isGalleryOutputType,
  type GalleryOutputType,
} from '@/lib/gallery/outputs'

/**
 * GET /api/gallery/outputs
 *
 * Wave 1A-2 / S1. The Gallery as a READ-ONLY projection of completed outputs: AI images, AI videos (succeeded), Creative Editor
 * video renders and Creative Editor static renders. It never writes, never creates a LibraryFile and never signs a URL: media
 * stays behind the existing per-item endpoints named in each item's `access`.
 *
 * Query:
 *   type       repeated or comma separated: image | video_generation | video_render | static_render (default: all four).
 *              Filtering is SERVER-side, across the whole collection.
 *   projectId  one of the caller's own Projects
 *   limit      1..100, default 48
 *   cursor     opaque; only valid for the same `type` / `projectId`
 *   totals     "1" to include exact counts (only reported as a global total when every selected source succeeded)
 *
 * Contract (see docs/productization/structural-wave-1a2-s1-gallery-read-model-v1.md):
 *   - every source reports `ok` / `failed` / `skipped`; a failed source is never an empty one
 *   - a partial result keeps every successful source and keeps the cursor open for the failed one
 *   - 503 only when every selected source failed
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status, headers: NO_STORE })
}

function parseTypes(values: string[]): GalleryOutputType[] | null {
  const raw = values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  if (raw.length === 0) return [...GALLERY_OUTPUT_TYPES]
  const types: GalleryOutputType[] = []
  for (const value of raw) {
    if (!isGalleryOutputType(value)) return null
    if (!types.includes(value)) types.push(value)
  }
  return types
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return jsonError(401, 'UNAUTHORIZED', 'Não autorizado')

    const params = new URL(request.url).searchParams
    const types = parseTypes(params.getAll('type'))
    if (!types) return jsonError(400, 'INVALID_TYPE', 'Tipo de output inválido.')

    const projectIdRaw = params.get('projectId')
    if (projectIdRaw !== null && projectIdRaw !== '' && !isUuid(projectIdRaw)) return jsonError(400, 'INVALID_PROJECT', 'Project inválido.')
    const projectId = projectIdRaw ? projectIdRaw : null

    const fingerprint = filterFingerprint(types, projectId)
    const cursor = decodeGalleryCursor(params.get('cursor'), fingerprint)
    if (!cursor.ok) {
      return jsonError(400, cursor.reason === 'FILTER_MISMATCH' ? 'CURSOR_FILTER_MISMATCH' : 'INVALID_CURSOR', 'Cursor inválido para esta consulta.')
    }

    if (projectId) {
      // An unknown/foreign Project is "not found", never an empty Gallery.
      const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle()
      if (projectError) return jsonError(503, 'PROJECT_UNAVAILABLE', 'Não foi possível validar o Project agora.')
      if (!project) return jsonError(404, 'PROJECT_NOT_FOUND', 'Project não encontrado.')
    }

    // A missing or locally-forbidden service-role client only fails the two render sources; the others still answer.
    let renderDb: ReturnType<typeof createServiceRoleSupabaseOrNull> = null
    try {
      renderDb = createServiceRoleSupabaseOrNull()
    } catch {
      renderDb = null
    }

    const response = await loadGalleryOutputs(
      { userDb: supabase, renderDb, userId: user.id },
      { types, projectId, limit: clampGalleryLimit(params.get('limit')), positions: cursor.positions, includeTotals: params.get('totals') === '1' },
    )

    const selectedStates = types.map((type) => response.sources[type].state)
    if (selectedStates.every((state) => state === 'failed')) {
      return NextResponse.json({ ...response, error: 'Não foi possível carregar os outputs agora.', code: 'ALL_SOURCES_FAILED' }, { status: 503, headers: NO_STORE })
    }
    return NextResponse.json(response, { headers: NO_STORE })
  } catch (error) {
    console.error('[Gallery outputs GET] error:', error instanceof Error ? error.name : 'unknown')
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno')
  }
}
