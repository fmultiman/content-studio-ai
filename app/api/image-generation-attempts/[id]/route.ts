import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { authenticateImageGenerationRequest } from '@/lib/image-generation/api'
import { ATTEMPT_COLUMNS, AttemptLifecyclePatchSchema, toAttemptResponse, type ImageGenerationAttemptRow } from '@/lib/image-generation/attempt'
import { isUuid, readBoundedJsonBody } from '@/lib/image-generation/session'

const IMMUTABLE_FIELDS = ['sessionId', 'session_id', 'submittedPrompt', 'submitted_prompt', 'provider', 'model', 'submittedConfig', 'submitted_config', 'sourceSnapshot', 'source_snapshot', 'clientRequestId', 'client_request_id', 'requestFingerprint', 'request_fingerprint'] as const
function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return errorResponse(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.')
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data, error } = await supabase.from('image_generation_attempts').select(ATTEMPT_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
    if (error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempt could not be loaded.')
    if (!data) return errorResponse(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.')
    return NextResponse.json({ attempt: toAttemptResponse(data as unknown as ImageGenerationAttemptRow) })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not load Image generation attempt.')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return errorResponse(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.')
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const read = await readBoundedJsonBody(req)
    if (!read.ok) return errorResponse(read.status, read.code, read.message)
    const immutable = IMMUTABLE_FIELDS.find((field) => field in read.body)
    if (immutable) return errorResponse(400, 'IMMUTABLE_FIELD', `${immutable} cannot be changed after submission.`)
    const patch = AttemptLifecyclePatchSchema.safeParse(read.body)
    if (!patch.success) return errorResponse(400, 'INVALID_LIFECYCLE', 'Only provider lifecycle fields may change after submission.', { issues: patch.error.issues })
    if (Object.keys(patch.data).length === 0) return errorResponse(400, 'EMPTY_LIFECYCLE_PATCH', 'At least one lifecycle field is required.')
    const current = await supabase.from('image_generation_attempts').select(ATTEMPT_COLUMNS).eq('id', id).eq('user_id', user.id).maybeSingle()
    if (current.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempt could not be loaded.')
    if (!current.data) return errorResponse(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.')
    const row = current.data as unknown as ImageGenerationAttemptRow
    if (patch.data.resultImageId) {
      let imageQuery = supabase.from('images').select('id').eq('id', patch.data.resultImageId).eq('user_id', user.id)
      if (row.project_id) imageQuery = imageQuery.eq('project_id', row.project_id)
      const image = await imageQuery.maybeSingle()
      if (image.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Result image could not be verified.')
      if (!image.data) return errorResponse(403, 'RESULT_IMAGE_NOT_FOUND', 'Result image is not owned by this user and project.')
    }
    const update: Record<string, unknown> = {}
    if (patch.data.status !== undefined) update.status = patch.data.status
    if (patch.data.providerTaskId !== undefined) update.provider_task_id = patch.data.providerTaskId
    if (patch.data.resultImageId !== undefined) update.result_image_id = patch.data.resultImageId
    if (patch.data.resultMetadata !== undefined) update.result_metadata = patch.data.resultMetadata
    if (patch.data.failureDetails !== undefined) update.failure_details = patch.data.failureDetails
    if (patch.data.completedAt !== undefined) update.completed_at = patch.data.completedAt
    const { data, error } = await createServiceRoleSupabase().from('image_generation_attempts').update(update).eq('id', id).eq('user_id', user.id).select(ATTEMPT_COLUMNS).maybeSingle()
    if (error) return errorResponse(409, 'ATTEMPT_IMMUTABLE', 'Attempt submission fields are immutable.')
    if (!data) return errorResponse(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found.')
    return NextResponse.json({ attempt: toAttemptResponse(data as unknown as ImageGenerationAttemptRow) })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not update Image generation attempt.')
  }
}
