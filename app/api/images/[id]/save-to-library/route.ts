import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { copyS3ObjectToLibrary, deleteS3Object } from '@/lib/storage/s3'
import {
  MAX_LIBRARY_IMAGE_BYTES,
  generatedImageLibraryFilename,
  isSchemaNotReadyError,
  isUniqueViolation,
  validateGeneratedImageForLibrary,
} from '@/lib/images/library-promotion'

// GENERATED_IMAGE_LIBRARY_PROMOTION_V1
//
// GET  /api/images/:id/save-to-library  -> durable "saved in Arquivos" state for one generated image
// POST /api/images/:id/save-to-library  -> explicit promotion ("Salvar em Arquivos")
//
// The browser names an image; nothing else is trusted. `images` rows are written from the
// browser, so storage_path / project_id / mime_type are re-validated here: the object must be
// an original image inside THIS user's own images namespace, and the Project must belong to
// the caller. The bytes are COPIED into the canonical Library namespace, so the LibraryFile
// outlives the generated-image history. The provider is never contacted, no usage event is
// written and no authoring object (ChannelPieceMedia, VideoDraft, ...) is created.
//
// Idempotency: `library_files.source_image_id` + a UNIQUE partial index (active rows only,
// migration 045) is the final authority. A request that loses a race removes its own copy and
// returns the winner's file. Remaining crash window: a process death between the S3 copy and the
// row insert leaves one unreferenced object (no row), which is invisible to the user.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILE_COLUMNS = 'id, user_id, project_id, name, kind, mime_type, file_size, folder, source_image_id, deleted_at, created_at'

const SCHEMA_NOT_READY = { error: 'Salvar em Arquivos ainda não está disponível.', code: 'SCHEMA_NOT_READY' }

async function authenticate() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user: error ? null : user }
}

async function loadImage(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  return supabase.from('images').select('id, user_id, project_id, storage_path').eq('id', id).eq('user_id', userId).maybeSingle()
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID inválido.', code: 'INVALID_IMAGE_ID' }, { status: 400 })

    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { data: image } = await loadImage(supabase, user.id, id)
    if (!image) return NextResponse.json({ error: 'Imagem não encontrada.', code: 'NOT_FOUND' }, { status: 404 })

    const { data: active, error } = await supabase
      .from('library_files')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('source_image_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    // Without the column the feature is simply unavailable: the page must keep working.
    if (error) {
      if (isSchemaNotReadyError(error)) return NextResponse.json({ available: false, saved: null, promotable: false })
      return NextResponse.json({ error: 'Não foi possível consultar Arquivos.', code: 'LOOKUP_FAILED' }, { status: 500 })
    }

    const eligibility = validateGeneratedImageForLibrary(image, user.id)
    return NextResponse.json({ available: true, saved: active ?? null, promotable: eligibility.ok })
  } catch (error) {
    console.error('[Image save-to-library GET] error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(_request: Request, context: RouteContext) {
  let copiedPath: string | null = null
  const discardCopy = async () => {
    if (copiedPath) await deleteS3Object(copiedPath).catch((error) => console.error('[Image save-to-library] object cleanup failed:', error))
    copiedPath = null
  }

  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'ID inválido.', code: 'INVALID_IMAGE_ID' }, { status: 400 })

    const { supabase, user } = await authenticate()
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

    const { data: image, error: imageError } = await loadImage(supabase, user.id, id)
    if (imageError || !image) return NextResponse.json({ error: 'Imagem não encontrada ou acesso negado.', code: 'NOT_FOUND' }, { status: 404 })

    const eligibility = validateGeneratedImageForLibrary(image, user.id)
    if (!eligibility.ok) {
      return NextResponse.json({ error: 'Esta imagem não pode ser salva em Arquivos.', code: eligibility.code }, { status: 422 })
    }

    // The project named by the row is context, not authority: the caller must own it.
    const { data: project } = await supabase.from('projects').select('id').eq('id', image.project_id).eq('user_id', user.id).maybeSingle()
    if (!project) return NextResponse.json({ error: 'Projeto não encontrado ou sem acesso.', code: 'PROJECT_NOT_FOUND' }, { status: 404 })

    const findActive = () =>
      supabase.from('library_files').select(FILE_COLUMNS).eq('user_id', user.id).eq('source_image_id', id).is('deleted_at', null).maybeSingle()

    const { data: existing, error: lookupError } = await findActive()
    if (lookupError) {
      if (isSchemaNotReadyError(lookupError)) return NextResponse.json(SCHEMA_NOT_READY, { status: 503 })
      return NextResponse.json({ error: 'Não foi possível consultar Arquivos.', code: 'LOOKUP_FAILED' }, { status: 500 })
    }
    if (existing) return NextResponse.json({ result: 'already_saved', libraryFile: existing }, { status: 200 })

    const { data: projectRoot, error: folderError } = await supabase
      .from('library_folders')
      .select('path')
      .eq('project_id', image.project_id)
      .eq('user_id', user.id)
      .eq('is_project_root', true)
      .maybeSingle()
    if (folderError) return NextResponse.json({ error: 'Não foi possível localizar a pasta do Projeto.', code: 'PROJECT_FOLDER_UNAVAILABLE' }, { status: 500 })

    const filename = generatedImageLibraryFilename(image.id, eligibility.extension)
    let copied
    try {
      copied = await copyS3ObjectToLibrary({ userId: user.id, sourcePath: eligibility.storagePath, filename, mimeType: eligibility.mimeType })
    } catch (error) {
      console.error('[Image save-to-library] source copy failed:', error instanceof Error ? error.message : error)
      return NextResponse.json({ error: 'O arquivo da imagem não está mais disponível.', code: 'OUTPUT_UNAVAILABLE' }, { status: 409 })
    }
    if (!copied) return NextResponse.json({ error: 'Storage não configurado.', code: 'STORAGE_UNAVAILABLE' }, { status: 503 })
    copiedPath = copied.storagePath

    // The stored object must really be an image of the type its key claims (the row is not trusted).
    if (copied.mimeType !== eligibility.mimeType || copied.fileSize <= 0 || copied.fileSize > MAX_LIBRARY_IMAGE_BYTES) {
      await discardCopy()
      return NextResponse.json({ error: 'O objeto armazenado não é uma imagem válida.', code: 'INVALID_IMAGE_OBJECT' }, { status: 422 })
    }

    const { data: libraryFile, error: insertError } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: image.project_id,
        folder: projectRoot?.path || '/',
        name: filename,
        kind: 'image',
        mime_type: eligibility.mimeType,
        file_size: copied.fileSize,
        storage_provider: 's3',
        storage_path: copied.storagePath,
        public_url: copied.publicUrl,
        thumbnail_url: null,
        source_image_id: image.id,
      })
      .select(FILE_COLUMNS)
      .single()

    if (insertError || !libraryFile) {
      await discardCopy()
      if (isUniqueViolation(insertError)) {
        // Lost the race: an active file for this image already exists. Return the winner's.
        const { data: winner } = await findActive()
        if (winner) return NextResponse.json({ result: 'already_saved', libraryFile: winner }, { status: 200 })
        return NextResponse.json({ error: 'O salvamento foi concorrente. Tente novamente.', code: 'CONCURRENT_PROMOTION' }, { status: 409 })
      }
      if (isSchemaNotReadyError(insertError)) return NextResponse.json(SCHEMA_NOT_READY, { status: 503 })
      console.error('[Image save-to-library] LibraryFile insert failed:', insertError)
      return NextResponse.json({ error: 'Não foi possível registrar a imagem em Arquivos.', code: 'LIBRARY_FILE_CREATE_FAILED' }, { status: 500 })
    }

    copiedPath = null
    return NextResponse.json({ result: 'created', libraryFile }, { status: 201 })
  } catch (error) {
    console.error('[Image save-to-library] unexpected error:', error)
    await discardCopy()
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
