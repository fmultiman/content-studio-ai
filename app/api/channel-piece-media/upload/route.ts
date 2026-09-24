import { NextResponse } from 'next/server'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { deleteS3Object, uploadLibraryFile } from '@/lib/storage/s3'
import type { LibraryFileKind } from '@/lib/types'
import { UUID_RE, mapPgError, resolveMediaSource } from '../_helpers'

// POST /api/channel-piece-media/upload
// Orchestrates: S3 upload → library_file creation → CPM creation.
// Accepts multipart/form-data with fields: file (File), channelPieceId (string)
// and, only for the Creative Editor's explicit "Salvar nesta peca", an optional
// renderExecutionId (string). Compensates partially-created resources on failure.
//
// Creative Editor Template Foundation V1: renderExecutionId classifies the new
// LibraryFile as origin='studio_render' (discovered under Galeria / "Imagens
// geradas", not Arquivos). It is honoured only after the server verifies the
// execution is the caller's own COMPLETED static_still render of this same
// ChannelPiece; otherwise the request is rejected. Persistence is unchanged:
// still one LibraryFile + one ChannelPieceMedia.

/** render_executions is server-only (no browser SELECT policy, see 031/032). */
function createRenderExecutionReadClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

function mimeToKind(mimeType: string): LibraryFileKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  return 'other'
}

function sanitizeFilename(name: string): string {
  const safe = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
  return safe || 'arquivo'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  // Track created resources for Caso D compensation
  let storagePath: string | null = null
  let libraryFileId: string | null = null

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // Parse multipart form data
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        { error: 'Body invalido: multipart/form-data esperado' },
        { status: 400 },
      )
    }

    const channelPieceId = ((formData.get('channelPieceId') as string | null) ?? '').trim()
    const file = formData.get('file')
    const renderExecutionId = ((formData.get('renderExecutionId') as string | null) ?? '').trim() || null

    // Validate channelPieceId
    if (!channelPieceId) {
      return NextResponse.json({ error: 'channelPieceId obrigatorio' }, { status: 400 })
    }
    if (!UUID_RE.test(channelPieceId)) {
      return NextResponse.json({ error: 'channelPieceId invalido' }, { status: 400 })
    }

    // Validate file
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo obrigatorio' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Arquivo nao pode ser vazio' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `O arquivo excede o limite de ${MAX_FILE_BYTES / 1024 / 1024} MB` },
        { status: 400 },
      )
    }

    const mimeType = file.type
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          error:
            'Arquivo nao suportado. Formatos aceitos: JPEG, PNG, WebP, GIF, MP4, WebM, MOV.',
        },
        { status: 400 },
      )
    }

    // Verify CP ownership and derive projectId via CP → EC chain
    const { data: cp, error: cpError } = await supabase
      .from('channel_pieces')
      .select('id, editorial_content_id')
      .eq('id', channelPieceId)
      .eq('user_id', user.id)
      .single()

    if (cpError || !cp) {
      return NextResponse.json(
        { error: 'ChannelPiece nao encontrada ou nao autorizada' },
        { status: 404 },
      )
    }

    const { data: ec, error: ecError } = await supabase
      .from('editorial_contents')
      .select('project_id')
      .eq('id', cp.editorial_content_id)
      .eq('user_id', user.id)
      .single()

    if (ecError || !ec) {
      console.error('[CPM Upload] EC lookup failed:', ecError)
      return NextResponse.json({ error: 'Erro interno ao resolver Projeto' }, { status: 500 })
    }

    const projectId = ec.project_id
    if (!projectId) {
      return NextResponse.json(
        { error: 'ChannelPiece nao pertence a um Projeto' },
        { status: 400 },
      )
    }

    if (renderExecutionId) {
      if (!UUID_RE.test(renderExecutionId)) {
        return NextResponse.json({ error: 'renderExecutionId invalido' }, { status: 400 })
      }
      if (mimeType !== 'image/png') {
        return NextResponse.json({ error: 'Render estatico deve ser PNG' }, { status: 400 })
      }
      const executionReader = createRenderExecutionReadClient()
      if (!executionReader) {
        return NextResponse.json({ error: 'Servico de renderizacao indisponivel.' }, { status: 503 })
      }
      const { data: execution } = await executionReader
        .from('render_executions')
        .select('id, kind, status, channel_piece_id')
        .eq('id', renderExecutionId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!execution || execution.kind !== 'static_still' || execution.status !== 'completed' || execution.channel_piece_id !== channelPieceId) {
        return NextResponse.json({ error: 'Render nao encontrado para esta peca.' }, { status: 404 })
      }

      // Authoring Usability Completion V1 — idempotent per render output:
      // ONE durable LibraryFile per render execution. If this execution was
      // already saved, never upload a second copy: return the existing
      // attachment, or re-attach the existing LibraryFile if its media row
      // was removed from this piece. Identity = the execution, not pixels,
      // so a NEW render of identical content can still be saved.
      const { data: existingFile } = await supabase
        .from('library_files')
        .select('*')
        .eq('user_id', user.id)
        .eq('source_render_execution_id', renderExecutionId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (existingFile) {
        const { data: existingMedia } = await supabase
          .from('channel_piece_media')
          .select('*')
          .eq('channel_piece_id', channelPieceId)
          .eq('library_file_id', existingFile.id)
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle()
        if (existingMedia) {
          const resolvedExisting = { ...existingMedia, ...(await resolveMediaSource(supabase, existingMedia)) }
          return NextResponse.json({ channelPieceMedium: resolvedExisting, libraryFile: existingFile, alreadyAttached: true }, { status: 200 })
        }
        const { data: siblings } = await supabase
          .from('channel_piece_media')
          .select('position, role')
          .eq('channel_piece_id', channelPieceId)
          .eq('user_id', user.id)
        const items = (siblings ?? []) as { position: number; role: string }[]
        const { data: reattached, error: reattachError } = await supabase
          .from('channel_piece_media')
          .insert({
            user_id: user.id,
            channel_piece_id: channelPieceId,
            image_id: null,
            library_file_id: existingFile.id,
            position: items.length > 0 ? Math.max(...items.map((item) => item.position)) + 1 : 0,
            role: items.some((item) => item.role === 'primary') ? 'carousel_item' : 'primary',
            alt_text: null,
          })
          .select()
          .single()
        if (reattachError || !reattached) {
          const mapped = reattachError ? mapPgError(reattachError.code, reattachError.message) : null
          if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
          return NextResponse.json({ error: 'Nao foi possivel adicionar a midia a versao. Tente novamente.' }, { status: 500 })
        }
        const resolvedReattached = { ...reattached, ...(await resolveMediaSource(supabase, reattached)) }
        return NextResponse.json({ channelPieceMedium: resolvedReattached, libraryFile: existingFile, reattached: true }, { status: 201 })
      }
    }

    // Step 1: Upload to S3 (Caso A — failure here leaves no residue)
    const safeName = sanitizeFilename(file.name || 'arquivo')
    const buffer = Buffer.from(await file.arrayBuffer())

    const uploaded = await uploadLibraryFile({
      userId: user.id,
      filename: safeName,
      mimeType,
      buffer,
    })

    if (!uploaded) {
      return NextResponse.json(
        { error: 'Storage nao configurado. Contate o administrador.' },
        { status: 503 },
      )
    }

    storagePath = uploaded.storagePath

    // Step 2: Create library_file (Caso B — compensate by deleting S3 object)
    const kind = mimeToKind(mimeType)
    const { data: lf, error: lfError } = await supabase
      .from('library_files')
      .insert({
        user_id: user.id,
        project_id: projectId,
        folder: '/',
        name: safeName,
        kind,
        mime_type: mimeType,
        file_size: uploaded.fileSize,
        storage_provider: 's3',
        storage_path: uploaded.storagePath,
        public_url: uploaded.publicUrl,
        thumbnail_url: null,
        // Discovery classification only (migration 035): a verified studio
        // render surfaces in Galeria; everything else stays an upload.
        ...(renderExecutionId ? { origin: 'studio_render', source_render_execution_id: renderExecutionId } : {}),
      })
      .select()
      .single()

    if (lfError || !lf) {
      console.error('[CPM Upload] library_file insert failed:', lfError)
      await deleteS3Object(storagePath).catch((e) => {
        console.error('[CPM Upload] Compensation B: S3 orphan at', storagePath, e)
      })
      return NextResponse.json(
        { error: 'Nao foi possivel registrar o arquivo. Tente novamente.' },
        { status: 500 },
      )
    }

    libraryFileId = lf.id

    // Step 3: Determine role + position (server-side, same rules as M4 picker)
    const { data: existingCpm } = await supabase
      .from('channel_piece_media')
      .select('position, role')
      .eq('channel_piece_id', channelPieceId)
      .eq('user_id', user.id)
      .order('position', { ascending: false })

    const existingItems = (existingCpm ?? []) as { position: number; role: string }[]
    const nextRole = existingItems.some((i) => i.role === 'primary') ? 'carousel_item' : 'primary'
    const nextPosition =
      existingItems.length > 0
        ? Math.max(...existingItems.map((i) => i.position)) + 1
        : 0

    // Step 4: Create CPM (Caso C — compensate by deleting library_file + S3 object)
    const { data: cpm, error: cpmError } = await supabase
      .from('channel_piece_media')
      .insert({
        user_id: user.id,
        channel_piece_id: channelPieceId,
        image_id: null,
        library_file_id: lf.id,
        position: nextPosition,
        role: nextRole,
        alt_text: null,
      })
      .select()
      .single()

    if (cpmError || !cpm) {
      console.error('[CPM Upload] CPM insert failed:', cpmError)
      const mapped = cpmError ? mapPgError(cpmError.code, cpmError.message) : null
      // Compensation C
      await supabase
        .from('library_files')
        .delete()
        .eq('id', lf.id)
        .eq('user_id', user.id)
        .then(null, (e: unknown) => {
          console.error('[CPM Upload] Compensation C: library_file delete failed:', e)
        })
      await deleteS3Object(storagePath).catch((e: unknown) => {
        console.error('[CPM Upload] Compensation C: S3 delete failed:', e)
      })
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status })
      return NextResponse.json(
        { error: 'Nao foi possivel adicionar a midia a versao. Tente novamente.' },
        { status: 500 },
      )
    }

    const resolved = { ...cpm, ...(await resolveMediaSource(supabase, cpm)) }
    return NextResponse.json({ channelPieceMedium: resolved, libraryFile: lf }, { status: 201 })
  } catch (err) {
    console.error('[CPM Upload] Unexpected error:', err)
    // Caso D: unexpected error — attempt cleanup of any created resources
    const cleanups: Promise<unknown>[] = []
    if (storagePath) {
      cleanups.push(
        deleteS3Object(storagePath).catch((e) => {
          console.error('[CPM Upload] Caso D: S3 orphan at', storagePath, e)
        }),
      )
    }
    if (libraryFileId) {
      cleanups.push(
        Promise.resolve(
          supabase.from('library_files').delete().eq('id', libraryFileId),
        ).catch((e: unknown) => {
          console.error('[CPM Upload] Caso D: library_file orphan', libraryFileId, e)
        }),
      )
    }
    if (cleanups.length > 0) await Promise.allSettled(cleanups)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
