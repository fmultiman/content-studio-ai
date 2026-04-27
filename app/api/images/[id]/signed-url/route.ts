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

    const { data: image, error } = await supabase
      .from('images')
      .select('id, image_url, thumbnail_url, storage_path, thumbnail_path')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !image) {
      return NextResponse.json({ error: 'Imagem não encontrada' }, { status: 404 })
    }

    const signedImageUrl = image.storage_path
      ? await createPresignedReadUrl(image.storage_path)
      : null
    const signedThumbnailUrl = image.thumbnail_path
      ? await createPresignedReadUrl(image.thumbnail_path)
      : null

    return NextResponse.json({
      imageUrl: signedImageUrl || image.image_url,
      thumbnailUrl: signedThumbnailUrl || image.thumbnail_url,
      publicUrl: image.image_url,
    })
  } catch (error) {
    console.error('[Image Signed URL] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
