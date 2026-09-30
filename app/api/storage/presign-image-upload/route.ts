import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedImageUpload } from '@/lib/storage/s3'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const { folder = 'posts', mimeType, filename, prefix } = await request.json()

    if (typeof mimeType !== 'string') {
      return NextResponse.json({ error: 'Tipo de arquivo obrigatório' }, { status: 400 })
    }

    const signed = await createPresignedImageUpload({
      userId: user.id,
      // 'images' is written only by the server-side generators (uploadImageToS3); no caller presigns into it.
      folder: folder === 'library' ? folder : 'posts',
      mimeType,
      filename,
      prefix,
    })

    if (!signed) {
      return NextResponse.json({ error: 'Storage S3 não configurado' }, { status: 400 })
    }

    return NextResponse.json(signed)
  } catch (error) {
    console.error('[Presign Image Upload] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
