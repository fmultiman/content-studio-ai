import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import {
  PatchSessionBodySchema,
  SESSION_COLUMNS,
  formatValidationIssues,
  isUuid,
  parseWorkingState,
  readBoundedJsonBody,
  toSessionResponse,
  type ImageGenerationSessionRow,
} from '@/lib/image-generation/session'
import { authenticateImageGenerationRequest } from '@/lib/image-generation/api'

const IMMUTABLE_FIELDS = ['id', 'userId', 'user_id', 'projectId', 'project_id', 'productionId', 'production_id', 'name'] as const
function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}
async function ownSession(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>, userId: string, id: string) {
  return supabase.from('image_generation_sessions').select(SESSION_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data, error } = await ownSession(supabase, user.id, id)
    if (error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be loaded.')
    if (!data) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    return NextResponse.json({ session: toSessionResponse(data as unknown as ImageGenerationSessionRow) })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not load Image generation session.')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const bodyRead = await readBoundedJsonBody(req)
    if (!bodyRead.ok) return errorResponse(bodyRead.status, bodyRead.code, bodyRead.message)
    const immutable = IMMUTABLE_FIELDS.find((field) => field in bodyRead.body)
    if (immutable) return errorResponse(400, 'IMMUTABLE_FIELD', `${immutable} cannot be changed.`)
    const body = PatchSessionBodySchema.safeParse(bodyRead.body)
    if (!body.success) return errorResponse(400, 'INVALID_BODY', 'Invalid session body.', { issues: formatValidationIssues(body.error) })
    const state = parseWorkingState(body.data.workingState)
    if (!state.success) return errorResponse(400, 'INVALID_WORKING_STATE', 'The Image generation working state is invalid.', { issues: formatValidationIssues(state.error) })
    const currentBefore = await ownSession(supabase, user.id, id)
    if (currentBefore.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be loaded.')
    if (!currentBefore.data) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    const currentRow = currentBefore.data as unknown as ImageGenerationSessionRow
    if (currentRow.revision !== body.data.expectedRevision) {
      return errorResponse(409, 'SESSION_VERSION_CONFLICT', 'The session changed before this save.', { session: toSessionResponse(currentRow) })
    }
    const currentState = parseWorkingState(currentRow.working_state)
    const lifecycle = currentState.success ? currentState.data : null
    const workingState = {
      ...state.data,
      imageStatus: lifecycle?.imageStatus ?? state.data.imageStatus,
      currentAttempt: lifecycle?.currentAttempt ?? state.data.currentAttempt,
      currentImageId: currentRow.current_image_id ?? lifecycle?.currentImageId ?? null,
      legacyImageUrl: lifecycle?.legacyImageUrl ?? state.data.legacyImageUrl,
    }
    const { data, error } = await createServiceRoleSupabase().from('image_generation_sessions')
      .update({ working_prompt: body.data.workingPrompt, working_state: workingState, current_image_id: currentRow.current_image_id, revision: body.data.expectedRevision + 1 })
      .eq('id', id).eq('user_id', user.id).eq('revision', body.data.expectedRevision)
      .select(SESSION_COLUMNS).maybeSingle()
    if (error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be saved.')
    if (data) return NextResponse.json({ session: toSessionResponse(data as unknown as ImageGenerationSessionRow) })
    const current = await ownSession(supabase, user.id, id)
    if (current.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be loaded.')
    if (!current.data) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    return errorResponse(409, 'SESSION_VERSION_CONFLICT', 'The session changed before this save.', { session: toSessionResponse(current.data as unknown as ImageGenerationSessionRow) })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not save Image generation session.')
  }
}
