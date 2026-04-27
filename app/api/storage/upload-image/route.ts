import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const { image, imageUrl, folder = 'posts' } = await request.json()

    if (
      (typeof image !== 'string' || !image.startsWith('data:image/')) &&
      typeof imageUrl !== 'string'
    ) {
      return NextResponse.json({ error: 'Imagem obrigatoria' }, { status: 400 })
    }

    let uploadInput:
      | { dataUrl: string }
      | { buffer: Buffer; mimeType: string }

    if (typeof image === 'string' && image.startsWith('data:image/')) {
      uploadInput = { dataUrl: image }
    } else {
      const remoteResponse = await fetch(imageUrl)

      if (!remoteResponse.ok) {
        return NextResponse.json(
          { error: 'Nao foi possivel baixar a imagem original' },
          { status: 400 },
        )
      }

      uploadInput = {
        buffer: Buffer.from(await remoteResponse.arrayBuffer()),
        mimeType: remoteResponse.headers.get('content-type') || 'image/png',
      }
    }

    const stored = await uploadImageToS3({
      userId: user.id,
      folder: folder === 'images' ? 'images' : 'posts',
      ...uploadInput,
    })

    if (!stored) {
      return NextResponse.json(
        { error: 'Storage S3 nao configurado' },
        { status: 400 },
      )
    }

    const signedImageUrl = await createPresignedReadUrl(stored.storagePath)

    return NextResponse.json({
      ...stored,
      imageUrl: signedImageUrl || stored.imageUrl,
      publicUrl: stored.imageUrl,
    })
  } catch (error) {
    console.error('[Storage Upload Image] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
