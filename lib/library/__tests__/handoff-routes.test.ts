import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1 — HTTP surface of the handoff: auth, status mapping, and the
// read-only guarantee. The domain rules are proven in handoff.test.ts.

const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))

const resolveHandoffLibraryFile = vi.fn()
const loadHandoffTargets = vi.fn()
const resolveReceivedMedia = vi.fn()
vi.mock('@/lib/library/handoff', () => ({
  resolveHandoffLibraryFile: (...args: unknown[]) => resolveHandoffLibraryFile(...args),
  loadHandoffTargets: (...args: unknown[]) => loadHandoffTargets(...args),
  resolveReceivedMedia: (...args: unknown[]) => resolveReceivedMedia(...args),
}))

import { GET as getTargets } from '@/app/api/library-files/[id]/handoff/route'
import { GET as getMedia } from '@/app/api/library-files/[id]/handoff-media/route'

const ID = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const CONTENT = '33333333-3333-4333-8333-333333333333'
const PIECE = '44444444-4444-4444-8444-444444444444'
const DRAFT = '55555555-5555-4555-8555-555555555555'
const context = { params: Promise.resolve({ id: ID }) }
const mediaRequest = (query: string) => new Request(`https://app.example/api/library-files/${ID}/handoff-media?${query}`)

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

describe('GET /api/library-files/:id/handoff', () => {
  it('requires authentication before touching any data', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await getTargets(new Request('https://app.example/x'), context)
    expect(response.status).toBe(401)
    expect(resolveHandoffLibraryFile).not.toHaveBeenCalled()
  })

  it.each([['INVALID_REQUEST', 400], ['NOT_FOUND', 404], ['NO_PROJECT', 404]])('maps %s to %i', async (code, status) => {
    resolveHandoffLibraryFile.mockResolvedValue({ ok: false, code })
    const response = await getTargets(new Request('https://app.example/x'), context)
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(loadHandoffTargets).not.toHaveBeenCalled()
  })

  it('returns the targets of a valid file', async () => {
    resolveHandoffLibraryFile.mockResolvedValue({ ok: true, projectId: PROJECT, file: { id: ID } })
    loadHandoffTargets.mockResolvedValue({ file: { id: ID }, static: { items: [], truncated: false }, video: { items: [], truncated: false } })
    const response = await getTargets(new Request('https://app.example/x'), context)
    expect(response.status).toBe(200)
    expect(resolveHandoffLibraryFile).toHaveBeenCalledWith(expect.anything(), 'user-1', ID)
  })

  it('a failure while loading targets is a bounded 500, never a thrown error', async () => {
    resolveHandoffLibraryFile.mockResolvedValue({ ok: true, projectId: PROJECT, file: { id: ID } })
    loadHandoffTargets.mockRejectedValue(new Error('HANDOFF_TARGETS_UNAVAILABLE'))
    const response = await getTargets(new Request('https://app.example/x'), context)
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('TARGETS_UNAVAILABLE')
  })
})

describe('GET /api/library-files/:id/handoff-media', () => {
  it('requires authentication', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await getMedia(mediaRequest(`editor=video&projectId=${PROJECT}`), context)).status).toBe(401)
    expect(resolveReceivedMedia).not.toHaveBeenCalled()
  })

  it('rejects an unknown editor value without resolving anything', async () => {
    const response = await getMedia(mediaRequest(`editor=admin&projectId=${PROJECT}`), context)
    expect(response.status).toBe(400)
    expect(resolveReceivedMedia).not.toHaveBeenCalled()
  })

  it('passes the file id from the path and the Static target identifiers (never a bare Project) to the server authority', async () => {
    resolveReceivedMedia.mockResolvedValue({ ok: true, file: { id: ID } })
    const response = await getMedia(mediaRequest(`editor=static&projectId=${PROJECT}&editorialContentId=${CONTENT}&channelPieceId=${PIECE}`), context)
    expect(response.status).toBe(200)
    expect(resolveReceivedMedia).toHaveBeenCalledWith(expect.anything(), 'user-1', { fileId: ID, target: { editor: 'static', projectId: PROJECT, editorialContentId: CONTENT, channelPieceId: PIECE } })
  })

  it('passes ONLY the draft for a Video target: a projectId in the query is not forwarded as authority', async () => {
    resolveReceivedMedia.mockResolvedValue({ ok: true, file: { id: ID } })
    await getMedia(mediaRequest(`editor=video&draftId=${DRAFT}&projectId=${PROJECT}`), context)
    expect(resolveReceivedMedia).toHaveBeenCalledWith(expect.anything(), 'user-1', { fileId: ID, target: { editor: 'video', draftId: DRAFT } })
  })

  it.each([['NOT_FOUND', 404], ['PROJECT_MISMATCH', 409], ['UNSUPPORTED_KIND', 422], ['NO_PROJECT', 409], ['INVALID_REQUEST', 400], ['TARGET_NOT_FOUND', 404]])('maps %s to %i with a bounded message', async (code, status) => {
    resolveReceivedMedia.mockResolvedValue({ ok: false, code })
    const response = await getMedia(mediaRequest(`editor=video&draftId=${DRAFT}`), context)
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body.code).toBe(code)
    expect(typeof body.error).toBe('string')
    expect(JSON.stringify(body)).not.toMatch(/storage_path|users\//)
  })
})

describe('handoff is read-only by construction', () => {
  const sources = ['app/api/library-files/[id]/handoff/route.ts', 'app/api/library-files/[id]/handoff-media/route.ts', 'lib/library/handoff.ts', 'lib/creative/handoff/media-handoff.ts']
    .map((file) => [file, readFileSync(join(process.cwd(), ...file.split('/')), 'utf-8')] as const)

  it.each(sources)('%s never writes, promotes or creates anything', (_file, source) => {
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(source).not.toMatch(/save-to-library|channel_piece_media|copyS3Object|PutObject|from\('video_scenes'\)/)
    expect(source).not.toMatch(/createVideoDraft|createChannelPiece/)
  })

  it('exports GET only (no mutating verb exists on the handoff routes)', () => {
    for (const [file, source] of sources.slice(0, 2)) {
      expect(source, file).toMatch(/export async function GET/)
      expect(source, file).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    }
  })
})
