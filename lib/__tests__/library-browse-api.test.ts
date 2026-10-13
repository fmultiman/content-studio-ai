import { beforeEach, describe, expect, it, vi } from 'vitest'

// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1 — GET /api/library-files/browse.
// An in-memory PostgREST-shaped query builder evaluates the REAL filter strings the route emits (including the
// `.or()` logic trees), so cursor pagination is proven end to end, not assumed. Synthetic data only.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(async (path: string) => `https://signed.example.test/${path}?sig=1`),
}))

import * as server from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { GET } from '@/app/api/library-files/browse/route'
import { BROWSE_DEFAULT_LIMIT, BROWSE_MAX_LIMIT, combineOrGroups, decodeCursor, encodeCursor, escapeLike, keysetFilter } from '@/lib/library/browse-query'

type Row = Record<string, any>

// ---- mini PostgREST evaluator ------------------------------------------------------------------------------------
function splitTop(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const character of input) {
    if (character === '"') quoted = !quoted
    if (!quoted && character === '(') depth += 1
    if (!quoted && character === ')') depth -= 1
    if (!quoted && depth === 0 && character === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current) parts.push(current)
  return parts
}

const unquote = (value: string) => (value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value)
const comparable = (column: string, value: any) => (column === 'created_at' ? Date.parse(String(value)) : value)

function leaf(row: Row, expression: string): boolean {
  const firstDot = expression.indexOf('.')
  const secondDot = expression.indexOf('.', firstDot + 1)
  const column = expression.slice(0, firstDot)
  const operator = expression.slice(firstDot + 1, secondDot)
  const raw = unquote(expression.slice(secondDot + 1))
  const left = comparable(column, row[column])
  const right = comparable(column, raw)
  if (operator === 'eq') return left === right
  if (operator === 'neq') return left !== right
  if (operator === 'lt') return left < right
  throw new Error(`unsupported operator in test evaluator: ${operator}`)
}

function evaluate(row: Row, expression: string, mode: 'or' | 'and'): boolean {
  const results = splitTop(expression).map((item) => {
    if (item.startsWith('and(')) return evaluate(row, item.slice(4, -1), 'and')
    if (item.startsWith('or(')) return evaluate(row, item.slice(3, -1), 'or')
    return leaf(row, item)
  })
  return mode === 'or' ? results.some(Boolean) : results.every(Boolean)
}

const likeToRegExp = (pattern: string) => {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '\\') {
      source += pattern[index + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      index += 1
    } else if (character === '%') source += '.*'
    else if (character === '_') source += '.'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, 'i')
}

const calls: { table: string; or: string[]; limit: number | null }[] = []

function builder(tables: Record<string, Row[]>, table: string) {
  const predicates: Array<(row: Row) => boolean> = []
  const record = { table, or: [] as string[], limit: null as number | null }
  calls.push(record)
  let orderBy: Array<[string, boolean]> = []
  const api: any = {
    select: () => api,
    eq: (column: string, value: any) => (predicates.push((row) => row[column] === value), api),
    in: (column: string, values: any[]) => (predicates.push((row) => values.includes(row[column])), api),
    is: (column: string, value: any) => (predicates.push((row) => (value === null ? row[column] == null : row[column] === value)), api),
    not: (column: string, operator: string, value: any) => (predicates.push((row) => !(operator === 'is' && value === null ? row[column] == null : row[column] === value)), api),
    ilike: (column: string, pattern: string) => (predicates.push((row) => likeToRegExp(pattern).test(String(row[column] ?? ''))), api),
    or: (expression: string) => (record.or.push(expression), predicates.push((row) => evaluate(row, expression, 'or')), api),
    order: (column: string, options: { ascending: boolean }) => (orderBy.push([column, options.ascending]), api),
    limit: (count: number) => ((record.limit = count), api),
    maybeSingle: async () => ({ data: (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)))[0] ?? null, error: null }),
    then: (resolve: (value: any) => void) => {
      let rows = (tables[table] ?? []).filter((row) => predicates.every((predicate) => predicate(row)))
      rows = [...rows].sort((a, b) => {
        for (const [column, ascending] of orderBy) {
          const x = comparable(column, a[column])
          const y = comparable(column, b[column])
          if (x === y) continue
          return (x < y ? -1 : 1) * (ascending ? 1 : -1)
        }
        return 0
      })
      if (record.limit != null) rows = rows.slice(0, record.limit)
      resolve({ data: rows, error: null })
    },
  }
  return api
}

// ---- fixtures ----------------------------------------------------------------------------------------------------
const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROJECT_FOREIGN = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const PROD_A1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const PROD_A2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'
const PROD_B1 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, seconds)).toISOString()

function file(n: number, overrides: Row = {}): Row {
  return {
    id: uuid(n),
    user_id: USER,
    project_id: PROJECT_A,
    production_id: null,
    folder: '/Projetos/A',
    name: `arquivo-${n}.png`,
    kind: 'image',
    mime_type: 'image/png',
    origin: 'upload',
    deleted_at: null,
    created_at: at(n),
    storage_path: `users/${USER}/library/${uuid(1000 + n)}/arquivo-${n}.png`,
    public_url: 'https://cdn.example.test/stored',
    thumbnail_url: null,
    ...overrides,
  }
}

let tables: Record<string, Row[]>
let authed: { id: string } | null

function seed(library: Row[]) {
  tables = {
    projects: [{ id: PROJECT_A, user_id: USER }, { id: PROJECT_B, user_id: USER }, { id: PROJECT_FOREIGN, user_id: OTHER }],
    productions: [
      { id: PROD_A1, user_id: USER, project_id: PROJECT_A },
      { id: PROD_A2, user_id: USER, project_id: PROJECT_A },
      { id: PROD_B1, user_id: USER, project_id: PROJECT_B },
    ],
    library_files: library,
  }
  vi.mocked(server.createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: authed }, error: authed ? null : { message: 'no' } }) },
    from: (table: string) => builder(tables, table),
  } as any)
}

const browse = (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value)
  return GET(new Request(`http://localhost/api/library-files/browse?${params.toString()}`))
}
const ids = async (response: Response) => (await response.json()).files.map((item: Row) => item.id) as string[]

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  authed = { id: USER }
  vi.mocked(createPresignedReadUrl).mockImplementation(async (path: string) => `https://signed.example.test/${path}?sig=1`)
  seed([])
})

// ---- pure helpers ------------------------------------------------------------------------------------------------
describe('browse-query helpers', () => {
  it('escapes LIKE wildcards so user text is literal', () => {
    expect(escapeLike('100%_off\\x')).toBe('100\\%\\_off\\\\x')
  })

  it('cursor round-trips and rejects anything it did not produce', () => {
    const cursor = { createdAt: at(5), id: uuid(5) }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
    expect(decodeCursor(null)).toBe('none')
    for (const bad of ['garbage', Buffer.from('[1,2]').toString('base64url'), Buffer.from(JSON.stringify(['x"),id.eq.1', uuid(1)])).toString('base64url'), Buffer.from(JSON.stringify([at(1), 'id.eq.1,or(a.eq.b)'])).toString('base64url')]) {
      expect(decodeCursor(bad)).toBeNull()
    }
  })

  it('combines several or-groups with AND', () => {
    expect(combineOrGroups([])).toBeNull()
    expect(combineOrGroups(['a.eq.1,b.eq.2'])).toBe('a.eq.1,b.eq.2')
    expect(combineOrGroups(['a.eq.1,b.eq.2', keysetFilter({ createdAt: at(1), id: uuid(1) })])).toMatch(/^and\(or\(a\.eq\.1,b\.eq\.2\),or\(created_at\.lt/)
  })
})

// ---- request validation ------------------------------------------------------------------------------------------
describe('authentication and scoping', () => {
  it('401 without a session', async () => {
    authed = null
    seed([file(1)])
    authed = null
    expect((await browse({ projectId: PROJECT_A })).status).toBe(401)
  })

  it.each([undefined, '', 'not-a-uuid'])('requires a valid projectId (%s)', async (projectId) => {
    seed([file(1)])
    const response = await browse({ projectId })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('PROJECT_REQUIRED')
  })

  it('404 for a Project the user does not own (no data, no existence oracle)', async () => {
    seed([file(1, { user_id: OTHER, project_id: PROJECT_FOREIGN, storage_path: `users/${OTHER}/library/${uuid(9)}/x.png` })])
    const response = await browse({ projectId: PROJECT_FOREIGN })
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PROJECT_NOT_FOUND')
  })

  it('returns only the caller’s files of the requested Project, never another user’s or another Project’s', async () => {
    seed([
      file(1),
      file(2, { project_id: PROJECT_B, folder: '/Projetos/B' }),
      file(3, { user_id: OTHER, storage_path: `users/${OTHER}/library/${uuid(9)}/x.png` }),
    ])
    expect(await ids(await browse({ projectId: PROJECT_A }))).toEqual([uuid(1)])
  })

  it('rejects malformed filters with 400 and never reaches the database', async () => {
    seed([file(1)])
    for (const [query, code] of [
      [{ projectId: PROJECT_A, production: 'nope' }, 'INVALID_PRODUCTION_FILTER'],
      [{ projectId: PROJECT_A, kind: 'exe' }, 'INVALID_KIND'],
      [{ projectId: PROJECT_A, cursor: 'garbage' }, 'INVALID_CURSOR'],
    ] as const) {
      const response = await browse(query)
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe(code)
    }
    expect(calls.filter((call) => call.table === 'library_files')).toHaveLength(0)
  })
})

describe('Production filter: all / one / unscoped are distinct states', () => {
  beforeEach(() => {
    seed([file(1, { production_id: PROD_A1 }), file(2, { production_id: PROD_A2 }), file(3), file(4, { production_id: PROD_A1 })])
  })

  it('all (default) includes scoped and unscoped files', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A }))).sort()).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)])
    expect((await ids(await browse({ projectId: PROJECT_A, production: 'all' }))).sort()).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)])
  })

  it('one Production returns exactly its files', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, production: PROD_A1 }))).sort()).toEqual([uuid(1), uuid(4)])
  })

  it('unscoped returns only files without a Production', async () => {
    expect(await ids(await browse({ projectId: PROJECT_A, production: 'unscoped' }))).toEqual([uuid(3)])
  })

  it('a Production of another Project of the same user is refused (404), not silently empty', async () => {
    const response = await browse({ projectId: PROJECT_A, production: PROD_B1 })
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PRODUCTION_NOT_FOUND')
  })

  it('an unknown Production uuid is refused (404)', async () => {
    const response = await browse({ projectId: PROJECT_A, production: '12345678-1234-4234-8234-123456789012' })
    expect(response.status).toBe(404)
  })
})

describe('folder, kind, search, trash', () => {
  beforeEach(() => {
    seed([
      file(1, { folder: '/Projetos/A', name: 'Capa Verão.png' }),
      file(2, { folder: '/Projetos/A/Sub', name: 'capa-inverno.png' }),
      file(3, { folder: '/Projetos/A', name: 'clip.mp4', kind: 'video' }),
      file(4, { folder: '/Projetos/A', name: '100%_real.png' }),
      file(5, { folder: '/Projetos/A', name: 'lixo.png', deleted_at: at(50) }),
    ])
  })

  it('folder is an exact path filter (independent of Production)', async () => {
    expect(await ids(await browse({ projectId: PROJECT_A, folder: '/Projetos/A/Sub' }))).toEqual([uuid(2)])
    expect((await ids(await browse({ projectId: PROJECT_A, folder: 'Projetos/A/' }))).sort()).toEqual([uuid(1), uuid(3), uuid(4)])
  })

  it('kind filter', async () => {
    expect(await ids(await browse({ projectId: PROJECT_A, kind: 'video' }))).toEqual([uuid(3)])
  })

  it('search is case-insensitive, substring, and treats % and _ literally', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, q: 'CAPA' }))).sort()).toEqual([uuid(1), uuid(2)])
    expect(await ids(await browse({ projectId: PROJECT_A, q: '100%_' }))).toEqual([uuid(4)])
    expect(await ids(await browse({ projectId: PROJECT_A, q: '%' }))).toEqual([uuid(4)])
    expect(await ids(await browse({ projectId: PROJECT_A, q: '_' }))).toEqual([uuid(4)])
  })

  it('active files by default; trash only with trash=true', async () => {
    expect(await ids(await browse({ projectId: PROJECT_A }))).not.toContain(uuid(5))
    expect(await ids(await browse({ projectId: PROJECT_A, trash: 'true' }))).toEqual([uuid(5)])
  })

  it('scope=arquivos hides Creative Editor still renders (they live in Galeria) but keeps video renders', async () => {
    seed([file(1), file(2, { origin: 'studio_render', kind: 'image' }), file(3, { origin: 'studio_render', kind: 'video' })])
    expect((await ids(await browse({ projectId: PROJECT_A }))).sort()).toEqual([uuid(1), uuid(2), uuid(3)])
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'arquivos' }))).sort()).toEqual([uuid(1), uuid(3)])
  })
})

describe('pagination is bounded and deterministic', () => {
  it('default page is 48 and the hard max is 100', async () => {
    expect(BROWSE_DEFAULT_LIMIT).toBe(48)
    expect(BROWSE_MAX_LIMIT).toBe(100)
    seed(Array.from({ length: 130 }, (_, index) => file(index + 1)))
    const first = await (await browse({ projectId: PROJECT_A })).json()
    expect(first.files).toHaveLength(48)
    expect(first.limit).toBe(48)
    expect(first.nextCursor).toBeTruthy()
    const huge = await (await browse({ projectId: PROJECT_A, limit: '100000' })).json()
    expect(huge.files).toHaveLength(100)
    expect(huge.limit).toBe(100)
    const bogus = await (await browse({ projectId: PROJECT_A, limit: 'abc' })).json()
    expect(bogus.limit).toBe(48)
  })

  it('queries limit+1 rows, never the whole table', async () => {
    seed(Array.from({ length: 130 }, (_, index) => file(index + 1)))
    await browse({ projectId: PROJECT_A, limit: '10' })
    expect(calls.find((call) => call.table === 'library_files')!.limit).toBe(11)
  })

  it('newest first, and walking every page yields each file exactly once with no gaps', async () => {
    const all = Array.from({ length: 107 }, (_, index) => file(index + 1))
    seed(all)
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const body = await (await browse({ projectId: PROJECT_A, limit: '25', cursor })).json()
      seen.push(...body.files.map((item: Row) => item.id))
      cursor = body.nextCursor ?? undefined
      pages += 1
    } while (cursor && pages < 20)
    expect(pages).toBe(5)
    expect(seen).toHaveLength(107)
    expect(new Set(seen).size).toBe(107)
    expect(seen).toEqual(all.map((item) => item.id).reverse())
  })

  it('ties on created_at are broken by id so a page boundary inside a tie loses and repeats nothing', async () => {
    const same = at(7)
    const all = Array.from({ length: 9 }, (_, index) => file(index + 1, { created_at: same }))
    seed(all)
    const seen: string[] = []
    let cursor: string | undefined
    let guard = 0
    do {
      const body = await (await browse({ projectId: PROJECT_A, limit: '4', cursor })).json()
      seen.push(...body.files.map((item: Row) => item.id))
      cursor = body.nextCursor ?? undefined
      guard += 1
    } while (cursor && guard < 10)
    expect(seen).toHaveLength(9)
    expect(new Set(seen).size).toBe(9)
    expect(seen).toEqual(all.map((item) => item.id).reverse())
  })

  it('a cursor keeps working together with filters and the scope=arquivos group (AND of or-groups)', async () => {
    const all = Array.from({ length: 30 }, (_, index) => file(index + 1, index % 2 === 0 ? { production_id: PROD_A1 } : { origin: 'studio_render', kind: 'image' }))
    seed(all)
    const seen: string[] = []
    let cursor: string | undefined
    let guard = 0
    do {
      const body = await (await browse({ projectId: PROJECT_A, production: PROD_A1, scope: 'arquivos', limit: '4', cursor })).json()
      seen.push(...body.files.map((item: Row) => item.id))
      cursor = body.nextCursor ?? undefined
      guard += 1
    } while (cursor && guard < 10)
    expect(seen).toEqual(all.filter((item) => item.production_id === PROD_A1).map((item) => item.id).reverse())
  })

  it('no next cursor on the last page', async () => {
    seed(Array.from({ length: 3 }, (_, index) => file(index + 1)))
    expect((await (await browse({ projectId: PROJECT_A })).json()).nextCursor).toBeNull()
  })
})

describe('response safety', () => {
  it('presigns only the returned page (<= limit), each key proven to be the owner’s', async () => {
    seed(Array.from({ length: 130 }, (_, index) => file(index + 1)))
    await browse({ projectId: PROJECT_A, limit: '20' })
    expect(vi.mocked(createPresignedReadUrl)).toHaveBeenCalledTimes(20)
  })

  it('a row whose key is not the owner’s is never presigned (falls back to the stored url)', async () => {
    seed([file(1, { storage_path: `users/${OTHER}/library/${uuid(9)}/secret.png` })])
    const body = await (await browse({ projectId: PROJECT_A })).json()
    expect(vi.mocked(createPresignedReadUrl)).not.toHaveBeenCalled()
    expect(body.files[0].public_url).toBe('https://cdn.example.test/stored')
  })

  it('is uncacheable and exposes production_id for the UI', async () => {
    seed([file(1, { production_id: PROD_A1 })])
    const response = await browse({ projectId: PROJECT_A })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect((await response.json()).files[0].production_id).toBe(PROD_A1)
  })
})

// ---- VIDEO_I2V_SOURCE_BROWSER_V1: Galeria scope + I2V format eligibility -------------------------------------------
describe('scope=gallery — Creative Editor image outputs only (Galeria source)', () => {
  const studio = (n: number, overrides: Row = {}) => file(n, { origin: 'studio_render', folder: '/', ...overrides })

  beforeEach(() => {
    seed([
      studio(1, { production_id: PROD_A1 }),
      studio(2, { production_id: PROD_A2 }),
      studio(3),
      studio(4, { kind: 'video', mime_type: 'video/mp4' }),
      studio(5, { deleted_at: at(50) }),
      studio(6, { project_id: PROJECT_B }),
      file(7, { production_id: PROD_A1 }),
      file(8, { kind: 'video', mime_type: 'video/mp4' }),
      studio(9, { user_id: OTHER, storage_path: `users/${OTHER}/library/${uuid(9)}/x.png` }),
    ])
  })

  it('returns ONLY origin=studio_render images of this user and Project: no uploads, no video renders, no trash, no other Project/user', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'gallery' }))).sort()).toEqual([uuid(1), uuid(2), uuid(3)])
  })

  it('the browser cannot widen the scope: kind / folder hints do not turn it into something else', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', kind: 'video' }))).sort()).toEqual([uuid(1), uuid(2), uuid(3)])
  })

  it('Production filter: one / all / unscoped, and a Production of another Project is refused', async () => {
    expect(await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', production: PROD_A1 }))).toEqual([uuid(1)])
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', production: 'all' }))).sort()).toEqual([uuid(1), uuid(2), uuid(3)])
    expect(await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', production: 'unscoped' }))).toEqual([uuid(3)])
    const refused = await browse({ projectId: PROJECT_A, scope: 'gallery', production: PROD_B1 })
    expect(refused.status).toBe(404)
  })

  it('search matches the stored name and pages deterministically with no duplicates', async () => {
    seed(Array.from({ length: 30 }, (_, index) => studio(index + 1, { name: index % 2 ? 'slide-x.png' : 'capa-y.png' })))
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', q: 'slide', limit: '100' }))).length).toBe(15)
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const body = await (await browse({ projectId: PROJECT_A, scope: 'gallery', limit: '8', cursor })).json()
      seen.push(...body.files.map((item: Row) => item.id))
      cursor = body.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(30)
    expect(new Set(seen).size).toBe(30)
  })

  it('Galeria and Arquivos never show the same static render (taxonomy boundary, not a storage boundary)', async () => {
    const gallery = await ids(await browse({ projectId: PROJECT_A, scope: 'gallery', limit: '100' }))
    const arquivos = await ids(await browse({ projectId: PROJECT_A, scope: 'arquivos', kind: 'image', limit: '100' }))
    expect(gallery.length).toBeGreaterThan(0)
    expect(arquivos.length).toBeGreaterThan(0)
    expect(gallery.filter((id) => arquivos.includes(id))).toEqual([])
    expect(arquivos).toContain(uuid(7))
    expect(arquivos).not.toContain(uuid(1))
  })

  it('an unknown scope is refused without touching the database', async () => {
    const response = await browse({ projectId: PROJECT_A, scope: 'origin=studio_render' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_SCOPE')
    expect(calls.filter((call) => call.table === 'library_files')).toHaveLength(0)
  })
})

describe('format=i2v-image — PNG and JPEG only (source eligibility, not a Library-wide format rule)', () => {
  it('image-reference explicitly permits PNG/JPEG/WebP while Video keeps PNG/JPEG', async () => {
    seed([file(1), file(2, { mime_type: 'image/jpeg' }), file(3, { mime_type: 'image/webp' }), file(4, { mime_type: 'image/gif' }), file(5, { mime_type: 'image/webp', user_id: OTHER }), file(6, { mime_type: 'image/webp', project_id: PROJECT_B })])
    expect((await ids(await browse({ projectId: PROJECT_A, scope: 'arquivos', kind: 'image', format: 'image-reference' }))).sort()).toEqual([uuid(1), uuid(2), uuid(3)])
    expect((await ids(await browse({ projectId: PROJECT_A, format: 'i2v-image' }))).sort()).toEqual([uuid(1), uuid(2)])
  })
  beforeEach(() => {
    seed([
      file(1, { mime_type: 'image/png' }),
      file(2, { mime_type: 'image/jpeg' }),
      file(3, { mime_type: 'image/webp' }),
      file(4, { mime_type: 'image/gif' }),
      file(5, { mime_type: 'image/svg+xml' }),
      file(6, { mime_type: 'image/avif' }),
      file(7, { mime_type: null }),
    ])
  })

  it('offers PNG and JPEG and nothing else', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, format: 'i2v-image' }))).sort()).toEqual([uuid(1), uuid(2)])
  })

  it('without the format hint the Library itself still lists every image format (Library support is unchanged)', async () => {
    expect((await ids(await browse({ projectId: PROJECT_A, kind: 'image', limit: '100' }))).length).toBe(7)
  })

  it('only the typed value is accepted; a raw MIME list from the browser is refused', async () => {
    const response = await browse({ projectId: PROJECT_A, format: 'image/webp' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_FORMAT')
  })

  it('combines with scope, kind and Production filters', async () => {
    seed([file(1, { production_id: PROD_A1 }), file(2, { mime_type: 'image/webp', production_id: PROD_A1 }), file(3, { production_id: PROD_A2 })])
    expect(await ids(await browse({ projectId: PROJECT_A, scope: 'arquivos', kind: 'image', format: 'i2v-image', production: PROD_A1 }))).toEqual([uuid(1)])
  })
})
