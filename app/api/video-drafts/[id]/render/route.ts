import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '@/lib/project-identity-normalizer'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { buildRenderExecutionSnapshot, assertSnapshotHasNoSignedUrl } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { readVideoTimeline, timelineLibraryFileRefs } from '@/lib/creative/video-editor/temporal-items'
import { isRenderableLibraryFile } from '@/lib/creative/integration/library-file-adapter'
import { collectLibraryFileIds, validateSceneLibraryFileBindings } from '@/lib/video-scene-library-bindings'
import type { LibraryFileKind, VideoScene } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDEMPOTENCY_KEY_LENGTH = 128

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Execution insertion is intentionally server-privileged: an execution
 * snapshot is a future worker command and must never be insertable with the
 * browser's authenticated Supabase client.  This function lives in a route
 * module (not a client-importable library), and the key has no NEXT_PUBLIC_
 * prefix, so it cannot enter a browser bundle.
 */
function createRenderExecutionWriteClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null

  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

function parseIdempotencyKey(body: unknown): { ok: true; key: string | null } | { ok: false } {
  if (body === null || typeof body !== 'object') return { ok: true, key: null }
  const raw = (body as Record<string, unknown>).idempotencyKey
  if (raw === undefined || raw === null) return { ok: true, key: null }
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return { ok: false }
  }
  return { ok: true, key: raw.trim() }
}

/**
 * POST /api/video-drafts/:id/render
 *
 * Creates one queued render_execution for a VideoDraft. Per
 * PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md §5/§17: the browser submits only
 * the VideoDraft id (route param) and an optional idempotency key -- never a
 * Project id, TimelineManifest, ResolvedTimelineInput, signed URL, storage
 * path, or any execution-authority field. Every authoritative value below is
 * re-derived server-side from freshly-fetched, ownership-checked rows.
 *
 * Does NOT execute Remotion, contact the VPS, or write to MinIO -- this
 * route only persists a queued row; a future worker (2I-B2+) claims it.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID do rascunho invalido.', code: 'INVALID_VIDEO_DRAFT_ID' }, { status: 400 })
    }

    const { supabase, user } = await getAuthenticatedClient()
    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    let rawBody: unknown = null
    try {
      const text = await request.text()
      rawBody = text ? JSON.parse(text) : null
    } catch {
      return NextResponse.json({ error: 'Corpo da requisicao invalido.', code: 'INVALID_BODY' }, { status: 400 })
    }
    const idempotency = parseIdempotencyKey(rawBody)
    if (!idempotency.ok) {
      return NextResponse.json({ error: 'idempotencyKey invalido.', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 })
    }
    const idempotencyKey = idempotency.key

    // Keep all execution-row reads and writes behind a server-only client.
    // Browser roles cannot bypass the GET safe projection to inspect the
    // immutable snapshot or worker/internal columns.
    const executionAdmin = createRenderExecutionWriteClient()
    if (!executionAdmin) {
      console.error('[Video Draft Render POST] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' }, { status: 503 })
    }

    // Idempotency fast path: an accidental double-submit of the SAME user
    // gesture (same key) reuses the existing row rather than creating a
    // duplicate. Two deliberate renders use two different keys (or omit the
    // key entirely) and are never deduplicated by this check.
    if (idempotencyKey) {
      const { data: existing } = await executionAdmin
        .from('render_executions')
        .select('id, status, queued_at')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ executionId: existing.id, status: existing.status, queuedAt: existing.queued_at, reused: true })
      }
    }

    // 1. Load the VideoDraft, ownership-scoped -- the only client-authored
    // authority accepted anywhere in this route is this route param.
    const { data: draft, error: draftError } = await supabase
      .from('video_drafts')
      .select('id, user_id, project_id, production_id, scenes, timeline')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (draftError || !draft) {
      return NextResponse.json({ error: 'Rascunho nao encontrado.', code: 'VIDEO_DRAFT_NOT_FOUND' }, { status: 404 })
    }
    if (!draft.project_id) {
      return NextResponse.json({ error: 'O rascunho precisa pertencer a um Projeto para ser renderizado.', code: 'VIDEO_DRAFT_PROJECT_REQUIRED' }, { status: 409 })
    }
    if (!draft.production_id) {
      return NextResponse.json({ error: 'O rascunho precisa pertencer a uma Producao para ser renderizado.', code: 'VIDEO_DRAFT_PRODUCTION_REQUIRED' }, { status: 409 })
    }

    const scenes = Array.isArray(draft.scenes) ? (draft.scenes as VideoScene[]) : []
    if (scenes.length === 0) {
      return NextResponse.json({ error: 'O rascunho nao possui cenas.', code: 'VIDEO_DRAFT_EMPTY' }, { status: 409 })
    }

    // 2. Derive the authoritative Project context server-side (never from
    // a client-supplied project id) and confirm ownership independently.
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, identity')
      .eq('id', draft.project_id)
      .eq('user_id', user.id)
      .single()
    if (projectError || !project) {
      return NextResponse.json({ error: 'Projeto nao encontrado ou nao autorizado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
    }

    let projectIdentity
    try {
      projectIdentity = normalizeProjectIdentity(project.identity)
    } catch (error) {
      if (error instanceof ProjectIdentityParseError) {
        return NextResponse.json({ error: 'Identidade do Projeto invalida.', code: 'PROJECT_IDENTITY_INVALID' }, { status: 409 })
      }
      throw error
    }
    if (!projectIdentity) {
      return NextResponse.json({ error: 'Projeto sem identidade valida.', code: 'PROJECT_IDENTITY_REQUIRED' }, { status: 409 })
    }

    // 3. Validate scene -> LibraryFile bindings server-side, reusing the
    // exact same helper video-drafts autosave already enforces (defense in
    // depth -- claim-time revalidation happens again in a later phase).
    const libraryFileIds = collectLibraryFileIds(scenes)
    let libraryFileRecords: Array<{ id: string; project_id: string | null; deleted_at: string | null }> = []
    if (libraryFileIds.length > 0) {
      const { data: files, error: filesError } = await supabase
        .from('library_files')
        .select('id, project_id, deleted_at')
        .eq('user_id', user.id)
        .in('id', libraryFileIds)
      if (filesError) {
        return NextResponse.json({ error: 'Nao foi possivel validar os LibraryFiles das cenas.', code: 'LIBRARY_FILE_VALIDATION_FAILED' }, { status: 500 })
      }
      libraryFileRecords = files || []
    }
    const bindingValidation = validateSceneLibraryFileBindings(scenes, draft.project_id, libraryFileRecords)
    if (!bindingValidation.valid) {
      return NextResponse.json({ error: bindingValidation.error.message, code: bindingValidation.error.code }, { status: 400 })
    }

    // 3b. VIDEO_TIMELINE_GATE_B: the independent layer's media must be renderable
    // files of this Project (claim would otherwise only warn and drop the layer).
    const timeline = readVideoTimeline(draft.timeline)
    const timelineRefs = timelineLibraryFileRefs(timeline)
    if (timelineRefs.length > 0) {
      const { data: timelineFiles, error: timelineFilesError } = await supabase
        .from('library_files')
        .select('id, project_id, kind, mime_type, deleted_at')
        .eq('user_id', user.id)
        .in('id', [...new Set(timelineRefs.map((ref) => ref.id))])
      if (timelineFilesError) {
        return NextResponse.json({ error: 'Nao foi possivel validar os arquivos da timeline.', code: 'LIBRARY_FILE_VALIDATION_FAILED' }, { status: 500 })
      }
      const byId = new Map((timelineFiles ?? []).map((file) => [file.id as string, file]))
      const broken = timelineRefs.find((ref) => {
        const file = byId.get(ref.id)
        return !file || file.deleted_at || file.project_id !== draft.project_id || !isRenderableLibraryFile(file as { kind: LibraryFileKind; mime_type: string | null })
      })
      if (broken) {
        return NextResponse.json({ error: 'Um arquivo da timeline nao esta disponivel neste Projeto.', code: 'TIMELINE_FILE_UNAVAILABLE' }, { status: 409 })
      }
    }

    // 4. Build the authoritative, signed-URL-free snapshot (Task 5/7/8).
    const identitySnapshot = adaptProjectIdentityToVisualTokens(project.id, projectIdentity)
    let snapshotResult: ReturnType<typeof buildRenderExecutionSnapshot>
    try {
      snapshotResult = buildRenderExecutionSnapshot({
        draft: { id: draft.id, project_id: draft.project_id, production_id: draft.production_id, scenes, timeline },
        identitySnapshot,
      })
      assertSnapshotHasNoSignedUrl(snapshotResult.snapshot)
    } catch (error) {
      return NextResponse.json(
        { error: 'Nao foi possivel construir o snapshot de renderizacao.', code: 'SNAPSHOT_CONSTRUCTION_FAILED', details: error instanceof Error ? error.message : undefined },
        { status: 500 },
      )
    }

    // 4b. VIDEO_SCENE_COMPOSITION_PARITY_V1: Scenes carry authored content, so
    // validate the frozen manifest against the Template NOW (the same check the
    // worker's claim runs) instead of enqueueing work that can only fail later.
    const manifestCheck = resolveTimelineManifest(snapshotResult.snapshot.manifest, { identitySnapshot })
    if (!manifestCheck.valid) {
      return NextResponse.json(
        { error: `Composição inválida para renderizar: ${manifestCheck.errors.map((issue) => issue.message).join('; ')}`.slice(0, 500), code: 'SCENE_COMPOSITION_INVALID' },
        { status: 422 },
      )
    }

    // 5. Insert through the server-only service-role client. The regular
    // authenticated client above deliberately has no INSERT authority on
    // this table: otherwise a browser could forge `input_snapshot` and
    // enqueue worker work without passing through this validation boundary.
    const { data: execution, error: insertError } = await executionAdmin
      .from('render_executions')
      .insert({
        user_id: user.id,
        project_id: draft.project_id,
        video_draft_id: draft.id,
        status: 'queued',
        input_schema_version: snapshotResult.snapshot.manifest.schema_version,
        input_snapshot: snapshotResult.snapshot,
        idempotency_key: idempotencyKey,
      })
      .select('id, status, queued_at')
      .single()

    if (insertError) {
      // Race: two near-simultaneous requests carrying the SAME idempotency
      // key both pass the pre-check above; the unique index resolves the
      // conflict -- re-select and reuse rather than surface a 500.
      if (idempotencyKey && insertError.code === '23505') {
        const { data: raced } = await executionAdmin
          .from('render_executions')
          .select('id, status, queued_at')
          .eq('user_id', user.id)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()
        if (raced) {
          return NextResponse.json({ executionId: raced.id, status: raced.status, queuedAt: raced.queued_at, reused: true })
        }
      }
      return NextResponse.json({ error: insertError.message, code: 'RENDER_EXECUTION_INSERT_FAILED' }, { status: 500 })
    }

    return NextResponse.json(
      { executionId: execution.id, status: execution.status, queuedAt: execution.queued_at, reused: false },
      { status: 201 },
    )
  } catch (error) {
    console.error('[Video Draft Render POST] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
