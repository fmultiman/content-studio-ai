import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createS3FolderPlaceholder, deleteS3FolderPlaceholder } from '@/lib/storage/s3'

type LibraryFolderBody = {
  projectId?: string | null
  name?: string | null
  parentPath?: string | null
  ensureProjectRoot?: boolean
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

function normalizeFolder(path: unknown) {
  if (typeof path !== 'string' || !path.trim()) return '/'
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.length > 1 ? withSlash.replace(/\/+$/g, '') : '/'
}

function safeFolderName(name: unknown) {
  if (typeof name !== 'string') return ''
  return name
    .trim()
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

function joinFolderPath(parentPath: string, name: string) {
  const cleanParent = normalizeFolder(parentPath)
  const cleanName = safeFolderName(name)
  return cleanParent === '/' ? `/${cleanName}` : `${cleanParent}/${cleanName}`
}

async function createFolderPlaceholder(userId: string, path: string) {
  try {
    await createS3FolderPlaceholder({
      userId,
      folder: 'library',
      prefix: path,
    })
  } catch (error) {
    console.warn('[Library Folders] S3 placeholder error:', error)
  }
}

async function ensureProjectRootFolder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string,
) {
  const { data: existingRoot, error: existingError } = await supabase
    .from('library_folders')
    .select('*')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .eq('is_project_root', true)
    .maybeSingle()

  if (existingError) throw existingError
  if (existingRoot) return existingRoot

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single()

  if (projectError || !project) {
    throw projectError || new Error('Projeto não encontrado')
  }

  const name = safeFolderName(project.name) || 'Projeto'
  let path = `/${name}`

  const { data: inserted, error: insertError } = await supabase
    .from('library_folders')
    .insert({
      user_id: userId,
      project_id: projectId,
      name,
      path,
      parent_path: '/',
      is_project_root: true,
    })
    .select()
    .single()

  if (!insertError) {
    await createFolderPlaceholder(userId, inserted.path)
    return inserted
  }

  if (insertError.code === '23505') {
    const { data: rootAfterConflict, error: rootAfterConflictError } = await supabase
      .from('library_folders')
      .select('*')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .eq('is_project_root', true)
      .maybeSingle()

    if (rootAfterConflictError) throw rootAfterConflictError
    if (rootAfterConflict) return rootAfterConflict

    path = `/${name}-${projectId.slice(0, 8)}`
    const { data: fallback, error: fallbackError } = await supabase
      .from('library_folders')
      .insert({
        user_id: userId,
        project_id: projectId,
        name,
        path,
        parent_path: '/',
        is_project_root: true,
      })
      .select()
      .single()

    if (fallbackError) throw fallbackError
    await createFolderPlaceholder(userId, fallback.path)
    return fallback
  }

  throw insertError
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    if (!projectId || projectId === 'all') {
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', user.id)

      if (projectsError) {
        return NextResponse.json({ error: projectsError.message, details: projectsError }, { status: 400 })
      }

      await Promise.all((projects || []).map((project) => ensureProjectRootFolder(supabase, user.id, project.id)))

      const { data, error } = await supabase
        .from('library_folders')
        .select('*')
        .eq('user_id', user.id)
        .order('path', { ascending: true })

      if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
      return NextResponse.json({ folders: data || [] })
    }

    await ensureProjectRootFolder(supabase, user.id, projectId)

    const { data, error } = await supabase
      .from('library_folders')
      .select('*')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .order('path', { ascending: true })

    if (error) return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    return NextResponse.json({ folders: data || [] })
  } catch (error) {
    console.error('[Library Folders] GET error:', error)
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

    const body = (await request.json()) as LibraryFolderBody
    const projectId = body.projectId
    const parentPath = normalizeFolder(body.parentPath)
    const name = safeFolderName(body.name)

    if (!projectId || projectId === 'all') {
      return NextResponse.json({ error: 'Selecione um projeto para criar pastas' }, { status: 400 })
    }

    if (body.ensureProjectRoot) {
      const folder = await ensureProjectRootFolder(supabase, user.id, projectId)
      return NextResponse.json({ folder })
    }

    if (!name) {
      return NextResponse.json({ error: 'Nome da pasta obrigatório' }, { status: 400 })
    }

    const path = joinFolderPath(parentPath, name)

    const { data, error } = await supabase
      .from('library_folders')
      .insert({
        user_id: user.id,
        project_id: projectId,
        name,
        path,
        parent_path: parentPath,
        is_project_root: false,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Já existe uma pasta com esse nome nesse local' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    await createFolderPlaceholder(user.id, data.path)
    return NextResponse.json({ folder: data })
  } catch (error) {
    console.error('[Library Folders] POST error:', error)
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

    const body = (await request.json()) as { id?: string | null }
    if (!body.id) {
      return NextResponse.json({ error: 'Pasta obrigatória' }, { status: 400 })
    }

    const { data: folder, error: folderError } = await supabase
      .from('library_folders')
      .select('*')
      .eq('id', body.id)
      .eq('user_id', user.id)
      .single()

    if (folderError || !folder) {
      return NextResponse.json({ error: 'Pasta não encontrada' }, { status: 404 })
    }

    if (folder.is_project_root) {
      return NextResponse.json({ error: 'A pasta raiz do projeto não pode ser excluída' }, { status: 400 })
    }

    const { data: projectFolders, error: foldersError } = await supabase
      .from('library_folders')
      .select('id, path')
      .eq('user_id', user.id)
      .eq('project_id', folder.project_id)

    if (foldersError) {
      return NextResponse.json({ error: foldersError.message, details: foldersError }, { status: 400 })
    }

    const hasChildFolder = (projectFolders || []).some(
      (item) => item.id !== folder.id && item.path.startsWith(`${folder.path}/`),
    )

    if (hasChildFolder) {
      return NextResponse.json({ error: 'Exclua ou mova as subpastas antes de apagar esta pasta' }, { status: 400 })
    }

    const { data: files, error: filesError } = await supabase
      .from('library_files')
      .select('id, folder')
      .eq('user_id', user.id)
      .eq('project_id', folder.project_id)

    if (filesError) {
      return NextResponse.json({ error: filesError.message, details: filesError }, { status: 400 })
    }

    const hasFiles = (files || []).some(
      (file) => file.folder === folder.path || file.folder.startsWith(`${folder.path}/`),
    )

    if (hasFiles) {
      return NextResponse.json({ error: 'Mova ou exclua os arquivos antes de apagar esta pasta' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('library_folders')
      .delete()
      .eq('id', folder.id)
      .eq('user_id', user.id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message, details: deleteError }, { status: 400 })
    }

    await deleteS3FolderPlaceholder({
      userId: user.id,
      folder: 'library',
      prefix: folder.path,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Library Folders] DELETE error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
