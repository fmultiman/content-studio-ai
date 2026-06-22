import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function getDraftName(name: unknown, userInput: unknown) {
  if (typeof name === 'string' && name.trim()) {
    return name.trim()
  }

  if (typeof userInput === 'string' && userInput.trim()) {
    return userInput.split('\n')[0].trim().slice(0, 50)
  }

  return 'Rascunho sem titulo'
}

function isMissingPromptPtColumn(error: { message?: string; details?: string; code?: string } | null) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return text.includes('generated_prompt_pt') || error?.code === 'PGRST204'
}

function isMissingCurrentImageIdColumn(error: { message?: string; details?: string; code?: string } | null) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return text.includes('current_image_id') || error?.code === 'PGRST204'
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

function buildDraftPayload(body: Record<string, unknown>, includePromptPt = true) {
  const payload: Record<string, unknown> = {
    name: getDraftName(body.name, body.userInput),
    project_id: body.projectId || null,
    user_input: typeof body.userInput === 'string' ? body.userInput : '',
    generated_prompt: body.generatedPrompt || null,
    auto_mode: Boolean(body.autoMode),
    selected_model: body.selectedModel || null,
    prompt_details: body.promptDetails || null,
    current_evaluation: body.currentEvaluation || null,
    generation_attempts: Array.isArray(body.generationAttempts)
      ? body.generationAttempts
      : [],
    current_attempt:
      typeof body.currentAttempt === 'number' ? body.currentAttempt : 1,
    image_status: body.imageStatus || 'draft',
  }

  if (Object.hasOwn(body, 'productionId')) {
    payload.production_id = body.productionId || null
  }

  if (Object.hasOwn(body, 'imageUrl')) {
    payload.image_url = body.imageUrl || null
  }

  if (typeof body.currentImageId === 'string' && body.currentImageId) {
    payload.current_image_id = body.currentImageId
  }

  if (includePromptPt) {
    payload.generated_prompt_pt = body.generatedPromptPt || null
  }

  return payload
}

async function attachImageFromReference(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const currentImageId = body.currentImageId

  if (typeof currentImageId !== 'string' || !currentImageId) {
    return payload
  }

  const { data: image } = await supabase
    .from('images')
    .select('image_url')
    .eq('id', currentImageId)
    .eq('user_id', userId)
    .single()

  if (image?.image_url) {
    payload.image_url = image.image_url
  }

  return payload
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const limit = searchParams.get('limit')

    if (id) {
      const { data, error } = await supabase
        .from('image_drafts')
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

    const productionId = searchParams.get('productionId')

    // Validate UUID format when productionId filter is used
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (productionId && !UUID_RE.test(productionId)) {
      return NextResponse.json({ error: 'productionId inválido.' }, { status: 400 })
    }

    let query = supabase
      .from('image_drafts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (productionId) {
      // No pagination infrastructure yet; 200 is a defensive cap for MVP
      query = query.eq('production_id', productionId).limit(200)
    } else if (limit) {
      const parsedLimit = Number(limit)
      query = query.limit(Number.isFinite(parsedLimit) ? parsedLimit : 5)
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
    console.error('[Image Drafts GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

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

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await request.json()

    if (!body.userInput?.trim() && !body.generatedPrompt?.trim()) {
      return NextResponse.json(
        { error: 'Conteudo do rascunho obrigatorio' },
        { status: 400 },
      )
    }

    if (body.productionId) {
      const validationError = await validateProductionOwnership(supabase, user.id, body.productionId, body.projectId)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    const payload = await attachImageFromReference(supabase, user.id, body, {
      user_id: user.id,
      ...buildDraftPayload(body),
    })

    let result = await supabase
      .from('image_drafts')
      .insert(payload)
      .select()
      .single()

    if (result.error && (isMissingPromptPtColumn(result.error) || isMissingCurrentImageIdColumn(result.error))) {
      result = await supabase
        .from('image_drafts')
        .insert({
          user_id: user.id,
          ...(await attachImageFromReference(
            supabase,
            user.id,
            body,
            Object.fromEntries(
              Object.entries(buildDraftPayload(body, false)).filter(
                ([key]) => key !== 'current_image_id',
              ),
            ),
          )),
        })
        .select()
        .single()
    }

    if (result.error) {
      return NextResponse.json(
        { error: result.error.message, details: result.error },
        { status: 400 },
      )
    }

    return NextResponse.json({ draft: result.data })
  } catch (error) {
    console.error('[Image Drafts POST] Error:', error)
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

    // Mode: only update production_id (link/unlink), no full draft overwrite
    if (body.linkOnly === true) {
      const allowedKeys = new Set(['id', 'productionId', 'linkOnly'])
      const extraKeys = Object.keys(body).filter((k) => !allowedKeys.has(k))
      if (extraKeys.length > 0) {
        return NextResponse.json({ error: 'Campos não permitidos em modo linkOnly.' }, { status: 400 })
      }

      if (body.productionId) {
        // Fetch artifact project_id to validate project coherence
        const { data: artifact } = await supabase
          .from('image_drafts')
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
        .from('image_drafts')
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

    const payload = await attachImageFromReference(
      supabase,
      user.id,
      body,
      buildDraftPayload(body),
    )

    let result = await supabase
      .from('image_drafts')
      .update(payload)
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (result.error && (isMissingPromptPtColumn(result.error) || isMissingCurrentImageIdColumn(result.error))) {
      result = await supabase
        .from('image_drafts')
        .update(
          await attachImageFromReference(
            supabase,
            user.id,
            body,
            Object.fromEntries(
              Object.entries(buildDraftPayload(body, false)).filter(
                ([key]) => key !== 'current_image_id',
              ),
            ),
          ),
        )
        .eq('id', body.id)
        .eq('user_id', user.id)
        .select()
        .single()
    }

    if (result.error) {
      return NextResponse.json(
        { error: result.error.message, details: result.error },
        { status: 400 },
      )
    }

    return NextResponse.json({ draft: result.data })
  } catch (error) {
    console.error('[Image Drafts PATCH] Error:', error)
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

    const { error } = await supabase
      .from('image_drafts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Image Drafts DELETE] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
