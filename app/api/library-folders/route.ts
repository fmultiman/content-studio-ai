import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type LibraryFolderBody = {
  projectId?: string | null
  name?: string | null
  parentPath?: string | null
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

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedClient()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    if (!projectId || projectId === 'all') {
      return NextResponse.json({ folders: [] })
    }

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
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Já existe uma pasta com esse nome nesse local' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message, details: error }, { status: 400 })
    }

    return NextResponse.json({ folder: data })
  } catch (error) {
    console.error('[Library Folders] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}
