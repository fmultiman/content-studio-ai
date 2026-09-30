import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'
import { checkLibrarySourceFile, eligibleLibraryImages, i2vSourceFields } from '@/lib/video-generation/i2v-source'

// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1 — /arquivos UX contract + I2V picker compatibility.
// The repository has no DOM harness (vitest runs in node), so the page is asserted at its contract surface:
// which endpoint it calls, in which state, with which parameters — plus behavior of the real routes it depends on.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ createPresignedReadUrl: vi.fn(async (path: string) => `https://signed.example.test/${path}?sig=1`) }))

import * as server from '@/lib/supabase/server'
import { GET as legacyList } from '@/app/api/library-files/route'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
const page = read('app/(dashboard)/arquivos/page.tsx')
const picker = read('components/videos/i2v-source-picker.tsx')

describe('/arquivos — Production filter, search and "Carregar mais"', () => {
  it('uses the bounded browse endpoint ONLY with a Project selected; "Todos os projetos" keeps the legacy list', () => {
    expect(page).toMatch(/if \(selectedProject === 'all'\) return null/)
    expect(page).toMatch(/browse \? `\/api\/library-files\/browse\?\$\{browse\.toString\(\)\}` : `\/api\/library-files\?\$\{params\.toString\(\)\}`/)
    expect(page).toMatch(/projectId: selectedProject, scope: 'arquivos'/)
  })

  it('offers "Todas as Productions" / each Production of the selected Project / "Sem Production"', () => {
    expect(page).toContain('Todas as Productions')
    expect(page).toContain('Sem Production')
    expect(page).toMatch(/selectedProject !== 'all' && \(\s*<div className="min-w-\[200px\] space-y-2" data-testid="arquivos-production-filter"/)
    // Productions are read for THIS Project only — never a cross-Project list
    expect(page).toMatch(/\.from\('productions'\)[\s\S]{0,80}\.eq\('project_id', selectedProject\)/)
  })

  it('the filter value is sent to the server as `production` and is reset when the Project changes', () => {
    expect(page).toMatch(/if \(selectedProduction !== 'all'\) query\.set\('production', selectedProduction\)/)
    expect(page).toMatch(/const handleProjectChange = \(value: string\) => \{\s*setSelectedProject\(value\)\s*setSelectedProduction\('all'\)/)
  })

  it('reloads when the Production filter or the search changes', () => {
    expect(page).toMatch(/\[selectedProject, selectedKind, folder, showTrash, selectedProduction, search\]/)
  })

  it('search is server-side, debounced, length-bounded and only shown with a Project', () => {
    expect(page).toMatch(/query\.set\('q', search\.trim\(\)\)/)
    expect(page).toMatch(/setTimeout\(\(\) => setSearch\(searchInput\), 300\)/)
    expect(page).toContain('maxLength={100}')
    expect(page).toMatch(/selectedProject !== 'all' && \(\s*<div className="min-w-\[200px\] flex-1 space-y-2" data-testid="arquivos-search"/)
  })

  it('"Carregar mais" follows the server cursor, de-duplicates by id, and shows only when a next page exists', () => {
    expect(page).toMatch(/\{nextCursor && \(/)
    expect(page).toContain('data-testid="arquivos-load-more"')
    expect(page).toMatch(/browseParams\(nextCursor\)/)
    expect(page).toMatch(/const seen = new Set\(current\.map\(\(file\) => file\.id\)\)/)
    expect(page).toMatch(/setNextCursor\(payload\.nextCursor \?\? null\)/)
  })

  it('"Limpar filtros" also clears the Production and the search, and they count as active filters', () => {
    expect(page).toMatch(/selectedProduction !== 'all' \|\| search !== ''/)
    expect(page).toMatch(/setSelectedProduction\('all'\)\s*setSearchInput\(''\)/)
  })

  it('Production is a filter, not a folder: no folder is created from it and the folder tree is untouched', () => {
    expect(page).not.toMatch(/library-folders[\s\S]{0,200}production/i)
    expect(page).not.toMatch(/setFolder\([^)]*[Pp]roduction/)
  })

  it('never exposes or accepts a Production id typed by the user (a select of server-listed ids only)', () => {
    expect(page).not.toMatch(/<Input[^>]*production/i)
  })
})

describe('I2V Arquivos picker stays compatible', () => {
  const USER = '11111111-1111-4111-8111-111111111111'
  const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const PROD = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
  let db: FakeDb

  const image = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    user_id: USER,
    project_id: PROJECT,
    production_id: null,
    folder: '/Projetos/A',
    name: `${id}.png`,
    kind: 'image',
    origin: 'upload',
    deleted_at: null,
    updated_at: '2026-09-01T00:00:00Z',
    storage_path: `users/${USER}/library/${id}/x.png`,
    public_url: 'https://cdn.example.test/x',
    thumbnail_url: null,
    ...overrides,
  })

  beforeEach(() => {
    db = createFakeDb({
      seed: { library_files: [image('img-1'), image('img-2', { production_id: PROD }), image('img-3', { project_id: OTHER_PROJECT }), image('vid-1', { kind: 'video' }), image('gone', { deleted_at: '2026-09-02T00:00:00Z' })] },
      generatedId: [],
    })
    vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, from: db.from } as any)
  })

  it('VIDEO_I2V_SOURCE_BROWSER_V1: the chooser no longer uses the flat, unbounded list — it reads only bounded, cursor-paged endpoints', () => {
    const browser = read('components/videos/i2v-source-browser.tsx')
    const browse = read('lib/video-generation/i2v-source-browse.ts')
    expect(picker).not.toMatch(/fetch\(/)
    expect(browser).not.toMatch(/\/api\/library-files\?/)
    expect(browse).toContain('/api/library-files/browse?')
    expect(browse).toContain('/api/images/browse?')
    // the legacy endpoint is unchanged for its other callers (Arquivos "Todos os projetos", asset pickers)
    expect(read('app/api/library-files/route.ts')).toMatch(/return NextResponse\.json\(\{ files \}\)/)
  })

  it('the legacy endpoint keeps its response shape ({ files }, no pagination envelope) and the Project/kind filters', async () => {
    const response = await legacyList(new Request(`http://localhost/api/library-files?projectId=${PROJECT}&kind=image`))
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['files'])
    expect(body.files.map((item: { id: string }) => item.id).sort()).toEqual(['img-1', 'img-2'])
  })

  it('rows now carry production_id, which the picker’s eligibility rules simply ignore', async () => {
    const response = await legacyList(new Request(`http://localhost/api/library-files?projectId=${PROJECT}&kind=image`))
    const { files } = await response.json()
    expect(files.find((item: { id: string }) => item.id === 'img-2').production_id).toBe(PROD)
    expect(eligibleLibraryImages(files, PROJECT).map((item: { id: string }) => item.id).sort()).toEqual(['img-1', 'img-2'])
    expect(eligibleLibraryImages(files, OTHER_PROJECT)).toEqual([])
  })

  it('the source is still identified by the LibraryFile id alone — a Production never enters the request', () => {
    expect(i2vSourceFields('image_to_video', { type: 'library', id: 'img-2' })).toEqual({ sourceLibraryFileId: 'img-2' })
    expect(i2vSourceFields('image_to_video', { type: 'generated', id: 'gen-1' })).toEqual({ sourceImageId: 'gen-1' })
    // Production is only a browse FILTER in the chooser; it is never part of the generation request identity.
    expect(Object.keys(i2vSourceFields('image_to_video', { type: 'library', id: 'img-2' }))).toEqual(['sourceLibraryFileId'])
    expect(picker).not.toMatch(/sourceProduction|source_production/i)
  })

  it('server-side source checks are independent of production_id (scoped and unscoped files are both valid sources)', () => {
    expect(checkLibrarySourceFile({ kind: 'image', deleted_at: null })).toBeNull()
    expect(checkLibrarySourceFile({ kind: 'video', deleted_at: null })).toBe('SOURCE_LIBRARY_FILE_NOT_IMAGE')
    expect(checkLibrarySourceFile({ kind: 'image', deleted_at: '2026-09-02T00:00:00Z' })).toBe('SOURCE_LIBRARY_FILE_DELETED')
  })

  it('the I2V submit route still accepts the LibraryFile id and never reads a library Production from the browser', () => {
    const generations = read('app/api/video-generations/route.ts')
    expect(generations).toMatch(/sourceLibraryFileId/)
    expect(generations).not.toMatch(/from\('library_files'\)[\s\S]{0,400}production_id/)
  })
})
