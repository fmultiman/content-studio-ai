import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ChannelPieceMediaRole } from '@/lib/types'
import { UUID_RE, VALID_ROLES, mapPgError, mapRpcError, resolveMediaSource } from '../_helpers'

const ALLOWED_PATCH_KEYS = new Set(['position', 'role', 'altText'])

type RouteContext = { params: Promise<{ id: string }> }

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

// GET /api/channel-piece-media/[id]
// Returns a single media association with resolved source data.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('channel_piece_media')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Associacao de midia nao encontrada' }, { status: 404 })
      }
      console.error('[CPM] GET/id error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    const resolved = { ...data, ...(await resolveMediaSource(supabase, data)) }
    return NextResponse.json({ channelPieceMedium: resolved })
  } catch (error) {
    console.error('[CPM] GET/id error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// PATCH /api/channel-piece-media/[id]
// Mutable fields: position, role, altText.
// Immutable: user_id, channel_piece_id, image_id, library_file_id.
// Note: batch reordering (M6) will have its own transactional endpoint using
//       SET CONSTRAINTS cpm_unique_position DEFERRED.
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
      return NextResponse.json({ error: `Campos nao permitidos: ${unknownKeys.join(', ')}` }, { status: 400 })
    }

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: 'Body vazio: nenhum campo para atualizar' }, { status: 400 })
    }

    // Verify ownership before building update payload
    const { data: current, error: fetchError } = await supabase
      .from('channel_piece_media')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Associacao de midia nao encontrada' }, { status: 404 })
      }
      console.error('[CPM] PATCH fetch error:', fetchError)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    if (!current) {
      return NextResponse.json({ error: 'Associacao de midia nao encontrada' }, { status: 404 })
    }

    const update: Record<string, unknown> = {}

    if (body.position !== undefined) {
      if (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0) {
        return NextResponse.json({ error: 'position deve ser inteiro >= 0' }, { status: 400 })
      }
      update.position = body.position
    }

    if (body.role !== undefined) {
      if (!VALID_ROLES.includes(body.role as ChannelPieceMediaRole)) {
        return NextResponse.json({ error: `role invalido. Valores aceitos: ${VALID_ROLES.join(', ')}` }, { status: 400 })
      }
      update.role = body.role
    }

    if (body.altText !== undefined) {
      if (body.altText !== null) {
        if (typeof body.altText !== 'string') {
          return NextResponse.json({ error: 'altText deve ser string ou null' }, { status: 400 })
        }
        if (body.altText.length > 1000) {
          return NextResponse.json({ error: 'altText excede 1000 caracteres' }, { status: 400 })
        }
      }
      update.alt_text = body.altText
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo editavel enviado' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('channel_piece_media')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('[CPM] PATCH update error:', error)
      const mapped = mapPgError(error.code, error.message)
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Associacao de midia nao encontrada' }, { status: 404 })
      }
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPieceMedium: data })
  } catch (error) {
    console.error('[CPM] PATCH error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// DELETE /api/channel-piece-media/[id]
// Removes a media association atomically via remove_channel_piece_media RPC.
// After removal: positions are compacted (0..N-1) and primary is promoted if needed.
// Never deletes images, library_files, or storage objects — association only.
// Returns: { ok: true, channelPieceMedia: ChannelPieceMediaResolved[] }
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    const { data, error } = await supabase.rpc('remove_channel_piece_media', { p_id: id })

    if (error) {
      console.error('[CPM] DELETE RPC error:', error)
      const mapped = mapRpcError(error.message)
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    // Enrich remaining items with resolved source data
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
    const resolved = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await resolveMediaSource(
          supabase,
          row as Parameters<typeof resolveMediaSource>[1],
        )),
      })),
    )

    return NextResponse.json({ ok: true, channelPieceMedia: resolved })
  } catch (error) {
    console.error('[CPM] DELETE error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
