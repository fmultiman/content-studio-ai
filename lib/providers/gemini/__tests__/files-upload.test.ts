import { describe, expect, it, vi } from 'vitest'
import { GEMINI_UPLOAD_CHUNK_BYTES, createGeminiClient } from '../client'
import { verifyingChunks } from '@/lib/media-artifacts/streaming'

const KEY = 'AIza-test-secret-key'
const HOST = 'https://generativelanguage.googleapis.com'
const UPLOAD_URL = `${HOST}/upload/v1beta/files/session-1`
const MIB = 1024 * 1024

type Call = { url: string; headers: Record<string, string>; bodyBytes: number }

function harness(options: { failAtOffset?: number; status?: number } = {}) {
  const calls: Call[] = []
  const sent = { bytes: 0 }
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body as Uint8Array | string | undefined
    const bodyBytes = typeof body === 'string' ? 0 : body?.byteLength ?? 0
    calls.push({ url: String(url), headers, bodyBytes })
    if (String(url).endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': UPLOAD_URL } })
    sent.bytes += bodyBytes
    if (options.failAtOffset !== undefined && headers['X-Goog-Upload-Offset'] === String(options.failAtOffset)) {
      return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: options.status ?? 500 })
    }
    if (headers['X-Goog-Upload-Command'] === 'upload, finalize') {
      return new Response(JSON.stringify({ file: { name: 'files/abc', uri: `${HOST}/v1beta/files/abc`, mimeType: 'video/mp4', state: 'PROCESSING' } }), { status: 200 })
    }
    return new Response('{}', { status: 200, headers: { 'x-goog-upload-status': 'active' } })
  }) as unknown as typeof fetch
  return { calls, sent, fetchImpl, client: createGeminiClient({ fetchImpl }) }
}

/** Lazily produced stream; tracks how much has been produced so memory can be compared with what was sent. */
function source(total: number, pieceSize: number, tracker?: { produced: number; maxAhead: number }, sent?: { bytes: number }) {
  const destroy = vi.fn()
  const chunks: AsyncIterable<Uint8Array> & { destroy: typeof destroy } = {
    destroy,
    async *[Symbol.asyncIterator]() {
      for (let at = 0; at < total; at += pieceSize) {
        const piece = new Uint8Array(Math.min(pieceSize, total - at)).fill(7)
        if (tracker && sent) {
          tracker.produced += piece.byteLength
          tracker.maxAhead = Math.max(tracker.maxAhead, tracker.produced - sent.bytes)
        }
        yield piece
      }
    },
  }
  return chunks
}

describe('Gemini Files API resumable upload', () => {
  it('uploads a stream in 8 MiB protocol chunks with explicit offsets and a final finalize', async () => {
    const h = harness()
    const total = 20 * MIB
    const file = await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: total, chunks: source(total, MIB) })

    expect(file).toMatchObject({ name: 'files/abc', state: 'PROCESSING' })
    const [start, ...chunks] = h.calls
    expect(start.headers['X-Goog-Upload-Command']).toBe('start')
    expect(start.headers['X-Goog-Upload-Header-Content-Length']).toBe(String(total))
    expect(chunks.map((c) => c.headers['X-Goog-Upload-Offset'])).toEqual(['0', String(8 * MIB), String(16 * MIB)])
    expect(chunks.map((c) => c.headers['X-Goog-Upload-Command'])).toEqual(['upload', 'upload', 'upload, finalize'])
    expect(chunks.map((c) => c.bodyBytes)).toEqual([8 * MIB, 8 * MIB, 4 * MIB])
    expect(chunks.map((c) => c.headers['Content-Length'])).toEqual([String(8 * MIB), String(8 * MIB), String(4 * MIB)])
    expect(chunks.every((c) => c.url === UPLOAD_URL && c.headers['x-goog-api-key'] === undefined)).toBe(true)
  })

  it('keeps memory bounded by the chunk size, not the file size', async () => {
    const h = harness()
    const tracker = { produced: 0, maxAhead: 0 }
    const concat = vi.spyOn(Buffer, 'concat')
    const total = 96 * MIB
    await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: total, chunks: source(total, MIB, tracker, h.sent) })
    // Produced-but-not-yet-sent bytes never exceed one chunk plus one incoming piece.
    expect(tracker.maxAhead).toBeLessThanOrEqual(GEMINI_UPLOAD_CHUNK_BYTES + MIB)
    expect(Math.max(...h.calls.map((c) => c.bodyBytes))).toBeLessThanOrEqual(GEMINI_UPLOAD_CHUNK_BYTES)
    expect(h.sent.bytes).toBe(total)
    // The client never joins more than one protocol chunk (and in practice never calls concat at all).
    expect(Math.max(0, ...concat.mock.results.map((r) => (r.value as Buffer).byteLength))).toBeLessThanOrEqual(GEMINI_UPLOAD_CHUNK_BYTES)
    concat.mockRestore()
  })

  it('finalizes on an exact multiple of the chunk size', async () => {
    const h = harness()
    await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 16 * MIB, chunks: source(16 * MIB, 4 * MIB) })
    expect(h.calls.slice(1).map((c) => c.headers['X-Goog-Upload-Command'])).toEqual(['upload', 'upload, finalize'])
  })

  it('still supports a small in-memory body as one finalize request', async () => {
    const h = harness()
    await h.client.uploadFile({ apiKey: KEY, mimeType: 'image/png', bytes: new Uint8Array(10) })
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].headers).toMatchObject({ 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': '10' })
  })

  it('fails without finalizing when the source is shorter or longer than declared, and releases it', async () => {
    for (const [declared, actual] of [[10 * MIB, 9 * MIB], [10 * MIB, 11 * MIB], [4, 8]] as const) {
      const h = harness()
      const chunks = source(actual, MIB / 4 || 1)
      const error = await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: declared, chunks }).catch((e) => e)
      expect(error).toMatchObject({ name: 'ReviewProviderError', kind: 'upload_failed' })
      expect(h.calls.some((c) => c.headers['X-Goog-Upload-Command'] === 'upload, finalize')).toBe(false)
    }
  })

  it('aborts BEFORE finalize when the source fails its integrity check, so no remote file is created', async () => {
    const h = harness()
    const total = 3 * MIB
    const underlying = source(total, MIB)
    const verified = verifyingChunks(underlying, { byteLength: total, sha256: 'a'.repeat(64) })
    const error = await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: total, chunks: verified }).catch((e) => e)
    expect(error).toMatchObject({ name: 'MediaIntegrityError', code: 'HASH_MISMATCH' })
    expect(h.calls.some((c) => c.headers['X-Goog-Upload-Command'] === 'upload, finalize')).toBe(false)
  })

  it('propagates a storage read failure and stops uploading', async () => {
    const h = harness()
    const failing: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() { yield new Uint8Array(MIB); throw new Error('connection reset') },
    }
    await expect(h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 20 * MIB, chunks: failing })).rejects.toThrow('connection reset')
    expect(h.calls).toHaveLength(1)
  })

  it('normalizes a mid-upload provider failure to upload_failed, stops, and releases the source', async () => {
    const h = harness({ failAtOffset: 8 * MIB })
    const chunks = source(24 * MIB, MIB)
    const error = await h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 24 * MIB, chunks }).catch((e) => e)
    expect(error).toMatchObject({ name: 'ReviewProviderError', kind: 'upload_failed', providerStatus: 500 })
    expect(String(error.message)).not.toContain('boom')
    expect(String(error.message)).not.toContain(KEY)
    expect(h.calls.map((c) => c.headers['X-Goog-Upload-Offset']).filter(Boolean)).toEqual(['0', String(8 * MIB)])
  })

  it('keeps credential failures distinct from upload failures', async () => {
    const h = harness({ failAtOffset: 0, status: 403 })
    await expect(h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 2 * MIB, chunks: source(2 * MIB, MIB) })).rejects.toMatchObject({ kind: 'invalid_credential' })
  })

  it('rejects an empty source and an upload session URL on another host', async () => {
    const h = harness()
    await expect(h.client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 0, chunks: source(0, 1) })).rejects.toMatchObject({ kind: 'upload_failed' })
    expect(h.calls).toHaveLength(0)

    const evil = createGeminiClient({ fetchImpl: (async () => new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://evil.example/u' } })) as unknown as typeof fetch })
    await expect(evil.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: MIB, chunks: source(MIB, MIB) })).rejects.toMatchObject({ kind: 'upload_failed' })
  })

  it('stops uploading once the whole-upload ceiling has passed', async () => {
    let clock = 0
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url))
      if (String(url).endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': UPLOAD_URL } })
      clock += 400_000
      expect((init?.headers as Record<string, string>)['X-Goog-Upload-Command']).toBe('upload')
      return new Response('{}', { status: 200, headers: { 'x-goog-upload-status': 'active' } })
    }) as unknown as typeof fetch
    const client = createGeminiClient({ fetchImpl, now: () => clock })
    await expect(client.uploadFile({ apiKey: KEY, mimeType: 'video/mp4', byteLength: 40 * MIB, chunks: source(40 * MIB, MIB) })).rejects.toMatchObject({ kind: 'timeout' })
    expect(calls.length).toBeLessThanOrEqual(3)
  })
})
