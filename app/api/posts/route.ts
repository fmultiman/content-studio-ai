// INTEGRAÇÃO PROVISÓRIA — pendente de revisão de domínio.
// O modelo de Publicações (Post, canal, distribuição) ainda não foi definido.
// Não alterar esta API sem antes concluir a descoberta de domínio em docs/PUBLICATION_DOMAIN_DISCOVERY.md.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type PostBody = {
  id?: string
  name?: string
  projectId?: string | null
  productionId?: string | null
  channel?: string
  description?: string | null
  aiContext?: string | null
  feedText?: string | null
  imageUrl?: string | null
  thumbnailUrl?: string | null
  storageProvider?: string | null
  storagePath?: string | null
  thumbnailPath?: string | null
  fileSize?: number | null
  mimeType?: string | null
  postImages?: unknown[] | null
  status?: string
  linkOnly?: boolean
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

type PostRow = Record<string, unknown> & { id: string; migrated_at?: string | null }

async function enrichWithEcLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  posts: PostRow[],
): Promise<PostRow[]> {
  const migratedIds = posts.filter((p) => p.migrated_at).map((p) => p.id)
  if (migratedIds.length === 0) return posts
  const { data: ecs } = await supabase
    .from('editorial_contents')
    .select('id, project_id, legacy_post_id')
    .in('legacy_post_id', migratedIds)
  if (!ecs) return posts
  const ecByPostId = Object.fromEntries(ecs.map((ec) => [ec.legacy_post_id, ec]))
  return posts.map((p) => {
    const ec = ecByPostId[p.id]
    if (!ec) return p
    return { ...p, migrated_ec_id: ec.id, migrated_ec_project_id: ec.project_id }
  })
}

const MIGRATED_ERROR = {
  error: 'Este post foi migrado para o novo domínio editorial e não pode mais ser editado aqui. Acesse o Conteúdo Editorial correspondente.',
  code: 'POST_MIGRATED',
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

function normalizeChannel(channel: unknown) {
  if (
    channel === 'instagram_story' ||
    channel === 'youtube_post' ||
    channel === 'youtube_shorts' ||
    channel === 'youtube_video'
  ) {
    return channel
  }

  if (channel === 'youtube') return 'youtube_post'
  return 'instagram_post'
}

function normalizeStatus(status: unknown) {
  return status === 'saved' ? 'saved' : 'draft'
}

function buildPostPayload(body: PostBody) {
  const payload: Record<string, unknown> = {
    name: body.name?.trim() || 'Post sem titulo',
    project_id: body.projectId || null,
    channel: normalizeChannel(body.channel),
    description: body.description || null,
    ai_context: body.aiContext || null,
    feed_text: body.feedText || null,
    image_url: body.imageUrl || null,
    thumbnail_url: body.thumbnailUrl || null,
    storage_provider: body.storageProvider || null,
    storage_path: body.storagePath || null,
    thumbnail_path: body.thumbnailPath || null,
    file_size: body.fileSize || null,
    mime_type: body.mimeType || null,
    post_images: Array.isArray(body.postImages) ? body.postImages : [],
    status: normalizeStatus(body.status),
  }
  if (Object.hasOwn(body, 'productionId')) {
    payload.production_id = body.productionId || null
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
    const productionId = searchParams.get('productionId')

    if (id) {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        return NextResponse.json({ error: error.message, details: error }, { status: 400 })
      }

      const post = await enrichWithEcLink(supabase, [data])
      return NextResponse.json({ post: post[0] })
    }

    // Validate UUID format when productionId filter is used
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (productionId && !UUID_RE.test(productionId)) {
      return NextResponse.json({ error: 'productionId inválido.' }, { status: 400 })
    }

    let postsQuery = supabase
      .from('posts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (productionId) {
      // No pagination infrastructure yet; 200 is a defensive cap for MVP
      postsQuery = postsQuery.eq('production_id', productionId).limit(200)
    }

    const { data, error } = await postsQuery

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    const posts = await enrichWithEcLink(supabase, data || [])
    return NextResponse.json({ posts })
  } catch (error) {
    console.error('[Posts] GET error:', error)
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

    const body = (await request.json()) as PostBody

    if (body.productionId) {
      const validationError = await validateProductionOwnership(supabase, user.id, body.productionId, body.projectId)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    const payload = {
      user_id: user.id,
      ...buildPostPayload(body),
    }

    const { data, error } = await supabase
      .from('posts')
      .insert(payload)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ post: data })
  } catch (error) {
    console.error('[Posts] POST error:', error)
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

    const body = (await request.json()) as PostBody

    if (!body.id) {
      return NextResponse.json({ error: 'ID obrigatorio' }, { status: 400 })
    }

    // Block edits on migrated posts
    const { data: existingPost } = await supabase
      .from('posts')
      .select('migrated_at')
      .eq('id', body.id)
      .eq('user_id', user.id)
      .single()
    if (existingPost?.migrated_at) {
      return NextResponse.json(MIGRATED_ERROR, { status: 409 })
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
          .from('posts')
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
        .from('posts')
        .update({ production_id: body.productionId || null })
        .eq('id', body.id)
        .eq('user_id', user.id)
        .select()
        .single()
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ post: data })
    }

    if (body.productionId) {
      const validationError = await validateProductionOwnership(supabase, user.id, body.productionId, body.projectId)
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('posts')
      .update(buildPostPayload(body))
      .eq('id', body.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ post: data })
  } catch (error) {
    console.error('[Posts] PATCH error:', error)
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

    const body = (await request.json()) as { ids?: string[] }
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum post selecionado' }, { status: 400 })
    }

    // Block deletion of migrated posts
    const { data: migratedPosts } = await supabase
      .from('posts')
      .select('id, migrated_at')
      .in('id', ids)
      .eq('user_id', user.id)
      .not('migrated_at', 'is', null)
    if (migratedPosts && migratedPosts.length > 0) {
      return NextResponse.json({
        error: `${migratedPosts.length} post(s) foram migrados para o novo domínio editorial e não podem ser excluídos por esta rota.`,
        code: 'POST_MIGRATED',
      }, { status: 409 })
    }

    const { error } = await supabase
      .from('posts')
      .delete()
      .in('id', ids)
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Posts] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
