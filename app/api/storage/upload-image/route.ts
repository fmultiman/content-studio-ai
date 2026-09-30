import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { NANOBANANA_RESULT_IMAGE_POLICY, RemoteImageError, fetchRemoteImage } from '@/lib/security/safe-remote-image'

// STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1
//
// The only caller (/imagens, Nano Banana completion) sends the provider's result URL. That URL round-trips
// through browser-writable state, so it is never fetched as-is: fetchRemoteImage enforces the provider host
// allowlist, resolves DNS once and pins the connection to the validated public address, revalidates every
// redirect, bounds time and size, and requires a real image signature. A `data:image/` upload never touches
// the network and is unchanged.
const REMOTE_IMAGE_STATUS: Record<RemoteImageError['code'], number> = {
  REMOTE_IMAGE_URL_INVALID: 400,
  REMOTE_IMAGE_HOST_NOT_ALLOWED: 400,
  REMOTE_IMAGE_FETCH_FAILED: 400,
  REMOTE_IMAGE_TOO_LARGE: 413,
  REMOTE_IMAGE_INVALID_CONTENT: 400,
}

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
      try {
        const remote = await fetchRemoteImage(imageUrl, NANOBANANA_RESULT_IMAGE_POLICY)
        uploadInput = { buffer: remote.buffer, mimeType: remote.mimeType }
      } catch (error) {
        if (error instanceof RemoteImageError) {
          // Category and policy reason only: never the URL (its query string can carry a signature) or any
          // resolved address. The client gets the bounded code, nothing about the network.
          console.warn('[Storage Upload Image] remote image refused:', error.code, error.reason)
          return NextResponse.json(
            { error: 'Nao foi possivel baixar a imagem original', code: error.code },
            { status: REMOTE_IMAGE_STATUS[error.code] },
          )
        }
        throw error
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
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
