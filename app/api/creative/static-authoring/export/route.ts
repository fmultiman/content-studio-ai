import { NextResponse } from 'next/server'
import { buildCarouselZip, CarouselExportError, isSupportedCarouselImageMimeType, type CarouselExportItem } from '@/lib/creative/export/carousel-zip'
import { readS3Object } from '@/lib/storage/s3'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorResponse(error: unknown) {
  if (error instanceof CarouselExportError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 })
  console.error('[Static Authoring Export] error:', error)
  return NextResponse.json({ error: 'Não foi possível preparar o ZIP do carrossel.' }, { status: 500 })
}

/**
 * Packages only durable LibraryFiles already attached to this ChannelPiece.
 * This route deliberately has no render, save, or database write path.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const channelPieceId = new URL(request.url).searchParams.get('channelPieceId')
    if (!channelPieceId || !UUID_RE.test(channelPieceId)) return NextResponse.json({ error: 'channelPieceId inválido.' }, { status: 400 })

    const { data: channelPiece, error: channelPieceError } = await supabase
      .from('channel_pieces')
      .select('id, editorial_content_id, format')
      .eq('id', channelPieceId)
      .eq('user_id', user.id)
      .single()
    if (channelPieceError || !channelPiece) return NextResponse.json({ error: 'ChannelPiece não encontrada ou não autorizada.' }, { status: 404 })
    if (channelPiece.format !== 'carousel') return NextResponse.json({ error: 'A exportação ZIP está disponível para carrosséis.' }, { status: 409 })

    const { data: editorialContent, error: editorialError } = await supabase
      .from('editorial_contents')
      .select('id, project_id')
      .eq('id', channelPiece.editorial_content_id)
      .eq('user_id', user.id)
      .single()
    if (editorialError || !editorialContent) return NextResponse.json({ error: 'EditorialContent não encontrado ou não autorizado.' }, { status: 404 })

    const { data: authoredState, error: authoredStateError } = await supabase
      .from('channel_piece_static_authoring_states')
      .select('slides')
      .eq('channel_piece_id', channelPieceId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (authoredStateError) throw authoredStateError
    const authoredSlides = Array.isArray(authoredState?.slides) ? authoredState.slides : []
    if (authoredSlides.length === 0) throw new CarouselExportError('EMPTY', 'O carrossel ainda não possui slides salvos.')

    const { data: mediaRows, error: mediaError } = await supabase
      .from('channel_piece_media')
      .select('position, library_file_id, image_id')
      .eq('channel_piece_id', channelPieceId)
      .eq('user_id', user.id)
      .order('position', { ascending: true })
    if (mediaError) throw mediaError
    const rows = mediaRows ?? []
    if (rows.some((row) => row.image_id || !row.library_file_id)) throw new CarouselExportError('UNSUPPORTED', 'A exportação exige LibraryFiles de imagem anexados ao carrossel.')

    const libraryFileIds = rows.map((row) => row.library_file_id as string)
    const { data: libraryFiles, error: libraryError } = await supabase
      .from('library_files')
      .select('id, project_id, mime_type, storage_path, deleted_at')
      .in('id', libraryFileIds)
      .eq('user_id', user.id)
    if (libraryError) throw libraryError
    const filesById = new Map((libraryFiles ?? []).map((file) => [file.id as string, file]))
    if (filesById.size !== libraryFileIds.length) throw new CarouselExportError('INCOMPLETE', 'Um ou mais arquivos duráveis do carrossel não foram encontrados.')

    const items: CarouselExportItem[] = []
    for (const row of rows) {
      const file = filesById.get(row.library_file_id as string)
      if (!file || file.project_id !== editorialContent.project_id) throw new CarouselExportError('INCOMPLETE', 'Um arquivo do carrossel não pertence ao mesmo Project.')
      if (file.deleted_at) throw new CarouselExportError('INCOMPLETE', 'Um arquivo do carrossel foi removido da Library.')
      if (!isSupportedCarouselImageMimeType(file.mime_type) || !file.storage_path) throw new CarouselExportError('UNSUPPORTED', 'Todos os arquivos do carrossel devem ser imagens estáticas armazenadas.')
      const object = await readS3Object(file.storage_path)
      if (!object) throw new CarouselExportError('INCOMPLETE', 'O storage não está configurado para ler um arquivo do carrossel.')
      items.push({ position: row.position, mimeType: file.mime_type, bytes: object.bytes })
    }

    const zip = buildCarouselZip(authoredSlides.length, items)
    return new Response(zip, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="carousel.zip"',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

