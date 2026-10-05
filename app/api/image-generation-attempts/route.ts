import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { authenticateImageGenerationRequest } from '@/lib/image-generation/api'
import { generateImageAttemptFingerprint, classifyExistingImageAttempt } from '@/lib/image-generation/idempotency'
import {
  ATTEMPT_COLUMNS,
  CreateAttemptBodySchema,
  toAttemptResponse,
  type ImageGenerationAttemptRow,
} from '@/lib/image-generation/attempt'
import { SESSION_COLUMNS, isUuid, readBoundedJsonBody, type ImageGenerationSessionRow } from '@/lib/image-generation/session'

function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}

async function loadOwnSession(supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>, userId: string, sessionId: string) {
  return supabase.from('image_generation_sessions').select(SESSION_COLUMNS).eq('id', sessionId).eq('user_id', userId).maybeSingle()
}

async function validateSourceSnapshot(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  userId: string,
  projectId: string | null,
  snapshot: { references: Array<{ type: 'image' | 'library_file'; id: string }> } | null,
) {
  for (const reference of snapshot?.references ?? []) {
    const table = reference.type === 'image' ? 'images' : 'library_files'
    let query = supabase.from(table).select('id').eq('id', reference.id).eq('user_id', userId)
    if (projectId) query = query.eq('project_id', projectId)
    const { data, error } = await query.maybeSingle()
    if (error) return { ok: false as const, status: 503, code: 'STORE_UNAVAILABLE', message: 'Source media could not be verified.' }
    if (!data) return { ok: false as const, status: 403, code: 'SOURCE_NOT_FOUND', message: 'A source reference is not owned by this user and project.' }
  }
  return { ok: true as const }
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const sessionId = new URL(req.url).searchParams.get('sessionId')
    if (sessionId && !isUuid(sessionId)) return errorResponse(400, 'INVALID_SESSION_ID', 'sessionId must be a UUID.')
    let query = supabase.from('image_generation_attempts').select(ATTEMPT_COLUMNS).eq('user_id', user.id)
    if (sessionId) query = query.eq('session_id', sessionId)
    const { data, error } = await query.order('sequence', { ascending: true }).limit(200)
    if (error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempts could not be loaded.')
    return NextResponse.json({ attempts: ((data ?? []) as unknown as ImageGenerationAttemptRow[]).map(toAttemptResponse) })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not list Image generation attempts.')
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await authenticateImageGenerationRequest()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const read = await readBoundedJsonBody(req)
    if (!read.ok) return errorResponse(read.status, read.code, read.message)
    const body = CreateAttemptBodySchema.safeParse(read.body)
    if (!body.success) return errorResponse(400, 'INVALID_BODY', 'Invalid attempt body.', { issues: body.error.issues })
    const sessionResult = await loadOwnSession(supabase, user.id, body.data.sessionId)
    if (sessionResult.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Session could not be loaded.')
    if (!sessionResult.data) return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.')
    const session = sessionResult.data as unknown as ImageGenerationSessionRow
    const source = await validateSourceSnapshot(supabase, user.id, session.project_id, body.data.sourceSnapshot)
    if (!source.ok) return errorResponse(source.status, source.code, source.message)
    const fingerprint = generateImageAttemptFingerprint({
      sessionId: body.data.sessionId,
      submittedPrompt: body.data.submittedPrompt,
      provider: body.data.provider,
      model: body.data.model,
      submittedConfig: body.data.submittedConfig,
      sourceSnapshot: body.data.sourceSnapshot,
    })
    if (body.data.clientRequestId) {
      const existing = await supabase.from('image_generation_attempts').select(ATTEMPT_COLUMNS)
        .eq('user_id', user.id).eq('client_request_id', body.data.clientRequestId).maybeSingle()
      if (existing.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempt idempotency could not be checked.')
      if (existing.data) {
        const row = existing.data as unknown as ImageGenerationAttemptRow
        if (classifyExistingImageAttempt(row, fingerprint) === 'conflict') return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'clientRequestId was already used for another submission.')
        return NextResponse.json({ attempt: toAttemptResponse(row), replayed: true })
      }
    }
    const latest = await supabase.from('image_generation_attempts').select('sequence').eq('session_id', body.data.sessionId).order('sequence', { ascending: false }).limit(1).maybeSingle()
    if (latest.error) return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempt sequence could not be allocated.')
    const sequence = ((latest.data as { sequence?: number } | null)?.sequence ?? 0) + 1
    const { data, error } = await createServiceRoleSupabase().from('image_generation_attempts').insert({
      session_id: session.id,
      user_id: user.id,
      project_id: session.project_id,
      production_id: session.production_id,
      sequence,
      submitted_prompt: body.data.submittedPrompt,
      provider: body.data.provider,
      model: body.data.model,
      submitted_config: body.data.submittedConfig,
      source_snapshot: body.data.sourceSnapshot,
      client_request_id: body.data.clientRequestId,
      request_fingerprint: body.data.clientRequestId ? fingerprint : null,
      status: 'queued',
      submitted_at: new Date().toISOString(),
    }).select(ATTEMPT_COLUMNS).single()
    if (error || !data) {
      if ((error as { code?: string } | null)?.code === '23505' && body.data.clientRequestId) {
        const raced = await supabase.from('image_generation_attempts').select(ATTEMPT_COLUMNS).eq('user_id', user.id).eq('client_request_id', body.data.clientRequestId).maybeSingle()
        if (raced.data) {
          const row = raced.data as unknown as ImageGenerationAttemptRow
          if (classifyExistingImageAttempt(row, fingerprint) === 'replay') return NextResponse.json({ attempt: toAttemptResponse(row), replayed: true })
          return errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'clientRequestId was already used for another submission.')
        }
      }
      return errorResponse(503, 'STORE_UNAVAILABLE', 'Attempt could not be created.')
    }
    return NextResponse.json({ attempt: toAttemptResponse(data as unknown as ImageGenerationAttemptRow), replayed: false }, { status: 201 })
  } catch {
    return errorResponse(500, 'INTERNAL_ERROR', 'Could not create Image generation attempt.')
  }
}
