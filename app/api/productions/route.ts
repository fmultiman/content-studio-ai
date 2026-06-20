import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ProductionType } from '@/lib/types'

const VALID_TYPES: ProductionType[] = ['editorial', 'branding', 'campaign']

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
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'projectId obrigatorio' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('productions')
      .select('*')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ productions: data || [] })
  } catch (error) {
    console.error('[Productions] GET error:', error)
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

    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const intention = typeof body.intention === 'string' ? body.intention.trim() : ''

    if (!projectId) {
      return NextResponse.json({ error: 'projectId obrigatorio' }, { status: 400 })
    }
    if (!title) {
      return NextResponse.json({ error: 'title obrigatorio' }, { status: 400 })
    }
    if (!intention) {
      return NextResponse.json({ error: 'intention obrigatoria' }, { status: 400 })
    }
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json(
        { error: `type invalido. Valores aceitos: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    const type: ProductionType = body.type

    const { data, error } = await supabase
      .from('productions')
      .insert({ user_id: user.id, project_id: projectId, title, intention, type })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ production: data }, { status: 201 })
  } catch (error) {
    console.error('[Productions] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
