import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type PostBody = {
  id?: string
  name?: string
  projectId?: string | null
  channel?: string
  description?: string | null
  aiContext?: string | null
  feedText?: string | null
  imageUrl?: string | null
  status?: string
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
  return {
    name: body.name?.trim() || 'Post sem titulo',
    project_id: body.projectId || null,
    channel: normalizeChannel(body.channel),
    description: body.description || null,
    ai_context: body.aiContext || null,
    feed_text: body.feedText || null,
    image_url: body.imageUrl || null,
    status: normalizeStatus(body.status),
  }
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()

    if (!user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

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

      return NextResponse.json({ post: data })
    }

    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ posts: data || [] })
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
