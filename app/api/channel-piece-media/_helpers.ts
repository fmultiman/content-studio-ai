import { createPresignedReadUrl } from '@/lib/storage/s3'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { presignLibraryRead } from '@/lib/storage/library-storage'
import type { createClient } from '@/lib/supabase/server'
import type { ChannelPieceMediaResolved, LibraryFileKind, LibraryFileOrigin } from '@/lib/types'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type MediaRow = Pick<ChannelPieceMediaResolved, 'image_id' | 'library_file_id'>

// Enriches a channel_piece_media row with resolved source data.
// Never persists URLs — generates signed URLs at read time.
// source_deleted: true when library_files.deleted_at IS NOT NULL.
export async function resolveMediaSource(
  supabase: SupabaseClient,
  row: MediaRow,
): Promise<Omit<ChannelPieceMediaResolved, keyof MediaRow | 'id' | 'user_id' | 'channel_piece_id' | 'position' | 'role' | 'alt_text' | 'created_at' | 'updated_at'>> {
  if (row.image_id) {
    const { data: img } = await supabase
      .from('images')
      .select('image_url, thumbnail_url, storage_path, thumbnail_path, file_size, mime_type')
      .eq('id', row.image_id)
      .single()

    if (!img) {
      return { media_kind: 'image', image_url: null, thumbnail_url: null, file_size: null, mime_type: null, name: null, source_deleted: false }
    }

    // createPresignedReadUrl returns null (not throws) when S3 is unconfigured,
    // so ?? is needed to fall back to the stored public URL.
    const presignedImage = img.storage_path
      ? await createPresignedReadUrl(img.storage_path).catch(() => null)
      : null
    const imageUrl = presignedImage ?? (img.image_url as string | null)
    const presignedThumb = img.thumbnail_path
      ? await createPresignedReadUrl(img.thumbnail_path).catch(() => null)
      : null
    const thumbUrl = presignedThumb ?? (img.thumbnail_url as string | null)

    return {
      media_kind: 'image',
      image_url: imageUrl ?? null,
      thumbnail_url: thumbUrl ?? null,
      file_size: (img.file_size as number | null) ?? null,
      mime_type: (img.mime_type as string | null) ?? null,
      name: null,
      source_deleted: false,
    }
  }

  if (row.library_file_id) {
    const { data: lf } = await supabase
      .from('library_files')
      .select('user_id, kind, name, file_size, mime_type, storage_path, public_url, thumbnail_url, deleted_at, origin')
      .eq('id', row.library_file_id)
      .single()

    if (!lf) {
      return { media_kind: 'other', image_url: null, thumbnail_url: null, file_size: null, mime_type: null, name: null, source_deleted: false }
    }

    // LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1: a row's storage_path is a claim. Sign (and fall
    // back to the recorded URL) only for a key that is provably the owner's own Library object.
    const libraryRow = { user_id: lf.user_id as string, storage_path: lf.storage_path as string | null }
    const presignedLf = await presignLibraryRead(libraryRow).catch(() => null)
    const resolvedUrl = presignedLf ?? (isTrustedLibraryStoragePath(libraryRow.user_id, libraryRow.storage_path) ? (lf.public_url as string | null) : null)

    return {
      media_kind: lf.kind as LibraryFileKind,
      image_url: resolvedUrl ?? null,
      thumbnail_url: (lf.thumbnail_url as string | null) ?? resolvedUrl ?? null,
      file_size: (lf.file_size as number | null) ?? null,
      mime_type: (lf.mime_type as string | null) ?? null,
      name: lf.name as string,
      source_deleted: lf.deleted_at !== null,
      library_origin: (lf.origin as LibraryFileOrigin | undefined) ?? 'upload',
    }
  }

  return { media_kind: 'other', image_url: null, thumbnail_url: null, file_size: null, mime_type: null, name: null, source_deleted: false }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const VALID_ROLES = ['primary', 'thumbnail', 'carousel_item', 'background', 'attachment'] as const

// Maps RPC error messages (CPM_* prefix) to HTTP responses.
// The message is the raw RAISE EXCEPTION text from the PL/pgSQL function.
// We never expose the internal prefix to the client.
export function mapRpcError(message: string): { status: number; error: string } | null {
  if (message.includes('CPM_UNAUTHORIZED')) {
    return { status: 401, error: 'Nao autorizado' }
  }
  if (message.includes('CPM_NOT_FOUND')) {
    return { status: 404, error: 'Associacao de midia nao encontrada' }
  }
  if (message.includes('CPM_LOCK_CONFLICT')) {
    return { status: 409, error: 'Operacao concorrente em andamento. Tente novamente em instantes.' }
  }
  if (message.includes('CPM_CONFLICT')) {
    return { status: 409, error: 'Lista de midias foi alterada. Recarregue e tente novamente.' }
  }
  if (message.includes('CPM_INVALID_INPUT')) {
    if (message.includes('exactly one primary')) {
      return { status: 400, error: 'Exatamente uma midia principal e obrigatoria.' }
    }
    if (message.includes('duplicate IDs')) {
      return { status: 400, error: 'IDs duplicados na lista de itens.' }
    }
    if (message.includes('duplicate positions')) {
      return { status: 400, error: 'Posicoes duplicadas na lista de itens.' }
    }
    if (message.includes('positions must be 0..N-1')) {
      return { status: 400, error: 'Posicoes devem ser sequenciais de 0 a N-1.' }
    }
    if (message.includes('invalid role')) {
      return { status: 400, error: 'Role invalida nos itens.' }
    }
    if (message.includes('items cannot be empty')) {
      return { status: 400, error: 'Lista de itens nao pode ser vazia.' }
    }
    return { status: 400, error: 'Dados invalidos.' }
  }
  return null
}

export function mapPgError(code: string, message: string): { status: number; error: string } | null {
  if (code === '23505') {
    if (message.includes('uq_cpm_cp_image') || message.includes('uq_cpm_cp_library_file')) {
      return { status: 409, error: 'Esta midia ja esta associada a esta versao.' }
    }
    if (message.includes('cpm_unique_position')) {
      return { status: 409, error: 'Posicao ja ocupada nesta ChannelPiece. Use uma posicao diferente.' }
    }
    if (message.includes('uq_cpm_cp_primary')) {
      return { status: 409, error: 'Ja existe uma midia com role=primary nesta ChannelPiece. Altere a role ou remova a midia primaria existente.' }
    }
    return { status: 409, error: 'Conflito de dados' }
  }
  if (code === '23514') return { status: 400, error: 'Regra de integridade violada' }
  if (code === '23503') return { status: 400, error: 'Referencia invalida' }
  if (code === '42501') return { status: 403, error: 'Operacao nao permitida' }
  return null
}
