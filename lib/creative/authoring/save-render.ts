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
  | { ok: true; libraryFileId: string; channelPieceMediaId: string; alreadyAttached?: boolean }
  | { ok: false; error: string }

export async function saveRenderToChannelPiece(input: {
  imageDataUrl: string
  channelPieceId: string
  filename?: string
  fetchImpl?: typeof fetch
}): Promise<SaveRenderResult> {
  let file: File
  try {
    file = dataUrlToFile(input.imageDataUrl, input.filename ?? renderOutputFilename())
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Render invalido.' }
  }
  return saveRenderFileToChannelPiece({ file, channelPieceId: input.channelPieceId, fetchImpl: input.fetchImpl })
}

/**
 * Static Render Worker V1: same explicit "Salvar nesta peca" path, fed by a
 * PNG File the editor fetched from its completed execution's same-origin
 * `/api/render-executions/:id/output` stream (the async render no longer
 * returns a data URL). Still only ever uses the existing upload route.
 */
export async function saveRenderFileToChannelPiece(input: {
  file: File
  channelPieceId: string
  /**
   * Creative Editor Template Foundation V1: the completed static execution
   * this PNG came from. Lets the route classify the LibraryFile as a studio
   * render (Galeria / "Imagens geradas") after verifying it server-side.
   */
  renderExecutionId?: string
  fetchImpl?: typeof fetch
}): Promise<SaveRenderResult> {
  const doFetch = input.fetchImpl ?? fetch
  const file = input.file
  const formData = new FormData()
  formData.set('file', file)
  formData.set('channelPieceId', input.channelPieceId)
  if (input.renderExecutionId) formData.set('renderExecutionId', input.renderExecutionId)

  try {
    const response = await doFetch(CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE, { method: 'POST', body: formData })
    const payload = await response.json().catch(() => null) as
      | { channelPieceMedium?: { id?: string }; libraryFile?: { id?: string }; error?: string; alreadyAttached?: boolean }
      | null
    if (!response.ok || !payload) {
      return { ok: false, error: payload?.error || 'Nao foi possivel salvar nesta peca.' }
    }
    const libraryFileId = payload.libraryFile?.id
    const channelPieceMediaId = payload.channelPieceMedium?.id
    if (!libraryFileId || !channelPieceMediaId) {
      return { ok: false, error: 'Resposta inesperada ao salvar nesta peca.' }
    }
    return { ok: true, libraryFileId, channelPieceMediaId, ...(payload.alreadyAttached ? { alreadyAttached: true } : {}) }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Falha de rede ao salvar.' }
  }
}
