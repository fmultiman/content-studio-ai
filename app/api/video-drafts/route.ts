import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { VideoScene } from '@/lib/types'

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

    let query = supabase
      .from('video_drafts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (productionId) {
      query = query.eq('production_id', productionId)
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

    if (body.productionId) {
      const validationError = await validateProductionOwnership(supabase, user.id, body.productionId, body.projectId)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    const insertPayload: Record<string, unknown> = {
      user_id: user.id,
      name,
      project_id: body.projectId || null,
      scenes,
    }
    if (Object.hasOwn(body, 'productionId')) {
      insertPayload.production_id = body.productionId || null
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
      if (body.productionId) {
        const validationError = await validateProductionOwnership(supabase, user.id, body.productionId)
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

    if (body.productionId) {
      const validationError = await validateProductionOwnership(supabase, user.id, body.productionId, body.projectId)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    const scenes = Array.isArray(body.scenes) ? body.scenes : []
    const name = getDraftName(body.name, scenes)

    const updatePayload: Record<string, unknown> = {
      name,
      project_id: body.projectId || null,
      scenes,
    }
    if (Object.hasOwn(body, 'productionId')) {
      updatePayload.production_id = body.productionId || null
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
