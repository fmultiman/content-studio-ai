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
    image_url: body.imageUrl || null,
    selected_model: body.selectedModel || null,
  }

  if (includePromptPt) {
    payload.generated_prompt_pt = body.generatedPromptPt || null
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

    let query = supabase
      .from('image_drafts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (limit) {
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

    const payload = {
      user_id: user.id,
      ...buildDraftPayload(body),
    }

    let result = await supabase
      .from('image_drafts')
      .insert(payload)
      .select()
      .single()

    if (result.error && isMissingPromptPtColumn(result.error)) {
      result = await supabase
        .from('image_drafts')
        .insert({
          user_id: user.id,
          ...buildDraftPayload(body, false),
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

    let result = await supabase
      .from('image_drafts')
      .update(buildDraftPayload(body))
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (result.error && isMissingPromptPtColumn(result.error)) {
      result = await supabase
        .from('image_drafts')
        .update(buildDraftPayload(body, false))
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
