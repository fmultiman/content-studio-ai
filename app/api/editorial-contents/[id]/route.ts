import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EditorialContentStatus } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_EC_STATUSES: EditorialContentStatus[] = ['draft', 'ready', 'archived']

const ALLOWED_PATCH_KEYS = new Set([
  'title', 'body', 'aiContext', 'status', 'projectId', 'productionId',
])

type RouteContext = { params: Promise<{ id: string }> }

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('editorial_contents')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Conteudo editorial nao encontrado' }, { status: 404 })
      }
      console.error('[EditorialContents] GET/id error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ editorialContent: data })
  } catch (error) {
    console.error('[EditorialContents] GET/id error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Body invalido: JSON esperado' }, { status: 400 })
    }

    if (Array.isArray(body)) {
      return NextResponse.json({ error: 'Body invalido: objeto esperado' }, { status: 400 })
    }

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_PATCH_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'Body vazio: nenhum campo para atualizar' }, { status: 400 })
    }

    // Fetch current record to validate ownership and resolve cross-field dependencies
    const { data: current, error: fetchError } = await supabase
      .from('editorial_contents')
      .select('id, project_id, production_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Conteudo editorial nao encontrado' }, { status: 404 })
      }
      console.error('[EditorialContents] PATCH fetch error:', fetchError)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    const update: Record<string, unknown> = {}

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title) return NextResponse.json({ error: 'title nao pode ser vazio' }, { status: 400 })
      if (title.length > 500) return NextResponse.json({ error: 'title excede 500 caracteres' }, { status: 400 })
      update.title = title
    }

    if (body.body !== undefined) {
      if (body.body !== null && typeof body.body !== 'string') {
        return NextResponse.json({ error: 'body deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.body === 'string' && body.body.length > 50000) {
        return NextResponse.json({ error: 'body excede 50000 caracteres' }, { status: 400 })
      }
      update.body = body.body
    }

    if (body.aiContext !== undefined) {
      if (body.aiContext !== null && typeof body.aiContext !== 'string') {
        return NextResponse.json({ error: 'aiContext deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.aiContext === 'string' && body.aiContext.length > 5000) {
        return NextResponse.json({ error: 'aiContext excede 5000 caracteres' }, { status: 400 })
      }
      update.ai_context = body.aiContext
    }

    if (body.status !== undefined) {
      if (!VALID_EC_STATUSES.includes(body.status as EditorialContentStatus)) {
        return NextResponse.json(
          { error: `status invalido. Valores aceitos: ${VALID_EC_STATUSES.join(', ')}` },
          { status: 400 },
        )
      }
      update.status = body.status
    }

    // Determine final project_id (may change via projectId)
    let finalProjectId = current.project_id

    if (body.projectId !== undefined) {
      if (typeof body.projectId !== 'string' || !UUID_RE.test(body.projectId)) {
        return NextResponse.json({ error: 'projectId invalido' }, { status: 400 })
      }
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('id')
        .eq('id', body.projectId)
        .eq('user_id', user.id)
        .single()
      if (projErr || !project) {
        return NextResponse.json({ error: 'Projeto nao encontrado ou nao autorizado' }, { status: 400 })
      }
      finalProjectId = body.projectId
      update.project_id = finalProjectId
    }

    // Resolve final production_id
    if (body.productionId !== undefined) {
      if (body.productionId === null) {
        update.production_id = null
      } else if (typeof body.productionId === 'string') {
        if (!UUID_RE.test(body.productionId)) {
          return NextResponse.json({ error: 'productionId invalido' }, { status: 400 })
        }
        const { data: production, error: prodErr } = await supabase
          .from('productions')
          .select('id, project_id')
          .eq('id', body.productionId)
          .eq('user_id', user.id)
          .single()
        if (prodErr || !production) {
          return NextResponse.json({ error: 'Production nao encontrada ou nao autorizada' }, { status: 400 })
        }
        if (production.project_id !== finalProjectId) {
          return NextResponse.json({ error: 'Production nao pertence ao Projeto final' }, { status: 400 })
        }
        update.production_id = body.productionId
      } else {
        return NextResponse.json({ error: 'productionId deve ser string ou null' }, { status: 400 })
      }
    } else if (body.projectId !== undefined) {
      // projectId changed but productionId not sent: re-validate existing production vs new project
      const currentProductionId = current.production_id
      if (currentProductionId) {
        const { data: production, error: prodErr } = await supabase
          .from('productions')
          .select('project_id')
          .eq('id', currentProductionId)
          .eq('user_id', user.id)
          .single()
        if (prodErr || !production || production.project_id !== finalProjectId) {
          return NextResponse.json(
            {
              error:
                'Mudanca de Projeto incompativel com a Production atual. ' +
                'Defina productionId como null ou forneça uma Production do novo Projeto.',
            },
            { status: 400 },
          )
        }
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo editavel enviado' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('editorial_contents')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Conteudo editorial nao encontrado' }, { status: 404 })
      }
      console.error('[EditorialContents] PATCH update error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ editorialContent: data })
  } catch (error) {
    console.error('[EditorialContents] PATCH error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    const { data: deleted, error } = await supabase
      .from('editorial_contents')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')

    if (error) {
      console.error('[EditorialContents] DELETE error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Conteudo editorial nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[EditorialContents] DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
