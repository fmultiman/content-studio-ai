import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ChannelPieceMediaRole } from '@/lib/types'
import { UUID_RE, VALID_ROLES, mapPgError, resolveMediaSource } from './_helpers'

const ALLOWED_POST_KEYS = new Set([
  'channelPieceId', 'imageId', 'libraryFileId', 'position', 'role', 'altText',
])

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

// GET /api/channel-piece-media?channelPieceId=<uuid>
// Returns all media associations for the given ChannelPiece, ordered by position ASC, created_at ASC.
// Resolves source data (URL, mime_type, etc.) at read time — nothing persisted.
export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const channelPieceId = searchParams.get('channelPieceId')

    if (!channelPieceId) {
      return NextResponse.json({ error: 'channelPieceId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(channelPieceId)) {
      return NextResponse.json({ error: 'channelPieceId invalido' }, { status: 400 })
    }

    // Verify CP ownership before listing media
    const { data: cp, error: cpError } = await supabase
      .from('channel_pieces')
      .select('id')
      .eq('id', channelPieceId)
      .eq('user_id', user.id)
      .single()

    if (cpError || !cp) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('channel_piece_media')
      .select('*')
      .eq('channel_piece_id', channelPieceId)
      .eq('user_id', user.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[CPM] GET list error:', error)
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    const resolved = await Promise.all(
      (data ?? []).map(async (row) => ({
        ...row,
        ...(await resolveMediaSource(supabase, row)),
      })),
    )

    return NextResponse.json({ channelPieceMedia: resolved })
  } catch (error) {
    console.error('[CPM] GET error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

// POST /api/channel-piece-media
// Creates a new media association. Validates same-project consistency before INSERT.
// Fields: channelPieceId (required), imageId XOR libraryFileId (required),
//         position (int >= 0, default 0), role (default 'primary'), altText (null | string <= 1000)
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
      return NextResponse.json({ error: `Campos nao permitidos: ${unknownKeys.join(', ')}` }, { status: 400 })
    }

    // channelPieceId
    const channelPieceId = typeof body.channelPieceId === 'string' ? body.channelPieceId.trim() : ''
    if (!channelPieceId) {
      return NextResponse.json({ error: 'channelPieceId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(channelPieceId)) {
      return NextResponse.json({ error: 'channelPieceId invalido' }, { status: 400 })
    }

    // Exactly one source
    const hasImage = body.imageId != null
    const hasLibraryFile = body.libraryFileId != null

    if (hasImage && hasLibraryFile) {
      return NextResponse.json({ error: 'Informe apenas imageId ou libraryFileId, nao ambos' }, { status: 400 })
    }
    if (!hasImage && !hasLibraryFile) {
      return NextResponse.json({ error: 'Informe imageId ou libraryFileId' }, { status: 400 })
    }

    const imageId = hasImage ? (typeof body.imageId === 'string' ? body.imageId.trim() : '') : null
    const libraryFileId = hasLibraryFile ? (typeof body.libraryFileId === 'string' ? body.libraryFileId.trim() : '') : null

    if (imageId !== null && !UUID_RE.test(imageId)) {
      return NextResponse.json({ error: 'imageId invalido' }, { status: 400 })
    }
    if (libraryFileId !== null && !UUID_RE.test(libraryFileId)) {
      return NextResponse.json({ error: 'libraryFileId invalido' }, { status: 400 })
    }

    // position
    const position = body.position !== undefined ? body.position : 0
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      return NextResponse.json({ error: 'position deve ser inteiro >= 0' }, { status: 400 })
    }

    // role
    const role = (body.role !== undefined ? body.role : 'primary') as ChannelPieceMediaRole
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `role invalido. Valores aceitos: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }

    // altText
    const altText = body.altText !== undefined ? body.altText : null
    if (altText !== null) {
      if (typeof altText !== 'string') {
        return NextResponse.json({ error: 'altText deve ser string ou null' }, { status: 400 })
      }
      if (altText.length > 1000) {
        return NextResponse.json({ error: 'altText excede 1000 caracteres' }, { status: 400 })
      }
    }

    // Verify CP ownership and resolve project_id chain: CP → EC → project_id
    const { data: cp, error: cpError } = await supabase
      .from('channel_pieces')
      .select('id, editorial_content_id')
      .eq('id', channelPieceId)
      .eq('user_id', user.id)
      .single()

    if (cpError || !cp) {
      return NextResponse.json({ error: 'ChannelPiece nao encontrada ou nao autorizada' }, { status: 404 })
    }

    const { data: ec, error: ecError } = await supabase
      .from('editorial_contents')
      .select('project_id')
      .eq('id', cp.editorial_content_id)
      .eq('user_id', user.id)
      .single()

    if (ecError || !ec) {
      console.error('[CPM] POST EC lookup error:', ecError)
      return NextResponse.json({ error: 'Erro interno ao resolver Projeto da ChannelPiece' }, { status: 500 })
    }

    const projectId = ec.project_id

    // Validate source: must belong to same user and same project
    if (imageId) {
      const { data: img, error: imgError } = await supabase
        .from('images')
        .select('id, project_id')
        .eq('id', imageId)
        .eq('user_id', user.id)
        .single()

      if (imgError || !img) {
        return NextResponse.json({ error: 'Imagem nao encontrada ou nao autorizada' }, { status: 404 })
      }
      if (img.project_id === null) {
        return NextResponse.json({
          error: 'Imagem sem Projeto atribuido. Atribua a imagem a um Projeto antes de associa-la a uma ChannelPiece.',
        }, { status: 400 })
      }
      if (img.project_id !== projectId) {
        return NextResponse.json({
          error: 'Imagem pertence a um Projeto diferente da ChannelPiece. Use uma imagem do mesmo Projeto.',
        }, { status: 400 })
      }
    }

    if (libraryFileId) {
      const { data: lf, error: lfError } = await supabase
        .from('library_files')
        .select('id, project_id')
        .eq('id', libraryFileId)
        .eq('user_id', user.id)
        .single()

      if (lfError || !lf) {
        return NextResponse.json({ error: 'LibraryFile nao encontrado ou nao autorizado' }, { status: 404 })
      }
      if (lf.project_id === null) {
        return NextResponse.json({
          error: 'LibraryFile sem Projeto atribuido. Mova o arquivo para uma pasta de Projeto antes de associa-lo a uma ChannelPiece.',
        }, { status: 400 })
      }
      if (lf.project_id !== projectId) {
        return NextResponse.json({
          error: 'LibraryFile pertence a um Projeto diferente da ChannelPiece. Use um arquivo do mesmo Projeto.',
        }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('channel_piece_media')
      .insert({
        user_id: user.id,
        channel_piece_id: channelPieceId,
        image_id: imageId,
        library_file_id: libraryFileId,
        position,
        role,
        alt_text: altText as string | null,
      })
      .select()
      .single()

    if (error) {
      console.error('[CPM] POST insert error:', error)
      const mapped = mapPgError(error.code, error.message)
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }

    return NextResponse.json({ channelPieceMedium: data }, { status: 201 })
  } catch (error) {
    console.error('[CPM] POST error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
