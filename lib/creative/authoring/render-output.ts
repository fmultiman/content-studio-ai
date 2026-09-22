/**
 * Converts an already-rendered static authoring PNG (data URL) into a File
 * suitable for the existing `POST /api/channel-piece-media/upload` route.
 *
 * Deliberately storage-agnostic: no S3, no LibraryFile, no ChannelPieceMedia
 * knowledge lives here. This module only prepares the multipart payload.
 */
const DATA_URL_RE = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]*)$/

export function renderOutputFilename(timestamp: number = Date.now()): string {
  return `static-render-${timestamp}.png`
}

export function dataUrlToFile(dataUrl: string, filename: string = renderOutputFilename()): File {
  const match = DATA_URL_RE.exec(dataUrl)
  if (!match) throw new Error('Render invalido: formato de imagem inesperado.')
  const [, mimeType, base64] = match
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mimeType })
}
