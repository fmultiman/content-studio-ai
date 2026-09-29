import { describe, expect, it, vi } from 'vitest'
import {
  downloadAndStoreVideo,
  MAX_REDIRECTS,
  MAX_VIDEO_BYTES,
  VIDEO_DOWNLOAD_TIMEOUT_MS,
} from '@/lib/storage/video-downloader'
import { assertPublicHost, isPrivateAddress, isSafeResultUrl } from '@/lib/storage/safe-result-url'

const PUBLIC = async () => ['203.0.113.10']
const uploaded = () => vi.fn(async (buffer: Buffer, path: string, mime: string, size: number) => ({ storagePath: path, publicUrl: `https://s3.example.test/${path}`, mime, size }))

function response(body: string | Uint8Array, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body as BodyInit, { status: init.status ?? 200, headers: { 'content-type': 'video/mp4', ...(init.headers ?? {}) } })
}

describe('provider result download hardening (external input)', () => {
  it('stores the video under the deterministic object name, with the ACTUAL byte size', async () => {
    const upload = uploaded()
    const fetchFn = vi.fn(async () => response('12345678'))

    const result = await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'u/videos/ai/p', { objectName: 'gen-1.mp4' }, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })

    expect(result).toMatchObject({ storagePath: 'u/videos/ai/p/gen-1.mp4', mime: 'video/mp4', size: 8 })
    expect(upload).toHaveBeenCalledTimes(1)
    // Redirects are handled manually and the request is time-bounded.
    expect(fetchFn.mock.calls[0]).toEqual(['https://cdn.example.test/v.mp4', expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) })])
    expect(VIDEO_DOWNLOAD_TIMEOUT_MS).toBeLessThanOrEqual(55_000)
  })

  it('follows a redirect only to another SAFE host, re-validating every hop', async () => {
    const upload = uploaded()
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn2.example.test/real.mp4' } }))
      .mockResolvedValueOnce(response('ok'))

    await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })

    expect(fetchFn.mock.calls.map((call) => call[0])).toEqual(['https://cdn.example.test/v.mp4', 'https://cdn2.example.test/real.mp4'])
  })

  it.each([
    ['a redirect to localhost', 'https://localhost/x'],
    ['a redirect to an internal IP literal', 'http://169.254.169.254/latest/meta-data'],
    ['a redirect to plain http', 'http://cdn.example.test/x'],
    ['a redirect to a .internal host', 'https://svc.internal/x'],
    ['a redirect to a file URL', 'file:///etc/passwd'],
  ])('refuses %s (SSRF) and stores nothing', async (_name, location) => {
    const upload = uploaded()
    const fetchFn = vi.fn(async () => new Response(null, { status: 301, headers: { location } }))

    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })).rejects.toThrow()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()
  })

  it('refuses a public-looking hostname that RESOLVES to a private address (DNS rebinding / nip.io style)', async () => {
    const upload = uploaded()
    const fetchFn = vi.fn()
    await expect(
      downloadAndStoreVideo('https://10.0.0.5.nip.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: async () => ['10.0.0.5'], upload }),
    ).rejects.toThrow(/not public/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('a host that does not resolve is a failure, not an allow', async () => {
    await expect(assertPublicHost('nope.example.test', async () => [])).rejects.toThrow()
  })

  it('stops following redirects after the hop limit', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/next' } }))
    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload: uploaded() })).rejects.toThrow(/redirects/)
    expect(fetchFn).toHaveBeenCalledTimes(MAX_REDIRECTS + 1)
  })

  it('rejects an oversized declared body before reading it', async () => {
    const upload = uploaded()
    const fetchFn = vi.fn(async () => response('x', { headers: { 'content-length': String(MAX_VIDEO_BYTES + 1) } }))
    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })).rejects.toThrow(/too large/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('caps a body that lies about (or omits) its length while STREAMING', async () => {
    const upload = uploaded()
    // 6 chunks of 64 MB = 384 MB > 300 MB, with no content-length.
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 6) return controller.close()
        sent += 1
        controller.enqueue(new Uint8Array(64 * 1024 * 1024))
      },
    })
    const fetchFn = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'video/mp4' } }))

    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })).rejects.toThrow(/too large/)

    // (The stream prefetches a chunk or two; what matters is that the cap aborted before storing.)
    expect(sent).toBeLessThanOrEqual(6)
    expect(upload).not.toHaveBeenCalled()
  })

  it.each(['text/html', 'application/json', 'image/png'])('does not store a %s response as a video', async (type) => {
    const upload = uploaded()
    const fetchFn = vi.fn(async () => response('<html>', { headers: { 'content-type': type } }))
    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })).rejects.toThrow(/not a video/)
    expect(upload).not.toHaveBeenCalled()
  })

  it.each(['application/octet-stream', 'binary/octet-stream'])('accepts %s (CDNs) and stores it as video/mp4', async (type) => {
    const upload = uploaded()
    const fetchFn = vi.fn(async () => response('data', { headers: { 'content-type': type } }))
    const result = await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })
    expect(result.mime).toBe('video/mp4')
  })

  it('a provider HTTP error is a failure', async () => {
    const fetchFn = vi.fn(async () => response('nope', { status: 403 }))
    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload: uploaded() })).rejects.toThrow(/Status: 403/)
  })

  it('rejects an unsafe initial URL before any network access', async () => {
    const fetchFn = vi.fn()
    await expect(downloadAndStoreVideo('http://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload: uploaded() })).rejects.toThrow()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('address classification', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip', '198.18.0.1', '198.19.255.255', '192.0.0.8', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::'])('%s is private/unusable', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })
  it.each(['8.8.8.8', '203.0.113.10', '172.32.0.1', '198.20.0.1', '192.0.1.1', '2606:4700:4700::1111'])('%s is public', (address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })
  it('isSafeResultUrl rejects non-https, credentials, IP literals and internal suffixes', () => {
    for (const url of ['http://a.test/x', 'https://u:p@a.test/x', 'https://1.2.3.4/x', 'https://[::1]/x', 'https://a.local/x', 'https://a.internal/x', 'https://localhost/x', 'nope']) expect(isSafeResultUrl(url)).toBe(false)
    expect(isSafeResultUrl('https://cdn.example.test/x.mp4?sig=1')).toBe(true)
  })
})
