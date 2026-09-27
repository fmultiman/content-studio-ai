/**
 * Slice 1 — Portal Carousel V1: persistence seam for static-authoring state
 * (see lib/creative/authoring/carousel-state.ts for the contract and its
 * architectural boundary). Scoped by channelPieceId — one row per
 * ChannelPiece, upserted on write.
 *
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1:
 *  - every static format persists here (not only carousel);
 *  - two composition modes: `composition: 'free'` (template_id NULL, free
 *    slides) or Template-backed (template_id set, Template slides);
 *  - a non-carousel piece holds exactly ONE authored visual unit.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { StaticAuthoringStateSchema, STATIC_AUTHORING_STATE_SCHEMA_VERSION } from '@/lib/creative/authoring/carousel-state'
import type { ChannelPieceStaticAuthoringStateRow } from '@/lib/types'
import { DEFAULT_TEMPLATE_ID } from '@/lib/creative/templates/template-definitions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toResponseState(row: ChannelPieceStaticAuthoringStateRow) {
  // Free only when the row says so explicitly (NULL template_id, written only
  // with free slides). A row from before template_id existed (undefined) was
  // authored with the first Template and still reports it.
  if (row.template_id === null) return { schemaVersion: row.schema_version, channelPieceId: row.channel_piece_id, composition: 'free' as const, templateId: null, slides: row.slides }
  return { schemaVersion: row.schema_version, channelPieceId: row.channel_piece_id, composition: 'template' as const, templateId: row.template_id ?? DEFAULT_TEMPLATE_ID, slides: row.slides }
}

async function ownedChannelPiece(
  supabase: Awaited<ReturnType<typeof createClient>>,
  channelPieceId: string,
  userId: string,
): Promise<{ id: string; format: string } | null> {
  const { data, error } = await supabase.from('channel_pieces').select('id, format').eq('id', channelPieceId).eq('user_id', userId).single()
  return !error && data ? data as { id: string; format: string } : null
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const channelPieceId = new URL(request.url).searchParams.get('channelPieceId')
    if (!channelPieceId || !UUID_RE.test(channelPieceId)) return NextResponse.json({ error: 'channelPieceId invalido.' }, { status: 400 })

    if (!(await ownedChannelPiece(supabase, channelPieceId, user.id))) {
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

    const channelPiece = await ownedChannelPiece(supabase, body.channelPieceId, user.id)
    if (!channelPiece) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada ou nao autorizada.' }, { status: 404 })
    }
    // A single post/story/feed piece is ONE authored visual unit; only a carousel is a collection.
    if (channelPiece.format !== 'carousel' && body.slides.length !== 1) {
      return NextResponse.json({ error: 'Esta peca tem exatamente uma arte.', code: 'SINGLE_PIECE_CARDINALITY' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('channel_piece_static_authoring_states')
      .upsert(
        {
          user_id: user.id,
          channel_piece_id: body.channelPieceId,
          schema_version: body.schemaVersion ?? STATIC_AUTHORING_STATE_SCHEMA_VERSION,
          // Free = no Template at all (NULL), never a default Template id under a free composition.
          template_id: body.composition === 'free' ? null : body.templateId ?? DEFAULT_TEMPLATE_ID,
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
