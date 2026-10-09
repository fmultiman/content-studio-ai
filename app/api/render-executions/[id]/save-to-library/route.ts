import { createServiceRoleSupabaseOrNull } from '@/lib/supabase/service-role'
import { NextResponse } from 'next/server'
import { ownedProductionIdOrNull } from '@/lib/library/production-scope'
import { createClient } from '@/lib/supabase/server'
import { copyS3ObjectToLibrary, deleteS3Object } from '@/lib/storage/s3'
import { validateVideoRenderLibrarySource, videoRenderLibraryFilename, type VideoRenderLibrarySource } from '@/lib/render-execution/video-render-library'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function createRenderExecutionReadClient() {
  return createServiceRoleSupabaseOrNull()
}

/**
 * POST /api/render-executions/:id/save-to-library
 *
 * The browser identifies only the render execution. User, Project, VideoDraft,
 * output locator, MIME, byte size and provenance are resolved server-side.
 * Scratch remains intact; the MP4 is copied into users/{user}/library/... and
 * then registered as one durable LibraryFile(origin=studio_render).
 */
export async function POST(_request: Request, context: RouteContext) {
  let copiedStoragePath: string | null = null
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID invalido.', code: 'INVALID_EXECUTION_ID' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })

    const executionReader = createRenderExecutionReadClient()
    if (!executionReader) {
      return NextResponse.json({ error: 'Servico de renderizacao indisponivel.', code: 'RENDER_EXECUTION_SERVICE_UNAVAILABLE' }, { status: 503 })
    }

    const { data: execution, error: executionError } = await executionReader
      .from('render_executions')
      .select('id, user_id, project_id, video_draft_id, kind, status, output_bucket, output_storage_path, output_mime_type, output_size_bytes')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (executionError || !execution) {
      return NextResponse.json({ error: 'Render nao encontrado ou sem acesso.', code: 'RENDER_NOT_FOUND' }, { status: 404 })
    }

    const eligibility = validateVideoRenderLibrarySource(execution as VideoRenderLibrarySource)
    if (!eligibility.ok) {
      const status = eligibility.code === 'EXECUTION_NOT_COMPLETED' || eligibility.code === 'NOT_VIDEO_RENDER' ? 409 : 422
      return NextResponse.json({ error: 'Este render nao pode ser salvo em Arquivos.', code: eligibility.code }, { status })
    }

    // Current Project access is checked independently. `project_id` itself is
    // the frozen server-derived provenance recorded when the render was queued.
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', execution.project_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'Projeto nao encontrado ou sem acesso.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
    }

    const { data: videoDraft } = await supabase
      .from('video_drafts')
      .select('id')
      .eq('id', execution.video_draft_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!videoDraft) {
      return NextResponse.json({ error: 'VideoDraft nao encontrado ou sem acesso.', code: 'VIDEO_DRAFT_NOT_FOUND' }, { status: 404 })
    }

    const { data: projectRoot, error: folderError } = await supabase
      .from('library_folders')
      .select('path')
      .eq('project_id', execution.project_id)
      .eq('user_id', user.id)
      .eq('is_project_root', true)
      .maybeSingle()
    if (folderError) {
      return NextResponse.json({ error: 'Nao foi possivel localizar a pasta do Projeto.', code: 'PROJECT_FOLDER_UNAVAILABLE' }, { status: 500 })
    }

    // Normal-path idempotency: one live durable LibraryFile per render
    // execution. Identity is provenance, never a content hash.
    const { data: existingFile } = await supabase
      .from('library_files')
      .select('*')
      .eq('user_id', user.id)
      .eq('source_render_execution_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (existingFile) {
      if (
        existingFile.project_id !== execution.project_id ||
        existingFile.origin !== 'studio_render' ||
        existingFile.kind !== 'video' ||
        existingFile.mime_type !== 'video/mp4'
      ) {
        return NextResponse.json({ error: 'Proveniencia de arquivo existente inconsistente.', code: 'PROVENANCE_CONFLICT' }, { status: 409 })
      }
      return NextResponse.json({ result: 'already_saved', libraryFile: existingFile }, { status: 200 })
    }

    const filename = videoRenderLibraryFilename(id)
    let copied
    try {
      copied = await copyS3ObjectToLibrary({
        userId: user.id,
        sourcePath: eligibility.storagePath,
        filename,
        mimeType: eligibility.mimeType,
      })
    } catch (error) {
      console.error('[Render save-to-library] source copy failed:', error instanceof Error ? error.message : error)
      return NextResponse.json({ error: 'O arquivo de saida nao esta mais disponivel.', code: 'OUTPUT_UNAVAILABLE' }, { status: 409 })
    }
    if (!copied) {
      return NextResponse.json({ error: 'Storage nao configurado.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    }
    copiedStoragePath = copied.storagePath

    if (copied.fileSize !== eligibility.sizeBytes || copied.mimeType !== eligibility.mimeType) {
      await deleteS3Object(copied.storagePath).catch(() => undefined)
      copiedStoragePath = null
      return NextResponse.json({ error: 'O objeto armazenado nao corresponde ao output concluido.', code: 'OUTPUT_METADATA_MISMATCH' }, { status: 409 })
    }

    // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1: render execution -> video draft -> Production (server chain, never the browser).
    let renderProductionId: string | null = null
    if (execution.video_draft_id) {
      const { data: draft } = await supabase.from('video_drafts').select('production_id').eq('id', execution.video_draft_id).eq('user_id', user.id).maybeSingle()
      renderProductionId = await ownedProductionIdOrNull(supabase, { userId: user.id, projectId: execution.project_id, productionId: draft?.production_id ?? null })
    }

    const { data: libraryFile, error: insertError } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: execution.project_id,
        production_id: renderProductionId,
        folder: projectRoot?.path || '/',
        name: filename,
        kind: 'video',
        mime_type: eligibility.mimeType,
        file_size: copied.fileSize,
        storage_provider: 's3',
        storage_path: copied.storagePath,
        public_url: copied.publicUrl,
        thumbnail_url: null,
        origin: 'studio_render',
        source_render_execution_id: id,
      })
      .select()
      .single()
    if (insertError || !libraryFile) {
      console.error('[Render save-to-library] LibraryFile insert failed:', insertError)
      await deleteS3Object(copied.storagePath).catch((error) => {
        console.error('[Render save-to-library] compensation failed:', error)
      })
      copiedStoragePath = null
      return NextResponse.json({ error: 'Nao foi possivel registrar o video em Arquivos.', code: 'LIBRARY_FILE_CREATE_FAILED' }, { status: 500 })
    }

    copiedStoragePath = null
    return NextResponse.json({ result: 'created', libraryFile }, { status: 201 })
  } catch (error) {
    console.error('[Render save-to-library] unexpected error:', error)
    if (copiedStoragePath) await deleteS3Object(copiedStoragePath).catch(() => undefined)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
