import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  isValidChannel,
  isValidFormat,
  isValidChannelFormat,
  PUBLICATION_CHANNELS,
  PUBLICATION_FORMATS,
} from '@/lib/publication-channels'
import type { ChannelPieceStatus } from '@/lib/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_CP_STATUSES: ChannelPieceStatus[] = ['draft', 'ready', 'approved', 'archived']

const ALLOWED_PATCH_KEYS = new Set([
  'editorialContentId', 'channel', 'format', 'title', 'body', 'cta', 'hashtags', 'status',
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
      .from('channel_pieces')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'ChannelPiece nao encontrada' }, { status: 404 })
      }
      console.error('[ChannelPieces] GET/id error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPiece: data })
  } catch (error) {
    console.error('[ChannelPieces] GET/id error:', error)
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

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
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

    // Fetch current record for ownership validation and channel/format state
    const { data: current, error: fetchError } = await supabase
      .from('channel_pieces')
      .select('id, channel, format, editorial_content_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'ChannelPiece nao encontrada' }, { status: 404 })
      }
      console.error('[ChannelPieces] PATCH fetch error:', fetchError)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    const update: Record<string, unknown> = {}

    // editorialContentId: optional move to another EC owned by the user
    if (body.editorialContentId !== undefined) {
      if (typeof body.editorialContentId !== 'string' || !UUID_RE.test(body.editorialContentId)) {
        return NextResponse.json({ error: 'editorialContentId invalido' }, { status: 400 })
      }
      const { data: ec, error: ecErr } = await supabase
        .from('editorial_contents')
        .select('id')
        .eq('id', body.editorialContentId)
        .eq('user_id', user.id)
        .single()
      if (ecErr || !ec) {
        return NextResponse.json(
          { error: 'EditorialContent nao encontrado ou nao autorizado' },
          { status: 400 },
        )
      }
      update.editorial_content_id = body.editorialContentId
    }

    // Determine final channel and format for combination validation
    const finalChannel = body.channel !== undefined ? body.channel : current.channel
    const finalFormat = body.format !== undefined ? body.format : current.format

    if (body.channel !== undefined) {
      if (typeof body.channel !== 'string' || !isValidChannel(body.channel)) {
        return NextResponse.json(
          { error: `channel invalido. Valores aceitos: ${PUBLICATION_CHANNELS.join(', ')}` },
          { status: 400 },
        )
      }
      update.channel = body.channel
    }

    if (body.format !== undefined) {
      if (typeof body.format !== 'string' || !isValidFormat(body.format)) {
        return NextResponse.json(
          { error: `format invalido. Valores aceitos: ${PUBLICATION_FORMATS.join(', ')}` },
          { status: 400 },
        )
      }
      update.format = body.format
    }

    // Validate final channel+format combination whenever either field changes
    if (body.channel !== undefined || body.format !== undefined) {
      if (!isValidChannelFormat(finalChannel as string, finalFormat as string)) {
        return NextResponse.json(
          { error: `Combinacao channel+format invalida: ${finalChannel}+${finalFormat}` },
          { status: 400 },
        )
      }
    }

    if (body.title !== undefined) {
      if (body.title !== null && typeof body.title !== 'string') {
        return NextResponse.json({ error: 'title deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.title === 'string' && body.title.length > 500) {
        return NextResponse.json({ error: 'title excede 500 caracteres' }, { status: 400 })
      }
      update.title = body.title
    }

    if (body.body !== undefined) {
      if (body.body !== null && typeof body.body !== 'string') {
        return NextResponse.json({ error: 'body deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.body === 'string' && body.body.length > 100000) {
        return NextResponse.json({ error: 'body excede 100000 caracteres' }, { status: 400 })
      }
      update.body = body.body
    }

    if (body.cta !== undefined) {
      if (body.cta !== null && typeof body.cta !== 'string') {
        return NextResponse.json({ error: 'cta deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.cta === 'string' && body.cta.length > 500) {
        return NextResponse.json({ error: 'cta excede 500 caracteres' }, { status: 400 })
      }
      update.cta = body.cta
    }

    if (body.hashtags !== undefined) {
      if (body.hashtags !== null && typeof body.hashtags !== 'string') {
        return NextResponse.json({ error: 'hashtags deve ser string ou null' }, { status: 400 })
      }
      if (typeof body.hashtags === 'string' && body.hashtags.length > 2000) {
        return NextResponse.json({ error: 'hashtags excede 2000 caracteres' }, { status: 400 })
      }
      update.hashtags = body.hashtags
    }

    if (body.status !== undefined) {
      if (!VALID_CP_STATUSES.includes(body.status as ChannelPieceStatus)) {
        return NextResponse.json(
          { error: `status invalido. Valores aceitos: ${VALID_CP_STATUSES.join(', ')}` },
          { status: 400 },
        )
      }
      update.status = body.status
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo editavel enviado' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('channel_pieces')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'ChannelPiece nao encontrada' }, { status: 404 })
      }
      console.error('[ChannelPieces] PATCH update error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPiece: data })
  } catch (error) {
    console.error('[ChannelPieces] PATCH error:', error)
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
      .from('channel_pieces')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id')

    if (error) {
      console.error('[ChannelPieces] DELETE error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ChannelPieces] DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
