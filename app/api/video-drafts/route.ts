import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { VideoScene } from '@/lib/types'
import {
  collectLibraryFileIds,
  validateSceneLibraryFileBindings,
} from '@/lib/video-scene-library-bindings'
import { validateSceneCompositionShape } from '@/lib/creative/video-editor/scene-composition'
import { validateSceneElementTimingShape } from '@/lib/creative/video-editor/element-timing'
import {
  persistedVideoTimeline, readVideoTimeline, timelineLibraryFileRefs, validateVideoTimeline, type VideoTimeline,
} from '@/lib/creative/video-editor/temporal-items'
import { isRenderableLibraryFile } from '@/lib/creative/integration/library-file-adapter'
import type { LibraryFileKind } from '@/lib/types'

async function validateProductionOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  productionId: unknown,
  projectId?: unknown,
): Promise<string | null> {
  if (!productionId || typeof productionId !== 'string') return null
  const { data, error } = await supabase
    .from('productions')
    .select('id, project_id')
    .eq('id', productionId)
    .eq('user_id', userId)
    .single()
  if (error || !data) return 'Production não encontrada ou acesso negado.'
  if (projectId && typeof projectId === 'string' && data.project_id !== projectId) {
    return 'Production não pertence a este Projeto.'
  }
  return null
}

async function validateProjectOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: unknown,
): Promise<boolean> {
  if (typeof projectId !== 'string' || !projectId.trim()) return false
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()
  return !error && Boolean(data)
}

async function validateSceneBindings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string | null | undefined,
  scenes: VideoScene[],
) {
  const ids = collectLibraryFileIds(scenes)
  if (ids.length === 0) {
    return validateSceneLibraryFileBindings(scenes, projectId, [])
  }

  const { data, error } = await supabase
    .from('library_files')
    .select('id, project_id, deleted_at')
    .eq('user_id', userId)
    .in('id', ids)

  if (error) {
    return {
      valid: false as const,
      error: {
        code: 'LIBRARY_FILE_NOT_FOUND' as const,
        message: 'Não foi possível validar os LibraryFiles das cenas.',
      },
    }
  }

  return validateSceneLibraryFileBindings(scenes, projectId, data || [])
}

function sceneBindingErrorResponse(error: { code: string; message: string }) {
  return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
}

/** VIDEO_SCENE_COMPOSITION_PARITY_V1 — structural check of each Scene's authored composition. */
function sceneCompositionErrorResponse(scenes: unknown[]) {
  for (const [index, scene] of scenes.entries()) {
    const composition = typeof scene === 'object' && scene !== null ? (scene as { composition?: unknown }).composition : undefined
    const check = validateSceneCompositionShape(composition)
    if (!check.ok) return NextResponse.json({ error: `Cena ${index + 1}: ${check.message}`, code: 'SCENE_COMPOSITION_INVALID' }, { status: 400 })
    // VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1: Scene-local element timing (structure only; ids resolve per layout).
    const elementTiming = typeof scene === 'object' && scene !== null ? (scene as { element_timing?: unknown }).element_timing : undefined
    const timingCheck = validateSceneElementTimingShape(elementTiming)
    if (!timingCheck.ok) return NextResponse.json({ error: `Cena ${index + 1}: ${timingCheck.message}`, code: 'SCENE_ELEMENT_TIMING_INVALID' }, { status: 400 })
  }
  return null
}

/**
 * VIDEO_TIMELINE_GATE_B — the independent temporal layer: structure, then
 * every referenced LibraryFile must belong to the draft's Project (owner-scoped,
 * not trashed) and be a kind the item can render (B-roll: image/video; audio:
 * audio). Returns the value to persist (null = no items) or an error response.
 */
async function validateTimelineBody(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string | null | undefined,
  raw: unknown,
): Promise<{ ok: true; value: VideoTimeline | null } | { ok: false; response: NextResponse }> {
  const shape = validateVideoTimeline(raw)
  if (!shape.ok) return { ok: false, response: NextResponse.json({ error: shape.message, code: 'TIMELINE_INVALID' }, { status: 400 }) }
  const timeline = readVideoTimeline(raw)
  const refs = timelineLibraryFileRefs(timeline)
  if (refs.length > 0) {
    if (!projectId) return { ok: false, response: NextResponse.json({ error: 'A timeline usa arquivos da Biblioteca e precisa de um Projeto.', code: 'TIMELINE_PROJECT_REQUIRED' }, { status: 400 }) }
    const { data, error } = await supabase
      .from('library_files')
      .select('id, project_id, kind, mime_type, deleted_at')
      .eq('user_id', userId)
      .in('id', [...new Set(refs.map((ref) => ref.id))])
    if (error) return { ok: false, response: NextResponse.json({ error: 'Não foi possível validar os arquivos da timeline.', code: 'TIMELINE_FILES_UNVERIFIED' }, { status: 500 }) }
    const files = new Map((data ?? []).map((file) => [file.id as string, file]))
    for (const ref of refs) {
      const file = files.get(ref.id)
      if (!file || file.deleted_at || file.project_id !== projectId) {
        return { ok: false, response: NextResponse.json({ error: 'Arquivo da timeline não encontrado neste Projeto.', code: 'TIMELINE_FILE_NOT_FOUND' }, { status: 400 }) }
      }
      const renderable = isRenderableLibraryFile(file as { kind: LibraryFileKind; mime_type: string | null })
      const kindOk = ref.kind === 'audio' ? file.kind === 'audio' : file.kind === 'image' || file.kind === 'video'
      if (!renderable || !kindOk) {
        return { ok: false, response: NextResponse.json({ error: `Arquivo da timeline não suportado para ${ref.kind === 'audio' ? 'áudio' : 'B-roll'}.`, code: 'TIMELINE_FILE_KIND' }, { status: 400 }) }
      }
    }
  }
  return { ok: true, value: persistedVideoTimeline(timeline) }
}

function getDraftName(name: unknown, scenes: VideoScene[]) {
  if (typeof name === 'string' && name.trim()) {
    return name.trim()
  }

  const firstSceneDescription = scenes
    .find((scene) => scene.description?.trim())
    ?.description.trim()

  return firstSceneDescription?.slice(0, 50) || 'Rascunho sem titulo'
}

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { supabase, user: null }
  }

  return { supabase, user }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const limit = Number(searchParams.get('limit') || 5)
    const productionId = searchParams.get('productionId')

    if (id) {
      const { data, error } = await supabase
        .from('video_drafts')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        return NextResponse.json(
          { error: error.message, details: error },
          { status: 400 },
        )
      }

      return NextResponse.json({ draft: data })
    }

    // Validate UUID format when productionId filter is used
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (productionId && !UUID_RE.test(productionId)) {
      return NextResponse.json({ error: 'productionId inválido.' }, { status: 400 })
    }

    let query = supabase
      .from('video_drafts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (productionId) {
      // No pagination infrastructure yet; 200 is a defensive cap for MVP
      query = query.eq('production_id', productionId).limit(200)
    } else {
      query = query.limit(Number.isFinite(limit) ? limit : 5)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 400 },
      )
    }

    return NextResponse.json({ drafts: data || [] })
  } catch (error) {
    console.error('[Video Drafts GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const scenes = Array.isArray(body.scenes) ? body.scenes : []
    const name = getDraftName(body.name, scenes)
    const compositionError = sceneCompositionErrorResponse(scenes)
    if (compositionError) return compositionError

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!body.productionId || typeof body.productionId !== 'string') {
      return NextResponse.json({ error: 'Production obrigatória.', code: 'PRODUCTION_REQUIRED' }, { status: 422 })
    }
    if (!UUID_RE.test(body.productionId)) {
      return NextResponse.json({ error: 'productionId inválido.', code: 'INVALID_PRODUCTION_ID' }, { status: 400 })
    }
    const { data: production, error: productionError } = await supabase
      .from('productions')
      .select('id, project_id')
      .eq('id', body.productionId)
      .eq('user_id', user.id)
      .single()
    if (productionError || !production) {
      return NextResponse.json({ error: 'Production não encontrada ou acesso negado.', code: 'PRODUCTION_NOT_FOUND' }, { status: 404 })
    }
    if (body.projectId && typeof body.projectId === 'string' && body.projectId !== production.project_id) {
      return NextResponse.json({ error: 'Production não pertence a este Projeto.', code: 'PROJECT_PRODUCTION_MISMATCH' }, { status: 409 })
    }

    const bindingValidation = await validateSceneBindings(
      supabase,
      user.id,
      production.project_id,
      scenes as VideoScene[],
    )
    if (!bindingValidation.valid) return sceneBindingErrorResponse(bindingValidation.error)

    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      name,
      project_id: production.project_id,
      production_id: production.id,
      scenes,
    }
    // Gate B: the independent temporal layer (only written when the client sends it).
    if (Object.hasOwn(body, 'timeline')) {
      const timeline = await validateTimelineBody(supabase, user.id, production.project_id, body.timeline)
      if (!timeline.ok) return timeline.response
      insertPayload.timeline = timeline.value
    }

    const { data, error } = await supabase
      .from('video_drafts')
      .insert(insertPayload)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 400 },
      )
    }

    return NextResponse.json({ draft: data })
  } catch (error) {
    console.error('[Video Drafts POST] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID do rascunho obrigatorio' },
        { status: 400 },
      )
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('video_drafts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 400 },
      )
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Rascunho não encontrado.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Video Drafts DELETE] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { error: 'ID do rascunho obrigatorio' },
        { status: 400 },
      )
    }

    // Mode: only update production_id (link/unlink)
    if (body.linkOnly === true) {
      const allowedKeys = new Set(['id', 'productionId', 'linkOnly'])
      const extraKeys = Object.keys(body).filter((k) => !allowedKeys.has(k))
      if (extraKeys.length > 0) {
        return NextResponse.json({ error: 'Campos não permitidos em modo linkOnly.' }, { status: 400 })
      }

      if (body.productionId) {
        const { data: artifact } = await supabase
          .from('video_drafts')
          .select('project_id')
          .eq('id', body.id)
          .eq('user_id', user.id)
          .single()
        const validationError = await validateProductionOwnership(
          supabase, user.id, body.productionId, artifact?.project_id,
        )
        if (validationError) {
          return NextResponse.json({ error: validationError }, { status: 400 })
        }
      }
      const { data, error } = await supabase
        .from('video_drafts')
        .update({ production_id: body.productionId || null })
        .eq('id', body.id)
        .eq('user_id', user.id)
        .select()
        .single()
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ draft: data })
    }

    if (Object.hasOwn(body, 'productionId') && body.productionId !== null && body.productionId !== '' && typeof body.productionId !== 'string') {
      return NextResponse.json({ error: 'productionId inválido.', code: 'INVALID_PRODUCTION_ID' }, { status: 400 })
    }

    const { data: existingDraft, error: existingDraftError } = await supabase
      .from('video_drafts')
      .select('project_id, production_id')
      .eq('id', body.id)
      .eq('user_id', user.id)
      .single()
    if (existingDraftError || !existingDraft) {
      return NextResponse.json({ error: 'Rascunho não encontrado.' }, { status: 404 })
    }

    let authoritativeProjectId: string | null = existingDraft.project_id
    if (Object.hasOwn(body, 'productionId') && body.productionId) {
      const { data: production, error: productionError } = await supabase
        .from('productions')
        .select('id, project_id')
        .eq('id', body.productionId)
        .eq('user_id', user.id)
        .single()
      if (productionError || !production) {
        return NextResponse.json({ error: 'Production não encontrada ou acesso negado.', code: 'PRODUCTION_NOT_FOUND' }, { status: 400 })
      }
      authoritativeProjectId = production.project_id
      if (body.projectId && typeof body.projectId === 'string' && body.projectId !== authoritativeProjectId) {
        return NextResponse.json({ error: 'Production não pertence a este Projeto.', code: 'PROJECT_PRODUCTION_MISMATCH' }, { status: 409 })
      }
    } else if (Object.hasOwn(body, 'projectId')) {
      if (body.projectId === null || body.projectId === '') {
        authoritativeProjectId = null
      } else {
        const projectOwned = await validateProjectOwnership(supabase, user.id, body.projectId)
        if (!projectOwned) {
          return NextResponse.json({ error: 'Projeto não encontrado ou acesso negado.', code: 'PROJECT_NOT_FOUND' }, { status: 400 })
        }
        authoritativeProjectId = body.projectId as string
      }
    }

    const scenes = Array.isArray(body.scenes) ? body.scenes : []
    const name = getDraftName(body.name, scenes)
    const compositionError = sceneCompositionErrorResponse(scenes)
    if (compositionError) return compositionError

    const bindingValidation = await validateSceneBindings(
      supabase,
      user.id,
      authoritativeProjectId,
      scenes as VideoScene[],
    )
    if (!bindingValidation.valid) return sceneBindingErrorResponse(bindingValidation.error)

    const updatePayload: Record<string, unknown> = {
      name,
      project_id: authoritativeProjectId,
      scenes,
    }
    if (Object.hasOwn(body, 'productionId')) {
      updatePayload.production_id = body.productionId || null
    }
    // Gate B: absent = keep the stored layer (older clients never wipe it).
    if (Object.hasOwn(body, 'timeline')) {
      const timeline = await validateTimelineBody(supabase, user.id, authoritativeProjectId, body.timeline)
      if (!timeline.ok) return timeline.response
      updatePayload.timeline = timeline.value
    }

    const { data, error } = await supabase
      .from('video_drafts')
      .update(updatePayload)
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 400 },
      )
    }

    return NextResponse.json({ draft: data })
  } catch (error) {
    console.error('[Video Drafts PATCH] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
