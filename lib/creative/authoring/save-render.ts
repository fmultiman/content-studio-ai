import { dataUrlToFile, renderOutputFilename } from './render-output'

/**
 * Persists an already-rendered static authoring PNG to a ChannelPiece using
 * ONLY the existing `/api/channel-piece-media/upload` route. This module
 * never talks to S3, library_files, or channel_piece_media directly — it is
 * a thin, storage-agnostic client of the route that already owns that
 * orchestration (upload -> LibraryFile -> ChannelPieceMedia, role/position
 * decided server-side).
 */
export const CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE = '/api/channel-piece-media/upload'

export type SaveRenderResult =
  | { ok: true; libraryFileId: string; channelPieceMediaId: string }
  | { ok: false; error: string }

export async function saveRenderToChannelPiece(input: {
  imageDataUrl: string
  channelPieceId: string
  filename?: string
  fetchImpl?: typeof fetch
}): Promise<SaveRenderResult> {
  const doFetch = input.fetchImpl ?? fetch
  let file: File
  try {
    file = dataUrlToFile(input.imageDataUrl, input.filename ?? renderOutputFilename())
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Render invalido.' }
  }

  const formData = new FormData()
  formData.set('file', file)
  formData.set('channelPieceId', input.channelPieceId)

  try {
    const response = await doFetch(CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE, { method: 'POST', body: formData })
    const payload = await response.json().catch(() => null) as
      | { channelPieceMedium?: { id?: string }; libraryFile?: { id?: string }; error?: string }
      | null
    if (!response.ok || !payload) {
      return { ok: false, error: payload?.error || 'Nao foi possivel salvar nesta peca.' }
    }
    const libraryFileId = payload.libraryFile?.id
    const channelPieceMediaId = payload.channelPieceMedium?.id
    if (!libraryFileId || !channelPieceMediaId) {
      return { ok: false, error: 'Resposta inesperada ao salvar nesta peca.' }
    }
    return { ok: true, libraryFileId, channelPieceMediaId }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Falha de rede ao salvar.' }
  }
}
