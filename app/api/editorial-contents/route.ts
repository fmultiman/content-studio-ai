import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EditorialContentStatus } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_EC_STATUSES: EditorialContentStatus[] = ['draft', 'ready', 'archived']

const ALLOWED_POST_KEYS = new Set([
  'projectId', 'productionId', 'title', 'body', 'aiContext', 'status',
])

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const productionId = searchParams.get('productionId')
    const status = searchParams.get('status')

    if (projectId && !UUID_RE.test(projectId)) {
      return NextResponse.json({ error: 'projectId invalido' }, { status: 400 })
    }
    if (productionId && !UUID_RE.test(productionId)) {
      return NextResponse.json({ error: 'productionId invalido' }, { status: 400 })
    }
    if (status && !VALID_EC_STATUSES.includes(status as EditorialContentStatus)) {
      return NextResponse.json(
        { error: `status invalido. Valores aceitos: ${VALID_EC_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    let query = supabase
      .from('editorial_contents')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (projectId) query = query.eq('project_id', projectId)
    // productionId=null-string would not be sent by clients; explicit null filter deferred to P3
    if (productionId) query = query.eq('production_id', productionId)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      console.error('[EditorialContents] GET list error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ editorialContents: data ?? [] })
  } catch (error) {
    console.error('[EditorialContents] GET error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Body invalido: JSON esperado' }, { status: 400 })
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Body invalido: objeto esperado' }, { status: 400 })
    }

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_POST_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
    if (!projectId) {
      return NextResponse.json({ error: 'projectId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(projectId)) {
      return NextResponse.json({ error: 'projectId invalido' }, { status: 400 })
    }

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'title obrigatorio e nao pode ser vazio' }, { status: 400 })
    }
    if (title.length > 500) {
      return NextResponse.json({ error: 'title excede 500 caracteres' }, { status: 400 })
    }

    if (body.body !== undefined && body.body !== null) {
      if (typeof body.body !== 'string') {
        return NextResponse.json({ error: 'body deve ser string ou null' }, { status: 400 })
      }
      if (body.body.length > 50000) {
        return NextResponse.json({ error: 'body excede 50000 caracteres' }, { status: 400 })
      }
    }

    if (body.aiContext !== undefined && body.aiContext !== null) {
      if (typeof body.aiContext !== 'string') {
        return NextResponse.json({ error: 'aiContext deve ser string ou null' }, { status: 400 })
      }
      if (body.aiContext.length > 5000) {
        return NextResponse.json({ error: 'aiContext excede 5000 caracteres' }, { status: 400 })
      }
    }

    if (body.status !== undefined && !VALID_EC_STATUSES.includes(body.status as EditorialContentStatus)) {
      return NextResponse.json(
        { error: `status invalido. Valores aceitos: ${VALID_EC_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // Validate project ownership explicitly (defense in depth beyond RLS)
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Projeto nao encontrado ou nao autorizado' }, { status: 400 })
    }

    // Validate and resolve productionId
    let resolvedProductionId: string | null = null
    if (body.productionId !== undefined) {
      if (body.productionId === null) {
        resolvedProductionId = null
      } else if (typeof body.productionId === 'string') {
        if (!UUID_RE.test(body.productionId)) {
          return NextResponse.json({ error: 'productionId invalido' }, { status: 400 })
        }
        const { data: production, error: prodError } = await supabase
          .from('productions')
          .select('id, project_id')
          .eq('id', body.productionId)
          .eq('user_id', user.id)
          .single()
        if (prodError || !production) {
          return NextResponse.json({ error: 'Production nao encontrada ou nao autorizada' }, { status: 400 })
        }
        if (production.project_id !== projectId) {
          return NextResponse.json({ error: 'Production nao pertence a este Projeto' }, { status: 400 })
        }
        resolvedProductionId = body.productionId
      } else {
        return NextResponse.json({ error: 'productionId deve ser string ou null' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('editorial_contents')
      .insert({
        user_id: user.id,
        project_id: projectId,
        production_id: resolvedProductionId,
        title,
        body: (body.body as string | null | undefined) ?? null,
        ai_context: (body.aiContext as string | null | undefined) ?? null,
        status: (body.status as EditorialContentStatus | undefined) ?? 'draft',
      })
      .select()
      .single()

    if (error) {
      console.error('[EditorialContents] POST insert error:', error)
      if (error.code === '23503') {
        return NextResponse.json({ error: 'Projeto ou Production nao encontrado' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ editorialContent: data }, { status: 201 })
  } catch (error) {
    console.error('[EditorialContents] POST error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
