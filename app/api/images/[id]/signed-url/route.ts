import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { presignImageObject } from '@/lib/storage/image-storage'

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
      .select('id, user_id, image_url, thumbnail_url, storage_path, thumbnail_path')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error || !image) {
      return NextResponse.json({ error: 'Imagem não encontrada' }, { status: 404 })
    }

    // IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1: `images` rows are browser-written, so a stored
    // key is a claim. A row that carries a key must carry the OWNER's own image key, or nothing is
    // signed. A NULL key (legacy provider/data URL representation) keeps its existing behavior.
    const claimed = [
      [image.storage_path, 'original'],
      [image.thumbnail_path, 'thumbnail'],
    ] as const
    if (claimed.some(([path, kind]) => path && !isTrustedImageStoragePath(image.user_id, path, kind))) {
      return NextResponse.json({ error: 'Imagem não encontrada', code: 'IMAGE_NOT_FOUND' }, { status: 404 })
    }

    const signedImageUrl = image.storage_path
      ? await presignImageObject(image.user_id, image.storage_path, 'original')
      : null
    const signedThumbnailUrl = image.thumbnail_path
      ? await presignImageObject(image.user_id, image.thumbnail_path, 'thumbnail')
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
