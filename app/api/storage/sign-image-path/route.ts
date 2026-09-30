import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkImageStoragePath } from '@/lib/storage/image-path'
import { presignImageObject } from '@/lib/storage/image-storage'

function normalizeStoragePath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = new URL(value)
    const parts = parsed.pathname
      .split('/')
      .map((part) => decodeURIComponent(part))
      .filter(Boolean)
    const usersIndex = parts.indexOf('users')

    if (usersIndex >= 0) {
      return parts.slice(usersIndex).join('/')
    }
  } catch {
    // The value can already be a storage path.
  }

  return value.replace(/\\/g, '/').replace(/^\/+/, '')
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

    const body = await request.json()
    const storagePath = normalizeStoragePath(body.storagePath || body.imageUrl)

    // IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1: this route exists to re-sign the stored display URL
    // of an image that may not (yet) have a row (draft attempts keep only the URL), so it cannot resolve by
    // image id. The authority is therefore the canonical key itself: the authenticated user's own
    // `users/{me}/images/{uuid}/(original.ext|thumb.webp)` and nothing else. A prefix test is not enough:
    // `users/{me}/images/../{other}/...` starts with the prefix.
    const check = storagePath ? checkImageStoragePath(user.id, storagePath) : null
    if (!check || !check.ok) {
      return NextResponse.json({ error: 'Caminho de imagem invalido', code: 'INVALID_STORAGE_PATH' }, { status: 400 })
    }

    const imageUrl = await presignImageObject(user.id, check.path, check.kind)

    if (!imageUrl) {
      return NextResponse.json({ error: 'Storage nao configurado' }, { status: 400 })
    }

    return NextResponse.json({ imageUrl, storagePath: check.path })
  } catch (error) {
    console.error('[Sign Image Path] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
