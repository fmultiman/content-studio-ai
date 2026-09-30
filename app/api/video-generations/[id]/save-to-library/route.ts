import { NextResponse } from 'next/server'
import { ownedProductionIdOrNull } from '@/lib/library/production-scope'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase, ServiceRoleNotConfiguredError } from '@/lib/supabase/service-role'
import { copyS3ObjectToLibrary, deleteS3Object } from '@/lib/storage/s3'
import { validateGenerationForLibrary, videoGenerationLibraryFilename } from '@/lib/video-generation/library-promotion'

// VIDEO_GENERATION_LIBRARY_PROMOTION_V1
//
// POST /api/video-generations/:id/save-to-library  ("Salvar em Arquivos")
//
// EXPLICIT promotion of ONE succeeded VideoGeneration into ONE durable LibraryFile.
//   - The browser sends only the generation identity. User, Project, object key,
//     MIME and size are resolved server-side; no client-supplied storage path exists.
//   - Only Content Studio storage is touched: the source object is COPIED into the
//     canonical Library namespace (users/{user}/library/...), so the LibraryFile owns
//     an independent object and outlives the generation history row. The provider is
//     never contacted, and no usage event is written (nothing was generated).
//   - It creates no VideoDraft, VideoScene, ChannelPieceMedia or Timeline entry.
//
// Idempotency: `video_generations.library_file_id` is the durable promotion pointer.
// It is claimed with an atomic compare-and-set (`... WHERE library_file_id IS NULL`),
// so under concurrent or repeated requests exactly ONE file is ever linked; a request
// that loses the race removes its own copy and returns the winner's file.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILE_COLUMNS = 'id, user_id, project_id, name, kind, mime_type, file_size, folder, deleted_at, created_at'

export async function POST(_request: Request, context: RouteContext) {
  // Set only while a copied object has no committed row that owns it.
  let orphanStoragePath: string | null = null
  let orphanFileId: string | null = null
  let userIdForCleanup: string | null = null
  const supabaseRef: { current: Awaited<ReturnType<typeof createClient>> | null } = { current: null }

  const discardOwnCopy = async () => {
    if (orphanFileId && userIdForCleanup && supabaseRef.current) {
      await supabaseRef.current.from('library_files').delete().eq('id', orphanFileId).eq('user_id', userIdForCleanup)
        .then(undefined, (error: unknown) => console.error('[Video save-to-library] row cleanup failed:', error))
    }
    if (orphanStoragePath) await deleteS3Object(orphanStoragePath).catch((error) => console.error('[Video save-to-library] object cleanup failed:', error))
    orphanFileId = null
    orphanStoragePath = null
  }

  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID inválido.', code: 'INVALID_GENERATION_ID' }, { status: 400 })
    }

    const supabase = await createClient()
    supabaseRef.current = supabase
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    userIdForCleanup = user.id

    // The user session can only read its own rows (RLS + explicit owner filter).
    const { data: generation, error: generationError } = await supabase
      .from('video_generations')
      .select('id, user_id, project_id, production_id, status, storage_path, library_file_id, result_metadata')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (generationError || !generation) {
      return NextResponse.json({ error: 'Geração não encontrada ou acesso negado.', code: 'NOT_FOUND' }, { status: 404 })
    }

    const eligibility = validateGenerationForLibrary(generation)
    if (!eligibility.ok) {
      const status = eligibility.code === 'GENERATION_NOT_COMPLETED' ? 409 : 422
      return NextResponse.json({ error: 'Esta geração não pode ser salva em Arquivos.', code: eligibility.code }, { status })
    }

    // Current Project access is checked independently of the frozen `project_id` on the row.
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', generation.project_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'Projeto não encontrado ou sem acesso.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })
    }

    // Already promoted? A live LibraryFile makes the action a no-op. A pointer to a file that was
    // since trashed (or a cleared pointer after a hard delete) means "no current LibraryFile":
    // saving again is allowed, matching render -> Arquivos, which also ignores trashed files.
    let staleLinkId: string | null = null
    if (generation.library_file_id) {
      const { data: linked } = await supabase
        .from('library_files')
        .select(FILE_COLUMNS)
        .eq('id', generation.library_file_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (linked && linked.deleted_at == null) {
        if (linked.project_id !== generation.project_id || linked.kind !== 'video') {
          return NextResponse.json({ error: 'Proveniência de arquivo existente inconsistente.', code: 'PROVENANCE_CONFLICT' }, { status: 409 })
        }
        return NextResponse.json({ result: 'already_saved', libraryFile: linked, generation: { id: generation.id, library_file_id: linked.id } }, { status: 200 })
      }
      staleLinkId = generation.library_file_id
    }

    let writeDb
    try {
      writeDb = createServiceRoleSupabase()
    } catch (error) {
      if (error instanceof ServiceRoleNotConfiguredError) {
        return NextResponse.json({ error: 'Serviço indisponível.', code: 'SERVICE_UNAVAILABLE' }, { status: 503 })
      }
      throw error
    }

    const { data: projectRoot, error: folderError } = await supabase
      .from('library_folders')
      .select('path')
      .eq('project_id', generation.project_id)
      .eq('user_id', user.id)
      .eq('is_project_root', true)
      .maybeSingle()
    if (folderError) {
      return NextResponse.json({ error: 'Não foi possível localizar a pasta do Projeto.', code: 'PROJECT_FOLDER_UNAVAILABLE' }, { status: 500 })
    }

    const filename = videoGenerationLibraryFilename(generation.id)
    let copied
    try {
      copied = await copyS3ObjectToLibrary({
        userId: user.id,
        sourcePath: eligibility.storagePath,
        filename,
        mimeType: eligibility.mimeType,
      })
    } catch (error) {
      console.error('[Video save-to-library] source copy failed:', error instanceof Error ? error.message : error)
      return NextResponse.json({ error: 'O arquivo do vídeo não está mais disponível.', code: 'OUTPUT_UNAVAILABLE' }, { status: 409 })
    }
    if (!copied) return NextResponse.json({ error: 'Storage não configurado.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    orphanStoragePath = copied.storagePath

    if (eligibility.expectedSizeBytes !== null && copied.fileSize !== eligibility.expectedSizeBytes) {
      await discardOwnCopy()
      return NextResponse.json({ error: 'O objeto armazenado não corresponde ao vídeo concluído.', code: 'OUTPUT_METADATA_MISMATCH' }, { status: 409 })
    }

    const { data: libraryFile, error: insertError } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: generation.project_id,
        // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1: the generation's own Production (server row, never the browser);
        // NULL if it is not valid for this owner/Project.
        production_id: await ownedProductionIdOrNull(supabase, { userId: user.id, projectId: generation.project_id, productionId: generation.production_id }),
        folder: projectRoot?.path || '/',
        name: filename,
        kind: 'video',
        mime_type: eligibility.mimeType,
        file_size: copied.fileSize,
        storage_provider: 's3',
        storage_path: copied.storagePath,
        public_url: copied.publicUrl,
        thumbnail_url: null,
      })
      .select(FILE_COLUMNS)
      .single()
    if (insertError || !libraryFile) {
      console.error('[Video save-to-library] LibraryFile insert failed:', insertError)
      await discardOwnCopy()
      return NextResponse.json({ error: 'Não foi possível registrar o vídeo em Arquivos.', code: 'LIBRARY_FILE_CREATE_FAILED' }, { status: 500 })
    }
    orphanFileId = libraryFile.id

    // Atomic claim of the promotion pointer. Exactly one caller can flip it from the value it observed.
    let claim = writeDb
      .from('video_generations')
      .update({ library_file_id: libraryFile.id })
      .eq('id', generation.id)
      .eq('user_id', user.id)
    claim = staleLinkId ? claim.eq('library_file_id', staleLinkId) : claim.is('library_file_id', null)
    const { data: claimed, error: claimError } = await claim.select('id')
    let linkedByUs = !claimError && !!claimed && claimed.length > 0
    if (claimError) {
      // The outcome of the write is uncertain: only discard our copy if the pointer is provably not ours.
      console.error('[Video save-to-library] promotion link failed:', claimError)
      const { data: after } = await supabase.from('video_generations').select('library_file_id').eq('id', generation.id).eq('user_id', user.id).maybeSingle()
      if (after?.library_file_id === libraryFile.id) {
        linkedByUs = true
      } else {
        await discardOwnCopy()
        return NextResponse.json({ error: 'Não foi possível concluir o salvamento.', code: 'LINK_FAILED' }, { status: 500 })
      }
    }

    if (!linkedByUs) {
      // Lost the race: someone else already promoted this generation. Drop our copy, return theirs.
      await discardOwnCopy()
      const { data: current } = await supabase
        .from('video_generations')
        .select('library_file_id')
        .eq('id', generation.id)
        .eq('user_id', user.id)
        .maybeSingle()
      const { data: winner } = current?.library_file_id
        ? await supabase.from('library_files').select(FILE_COLUMNS).eq('id', current.library_file_id).eq('user_id', user.id).maybeSingle()
        : { data: null }
      if (!winner || winner.deleted_at != null) {
        return NextResponse.json({ error: 'O salvamento foi concorrente. Tente novamente.', code: 'CONCURRENT_PROMOTION' }, { status: 409 })
      }
      return NextResponse.json({ result: 'already_saved', libraryFile: winner, generation: { id: generation.id, library_file_id: winner.id } }, { status: 200 })
    }

    orphanFileId = null
    orphanStoragePath = null
    return NextResponse.json({ result: 'created', libraryFile, generation: { id: generation.id, library_file_id: libraryFile.id } }, { status: 201 })
  } catch (error) {
    console.error('[Video save-to-library] unexpected error:', error)
    await discardOwnCopy()
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
