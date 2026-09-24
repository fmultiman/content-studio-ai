import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPresignedReadUrl, deleteS3Object, moveLibraryS3Object } from '@/lib/storage/s3'
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
  permanent?: boolean
  restore?: boolean
  targetFolder?: string | null
  targetFolderId?: string | null
  targetProjectId?: string | null
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
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/g, '') : '/'
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
    const trash = searchParams.get('trash') === 'true'
    // Template Foundation V1: `origin=upload` (Arquivos) / `origin=studio_render`
    // (Galeria "Imagens geradas"). Absent keeps the historical "everything" list.
    const origin = searchParams.get('origin')
    if (origin && origin !== 'upload' && origin !== 'studio_render' && origin !== 'all') {
      return NextResponse.json({ error: 'origin invalido' }, { status: 400 })
    }

    let query = supabase
      .from('library_files')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })

    query = trash ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
    if (projectId && projectId !== 'all') query = query.eq('project_id', projectId)
    if (folder && folder !== 'all') query = query.eq('folder', normalizeFolder(folder))
    if (kind && kind !== 'all') query = query.eq('kind', normalizeKind(kind))
    if (origin && origin !== 'all') query = query.eq('origin', origin)

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

export async function PATCH(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const body = (await request.json()) as LibraryFileBody
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum arquivo selecionado' }, { status: 400 })
    }

    if (body.restore) {
      const { error } = await supabase
        .from('library_files')
        .update({ deleted_at: null })
        .in('id', ids)
        .eq('user_id', user.id)

      if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    if (body.targetFolder || body.targetFolderId) {
      let targetFolder = normalizeFolder(body.targetFolder)
      let targetProjectId: string | null | undefined = body.targetProjectId

      if (body.targetFolderId) {
        const { data: folder, error: folderError } = await supabase
          .from('library_folders')
          .select('id, project_id, path')
          .eq('id', body.targetFolderId)
          .eq('user_id', user.id)
          .single()

        if (folderError || !folder) {
          return NextResponse.json({ error: 'Pasta de destino não encontrada' }, { status: 404 })
        }

        targetFolder = normalizeFolder(folder.path)
        targetProjectId = folder.project_id
      }

      const { data: files, error: fetchError } = await supabase
        .from('library_files')
        .select('*')
        .in('id', ids)
        .eq('user_id', user.id)
        .is('deleted_at', null)

      if (fetchError) return NextResponse.json({ error: fetchError.message, details: fetchError }, { status: 400 })

      const movedFiles = []
      for (const file of files || []) {
        const moved = file.storage_path
          ? await moveLibraryS3Object({
              userId: user.id,
              currentPath: file.storage_path,
              targetFolder,
            })
          : null

        const updatePayload: Record<string, unknown> = {
          folder: targetFolder,
          storage_path: moved?.storagePath || file.storage_path,
          public_url: moved?.publicUrl || file.public_url,
        }

        if (targetProjectId !== undefined) {
          updatePayload.project_id = targetProjectId
        }

        const { data: updated, error: updateError } = await supabase
          .from('library_files')
          .update(updatePayload)
          .eq('id', file.id)
          .eq('user_id', user.id)
          .select()
          .single()

        if (updateError) return NextResponse.json({ error: updateError.message, details: updateError }, { status: 400 })
        movedFiles.push(updated)
      }

      return NextResponse.json({ ok: true, files: movedFiles })
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  } catch (error) {
    console.error('[Library Files] PATCH error:', error)
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

    if (body.permanent) {
      const { data: files, error: fetchError } = await supabase
        .from('library_files')
        .select('id, storage_path')
        .in('id', ids)
        .eq('user_id', user.id)

      if (fetchError) return NextResponse.json({ error: fetchError.message, details: fetchError }, { status: 400 })

      await Promise.all(
        (files || [])
          .map((file) => file.storage_path)
          .filter(Boolean)
          .map((path) => deleteS3Object(path)),
      )

      const { error } = await supabase
        .from('library_files')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id)

      if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase
      .from('library_files')
      .update({ deleted_at: new Date().toISOString() })
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
