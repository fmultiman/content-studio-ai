import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedImageUpload } from '@/lib/storage/s3'
import { isUuid } from '@/lib/library/production-scope'
import { IMAGE_REFERENCE_MAX_BYTES, parseImageSourceProfile, sourceMimeTypes } from '@/lib/media-source/profile'

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

    const { folder = 'posts', mimeType, filename, prefix, profile: rawProfile, projectId, fileSize } = await request.json()
    const profile = parseImageSourceProfile(rawProfile)
    if (!profile) return NextResponse.json({ error: 'Perfil de imagem inválido.', code: 'INVALID_SOURCE_PROFILE' }, { status: 400 })

    if (typeof mimeType !== 'string') {
      return NextResponse.json({ error: 'Tipo de arquivo obrigatório' }, { status: 400 })
    }

    if (profile === 'image-reference') {
      if (folder !== 'library' || !sourceMimeTypes(profile).includes(mimeType)) {
        return NextResponse.json({ error: 'Use uma imagem PNG, JPEG ou WebP.', code: 'REFERENCE_FORMAT_UNSUPPORTED' }, { status: 400 })
      }
      if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > IMAGE_REFERENCE_MAX_BYTES) {
        return NextResponse.json({ error: 'A imagem de referência deve ter até 10 MiB.', code: 'REFERENCE_TOO_LARGE' }, { status: 400 })
      }
      if (!isUuid(projectId)) return NextResponse.json({ error: 'Selecione um Projeto.', code: 'PROJECT_REQUIRED' }, { status: 400 })
      const { data: project, error: projectError } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle()
      if (projectError || !project) return NextResponse.json({ error: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
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
