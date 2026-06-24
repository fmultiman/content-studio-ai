import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ChannelPieceMediaRole } from '@/lib/types'
import { UUID_RE, VALID_ROLES, mapRpcError, resolveMediaSource } from '../_helpers'

const ALLOWED_KEYS = new Set(['channelPieceId', 'items'])
const ALLOWED_ITEM_KEYS = new Set(['id', 'position', 'role'])

// PATCH /api/channel-piece-media/organize
// Atomically reorders and/or changes roles for ALL media of a ChannelPiece.
// Delegates to organize_channel_piece_media RPC (single DB transaction).
//
// Body: {
//   channelPieceId: string,
//   items: [{ id: string, position: number, role: string }, ...]
// }
//
// The items array MUST contain every existing CPM for the ChannelPiece.
// Extra or missing IDs → 409 (CPM_CONFLICT from RPC).
//
// Returns: { channelPieceMedia: ChannelPieceMediaResolved[] }
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
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

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    // channelPieceId
    const channelPieceId =
      typeof body.channelPieceId === 'string' ? body.channelPieceId.trim() : ''
    if (!channelPieceId) {
      return NextResponse.json({ error: 'channelPieceId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(channelPieceId)) {
      return NextResponse.json({ error: 'channelPieceId invalido' }, { status: 400 })
    }

    // items
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ error: 'items deve ser um array' }, { status: 400 })
    }
    if (body.items.length === 0) {
      return NextResponse.json({ error: 'items nao pode ser vazio' }, { status: 400 })
    }

    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i]
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return NextResponse.json({ error: `Item ${i}: objeto esperado` }, { status: 400 })
      }
      const it = item as Record<string, unknown>

      const unknownItemKeys = Object.keys(it).filter((k) => !ALLOWED_ITEM_KEYS.has(k))
      if (unknownItemKeys.length > 0) {
        return NextResponse.json(
          { error: `Item ${i}: campos nao permitidos: ${unknownItemKeys.join(', ')}` },
          { status: 400 },
        )
      }

      if (typeof it.id !== 'string' || !UUID_RE.test(it.id)) {
        return NextResponse.json({ error: `Item ${i}: id invalido` }, { status: 400 })
      }
      if (
        typeof it.position !== 'number' ||
        !Number.isInteger(it.position) ||
        it.position < 0
      ) {
        return NextResponse.json(
          { error: `Item ${i}: position deve ser inteiro >= 0` },
          { status: 400 },
        )
      }
      if (!VALID_ROLES.includes(it.role as ChannelPieceMediaRole)) {
        return NextResponse.json(
          { error: `Item ${i}: role invalida. Valores aceitos: ${VALID_ROLES.join(', ')}` },
          { status: 400 },
        )
      }
    }

    const validatedItems = (body.items as Record<string, unknown>[]).map((it) => ({
      id: it.id as string,
      position: it.position as number,
      role: it.role as ChannelPieceMediaRole,
    }))

    // Call the transactional RPC
    const { data, error } = await supabase.rpc('organize_channel_piece_media', {
      p_channel_piece_id: channelPieceId,
      p_items: validatedItems,
    })

    if (error) {
      console.error('[CPM Organize] RPC error:', error)
      const mapped = mapRpcError(error.message)
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    // Enrich each row with resolved source data (URLs, kind, etc.)
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

    return NextResponse.json({ channelPieceMedia: resolved })
  } catch (error) {
    console.error('[CPM Organize] error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
