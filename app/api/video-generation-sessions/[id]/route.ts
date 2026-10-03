import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import {
  CreateSessionBodySchema,
  PatchSessionBodySchema,
  SESSION_COLUMNS,
  SessionWorkingStateSchema,
  formatValidationIssues,
  isUuid,
  readBoundedJsonBody,
  splitWorkingState,
  toSessionResponse,
  type SessionRow,
} from '@/lib/video-generation/session'

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1
//
// A VideoGenerationSession is the mutable, resumable WORKING STATE of a video generation. It is not an attempt:
// Generate never reads it (POST /api/video-generations takes the complete request in its body), and editing it
// never touches a submitted VideoGeneration.
//
//   GET    read one Session. Read is read: it writes nothing (not even updated_at).
//   PUT    idempotent CREATE at a client-chosen UUID. First call creates; a repeat by the same owner for the same
//          Project/Production returns the stored Session UNCHANGED (it is not an overwrite, so it cannot bypass
//          the version check below); another owner's id behaves like "not found".
//   PATCH  replace the working state, guarded by `expectedUpdatedAt` (the `updatedAt` the client last saw).
//          Stale token -> 409 with the current Session. There is no last-write-wins.
//   DELETE intentionally absent in V1.
//
// Writes are SERVER-owned (the user session only has SELECT, see scripts/049): the server resolves the user,
// proves Project/Production ownership, validates the document and then writes with the service role, always
// stamping user_id from the verified session. Project, Production, user and id can never be changed.
const IMMUTABLE_FIELDS = ['id', 'userId', 'user_id', 'projectId', 'project_id', 'productionId', 'production_id'] as const

function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status })
}
const notFound = () => jsonError(404, 'SESSION_NOT_FOUND', 'Sessão não encontrada.')
const storeUnavailable = () => jsonError(503, 'STORE_UNAVAILABLE', 'Não foi possível acessar a sessão agora. Tente novamente.')

function parseWorkingState(raw: unknown) {
  const parsed = SessionWorkingStateSchema.safeParse(raw)
  if (parsed.success) return { ok: true as const, state: parsed.data }
  const version = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).schemaVersion : undefined
  const unsupported = version !== undefined && version !== 1
  return {
    ok: false as const,
    response: jsonError(
      400,
      unsupported ? 'UNSUPPORTED_SCHEMA_VERSION' : 'INVALID_WORKING_STATE',
      unsupported ? 'Unsupported working state schemaVersion.' : 'The working state is not valid.',
      { issues: formatValidationIssues(parsed.error) },
    ),
  }
}

async function authenticate() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return error || !user ? { supabase, user: null } : { supabase, user }
}

async function loadOwnSession(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data, error } = await supabase.from('video_generation_sessions').select(SESSION_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
  return { row: (data ?? null) as unknown as SessionRow | null, error }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isUuid(id)) return notFound()

    const { row, error } = await loadOwnSession(supabase, user.id, id)
    if (error) return storeUnavailable()
    if (!row) return notFound()
    return NextResponse.json({ session: toSessionResponse(row) })
  } catch {
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno ao carregar a sessão.')
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isUuid(id)) return jsonError(400, 'INVALID_SESSION_ID', 'sessionId must be a UUID.')

    const read = await readBoundedJsonBody(req)
    if (!read.ok) return jsonError(read.status, read.code, read.message)
    const body = CreateSessionBodySchema.safeParse(read.body)
    if (!body.success) return jsonError(400, 'INVALID_BODY', 'Invalid request body.', { issues: formatValidationIssues(body.error) })
    const state = parseWorkingState(body.data.workingState)
    if (!state.ok) return state.response
    const { projectId, productionId } = body.data

    // The browser-supplied ids are never trusted: the Production must belong to THIS user AND to the given Project.
    const { data: ownedProduction, error: productionError } = await supabase
      .from('productions')
      .select('id')
      .eq('id', productionId)
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (productionError) return storeUnavailable()
    if (!ownedProduction) return jsonError(403, 'PRODUCTION_NOT_FOUND', 'Production não encontrada neste projeto.')

    const settle = (row: SessionRow) =>
      row.project_id === projectId && row.production_id === productionId
        ? NextResponse.json({ session: toSessionResponse(row), created: false })
        : jsonError(409, 'SESSION_SCOPE_MISMATCH', 'Esta sessão pertence a outro projeto ou production.')

    const existing = await loadOwnSession(supabase, user.id, id)
    if (existing.error) return storeUnavailable()
    if (existing.row) return settle(existing.row)

    const { error: insertError, data: inserted } = await createServiceRoleSupabase()
      .from('video_generation_sessions')
      .insert({ id, user_id: user.id, project_id: projectId, production_id: productionId, ...splitWorkingState(state.state) })
      .select(SESSION_COLUMNS)
      .single()

    if (insertError || !inserted) {
      if ((insertError as { code?: string } | null)?.code === '23505') {
        // Lost a create race with ourselves (retry/autosave) -> settle on the stored row.
        // Someone else's id is invisible to this user -> indistinguishable from "not found".
        const raced = await loadOwnSession(supabase, user.id, id)
        if (raced.error) return storeUnavailable()
        return raced.row ? settle(raced.row) : notFound()
      }
      return storeUnavailable()
    }
    return NextResponse.json({ session: toSessionResponse(inserted as unknown as SessionRow), created: true }, { status: 201 })
  } catch {
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno ao criar a sessão.')
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isUuid(id)) return notFound()

    const read = await readBoundedJsonBody(req)
    if (!read.ok) return jsonError(read.status, read.code, read.message)
    const immutable = IMMUTABLE_FIELDS.find((field) => field in read.body)
    if (immutable) return jsonError(400, 'IMMUTABLE_FIELD', `"${immutable}" cannot be changed.`)
    const body = PatchSessionBodySchema.safeParse(read.body)
    if (!body.success) return jsonError(400, 'INVALID_BODY', 'Invalid request body.', { issues: formatValidationIssues(body.error) })
    const state = parseWorkingState(body.data.workingState)
    if (!state.ok) return state.response

    // Compare-and-swap: the row only changes if it is still at the version the client hydrated (the trigger then
    // moves updated_at to a new value). Only the two working columns are ever written.
    const { data: updated, error: updateError } = await createServiceRoleSupabase()
      .from('video_generation_sessions')
      .update(splitWorkingState(state.state))
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('updated_at', body.data.expectedUpdatedAt)
      .select(SESSION_COLUMNS)
      .maybeSingle()
    if (updateError) return storeUnavailable()
    if (updated) return NextResponse.json({ session: toSessionResponse(updated as unknown as SessionRow) })

    const current = await loadOwnSession(supabase, user.id, id)
    if (current.error) return storeUnavailable()
    if (!current.row) return notFound()
    return jsonError(409, 'SESSION_VERSION_CONFLICT', 'A sessão foi alterada por outra gravação. Recarregue antes de salvar.', {
      session: toSessionResponse(current.row),
    })
  } catch {
    return jsonError(500, 'INTERNAL_ERROR', 'Erro interno ao salvar a sessão.')
  }
}
