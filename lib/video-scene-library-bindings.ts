import type { VideoScene } from '@/lib/types'

export type SceneLibraryFileRecord = {
  id: string
  project_id: string | null
  deleted_at: string | null
}

export type SceneLibraryBindingErrorCode =
  | 'DRAFT_PROJECT_REQUIRED'
  | 'INVALID_LIBRARY_FILE_ID'
  | 'LIBRARY_FILE_NOT_FOUND'
  | 'LIBRARY_FILE_PROJECT_MISMATCH'
  | 'LIBRARY_FILE_DELETED'

export type SceneLibraryBindingError = {
  code: SceneLibraryBindingErrorCode
  message: string
  libraryFileId?: string
  sceneIds?: string[]
}

export type SceneLibraryBindingValidation =
  | { valid: true; libraryFileIds: string[] }
  | { valid: false; error: SceneLibraryBindingError }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function collectLibraryFileIds(scenes: VideoScene[]): string[] {
  return Array.from(
    new Set(
      scenes
        .map((scene) => scene.library_file_id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim()),
    ),
  )
}

export function validateSceneLibraryFileBindings(
  scenes: VideoScene[],
  projectId: string | null | undefined,
  records: SceneLibraryFileRecord[],
): SceneLibraryBindingValidation {
  const ids = collectLibraryFileIds(scenes)
  if (ids.length === 0) return { valid: true, libraryFileIds: [] }

  if (!projectId) {
    return {
      valid: false,
      error: {
        code: 'DRAFT_PROJECT_REQUIRED',
        message: 'Um VideoDraft com LibraryFile binding precisa pertencer a um Projeto.',
      },
    }
  }

  const scenesById = new Map<string, string[]>()
  for (const scene of scenes) {
    const id = typeof scene.library_file_id === 'string' ? scene.library_file_id.trim() : ''
    if (!id) continue
    scenesById.set(id, [...(scenesById.get(id) || []), scene.id])
    if (!UUID_RE.test(id)) {
      return {
        valid: false,
        error: {
          code: 'INVALID_LIBRARY_FILE_ID',
          message: `library_file_id inválido: ${id}`,
          libraryFileId: id,
          sceneIds: scenesById.get(id),
        },
      }
    }
  }

  const recordsById = new Map(records.map((record) => [record.id, record]))
  for (const id of ids) {
    const record = recordsById.get(id)
    const sceneIds = scenesById.get(id)
    if (!record) {
      return {
        valid: false,
        error: {
          code: 'LIBRARY_FILE_NOT_FOUND',
          message: 'LibraryFile não encontrado ou não autorizado.',
          libraryFileId: id,
          sceneIds,
        },
      }
    }
    if (record.deleted_at !== null) {
      return {
        valid: false,
        error: {
          code: 'LIBRARY_FILE_DELETED',
          message: 'LibraryFile está na lixeira e não pode ser associado a uma cena.',
          libraryFileId: id,
          sceneIds,
        },
      }
    }
    if (!record.project_id || record.project_id !== projectId) {
      return {
        valid: false,
        error: {
          code: 'LIBRARY_FILE_PROJECT_MISMATCH',
          message: 'LibraryFile pertence a um Projeto diferente do VideoDraft.',
          libraryFileId: id,
          sceneIds,
        },
      }
    }
  }

  return { valid: true, libraryFileIds: ids }
}
