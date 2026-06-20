import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ProductionType } from '@/lib/types'

const VALID_TYPES: ProductionType[] = ['editorial', 'branding', 'campaign']
const ALLOWED_PATCH_KEYS = new Set(['title', 'intention', 'type'])

type RouteContext = {
  params: Promise<{ id: string }>
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('productions')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Production nao encontrada' }, { status: 404 })
      }
      console.error('[Productions] GET/id error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ production: data })
  } catch (error) {
    console.error('[Productions] GET/id error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Body invalido: JSON esperado' }, { status: 400 })
    }

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_PATCH_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    const update: Partial<{ title: string; intention: string; type: ProductionType }> = {}

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title) {
        return NextResponse.json({ error: 'title nao pode ser vazio' }, { status: 400 })
      }
      update.title = title
    }

    if (body.intention !== undefined) {
      const intention = typeof body.intention === 'string' ? body.intention.trim() : ''
      if (!intention) {
        return NextResponse.json({ error: 'intention nao pode ser vazia' }, { status: 400 })
      }
      update.intention = intention
    }

    if (body.type !== undefined) {
      if (!VALID_TYPES.includes(body.type as ProductionType)) {
        return NextResponse.json(
          { error: `type invalido. Valores aceitos: ${VALID_TYPES.join(', ')}` },
          { status: 400 },
        )
      }
      update.type = body.type as ProductionType
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo editavel enviado' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('productions')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Production nao encontrada' }, { status: 404 })
      }
      console.error('[Productions] PATCH error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ production: data })
  } catch (error) {
    console.error('[Productions] PATCH error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { data: deleted, error } = await supabase
      .from('productions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')

    if (error) {
      console.error('[Productions] DELETE error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Production nao encontrada' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Productions] DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
