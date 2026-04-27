import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { data: file, error } = await supabase
      .from('library_files')
      .select('id, user_id, name, storage_path, public_url')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !file) {
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 })
    }

    if (!file.storage_path) {
      return NextResponse.redirect(file.public_url)
    }

    const downloadUrl = await createPresignedReadUrl(file.storage_path, {
      filename: file.name,
      disposition: 'attachment',
    })

    if (!downloadUrl) {
      return NextResponse.json({ error: 'Storage não configurado' }, { status: 500 })
    }

    return NextResponse.redirect(downloadUrl)
  } catch (error) {
    console.error('[Library Files] Download error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
