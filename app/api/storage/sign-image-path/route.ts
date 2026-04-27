import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'

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
    const allowedPrefix = `users/${user.id}/images/`

    if (!storagePath || !storagePath.startsWith(allowedPrefix)) {
      return NextResponse.json({ error: 'Caminho de imagem invalido' }, { status: 400 })
    }

    const imageUrl = await createPresignedReadUrl(storagePath)

    if (!imageUrl) {
      return NextResponse.json({ error: 'Storage nao configurado' }, { status: 400 })
    }

    return NextResponse.json({ imageUrl, storagePath })
  } catch (error) {
    console.error('[Sign Image Path] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
