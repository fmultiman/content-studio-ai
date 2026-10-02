import { beforeEach, describe, expect, it, vi } from 'vitest'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — SERVER AUTHORITY of the receiving route, end to end:
// the REAL route + the REAL domain code run against an in-memory table fake that applies the real
// .eq/.is filters. The receiving Project must come from the real authoring target (Static chain /
// owner-scoped VideoDraft); a browser-supplied `projectId` is never an authority.

vi.mock('@/lib/storage/library-storage', () => ({
  presignLibraryRead: vi.fn(async (file: { storage_path: string }) => `https://signed.example/${file.storage_path}`),
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

import { GET } from '@/app/api/library-files/[id]/handoff-media/route'

const ME = '00000000-0000-4000-8000-0000000000aa'
const OTHER = '00000000-0000-4000-8000-0000000000bb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PROJECT_A = id(1), PROJECT_B = id(2)
const EC_A = id(11), EC_B = id(12), EC_FOREIGN = id(13)
const CP_A = id(21), CP_B = id(22), CP_A_REEL = id(23), CP_FOREIGN = id(24)
const DRAFT_A = id(31), DRAFT_B = id(32), DRAFT_NO_PROJECT = id(33), DRAFT_FOREIGN = id(34)
const FILE_A = id(41), FILE_B = id(42), FILE_FOREIGN = id(43)
const UUID = '40000000-0000-4000-8000-000000000001'

const file = (fileId: string, project: string, user = ME): Row => ({
  id: fileId, user_id: user, project_id: project, production_id: null, name: 'gerada.png', kind: 'image', mime_type: 'image/png',
  storage_path: `users/${user}/library/${UUID}/gerada.png`, public_url: 'https://stored.example/x', thumbnail_url: null, deleted_at: null,
})

beforeEach(() => {
  writes.length = 0
  currentUser = ME
  tables = {
    projects: [{ id: PROJECT_A, user_id: ME }, { id: PROJECT_B, user_id: ME }],
    editorial_contents: [
      { id: EC_A, user_id: ME, project_id: PROJECT_A },
      { id: EC_B, user_id: ME, project_id: PROJECT_B },
      { id: EC_FOREIGN, user_id: OTHER, project_id: PROJECT_A },
    ],
    channel_pieces: [
      { id: CP_A, user_id: ME, editorial_content_id: EC_A, channel: 'instagram', format: 'post' },
      { id: CP_B, user_id: ME, editorial_content_id: EC_B, channel: 'instagram', format: 'post' },
      { id: CP_A_REEL, user_id: ME, editorial_content_id: EC_A, channel: 'instagram', format: 'reel' },
      { id: CP_FOREIGN, user_id: OTHER, editorial_content_id: EC_FOREIGN, channel: 'instagram', format: 'post' },
    ],
    video_drafts: [
      { id: DRAFT_A, user_id: ME, project_id: PROJECT_A },
      { id: DRAFT_B, user_id: ME, project_id: PROJECT_B },
      { id: DRAFT_NO_PROJECT, user_id: ME, project_id: null },
      { id: DRAFT_FOREIGN, user_id: OTHER, project_id: PROJECT_A },
    ],
    library_files: [file(FILE_A, PROJECT_A), file(FILE_B, PROJECT_B), file(FILE_FOREIGN, PROJECT_A, OTHER)],
  }
})

const request = (fileId: string, query: Record<string, string>) =>
  GET(new Request(`https://app.example/api/library-files/${fileId}/handoff-media?${new URLSearchParams(query)}`), { params: Promise.resolve({ id: fileId }) })
const staticQuery = (projectId: string, editorialContentId: string, channelPieceId: string) => ({ editor: 'static', projectId, editorialContentId, channelPieceId })

describe('Static receiving target — Project -> EditorialContent -> ChannelPiece is the authority', () => {
  it('1. target in Project A + LibraryFile in Project B + FORGED projectId=B -> rejected', async () => {
    // The browser claims Project B (where the file lives) but the real chain (EC_A / CP_A) is Project A.
    const forged = await request(FILE_B, staticQuery(PROJECT_B, EC_A, CP_A))
    expect(forged.status).toBe(404)
    expect((await forged.json()).code).toBe('TARGET_NOT_FOUND')
    // Told honestly that the target is Project A, the Project B file is still refused.
    const honest = await request(FILE_B, staticQuery(PROJECT_A, EC_A, CP_A))
    expect(honest.status).toBe(409)
    expect((await honest.json()).code).toBe('PROJECT_MISMATCH')
    expect(writes).toEqual([])
  })

  it('1b. a fully Project-B chain with Project A file is refused too (the file never decides the Project)', async () => {
    const response = await request(FILE_A, staticQuery(PROJECT_B, EC_B, CP_B))
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PROJECT_MISMATCH')
  })

  it.each([
    ['EditorialContent of another Project', staticQuery(PROJECT_A, EC_B, CP_A)],
    ['ChannelPiece of another EditorialContent/Project', staticQuery(PROJECT_A, EC_A, CP_B)],
    ['Project / EditorialContent / ChannelPiece all from different Projects', staticQuery(PROJECT_B, EC_A, CP_B)],
    ['a video-like ChannelPiece (not a Static target)', staticQuery(PROJECT_A, EC_A, CP_A_REEL)],
  ])('2. mixed or ineligible ids (%s) -> rejected', async (_label, query) => {
    for (const fileId of [FILE_A, FILE_B]) {
      const response = await request(fileId, query)
      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('TARGET_NOT_FOUND')
    }
  })

  it('3. correct chain + same-Project LibraryFile -> accepted (read-only)', async () => {
    const response = await request(FILE_A, staticQuery(PROJECT_A, EC_A, CP_A))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.file.id).toBe(FILE_A)
    expect(body.file.public_url).toBe(`https://signed.example/users/${ME}/library/${UUID}/gerada.png`)
    expect(writes).toEqual([])
  })

  it('refuses a request without the full chain (a bare projectId is not a target)', async () => {
    const response = await request(FILE_A, { editor: 'static', projectId: PROJECT_A })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_REQUEST')
  })
})

describe('Video receiving target — the owner-scoped VideoDraft is the authority', () => {
  it('4. VideoDraft in Project A + LibraryFile in Project B + FORGED projectId=B -> rejected (projectId is ignored)', async () => {
    const response = await request(FILE_B, { editor: 'video', draftId: DRAFT_A, projectId: PROJECT_B })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PROJECT_MISMATCH')
    expect(writes).toEqual([])
  })

  it('5. owner-scoped VideoDraft + same-Project LibraryFile -> accepted', async () => {
    const response = await request(FILE_A, { editor: 'video', draftId: DRAFT_A })
    expect(response.status).toBe(200)
    expect((await response.json()).file.id).toBe(FILE_A)
    // A forged, even contradictory, projectId changes nothing: the draft decides.
    expect((await request(FILE_A, { editor: 'video', draftId: DRAFT_A, projectId: PROJECT_B })).status).toBe(200)
    // And the Project B draft accepts the Project B file only.
    expect((await request(FILE_B, { editor: 'video', draftId: DRAFT_B })).status).toBe(200)
    expect((await request(FILE_A, { editor: 'video', draftId: DRAFT_B })).status).toBe(409)
  })

  it('a VideoDraft without a Project cannot receive media', async () => {
    const response = await request(FILE_A, { editor: 'video', draftId: DRAFT_NO_PROJECT, projectId: PROJECT_A })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('NO_PROJECT')
  })

  it('a missing or malformed draftId is an invalid request (a Project alone is never a target)', async () => {
    expect((await request(FILE_A, { editor: 'video', projectId: PROJECT_A })).status).toBe(400)
    expect((await request(FILE_A, { editor: 'video', draftId: 'not-a-uuid' })).status).toBe(400)
  })
})

describe('foreign users', () => {
  it('6. a foreign user target is rejected for both editors (even with the owner own file)', async () => {
    const staticResponse = await request(FILE_A, staticQuery(PROJECT_A, EC_FOREIGN, CP_FOREIGN))
    expect(staticResponse.status).toBe(404)
    expect((await staticResponse.json()).code).toBe('TARGET_NOT_FOUND')
    const videoResponse = await request(FILE_A, { editor: 'video', draftId: DRAFT_FOREIGN })
    expect(videoResponse.status).toBe(404)
    expect((await videoResponse.json()).code).toBe('TARGET_NOT_FOUND')
  })

  it('6b. an intruder cannot use the owner consistent target', async () => {
    currentUser = OTHER
    expect((await request(FILE_A, staticQuery(PROJECT_A, EC_A, CP_A))).status).toBe(404)
    expect((await request(FILE_A, { editor: 'video', draftId: DRAFT_A })).status).toBe(404)
  })

  it('7. a foreign user LibraryFile is rejected as not found, with a valid own target', async () => {
    for (const query of [staticQuery(PROJECT_A, EC_A, CP_A), { editor: 'video', draftId: DRAFT_A }]) {
      const response = await request(FILE_FOREIGN, query)
      expect(response.status).toBe(404)
      expect((await response.json()).code).toBe('NOT_FOUND')
    }
  })

  it('requires authentication before reading anything', async () => {
    currentUser = null
    expect((await request(FILE_A, { editor: 'video', draftId: DRAFT_A })).status).toBe(401)
  })
})
