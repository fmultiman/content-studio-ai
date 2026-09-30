import { describe, expect, it } from 'vitest'
import {
  aiImagesUrl,
  appendCursor,
  breadcrumbsFor,
  childFolders,
  folderDisplayName,
  libraryBrowseUrl,
  normalizeSourceSearch,
  parentFolderPath,
  productionParam,
  projectRootPath,
  uploadDestinationFolder,
  SEARCH_MAX_LENGTH,
} from '@/lib/video-generation/i2v-source-browse'
import { I2V_CATEGORY_LABEL, I2V_SOURCE_MIME_TYPES, i2vMimeFromFile, i2vSourceFields, isI2vSourceMime, reconcileI2vSource } from '@/lib/video-generation/i2v-source'
import { parseFormat, parseScope } from '@/lib/library/browse-query'

// VIDEO_I2V_SOURCE_BROWSER_V1 — pure pieces of the Image Source browser. Synthetic data only.

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROD = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'

const folder = (id: string, path: string, parent: string, root = false) => ({ id, name: path.split('/').pop()!, path, parent_path: parent, is_project_root: root })
const folders = [
  folder('root', '/Maitê', '/', true),
  folder('ref', '/Maitê/Referências', '/Maitê'),
  folder('rostos', '/Maitê/Referências/Rostos', '/Maitê/Referências'),
  folder('cenas', '/Maitê/Cenas', '/Maitê'),
  folder('alpha', '/Maitê/Alfa', '/Maitê'),
]

describe('taxonomy labels', () => {
  it('uses the explicit, unambiguous names (never the bare "Geradas")', () => {
    expect(I2V_CATEGORY_LABEL).toEqual({ ai: 'Geradas por IA', gallery: 'Galeria', library: 'Arquivos', upload: 'Enviar' })
  })
})

describe('source identity: strict XOR, category is display-only', () => {
  it('Geradas por IA -> source_image_id ONLY', () => {
    expect(i2vSourceFields('image_to_video', { type: 'generated', id: 'img-1' })).toEqual({ sourceImageId: 'img-1' })
  })
  it.each(['gallery', 'library', 'upload'] as const)('%s -> source_library_file_id ONLY (Galeria, Arquivos and Enviar all resolve to a LibraryFile)', () => {
    expect(i2vSourceFields('image_to_video', { type: 'library', id: 'lib-1' })).toEqual({ sourceLibraryFileId: 'lib-1' })
  })
  it('no other source identity exists and text_to_video carries none', () => {
    expect(i2vSourceFields('text_to_video', { type: 'library', id: 'lib-1' })).toEqual({})
    expect(Object.keys(i2vSourceFields('image_to_video', { type: 'library', id: 'x' }))).toEqual(['sourceLibraryFileId'])
    expect(reconcileI2vSource('text_to_video', { type: 'library', id: 'x' })).toBeNull()
  })
})

describe('I2V source format eligibility', () => {
  it('is PNG and JPEG only (conservative common support)', () => {
    expect([...I2V_SOURCE_MIME_TYPES]).toEqual(['image/png', 'image/jpeg'])
    expect(isI2vSourceMime('image/png')).toBe(true)
    expect(isI2vSourceMime('IMAGE/JPEG')).toBe(true)
    for (const mime of ['image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'video/mp4', '', null, undefined]) expect(isI2vSourceMime(mime)).toBe(false)
  })

  it('a local file: PNG and JPEG accepted, .jpg is JPEG, everything else is refused', () => {
    expect(i2vMimeFromFile({ name: 'a.png', type: 'image/png' })).toBe('image/png')
    expect(i2vMimeFromFile({ name: 'a.jpeg', type: 'image/jpeg' })).toBe('image/jpeg')
    expect(i2vMimeFromFile({ name: 'a.jpg', type: 'image/jpg' })).toBe('image/jpeg')
    expect(i2vMimeFromFile({ name: 'a.JPG', type: '' })).toBe('image/jpeg')
    expect(i2vMimeFromFile({ name: 'a.PNG', type: '' })).toBe('image/png')
    for (const [name, type] of [['a.webp', 'image/webp'], ['a.gif', 'image/gif'], ['a.svg', 'image/svg+xml'], ['a.avif', 'image/avif'], ['a.png', 'text/html'], ['a.txt', '']] as const) {
      expect(i2vMimeFromFile({ name, type })).toBeNull()
    }
  })

  it('the server accepts only the typed scope/format values from the browser', () => {
    expect(parseScope('gallery')).toBe('gallery')
    expect(parseScope('arquivos')).toBe('arquivos')
    expect(parseScope(null)).toBe('none')
    expect(parseScope("origin.eq.'studio_render'")).toBeNull()
    expect(parseFormat('i2v-image')).toEqual(['image/png', 'image/jpeg'])
    expect(parseFormat('image/webp')).toBeNull()
  })
})

describe('request URLs', () => {
  it('Geradas por IA: Project + opaque cursor only', () => {
    expect(aiImagesUrl({ projectId: PROJECT })).toBe(`/api/images/browse?projectId=${PROJECT}`)
    expect(aiImagesUrl({ projectId: PROJECT, cursor: 'c=1' })).toBe(`/api/images/browse?projectId=${PROJECT}&cursor=c%3D1`)
  })

  it('Galeria: fixed typed scope, image only, PNG/JPEG only, never a folder', () => {
    const url = new URL(libraryBrowseUrl({ category: 'gallery', projectId: PROJECT, production: PROD, search: '', folder: '/Maitê/Cenas' }), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: PROJECT, scope: 'gallery', kind: 'image', format: 'i2v-image', production: PROD })
  })

  it('Arquivos: scope=arquivos, kind=image, folder in browse mode', () => {
    const url = new URL(libraryBrowseUrl({ category: 'library', projectId: PROJECT, production: 'all', search: '', folder: '/Maitê/Cenas' }), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: PROJECT, scope: 'arquivos', kind: 'image', format: 'i2v-image', production: 'all', folder: '/Maitê/Cenas' })
  })

  it('an ACTIVE search spans the Project + Production context: the folder is dropped', () => {
    const url = new URL(libraryBrowseUrl({ category: 'library', projectId: PROJECT, production: PROD, search: '  capa  ', folder: '/Maitê/Cenas' }), 'http://x')
    expect(url.searchParams.get('q')).toBe('capa')
    expect(url.searchParams.has('folder')).toBe(false)
    expect(url.searchParams.get('production')).toBe(PROD)
  })

  it('never carries a limit, a signed URL or a storage path; search is length-bounded', () => {
    const url = libraryBrowseUrl({ category: 'library', projectId: PROJECT, production: 'all', search: 'x'.repeat(500), folder: '/A' })
    expect(url).not.toMatch(/limit|storage|signature|X-Amz/i)
    expect(normalizeSourceSearch('x'.repeat(500))).toHaveLength(SEARCH_MAX_LENGTH)
  })

  it('cursor is appended URL-encoded', () => {
    expect(appendCursor('/api/x?a=1', 'a+b/c')).toBe('/api/x?a=1&cursor=a%2Bb%2Fc')
  })
})

describe('Production filter', () => {
  it('current follows the generation Production; all / unscoped are explicit; without a Production "current" degrades to all', () => {
    expect(productionParam('current', PROD)).toBe(PROD)
    expect(productionParam('all', PROD)).toBe('all')
    expect(productionParam('unscoped', PROD)).toBe('unscoped')
    expect(productionParam('current', null)).toBe('all')
  })
})

describe('folder navigation (path / parent_path only)', () => {
  it('finds the Project root and the immediate children, sorted by name', () => {
    expect(projectRootPath(folders)).toBe('/Maitê')
    expect(childFolders(folders, '/Maitê').map((entry) => entry.name)).toEqual(['Alfa', 'Cenas', 'Referências'])
    expect(childFolders(folders, '/Maitê/Referências').map((entry) => entry.name)).toEqual(['Rostos'])
    expect(childFolders(folders, '/Maitê/Cenas')).toEqual([])
    expect(childFolders(folders, null)).toEqual([])
  })

  it('breadcrumbs go root -> current, labelling the root by the Project name', () => {
    expect(breadcrumbsFor(folders, '/Maitê/Referências/Rostos', 'Maitê')).toEqual([
      { path: '/Maitê', label: 'Maitê' },
      { path: '/Maitê/Referências', label: 'Referências' },
      { path: '/Maitê/Referências/Rostos', label: 'Rostos' },
    ])
    expect(breadcrumbsFor(folders, null, 'Maitê')).toEqual([{ path: '/Maitê', label: 'Maitê' }])
    expect(breadcrumbsFor([], '/x', 'Maitê')).toEqual([])
  })

  it('back goes to the parent, and there is no "back" at the root', () => {
    expect(parentFolderPath(folders, '/Maitê/Referências/Rostos')).toBe('/Maitê/Referências')
    expect(parentFolderPath(folders, '/Maitê/Referências')).toBe('/Maitê')
    expect(parentFolderPath(folders, '/Maitê')).toBeNull()
    expect(parentFolderPath(folders, null)).toBeNull()
  })

  it('display names', () => {
    expect(folderDisplayName(folders, '/Maitê', 'Maitê')).toBe('Maitê')
    expect(folderDisplayName(folders, '/Maitê/Cenas', 'Maitê')).toBe('Cenas')
    expect(folderDisplayName(folders, null, 'Maitê')).toBe('Maitê')
  })
})

describe('upload destination', () => {
  it('the Arquivos folder in view when there is one, otherwise the Project Library root — never a Production folder', () => {
    expect(uploadDestinationFolder(folders, '/Maitê/Referências')).toBe('/Maitê/Referências')
    expect(uploadDestinationFolder(folders, null)).toBe('/Maitê')
    expect(uploadDestinationFolder(folders, '/Outro/Projeto')).toBe('/Maitê')
    expect(uploadDestinationFolder([], null)).toBeNull()
  })
})
