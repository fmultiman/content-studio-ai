// VIDEO_I2V_LIBRARY_SOURCE_PICKER_V1
//
// Image-to-Video accepts exactly ONE source class:
//   - a generated image of the Project  -> `sourceImageId`
//   - a durable image in Arquivos       -> `sourceLibraryFileId`
// Once a file is picked from Arquivos its identity is the LibraryFile, even if it
// was originally saved from a generated image or a render: it is never converted
// back to an image id. The browser only ever sends a stable id; the server
// re-resolves ownership, project and kind.

export type I2vSource = { type: 'generated'; id: string } | { type: 'library'; id: string }

export interface I2vSourceFields {
  sourceImageId?: string
  sourceLibraryFileId?: string
}

/** Request fields for the current source: exactly one, or none outside image_to_video. */
export function i2vSourceFields(operation: string | null, source: I2vSource | null): I2vSourceFields {
  if (operation !== 'image_to_video' || !source) return {}
  return source.type === 'library' ? { sourceLibraryFileId: source.id } : { sourceImageId: source.id }
}

/** The source survives an operation change only while the operation is still image_to_video. */
export function reconcileI2vSource(operation: string | null, source: I2vSource | null): I2vSource | null {
  return operation === 'image_to_video' ? source : null
}

export interface LibraryImageCandidate {
  id: string
  project_id: string | null
  kind: string
  deleted_at: string | null
}

/**
 * Library files offered as an I2V source: same Project, kind image, not trashed.
 * The Library is the only authority — Gallery is an output surface, not a source.
 */
export function eligibleLibraryImages<T extends LibraryImageCandidate>(files: readonly T[], projectId: string): T[] {
  return files.filter((file) => file.project_id === projectId && file.kind === 'image' && !file.deleted_at)
}

export type LibrarySourceRejection = 'SOURCE_LIBRARY_FILE_DELETED' | 'SOURCE_LIBRARY_FILE_NOT_IMAGE'

/** Server-side check on an already owner/project-scoped library row. */
export function checkLibrarySourceFile(file: { kind: string; deleted_at: string | null }): LibrarySourceRejection | null {
  if (file.deleted_at) return 'SOURCE_LIBRARY_FILE_DELETED'
  if (file.kind !== 'image') return 'SOURCE_LIBRARY_FILE_NOT_IMAGE'
  return null
}

export const LIBRARY_SOURCE_REJECTION_MESSAGE: Record<LibrarySourceRejection, string> = {
  SOURCE_LIBRARY_FILE_DELETED: 'Este arquivo está na lixeira. Escolha outra imagem.',
  SOURCE_LIBRARY_FILE_NOT_IMAGE: 'O arquivo escolhido não é uma imagem. Escolha uma imagem.',
}
