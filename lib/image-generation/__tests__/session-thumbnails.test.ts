import { describe, expect, it, vi } from 'vitest'
import { resolveSessionThumbnails } from '../session-thumbnails'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const IMG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const IMG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IMG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BLOB = '22222222-2222-4222-8222-222222222222'

type StubDb = { client: never; from: ReturnType<typeof vi.fn>; filters: Array<[string, unknown]> }
function db(rows: Array<Record<string, unknown>>, error: unknown = null) {
  const filters: Array<[string, unknown]> = []
  const builder: any = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder },
    in: (column: string, values: unknown[]) => { filters.push([column, values]); return builder },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(resolve),
  }
  const from = vi.fn(() => builder)
  return { client: { from } as never, from, filters } as StubDb
}

describe('resolveSessionThumbnails', () => {
  it('presigns the owner thumbnail key for sessions with a current image and reads only that owner\'s images', async () => {
    const { client, filters } = db([{ id: IMG_A, thumbnail_url: 'https://stale.example/a.webp', thumbnail_path: `users/${OWNER}/images/${BLOB}/thumb.webp` }])
    const presign = vi.fn(async () => 'https://signed.example/thumb.webp')
    const map = await resolveSessionThumbnails(client, OWNER, [IMG_A, null, IMG_A], presign as never)
    expect(map.get(IMG_A)).toBe('https://signed.example/thumb.webp')
    expect(presign).toHaveBeenCalledWith(OWNER, `users/${OWNER}/images/${BLOB}/thumb.webp`, 'thumbnail')
    expect(filters).toContainEqual(['user_id', OWNER])
    expect(filters).toContainEqual(['id', [IMG_A]])
  })

  it('keeps the stored thumbnail URL only for legacy rows that have no storage key', async () => {
    const { client } = db([{ id: IMG_B, thumbnail_url: 'https://legacy.example/b.webp', thumbnail_path: null }])
    const map = await resolveSessionThumbnails(client, OWNER, [IMG_B], vi.fn() as never)
    expect(map.get(IMG_B)).toBe('https://legacy.example/b.webp')
  })

  it('never signs or echoes a thumbnail key outside the owner namespace', async () => {
    const { client } = db([{ id: IMG_C, thumbnail_url: 'https://stale.example/c.webp', thumbnail_path: `users/${OTHER}/images/${BLOB}/thumb.webp` }])
    const presign = vi.fn()
    const map = await resolveSessionThumbnails(client, OWNER, [IMG_C], presign as never)
    expect(map.has(IMG_C)).toBe(false)
    expect(presign).not.toHaveBeenCalled()
  })

  it('returns no thumbnail (placeholder) when nothing usable exists, and does not fabricate one', async () => {
    const { client } = db([{ id: IMG_A, thumbnail_url: null, thumbnail_path: null }])
    expect((await resolveSessionThumbnails(client, OWNER, [IMG_A], vi.fn() as never)).size).toBe(0)
    const noImages = db([])
    expect((await resolveSessionThumbnails(noImages.client, OWNER, [null], vi.fn() as never)).size).toBe(0)
    expect(noImages.from).not.toHaveBeenCalled()
  })

  it('degrades to no thumbnails when the store read or presign fails', async () => {
    const failing = db([], { message: 'boom' })
    expect((await resolveSessionThumbnails(failing.client, OWNER, [IMG_A], vi.fn() as never)).size).toBe(0)
    const { client } = db([{ id: IMG_A, thumbnail_url: 'https://stale.example/a.webp', thumbnail_path: `users/${OWNER}/images/${BLOB}/thumb.webp` }])
    const map = await resolveSessionThumbnails(client, OWNER, [IMG_A], (async () => { throw new Error('s3 down') }) as never)
    expect(map.has(IMG_A)).toBe(false)
  })
})
