/**
 * Slice 1 — Portal Carousel V1: persistence seam for static-authoring state
 * (see lib/creative/authoring/carousel-state.ts for the contract and its
 * architectural boundary). Scoped by channelPieceId — one row per
 * ChannelPiece, upserted on write.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { StaticAuthoringStateSchema, STATIC_AUTHORING_STATE_SCHEMA_VERSION } from '@/lib/creative/authoring/carousel-state'
import type { ChannelPieceStaticAuthoringStateRow } from '@/lib/types'
import { DEFAULT_TEMPLATE_ID } from '@/lib/creative/templates/template-definitions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toResponseState(row: ChannelPieceStaticAuthoringStateRow) {
  // Creative Editor Template Foundation V1: rows written before template_id
  // existed (or by an older client) report the first Template, which is what
  // they were authored with.
  return { schemaVersion: row.schema_version, channelPieceId: row.channel_piece_id, templateId: row.template_id ?? DEFAULT_TEMPLATE_ID, slides: row.slides }
}

async function verifyChannelPieceOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  channelPieceId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from('channel_pieces').select('id').eq('id', channelPieceId).eq('user_id', userId).single()
  return !error && Boolean(data)
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const channelPieceId = new URL(request.url).searchParams.get('channelPieceId')
    if (!channelPieceId || !UUID_RE.test(channelPieceId)) return NextResponse.json({ error: 'channelPieceId invalido.' }, { status: 400 })

    if (!(await verifyChannelPieceOwnership(supabase, channelPieceId, user.id))) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada ou nao autorizada.' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('channel_piece_static_authoring_states')
      .select('*')
      .eq('channel_piece_id', channelPieceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error

    return NextResponse.json({ state: data ? toResponseState(data as ChannelPieceStaticAuthoringStateRow) : null })
  } catch (error) {
    console.error('[Static Authoring State] GET error:', error)
    return NextResponse.json({ error: 'Erro interno ao carregar estado de autoria.' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const raw = await request.json().catch(() => null)
    const parsed = StaticAuthoringStateSchema.safeParse(raw)
    if (!parsed.success) return NextResponse.json({ error: 'Estado de autoria invalido.', issues: parsed.error.issues }, { status: 400 })
    const body = parsed.data
    if (!UUID_RE.test(body.channelPieceId)) return NextResponse.json({ error: 'channelPieceId invalido.' }, { status: 400 })

    if (!(await verifyChannelPieceOwnership(supabase, body.channelPieceId, user.id))) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada ou nao autorizada.' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('channel_piece_static_authoring_states')
      .upsert(
        {
          user_id: user.id,
          channel_piece_id: body.channelPieceId,
          schema_version: body.schemaVersion ?? STATIC_AUTHORING_STATE_SCHEMA_VERSION,
          template_id: body.templateId ?? DEFAULT_TEMPLATE_ID,
          slides: body.slides,
        },
        { onConflict: 'channel_piece_id' },
      )
      .select('*')
      .single()
    if (error) throw error

    return NextResponse.json({ state: toResponseState(data as ChannelPieceStaticAuthoringStateRow) })
  } catch (error) {
    console.error('[Static Authoring State] PUT error:', error)
    return NextResponse.json({ error: 'Erro interno ao salvar estado de autoria.' }, { status: 500 })
  }
}
