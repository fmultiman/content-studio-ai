import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import type { LibraryFileKind } from '@/lib/types'

type LibraryFileBody = {
  ids?: string[]
  projectId?: string | null
  folder?: string
  name?: string
  kind?: string
  mimeType?: string | null
  fileSize?: number | null
  storageProvider?: string | null
  storagePath?: string | null
  publicUrl?: string | null
  thumbnailUrl?: string | null
}

async function getAuthenticatedClient() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return { supabase, user: null }
  return { supabase, user }
}

function normalizeFolder(folder: unknown) {
  if (typeof folder !== 'string' || !folder.trim()) return '/'
  const normalized = folder.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeKind(kind: unknown): LibraryFileKind {
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'document') {
    return kind
  }
  return 'other'
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const folder = searchParams.get('folder')
    const kind = searchParams.get('kind')

    let query = supabase
      .from('library_files')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    if (projectId && projectId !== 'all') query = query.eq('project_id', projectId)
    if (folder && folder !== 'all') query = query.eq('folder', normalizeFolder(folder))
    if (kind && kind !== 'all') query = query.eq('kind', normalizeKind(kind))

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })

    const files = await Promise.all(
      (data || []).map(async (file) => {
        const signedUrl = file.storage_path
          ? await createPresignedReadUrl(file.storage_path)
          : null

        return {
          ...file,
          public_url: signedUrl || file.public_url,
          thumbnail_url: signedUrl || file.thumbnail_url,
        }
      }),
    )

    return NextResponse.json({ files })
  } catch (error) {
    console.error('[Library Files] GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = (await request.json()) as LibraryFileBody
    if (!body.name || !body.storagePath || !body.publicUrl) {
      return NextResponse.json({ error: 'Dados do arquivo obrigatórios' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: body.projectId || null,
        folder: normalizeFolder(body.folder),
        name: body.name,
        kind: normalizeKind(body.kind),
        mime_type: body.mimeType || null,
        file_size: body.fileSize || null,
        storage_provider: body.storageProvider || 's3',
        storage_path: body.storagePath,
        public_url: body.publicUrl,
        thumbnail_url: body.thumbnailUrl || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    return NextResponse.json({ file: data })
  } catch (error) {
    console.error('[Library Files] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = (await request.json()) as LibraryFileBody
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo selecionado' }, { status: 400 })
    }

    const { error } = await supabase
      .from('library_files')
      .delete()
      .in('id', ids)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Library Files] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
