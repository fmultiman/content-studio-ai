import { beforeEach, describe, expect, it, vi } from 'vitest'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — the Static Editor's route authority (the receiving side of
// the handoff reuses it unchanged): Project -> EditorialContent -> ChannelPiece must be one real chain.

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
const getUser = vi.fn()

class Query {
  private filters: Array<(row: Row) => boolean> = []
  constructor(private table: string) {}
  select() { return this }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
  in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this }
  private rows() { return (tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row))) }
  async single() { const row = this.rows()[0]; return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } } }
  then<T>(resolve: (value: { data: Row[]; error: null }) => T) { return Promise.resolve({ data: this.rows(), error: null }).then(resolve) }
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser }, from: (table: string) => new Query(table) }) }))

import { GET } from '@/app/api/creative/static-authoring-context/route'

const ME = 'user-1'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P_A = uuid(1); const P_B = uuid(2); const EC_A = uuid(11); const EC_B = uuid(12); const CP_A = uuid(21); const CP_B = uuid(22); const CP_REEL = uuid(23)
const identity = { schema_version: 1, foundation: { purpose: 'Registrar memoria cultural.' }, relationship: { audience: 'Comunidades leitoras.' }, expression: { visual_identity: 'Editorial e documental.' } }

const call = (project: string, content: string, piece: string) =>
  GET(new Request(`https://app.example/api/creative/static-authoring-context?projectId=${project}&editorialContentId=${content}&channelPieceId=${piece}`))

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: ME } }, error: null })
  tables = {
    projects: [{ id: P_A, user_id: ME, name: 'A', identity }, { id: P_B, user_id: ME, name: 'B', identity }],
    editorial_contents: [{ id: EC_A, user_id: ME, project_id: P_A, production_id: null, title: 'EC A' }, { id: EC_B, user_id: ME, project_id: P_B, production_id: null, title: 'EC B' }],
    channel_pieces: [
      { id: CP_A, user_id: ME, editorial_content_id: EC_A, channel: 'instagram', format: 'post', title: 'Post A' },
      { id: CP_B, user_id: ME, editorial_content_id: EC_B, channel: 'instagram', format: 'post', title: 'Post B' },
      { id: CP_REEL, user_id: ME, editorial_content_id: EC_A, channel: 'instagram', format: 'reel', title: 'Reel A' },
    ],
    productions: [],
    library_files: [],
  }
})

describe('static authoring context — id chain authority', () => {
  it('opens a real Project -> EditorialContent -> ChannelPiece chain', async () => {
    const response = await call(P_A, EC_A, CP_A)
    expect(response.status).toBe(200)
    expect((await response.json()).channelPiece.id).toBe(CP_A)
  })

  it('rejects an EditorialContent from another Project (mixed Project/EditorialContent)', async () => {
    const response = await call(P_A, EC_B, CP_B)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('EDITORIAL_CONTENT_NOT_FOUND')
  })

  it('rejects a ChannelPiece that belongs to a different EditorialContent (mixed EditorialContent/ChannelPiece)', async () => {
    const response = await call(P_A, EC_A, CP_B)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('CHANNEL_PIECE_NOT_FOUND')
  })

  it('rejects a valid ChannelPiece of Project B under Project A\'s URL ids', async () => {
    const response = await call(P_A, EC_A, CP_B)
    expect(response.status).toBe(404)
  })

  it('rejects another user\'s ids even when the chain is internally consistent', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'intruder' } }, error: null })
    const response = await call(P_A, EC_A, CP_A)
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PROJECT_NOT_FOUND')
  })

  it('keeps video-like ChannelPieces out of the Static Editor', async () => {
    const response = await call(P_A, EC_A, CP_REEL)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('TIMELINE_CONTEXT')
  })

  it('rejects non-UUID ids before any query', async () => {
    const response = await call('p1', 'e1', 'c1')
    expect(response.status).toBe(400)
  })

  it('requires authentication', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await call(P_A, EC_A, CP_A)).status).toBe(401)
  })
})
