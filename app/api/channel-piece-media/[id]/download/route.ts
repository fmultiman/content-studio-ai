import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { UUID_RE } from '../../_helpers'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/channel-piece-media/[id]/download
// Generates a signed URL with Content-Disposition: attachment and redirects to it.
// The browser follows the redirect and downloads the file directly from S3.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido' }, { status: 400 })
    }

    const { data: cpm, error: cpmError } = await supabase
      .from('channel_piece_media')
      .select('library_file_id, image_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (cpmError || !cpm) {
      return NextResponse.json({ error: 'Associacao de midia nao encontrada' }, { status: 404 })
    }

    let storagePath: string | null = null
    let filename: string | null = null

    if (cpm.library_file_id) {
      const { data: lf } = await supabase
        .from('library_files')
        .select('storage_path, name')
        .eq('id', cpm.library_file_id)
        .single()
      storagePath = (lf?.storage_path as string | null) ?? null
      filename = (lf?.name as string | null) ?? null
    } else if (cpm.image_id) {
      const { data: img } = await supabase
        .from('images')
        .select('storage_path, user_input')
        .eq('id', cpm.image_id)
        .single()
      storagePath = (img?.storage_path as string | null) ?? null
      filename = (img?.user_input as string | null) ?? 'imagem'
    }

    if (!storagePath) {
      return NextResponse.json({ error: 'Arquivo nao encontrado' }, { status: 404 })
    }

    const url = await createPresignedReadUrl(storagePath, { filename, disposition: 'attachment' })
    if (!url) {
      return NextResponse.json({ error: 'Armazenamento nao configurado' }, { status: 503 })
    }

    return NextResponse.redirect(url, 302)
  } catch (err) {
    console.error('[CPM] download error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
