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

const ALLOWED_POST_KEYS = new Set([
  'editorialContentId', 'channel', 'format', 'title', 'body', 'cta', 'hashtags', 'status',
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
    const editorialContentId = searchParams.get('editorialContentId')
    const channel = searchParams.get('channel')
    const format = searchParams.get('format')
    const status = searchParams.get('status')

    if (editorialContentId && !UUID_RE.test(editorialContentId)) {
      return NextResponse.json({ error: 'editorialContentId invalido' }, { status: 400 })
    }
    if (channel && !isValidChannel(channel)) {
      return NextResponse.json(
        { error: `channel invalido. Valores aceitos: ${PUBLICATION_CHANNELS.join(', ')}` },
        { status: 400 },
      )
    }
    if (format && !isValidFormat(format)) {
      return NextResponse.json(
        { error: `format invalido. Valores aceitos: ${PUBLICATION_FORMATS.join(', ')}` },
        { status: 400 },
      )
    }
    if (status && !VALID_CP_STATUSES.includes(status as ChannelPieceStatus)) {
      return NextResponse.json(
        { error: `status invalido. Valores aceitos: ${VALID_CP_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    let query = supabase
      .from('channel_pieces')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (editorialContentId) query = query.eq('editorial_content_id', editorialContentId)
    if (channel) query = query.eq('channel', channel)
    if (format) query = query.eq('format', format)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) {
      console.error('[ChannelPieces] GET list error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPieces: data ?? [] })
  } catch (error) {
    console.error('[ChannelPieces] GET error:', error)
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

    if (Array.isArray(body)) {
      return NextResponse.json({ error: 'Body invalido: objeto esperado, array recebido' }, { status: 400 })
    }

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_POST_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    const editorialContentId = typeof body.editorialContentId === 'string' ? body.editorialContentId.trim() : ''
    if (!editorialContentId) {
      return NextResponse.json({ error: 'editorialContentId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(editorialContentId)) {
      return NextResponse.json({ error: 'editorialContentId invalido' }, { status: 400 })
    }

    const channel = typeof body.channel === 'string' ? body.channel : ''
    if (!channel) return NextResponse.json({ error: 'channel obrigatorio' }, { status: 400 })
    if (!isValidChannel(channel)) {
      return NextResponse.json(
        { error: `channel invalido. Valores aceitos: ${PUBLICATION_CHANNELS.join(', ')}` },
        { status: 400 },
      )
    }

    const format = typeof body.format === 'string' ? body.format : ''
    if (!format) return NextResponse.json({ error: 'format obrigatorio' }, { status: 400 })
    if (!isValidFormat(format)) {
      return NextResponse.json(
        { error: `format invalido. Valores aceitos: ${PUBLICATION_FORMATS.join(', ')}` },
        { status: 400 },
      )
    }

    if (!isValidChannelFormat(channel, format)) {
      return NextResponse.json(
        { error: `Combinacao channel+format invalida: ${channel}+${format}` },
        { status: 400 },
      )
    }

    if (body.title !== undefined && body.title !== null) {
      if (typeof body.title !== 'string') {
        return NextResponse.json({ error: 'title deve ser string ou null' }, { status: 400 })
      }
      if (body.title.length > 500) {
        return NextResponse.json({ error: 'title excede 500 caracteres' }, { status: 400 })
      }
    }

    if (body.body !== undefined && body.body !== null) {
      if (typeof body.body !== 'string') {
        return NextResponse.json({ error: 'body deve ser string ou null' }, { status: 400 })
      }
      if (body.body.length > 100000) {
        return NextResponse.json({ error: 'body excede 100000 caracteres' }, { status: 400 })
      }
    }

    if (body.cta !== undefined && body.cta !== null) {
      if (typeof body.cta !== 'string') {
        return NextResponse.json({ error: 'cta deve ser string ou null' }, { status: 400 })
      }
      if (body.cta.length > 500) {
        return NextResponse.json({ error: 'cta excede 500 caracteres' }, { status: 400 })
      }
    }

    if (body.hashtags !== undefined && body.hashtags !== null) {
      if (typeof body.hashtags !== 'string') {
        return NextResponse.json({ error: 'hashtags deve ser string ou null' }, { status: 400 })
      }
      if (body.hashtags.length > 2000) {
        return NextResponse.json({ error: 'hashtags excede 2000 caracteres' }, { status: 400 })
      }
    }

    if (body.status !== undefined && !VALID_CP_STATUSES.includes(body.status as ChannelPieceStatus)) {
      return NextResponse.json(
        { error: `status invalido. Valores aceitos: ${VALID_CP_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // Validate EC ownership (defense in depth beyond RLS)
    const { data: ec, error: ecError } = await supabase
      .from('editorial_contents')
      .select('id')
      .eq('id', editorialContentId)
      .eq('user_id', user.id)
      .single()

    if (ecError || !ec) {
      return NextResponse.json(
        { error: 'EditorialContent nao encontrado ou nao autorizado' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('channel_pieces')
      .insert({
        user_id: user.id,
        editorial_content_id: editorialContentId,
        channel,
        format,
        title: (body.title as string | null | undefined) ?? null,
        body: (body.body as string | null | undefined) ?? null,
        cta: (body.cta as string | null | undefined) ?? null,
        hashtags: (body.hashtags as string | null | undefined) ?? null,
        status: (body.status as ChannelPieceStatus | undefined) ?? 'draft',
      })
      .select()
      .single()

    if (error) {
      console.error('[ChannelPieces] POST insert error:', error)
      if (error.code === '23503') {
        return NextResponse.json({ error: 'EditorialContent nao encontrado' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPiece: data }, { status: 201 })
  } catch (error) {
    console.error('[ChannelPieces] POST error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
