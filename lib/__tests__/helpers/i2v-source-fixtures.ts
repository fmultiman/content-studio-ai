import { vi } from 'vitest'

// VIDEO_I2V_SOURCE_BROWSER_V1 — in-memory fetch router for the Image Source browser.
// It answers the SAME URLs the real routes serve (images/browse, library-files/browse, library-folders, upload),
// applying the same filters the server applies, so component tests exercise real request parameters.
// Synthetic data only. No real network, storage or provider.

type Row = Record<string, any>

export const PROJECT = 'proj-1'
export const OTHER_PROJECT = 'proj-2'
export const PROD_CURRENT = 'prod-1'
export const PROD_OTHER = 'prod-2'

export const productionsFixture = [
  { id: PROD_CURRENT, title: 'Production Atual' },
  { id: PROD_OTHER, title: 'Outra Production' },
]

export const foldersFixture = [
  { id: 'f-root', project_id: PROJECT, name: 'Maitê', path: '/Maitê', parent_path: '/', is_project_root: true },
  { id: 'f-ref', project_id: PROJECT, name: 'Referências', path: '/Maitê/Referências', parent_path: '/Maitê', is_project_root: false },
  { id: 'f-faces', project_id: PROJECT, name: 'Rostos', path: '/Maitê/Referências/Rostos', parent_path: '/Maitê/Referências', is_project_root: false },
]

let clock = 0
export const libraryRow = (id: string, overrides: Row = {}): Row => ({
  id,
  user_id: 'u1',
  project_id: PROJECT,
  production_id: null,
  folder: '/Maitê',
  name: `${id}.png`,
  kind: 'image',
  mime_type: 'image/png',
  origin: 'upload',
  deleted_at: null,
  created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, 1000 - clock++)).toISOString(), // newest first in fixture order
  thumbnail_url: `https://s3.example.test/${id}.png?sig=1`,
  public_url: null,
  ...overrides,
})

export const aiRow = (id: string, overrides: Row = {}): Row => ({
  id,
  project_id: PROJECT,
  name: `Imagem IA ${id}`,
  created_at: '2026-09-01T00:00:00.000Z',
  mime_type: 'image/png',
  thumbnail_url: `https://s3.example.test/${id}.png?sig=1`,
  production_id: null,
  ...overrides,
})

export interface I2vFixtureState {
  ai: Row[]
  library: Row[]
  folders: Row[]
  productions: Row[]
  pageSize: number
  aiFail: boolean
  libraryFail: boolean
  foldersFail: boolean
  uploadFailAt: 'presign' | 'put' | 'save' | null
  /** Called before a response is produced; return a promise to hold it (race tests). */
  gate: ((url: string) => Promise<void> | null) | null
  requests: string[]
  uploads: { presign?: any; put?: { url: string; type: string | null }; save?: any }
  extra: (url: string, init?: RequestInit) => Response | Promise<Response> | null
}

export function freshState(): I2vFixtureState {
  clock = 0
  return {
    ai: [aiRow('img-1')],
    library: [],
    folders: foldersFixture.map((folder) => ({ ...folder })),
    productions: productionsFixture.map((row) => ({ ...row })),
    pageSize: 3,
    aiFail: false,
    libraryFail: false,
    foldersFail: false,
    uploadFailAt: null,
    gate: null,
    requests: [],
    uploads: {},
    extra: () => null,
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const ELIGIBLE = ['image/png', 'image/jpeg']

function pageOf<T>(rows: T[], cursor: string | null, size: number) {
  const offset = cursor?.startsWith('o:') ? Number(cursor.slice(2)) : 0
  const slice = rows.slice(offset, offset + size)
  return { slice, nextCursor: offset + size < rows.length ? `o:${offset + size}` : null }
}

export function installI2vFetch(state: I2vFixtureState) {
  const mock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    state.requests.push(url)
    const held = state.gate?.(url)
    if (held) await held
    const extra = state.extra(url, init)
    if (extra) return extra

    if (url.startsWith('/api/images/browse?')) {
      if (state.aiFail) return json({ error: 'x' }, 500)
      const params = new URL(url, 'http://x').searchParams
      const eligible = ['image-reference', 'openai-image-reference'].includes(params.get('profile') ?? '') ? [...ELIGIBLE, 'image/webp'] : ELIGIBLE
      const rows = state.ai.filter((row) => row.project_id === params.get('projectId') && eligible.includes(row.mime_type))
      const { slice, nextCursor } = pageOf(rows, params.get('cursor'), state.pageSize)
      return json({ images: slice, nextCursor, limit: state.pageSize })
    }

    if (url.startsWith('/api/library-files/browse?')) {
      if (state.libraryFail) return json({ error: 'x' }, 500)
      const params = new URL(url, 'http://x').searchParams
      const production = params.get('production') ?? 'all'
      if (!['all', 'unscoped'].includes(production) && !state.productions.some((row) => row.id === production)) return json({ code: 'PRODUCTION_NOT_FOUND' }, 404)
      const scope = params.get('scope')
      let rows = state.library.filter((row) => row.project_id === params.get('projectId') && !row.deleted_at)
      if (scope === 'gallery') rows = rows.filter((row) => row.origin === 'studio_render' && row.kind === 'image')
      else {
        if (scope === 'arquivos') rows = rows.filter((row) => !(row.origin === 'studio_render' && row.kind === 'image'))
        if (params.get('kind')) rows = rows.filter((row) => row.kind === params.get('kind'))
      }
      if (params.get('format') === 'i2v-image') rows = rows.filter((row) => ELIGIBLE.includes(row.mime_type))
      if (params.get('format') === 'image-reference') rows = rows.filter((row) => [...ELIGIBLE, 'image/webp'].includes(row.mime_type))
      if (production === 'unscoped') rows = rows.filter((row) => !row.production_id)
      else if (production !== 'all') rows = rows.filter((row) => row.production_id === production)
      if (params.get('folder')) rows = rows.filter((row) => row.folder === params.get('folder'))
      if (params.get('q')) rows = rows.filter((row) => String(row.name).toLowerCase().includes(params.get('q')!.toLowerCase()))
      const { slice, nextCursor } = pageOf(rows, params.get('cursor'), state.pageSize)
      return json({ files: slice, nextCursor, limit: state.pageSize })
    }

    if (url.startsWith('/api/library-folders?')) {
      if (state.foldersFail) return json({ error: 'x' }, 500)
      const projectId = new URL(url, 'http://x').searchParams.get('projectId')
      return json({ folders: state.folders.filter((folder) => folder.project_id === projectId) })
    }

    if (url === '/api/storage/presign-image-upload' && init?.method === 'POST') {
      state.uploads.presign = JSON.parse(String(init.body))
      if (state.uploadFailAt === 'presign') return json({ error: 'x' }, 500)
      return json({ uploadUrl: 'https://upload.example.test/put', storagePath: 'users/u1/library/uuid/foto.png', storageProvider: 's3', imageUrl: 'https://cdn.example.test/foto.png' })
    }
    if (url === 'https://upload.example.test/put' && init?.method === 'PUT') {
      state.uploads.put = { url, type: (init.headers as Record<string, string>)?.['Content-Type'] ?? null }
      return state.uploadFailAt === 'put' ? new Response('', { status: 403 }) : new Response('', { status: 200 })
    }
    if (url === '/api/library-files' && init?.method === 'POST') {
      state.uploads.save = JSON.parse(String(init.body))
      if (state.uploadFailAt === 'save') return json({ error: 'x' }, 500)
      return json({ file: { id: 'lib-uploaded', name: state.uploads.save.name, project_id: state.uploads.save.projectId, production_id: state.uploads.save.productionId ?? null } })
    }
    return new Response('{}', { status: 200 })
  })
  return mock
}

export const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
