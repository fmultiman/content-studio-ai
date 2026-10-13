// VIDEO_I2V_SOURCE_BROWSER_V1 — pure helpers for the Image Source browser (URLs, folders, upload destination).
// No React, no fetch: everything here is unit-testable. The browser only ever sends a Project id, a Production
// filter, a folder path, a search text and an opaque cursor; the server re-validates all of it.

import type { LibraryFolder } from '@/lib/types'
import type { ImageSourceProfile } from '@/lib/media-source/profile'

/** `current` follows the Production of the generation form; the others are explicit user choices. */
export type ProductionFilterMode = 'current' | 'all' | 'unscoped'

export function productionParam(mode: ProductionFilterMode, currentProductionId: string | null | undefined): string {
  if (mode === 'unscoped') return 'unscoped'
  if (mode === 'current' && currentProductionId) return currentProductionId
  return 'all'
}

export const SEARCH_MAX_LENGTH = 100

export function normalizeSourceSearch(raw: string): string {
  return raw.trim().slice(0, SEARCH_MAX_LENGTH)
}

export function aiImagesUrl(input: { projectId: string; cursor?: string | null; profile?: ImageSourceProfile }): string {
  const query = new URLSearchParams({ projectId: input.projectId })
  if (input.profile === 'image-reference') query.set('profile', input.profile)
  if (input.cursor) query.set('cursor', input.cursor)
  return `/api/images/browse?${query.toString()}`
}

/** Next page of an already-built URL (the cursor is opaque and URL-encoded). */
export function appendCursor(url: string, cursor: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
}

export interface LibraryBrowseInput {
  category: 'gallery' | 'library'
  projectId: string
  production: string
  search: string
  /** Arquivos only. Ignored while a search is active (search spans the Project + Production context). */
  folder?: string | null
  cursor?: string | null
  profile?: ImageSourceProfile
}

/** Galeria: Creative Editor image outputs. Arquivos: reusable images. Profile formats are server allow-lists. */
export function libraryBrowseUrl(input: LibraryBrowseInput): string {
  const query = new URLSearchParams({
    projectId: input.projectId,
    scope: input.category === 'gallery' ? 'gallery' : 'arquivos',
    kind: 'image',
    format: input.profile === 'image-reference' ? 'image-reference' : 'i2v-image',
    production: input.production,
  })
  const search = normalizeSourceSearch(input.search)
  if (search) query.set('q', search)
  else if (input.category === 'library' && input.folder) query.set('folder', input.folder)
  if (input.cursor) query.set('cursor', input.cursor)
  return `/api/library-files/browse?${query.toString()}`
}

// ---- folders (path / parent_path is the only truth; no parent_id, no Production folders) -----------------------

type FolderLike = Pick<LibraryFolder, 'id' | 'name' | 'path' | 'parent_path' | 'is_project_root'>

export function projectRootPath(folders: readonly FolderLike[]): string | null {
  return folders.find((folder) => folder.is_project_root)?.path ?? null
}

export function childFolders<T extends FolderLike>(folders: readonly T[], currentPath: string | null): T[] {
  if (!currentPath) return []
  return folders
    .filter((folder) => !folder.is_project_root && folder.parent_path === currentPath)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export interface Breadcrumb {
  path: string
  label: string
}

/** Root first, then each folder down to `currentPath`. The Project root is labelled by the Project's name. */
export function breadcrumbsFor(folders: readonly FolderLike[], currentPath: string | null, rootLabel: string): Breadcrumb[] {
  const root = folders.find((folder) => folder.is_project_root)
  if (!root) return []
  const trail: Breadcrumb[] = [{ path: root.path, label: rootLabel }]
  if (!currentPath || currentPath === root.path || !currentPath.startsWith(`${root.path}/`)) return trail
  let accumulated = root.path
  for (const segment of currentPath.slice(root.path.length + 1).split('/')) {
    accumulated = `${accumulated}/${segment}`
    trail.push({ path: accumulated, label: folders.find((folder) => folder.path === accumulated)?.name ?? segment })
  }
  return trail
}

export function parentFolderPath(folders: readonly FolderLike[], currentPath: string | null): string | null {
  const root = projectRootPath(folders)
  if (!currentPath || !root || currentPath === root) return null
  return folders.find((folder) => folder.path === currentPath)?.parent_path ?? root
}

/**
 * Where an upload from the chooser lands: the folder the user is currently looking at in Arquivos, otherwise the
 * Project Library root. Never a Production folder. Production is stored separately (production_id).
 */
export function uploadDestinationFolder(folders: readonly FolderLike[], selectedFolder: string | null): string | null {
  const root = projectRootPath(folders)
  if (selectedFolder && folders.some((folder) => folder.path === selectedFolder)) return selectedFolder
  return root
}

export function folderDisplayName(folders: readonly FolderLike[], path: string | null, rootLabel: string): string {
  const root = projectRootPath(folders)
  if (!path || path === root) return rootLabel
  return folders.find((folder) => folder.path === path)?.name ?? path.split('/').pop() ?? rootLabel
}
