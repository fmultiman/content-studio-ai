import { beforeEach, describe, expect, it, vi } from 'vitest'

// VIDEO_REVIEW_UI_AND_HISTORY_V1 — GET /api/reviews/video (read-only history) at the route boundary.

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), history: vi.fn(), create: vi.fn() }))
const session = { auth: { getUser: mocks.getUser }, marker: 'user-session-client' }

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => session }))
vi.mock('@/lib/reviews/video-service', () => ({ createVideoReviewExecution: mocks.create }))
vi.mock('@/lib/reviews/video-history', () => ({ getVideoReviewHistory: mocks.history }))

import { GET } from '@/app/api/reviews/video/route'
import { ReviewServiceError } from '../errors'

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const USER = ID(99)
const get = (query: string) => GET(new Request(`http://localhost/api/reviews/video?${query}`) as never)

beforeEach(() => {
  mocks.getUser.mockReset()
  mocks.history.mockReset()
  mocks.create.mockReset()
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  mocks.history.mockResolvedValue({ items: [] })
})

describe('GET /api/reviews/video', () => {
  it('rejects an unauthenticated caller before reading anything', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await get(`kind=library_file&id=${ID(1)}`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('accepts only a typed source: bad kind, non-UUID id and missing params are 400', async () => {
    for (const query of [
      `kind=url&id=${ID(1)}`, `kind=library&id=${ID(1)}`, 'kind=library_file&id=not-a-uuid', 'kind=library_file&id=https://evil.example/v.mp4',
      'kind=library_file', `id=${ID(1)}`, '',
    ]) {
      const response = await get(query)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid Review source.', code: 'INVALID_BODY' })
    }
    expect(mocks.history).not.toHaveBeenCalled()
  })

  it('reads with the caller\'s OWN session client and the verified user id, then returns the items uncached', async () => {
    mocks.history.mockResolvedValue({ items: [{ id: ID(5), status: 'completed' }] })
    const response = await get(`kind=video_generation&id=${ID(1)}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ items: [{ id: ID(5), status: 'completed' }] })
    expect(mocks.history).toHaveBeenCalledTimes(1)
    const args = mocks.history.mock.calls[0][0]
    expect(args.db).toBe(session)
    expect(args.userId).toBe(USER)
    expect(args.source).toEqual({ kind: 'video_generation', id: ID(1) })
    // A history read never starts a Review.
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('answers an empty history with 200 and an empty list', async () => {
    const response = await get(`kind=render_execution&id=${ID(2)}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [] })
  })

  it('maps another user\'s or an unknown source to 404 without disclosure, and failures without leaking', async () => {
    mocks.history.mockRejectedValueOnce(new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.'))
    const missing = await get(`kind=library_file&id=${ID(3)}`)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Review source was not found.', code: 'REVIEW_SUBJECT_NOT_FOUND' })

    mocks.history.mockRejectedValueOnce(new Error('db down users/abc/library/x/clip.mp4 AIza-secret'))
    const broken = await get(`kind=library_file&id=${ID(3)}`)
    expect(broken.status).toBe(500)
    expect(JSON.stringify(await broken.json())).not.toMatch(/users\/abc|AIza|db down/)
  })
})
