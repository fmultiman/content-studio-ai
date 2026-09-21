import { describe, expect, it, vi } from 'vitest'
import { CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE, saveRenderToChannelPiece } from '@/lib/creative/authoring'

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const DATA_URL = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`
const CHANNEL_PIECE_ID = '11111111-1111-1111-1111-111111111111'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('saveRenderToChannelPiece', () => {
  it('reuses the existing channel-piece-media upload route — no new route is introduced', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, { channelPieceMedium: { id: 'cpm-1' }, libraryFile: { id: 'lf-1' } }),
    )
    await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(CHANNEL_PIECE_MEDIA_UPLOAD_ROUTE)
    expect(url).toBe('/api/channel-piece-media/upload')
  })

  it('sends the correct channelPieceId and a PNG file under the "file" field expected by the route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, { channelPieceMedium: { id: 'cpm-1' }, libraryFile: { id: 'lf-1' } }),
    )
    await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = init.body as FormData
    expect(body.get('channelPieceId')).toBe(CHANNEL_PIECE_ID)
    const file = body.get('file') as File
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/png')
    // No role/status field is sent — the existing route decides role/position server-side.
    expect(body.get('role')).toBeNull()
    expect(body.get('status')).toBeNull()
  })

  it('returns the created LibraryFile and ChannelPieceMedia ids on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(201, { channelPieceMedium: { id: 'cpm-42' }, libraryFile: { id: 'lf-42' } }),
    )
    const result = await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result).toEqual({ ok: true, libraryFileId: 'lf-42', channelPieceMediaId: 'cpm-42' })
  })

  it('surfaces the server error message on a 401 without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Nao autorizado' }))
    const result = await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result).toEqual({ ok: false, error: 'Nao autorizado' })
  })

  it('surfaces a validation error from the existing route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'ChannelPiece nao encontrada ou nao autorizada' }))
    const result = await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result).toEqual({ ok: false, error: 'ChannelPiece nao encontrada ou nao autorizada' })
  })

  it('handles a network failure gracefully', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Failed to fetch')
  })

  it('handles malformed render data without ever calling fetch', async () => {
    const fetchImpl = vi.fn()
    const result = await saveRenderToChannelPiece({ imageDataUrl: 'not-a-data-url', channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats an unexpected response shape as an error instead of crashing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { unexpected: true }))
    const result = await saveRenderToChannelPiece({ imageDataUrl: DATA_URL, channelPieceId: CHANNEL_PIECE_ID, fetchImpl })
    expect(result.ok).toBe(false)
  })
})
