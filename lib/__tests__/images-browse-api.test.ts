import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// VIDEO_I2V_SOURCE_BROWSER_V1 — GET /api/images/browse ("Geradas por IA"). In-memory DB and S3; synthetic data only.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({
  createPresignedReadUrl: vi.fn(async (path: string) => `https://signed.example.test/${path}?sig=1`),
}))

import * as server from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { GET } from '@/app/api/images/browse/route'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROD_1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const PROD_2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, seconds)).toISOString()
const originalKey = (user: string, n: number) => `users/${user}/images/${uuid(1000 + n)}/original.png`
const thumbKey = (user: string, n: number) => `users/${user}/images/${uuid(1000 + n)}/thumb.webp`

type Row = Record<string, any>
function image(n: number, overrides: Row = {}): Row {
  return {
    id: uuid(n),
    user_id: USER,
    project_id: PROJECT_A,
    user_input: `Uma raposa ${n}`,
    created_at: at(n),
    mime_type: 'image/png',
    storage_path: originalKey(USER, n),
    thumbnail_path: null,
    image_url: `data:image/png;base64,${'A'.repeat(50)}`,
    ...overrides,
  }
}

let db: FakeDb
let authed: { id: string } | null
const selects: string[] = []
const orders: Array<[string, unknown]> = []
const limits: number[] = []
const ors: string[] = []

function seed(images: Row[], drafts: Row[] = []) {
  db = createFakeDb({
    seed: { images, image_drafts: drafts, projects: [{ id: PROJECT_A, user_id: USER }, { id: PROJECT_B, user_id: USER }, { id: 'foreign', user_id: OTHER }] },
    generatedId: [],
  })
  const from = (table: string) => {
    const builder: any = db.from(table)
    const select = builder.select.bind(builder)
    builder.select = (columns?: string) => (selects.push(`${table}:${columns ?? '*'}`), select(columns))
    // The generic fake does not sort/limit/or: record the contract the route asks for instead (cursor semantics are
    // proven end to end in library-browse-api.test.ts, which shares keysetFilter).
    const order = builder.order?.bind(builder)
    builder.order = (column: string, options: unknown) => (orders.push([column, options]), order ? order(column, options) : builder)
    const limit = builder.limit?.bind(builder)
    builder.limit = (count: number) => (limits.push(count), limit ? limit(count) : builder)
    builder.or = (expression: string) => (ors.push(expression), builder)
    return builder
  }
  vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: authed }, error: authed ? null : { message: 'no' } }) }, from } as any)
}

const browse = (query: Record<string, string | undefined> = { projectId: PROJECT_A }) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value)
  return GET(new Request(`http://localhost/api/images/browse?${params.toString()}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  selects.length = 0
  orders.length = 0
  limits.length = 0
  ors.length = 0
  authed = { id: USER }
  vi.mocked(createPresignedReadUrl).mockImplementation(async (path: string) => `https://signed.example.test/${path}?sig=1`)
  seed([])
})

describe('GET /api/images/browse — scoping', () => {
  it('401 without a session', async () => {
    authed = null
    seed([image(1)])
    authed = null
    expect((await browse()).status).toBe(401)
  })

  it.each([undefined, '', 'nope'])('requires a valid projectId (%s)', async (projectId) => {
    expect((await browse({ projectId })).status).toBe(400)
  })

  it('404 for a Project the user does not own', async () => {
    seed([image(1)])
    expect((await browse({ projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })).status).toBe(404)
  })

  it('lists only THIS user’s images of THIS Project (never another Project or user)', async () => {
    seed([image(1), image(2, { project_id: PROJECT_B }), image(3, { user_id: OTHER, storage_path: originalKey(OTHER, 3) })])
    const body = await (await browse()).json()
    expect(body.images.map((item: Row) => item.id)).toEqual([uuid(1)])
  })

  it('a malformed cursor is refused', async () => {
    seed([image(1)])
    const response = await browse({ projectId: PROJECT_A, cursor: 'garbage' })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('INVALID_CURSOR')
  })
})

describe('GET /api/images/browse — eligibility and payload', () => {
  it('offers only PNG/JPEG images that carry a stored object (other formats, unknown MIME and legacy URL-only rows are not sources)', async () => {
    seed([
      image(1),
      image(2, { mime_type: 'image/jpeg' }),
      image(3, { mime_type: 'image/webp' }),
      image(4, { mime_type: null }),
      image(5, { storage_path: null }),
    ])
    const body = await (await browse()).json()
    expect(body.images.map((item: Row) => item.id).sort()).toEqual([uuid(1), uuid(2)])
  })

  it('NEVER selects image_url (legacy rows hold multi-megabyte data URLs) and never returns a storage-key field or a data URL', async () => {
    seed([image(1)])
    const response = await browse()
    const text = await response.text()
    expect(selects.find((entry) => entry.startsWith('images:'))).not.toMatch(/image_url|thumbnail_url/)
    expect(text).not.toMatch(/data:image|storage_path|thumbnail_path/)
  })

  it('the display URL is a short-lived signed URL (thumbnail preferred), produced only for the owner’s own key', async () => {
    seed([image(1, { thumbnail_path: thumbKey(USER, 1) }), image(2)])
    const body = await (await browse()).json()
    const byId = Object.fromEntries(body.images.map((item: Row) => [item.id, item]))
    expect(byId[uuid(1)].thumbnail_url).toContain('thumb.webp')
    expect(byId[uuid(2)].thumbnail_url).toContain('original.png')
  })

  it('a row whose key is not the owner’s is listed without a URL and is never presigned', async () => {
    seed([image(1, { storage_path: originalKey(OTHER, 1) })])
    const body = await (await browse()).json()
    expect(body.images[0].thumbnail_url).toBeNull()
    expect(vi.mocked(createPresignedReadUrl)).not.toHaveBeenCalled()
  })

  it('the name is a bounded title (first line, truncated), never the full prompt', async () => {
    seed([image(1, { user_input: `${'x'.repeat(200)}\nsegunda linha` }), image(2, { user_input: '   ' })])
    const body = await (await browse()).json()
    const names = body.images.map((item: Row) => item.name)
    expect(names.find((name: string) => name.startsWith('xxx'))!.length).toBeLessThanOrEqual(80)
    expect(names).toContain('Imagem gerada')
  })
})

describe('GET /api/images/browse — Production is context, never a filter', () => {
  it('reports the Production only when exactly one draft Production is derivable; unscoped and ambiguous images are STILL listed', async () => {
    seed(
      [image(1), image(2), image(3)],
      [
        { id: 'd1', user_id: USER, current_image_id: uuid(1), production_id: PROD_1 },
        { id: 'd3a', user_id: USER, current_image_id: uuid(3), production_id: PROD_1 },
        { id: 'd3b', user_id: USER, current_image_id: uuid(3), production_id: PROD_2 },
      ],
    )
    const body = await (await browse()).json()
    const byId = Object.fromEntries(body.images.map((item: Row) => [item.id, item.production_id]))
    expect(byId).toEqual({ [uuid(1)]: PROD_1, [uuid(2)]: null, [uuid(3)]: null })
  })

  it('the Production context costs ONE batched read for the page (no per-image query)', async () => {
    seed([image(1), image(2), image(3), image(4)])
    await browse()
    expect(selects.filter((entry) => entry.startsWith('image_drafts:'))).toHaveLength(1)
  })
})

describe('GET /api/images/browse — bounded pages', () => {
  it('default 48, hard max 100; asks for newest first (created_at DESC, id DESC) with a limit+1 lookahead', async () => {
    seed(Array.from({ length: 130 }, (_, index) => image(index + 1)))
    const first = await (await browse()).json()
    expect(first.limit).toBe(48)
    expect(limits.at(-1)).toBe(49)
    expect(orders).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]])
    const huge = await (await browse({ projectId: PROJECT_A, limit: '100000' })).json()
    expect(huge.limit).toBe(100)
    expect(limits.at(-1)).toBe(101)
  })

  it('a cursor becomes the keyset filter on (created_at, id)', async () => {
    seed([image(1)])
    const cursor = Buffer.from(JSON.stringify([at(5), uuid(5)]), 'utf8').toString('base64url')
    await browse({ projectId: PROJECT_A, cursor })
    expect(ors).toEqual([`created_at.lt."${at(5)}",and(created_at.eq."${at(5)}",id.lt.${uuid(5)})`])
  })

  it('returns a next cursor when the lookahead row exists (limit+1 rows came back)', async () => {
    seed(Array.from({ length: 5 }, (_, index) => image(index + 1)))
    const body = await (await browse({ projectId: PROJECT_A, limit: '3' })).json()
    // the generic fake does not limit, so all 5 come back: the route keeps 3 and exposes the cursor
    expect(body.images).toHaveLength(3)
    expect(body.nextCursor).toBeTruthy()
  })

  it('presigns only the returned page', async () => {
    seed(Array.from({ length: 130 }, (_, index) => image(index + 1)))
    await browse({ projectId: PROJECT_A, limit: '20' })
    expect(vi.mocked(createPresignedReadUrl)).toHaveBeenCalledTimes(20)
  })

  it('no next cursor on the last page', async () => {
    seed([image(1), image(2)])
    expect((await (await browse()).json()).nextCursor).toBeNull()
  })
})
