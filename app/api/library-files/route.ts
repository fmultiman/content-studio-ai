import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildStoragePublicUrl, headS3Object, moveLibraryS3Object } from '@/lib/storage/s3'
import { checkLibraryStoragePath, isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { deleteLibraryObject, presignLibraryRead } from '@/lib/storage/library-storage'
import { resolveOwnedProductionContext } from '@/lib/library/production-scope'
import type { LibraryFileKind } from '@/lib/types'
import { parseImageSourceProfile, sourceFormatErrorCopy, sourceMaxBytes, sourceMimeTypes, sourceSizeErrorCopy } from '@/lib/media-source/profile'

// LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1
//
// A LibraryFile row is user-writable, so neither the row's storage_path nor any
// browser-supplied Project/kind/url is an authority. Every write here re-derives
// or validates them server-side, and every S3 operation proves the key is the
// OWNER's own Library key first (lib/storage/library-path.ts). The same rule is
// enforced in the database (scripts/046) so the PostgREST path cannot bypass it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/** True only for a Project that exists AND belongs to this user. A browser-supplied uuid is not proof. */
async function userOwnsProject(supabase: SupabaseServer, userId: string, projectId: unknown): Promise<boolean> {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return false
  const { data, error } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', userId).maybeSingle()
  return !error && !!data
}

function kindFromMime(mimeType: string | null | undefined): LibraryFileKind {
  const mime = (mimeType || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime === 'application/pdf' || mime.includes('document') || mime.includes('spreadsheet') || mime.includes('presentation')) return 'document'
  return 'other'
}

type LibraryFileBody = {
  profile?: string
  ids?: string[]
  projectId?: string | null
  /** Optional Production context for an upload (verified server-side against the Project). */
  productionId?: string | null
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
        // Sign only a key that is provably this owner's Library object.
        const signedUrl = await presignLibraryRead(file).catch(() => null)

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

      // A Project id that came straight from the browser must be the user's own.
      // `null` (no Project) and a folder's own Project (resolved below, owner-scoped) are fine.
      if (!body.targetFolderId && targetProjectId !== undefined && targetProjectId !== null) {
        if (!(await userOwnsProject(supabase, user.id, targetProjectId))) {
          return NextResponse.json({ error: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
        }
      }

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
        // Only the owner's own Library key is ever re-keyed in S3.
        const moved = file.storage_path && isTrustedLibraryStoragePath(user.id, file.storage_path)
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
          // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1: folder organization is independent of Production, so a move inside
          // the SAME Project keeps it; a move to ANOTHER Project cannot keep a Production of the old one.
          if (targetProjectId !== file.project_id) updatePayload.production_id = null
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
    const profile = parseImageSourceProfile(body.profile)
    if (!profile) return NextResponse.json({ error: 'Perfil de imagem inválido.', code: 'INVALID_SOURCE_PROFILE' }, { status: 400 })
    const maxBytes = sourceMaxBytes(profile)
    if (typeof body.name !== 'string' || !body.name.trim() || typeof body.storagePath !== 'string') {
      return NextResponse.json({ error: 'Dados do arquivo obrigatórios' }, { status: 400 })
    }

    // The key must be one of THIS user's own Library keys. Another tenant's namespace,
    // a URL, a traversal-like or malformed key is refused without saying why.
    const pathCheck = checkLibraryStoragePath(user.id, body.storagePath)
    if (!pathCheck.ok) {
      return NextResponse.json({ error: 'Caminho de armazenamento inválido.', code: 'INVALID_STORAGE_PATH' }, { status: 400 })
    }

    if ((body.projectId || maxBytes !== null) && !(await userOwnsProject(supabase, user.id, body.projectId))) {
      return NextResponse.json({ error: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
    }

    // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1: a Production is optional context. When the browser names one it must be
    // the user's own AND belong to this Project; otherwise the file is simply unscoped (NULL).
    let productionId: string | null = null
    if (body.productionId) {
      const context = await resolveOwnedProductionContext(supabase, { userId: user.id, projectId: body.projectId ?? null, productionId: body.productionId })
      if (!context.ok) return NextResponse.json({ error: 'Production não encontrada neste Projeto.', code: 'PRODUCTION_NOT_FOUND' }, { status: 404 })
      productionId = context.productionId
    }

    // The object must really exist; its size is what S3 reports, not what the browser says.
    let stored: Awaited<ReturnType<typeof headS3Object>>
    try {
      stored = await headS3Object(pathCheck.path)
    } catch {
      return NextResponse.json({ error: 'O arquivo enviado não foi encontrado.', code: 'UPLOAD_NOT_FOUND' }, { status: 400 })
    }
    if (!stored) return NextResponse.json({ error: 'Storage não configurado.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    if (stored.size <= 0) return NextResponse.json({ error: 'O arquivo enviado está vazio.', code: 'UPLOAD_NOT_FOUND' }, { status: 400 })

    if (maxBytes !== null) {
      // Enforce the cap on the actual object, even when the upload's claimed size was smaller.
      if (stored.size > maxBytes) {
        return NextResponse.json({ error: sourceSizeErrorCopy(profile), code: 'REFERENCE_TOO_LARGE' }, { status: 400 })
      }
      if (!stored.contentType || !sourceMimeTypes(profile).includes(stored.contentType)) {
        return NextResponse.json({ error: sourceFormatErrorCopy(profile), code: 'REFERENCE_FORMAT_UNSUPPORTED' }, { status: 400 })
      }
    }
    const mimeType = maxBytes !== null ? stored.contentType! : (typeof body.mimeType === 'string' && body.mimeType.trim()) || stored.contentType || null

    const { data, error } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: body.projectId || null,
        production_id: productionId,
        folder: normalizeFolder(body.folder),
        name: body.name.trim().slice(0, 255),
        // kind, size and the durable URL are derived here, never trusted from the browser.
        kind: kindFromMime(mimeType),
        mime_type: mimeType,
        file_size: stored.size,
        storage_provider: 's3',
        storage_path: pathCheck.path,
        public_url: buildStoragePublicUrl(pathCheck.path) ?? '',
        thumbnail_url: null,
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
        .select('id, user_id, storage_path')
        .in('id', ids)
        .eq('user_id', user.id)

      if (fetchError) return NextResponse.json({ error: fetchError.message, details: fetchError }, { status: 400 })

      // An object is deleted only when the key is provably this owner's Library key;
      // a forged storage_path never becomes a delete primitive (the row is still removed).
      await Promise.all((files || []).map((file) => deleteLibraryObject(file)))

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
