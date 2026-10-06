import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import {
  CreateSessionBodySchema,
  IMAGE_SESSION_LIMITS,
  SESSION_COLUMNS,
  formatValidationIssues,
  isUuid,
  parseWorkingState,
  readBoundedJsonBody,
  toSessionResponse,
  type ImageGenerationSessionRow,
} from '@/lib/image-generation/session'
import { authenticateImageGenerationRequest, validateImageScope } from '@/lib/image-generation/api'
import { resolveSessionThumbnails } from '@/lib/image-generation/session-thumbnails'

function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

function parseState(raw: unknown) {
  const parsed = parseWorkingState(raw)
  if (parsed.success) return { state: parsed.data }
  return { response: errorResponse(400, 'INVALID_WORKING_STATE', 'The Image generation working state is invalid.', { issues: formatValidationIssues(parsed.error) }) }
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId')
    const productionId = url.searchParams.get('productionId')
    const legacyImageDraftId = url.searchParams.get('legacyImageDraftId')
    if ((projectId && !isUuid(projectId)) || (productionId && !isUuid(productionId)) || (legacyImageDraftId && !isUuid(legacyImageDraftId))) {
      return errorResponse(400, 'INVALID_SCOPE_ID', 'projectId, productionId and legacyImageDraftId must be UUIDs.')
    }
    let query = supabase.from('image_generation_sessions').select(SESSION_COLUMNS).eq('user_id', user.id)
    if (projectId) query = query.eq('project_id', projectId)
    if (productionId) query = query.eq('production_id', productionId)
    if (legacyImageDraftId) query = query.eq('legacy_image_draft_id', legacyImageDraftId)
    const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(IMAGE_SESSION_LIMITS.listMax)
    if (error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Sessions could not be loaded.')
    const rows = (data ?? []) as unknown as ImageGenerationSessionRow[]
    // Thumbnail resolution is best-effort: a failure must never hide the Sessions themselves.
    const thumbnails = await resolveSessionThumbnails(supabase, user.id, rows.map((row) => row.current_image_id)).catch(() => new Map<string, string>())
    return NextResponse.json({
      sessions: rows.map((row) => ({ ...toSessionResponse(row), thumbnailUrl: row.current_image_id ? thumbnails.get(row.current_image_id) ?? null : null })),
    })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not list Image generation sessions.')
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const bodyRead = await readBoundedJsonBody(req)
    if (!bodyRead.ok) return errorResponse(bodyRead.status, bodyRead.code, bodyRead.message)
    const body = CreateSessionBodySchema.safeParse(bodyRead.body)
    if (!body.success) return errorResponse(400, 'INVALID_BODY', 'Invalid session body.', { issues: formatValidationIssues(body.error) })
    const state = parseState(body.data.workingState)
    if ('response' in state) return state.response
    const scope = await validateImageScope(supabase, user.id, body.data.projectId, body.data.productionId)
    if (!scope.ok) return errorResponse(scope.status, scope.code, scope.message)
    const id = body.data.id ?? crypto.randomUUID()
    const service = createServiceRoleSupabase()
    const existing = await supabase.from('image_generation_sessions').select(SESSION_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
    if (existing.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be loaded.')
    if (existing.data) {
      const row = existing.data as unknown as ImageGenerationSessionRow
      if (row.project_id !== (body.data.projectId ?? null) || row.production_id !== (body.data.productionId ?? null)) {
        return errorResponse(409, 'SESSION_SCOPE_MISMATCH', 'The session belongs to another project or production.')
      }
      return NextResponse.json({ session: toSessionResponse(row), created: false })
    }
    const { data, error } = await service.from('image_generation_sessions').insert({
      id,
      user_id: user.id,
      project_id: body.data.projectId ?? null,
      production_id: body.data.productionId ?? null,
      name: body.data.name ?? null,
      working_prompt: body.data.workingPrompt,
      working_state: state.state,
      current_image_id: state.state.currentImageId,
    }).select(SESSION_COLUMNS).single()
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505') {
        const raced = await supabase.from('image_generation_sessions').select(SESSION_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
        if (raced.data) return NextResponse.json({ session: toSessionResponse(raced.data as unknown as ImageGenerationSessionRow), created: false })
      }
      return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be created.')
    }
    return NextResponse.json({ session: toSessionResponse(data as unknown as ImageGenerationSessionRow), created: true }, { status: 201 })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not create Image generation session.')
  }
}
