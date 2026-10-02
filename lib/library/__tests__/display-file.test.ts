import { beforeEach, describe, expect, it, vi } from 'vitest'

// CREATIVE_EDITOR_REAL_SMOKE_CORRECTNESS_HARDENING_V1 — GET /api/library-files/:id/display: the signed, owner-scoped
// single-file read the Static picker uses. Real route + real domain code over an in-memory table fake.

vi.mock('@/lib/storage/library-storage', () => ({
  presignLibraryRead: vi.fn(async (file: { storage_path: string }) => `https://signed.example/${file.storage_path}?sig=1`),
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let currentUser: string | null
const writes: string[] = []

class Query {
  private filters: Array<(row: Row) => boolean> = []
  constructor(private table: string) {}
  select() { return this }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
  is(column: string, value: null) { this.filters.push((row) => (value === null ? row[column] == null : row[column] === value)); return this }
  insert() { writes.push(`${this.table}.insert`); return this }
  update() { writes.push(`${this.table}.update`); return this }
  upsert() { writes.push(`${this.table}.upsert`); return this }
  delete() { writes.push(`${this.table}.delete`); return this }
  async maybeSingle() { return { data: (tables[this.table] ?? []).find((row) => this.filters.every((filter) => filter(row))) ?? null, error: null } }
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null }, error: null }) },
    from: (table: string) => new Query(table),
  }),
}))

import { GET } from '@/app/api/library-files/[id]/display/route'

const ME = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PROJECT_A = id(1), PROJECT_B = id(2)
const FILE = id(41), FILE_B = id(42), FILE_FOREIGN = id(43), FILE_TRASHED = id(44), FILE_VIDEO = id(45), FILE_NO_PRODUCTION = id(46)
const UUID = '40000000-0000-4000-8000-000000000001'

const file = (fileId: string, overrides: Row = {}): Row => ({
  id: fileId, user_id: ME, project_id: PROJECT_A, production_id: null, name: 'logo.png', kind: 'image', mime_type: 'image/png', origin: 'upload',
  storage_path: `users/${ME}/library/${UUID}/logo.png`, public_url: 'https://stored.example/raw.png', thumbnail_url: null, deleted_at: null, ...overrides,
})

beforeEach(() => {
  writes.length = 0
  currentUser = ME
  tables = {
    library_files: [
      file(FILE),
      file(FILE_B, { project_id: PROJECT_B }),
      file(FILE_FOREIGN, { user_id: OTHER, storage_path: `users/${OTHER}/library/${UUID}/logo.png` }),
      file(FILE_TRASHED, { deleted_at: '2026-01-01T00:00:00Z' }),
      file(FILE_VIDEO, { kind: 'video', mime_type: 'video/mp4' }),
      file(FILE_NO_PRODUCTION, { production_id: null, name: 'sem-production.png' }),
    ],
  }
})

const call = (fileId: string, projectId: string | null) =>
  GET(new Request(`https://app.example/api/library-files/${fileId}/display${projectId ? `?projectId=${projectId}` : ''}`), { params: Promise.resolve({ id: fileId }) })

describe('GET /api/library-files/:id/display', () => {
  it('returns the file as the editors display it: a signed read URL, never the raw stored URL', async () => {
    const response = await call(FILE, PROJECT_A)
    expect(response.status).toBe(200)
    const { file: row } = await response.json()
    expect(row).toMatchObject({ id: FILE, name: 'logo.png', mime_type: 'image/png', origin: 'upload' })
    expect(row.public_url).toBe(`https://signed.example/users/${ME}/library/${UUID}/logo.png?sig=1`)
    expect(row.thumbnail_url).toBe(row.public_url)
    expect(JSON.stringify(row)).not.toContain('stored.example')
    expect(JSON.stringify(row)).not.toContain('storage_path')
    expect(writes).toEqual([])
  })

  it('33. a LibraryFile with NO Production association is returned (Production is never a requirement)', async () => {
    const response = await call(FILE_NO_PRODUCTION, PROJECT_A)
    expect(response.status).toBe(200)
    expect((await response.json()).file.name).toBe('sem-production.png')
  })

  it.each([
    ['another Project (the file belongs to Project B)', FILE_B, PROJECT_A],
    ['a foreign user file', FILE_FOREIGN, PROJECT_A],
    ['a trashed file', FILE_TRASHED, PROJECT_A],
    ['a non-image file', FILE_VIDEO, PROJECT_A],
    ['an unknown file', id(99), PROJECT_A],
  ])('37. is NOT found for %s', async (_label, fileId, projectId) => {
    const response = await call(fileId, projectId)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('NOT_FOUND')
  })

  it('37. an intruder cannot read the owner file even with its real Project id', async () => {
    currentUser = OTHER
    expect((await call(FILE, PROJECT_A)).status).toBe(404)
  })

  it('refuses a malformed or missing id / Project, and requires authentication', async () => {
    expect((await call('not-a-uuid', PROJECT_A)).status).toBe(400)
    expect((await call(FILE, null)).status).toBe(400)
    expect((await call(FILE, 'p1')).status).toBe(400)
    currentUser = null
    expect((await call(FILE, PROJECT_A)).status).toBe(401)
  })
})
