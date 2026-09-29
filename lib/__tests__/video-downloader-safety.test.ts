import { describe, expect, it, vi } from 'vitest'
import {
  downloadAndStoreVideo,
  MAX_REDIRECTS,
  MAX_VIDEO_BYTES,
  VIDEO_DOWNLOAD_TIMEOUT_MS,
} from '@/lib/storage/video-downloader'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { assertPublicHost, isPrivateAddress, isSafeResultUrl } from '@/lib/storage/safe-result-url'
import { pinnedFetch } from '@/lib/storage/pinned-fetch'

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
    expect(VIDEO_DOWNLOAD_TIMEOUT_MS).toBeLessThanOrEqual(150_000)
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

describe('connection pinning (closes the DNS-rebinding gap between "check" and "connect")', () => {
  it('connects to the VETTED address and never re-resolves the hostname', async () => {
    const seen: string[] = []
    const fetchFn = vi.fn(async (_url: string, init: { address: string }) => {
      seen.push(init.address)
      return response('ok')
    })
    // The vetted answer is the FIRST public address; a later lookup could differ, but we never do one.
    await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: async () => ['93.184.216.34', '93.184.216.35'], upload: uploaded() })
    expect(seen).toEqual(['93.184.216.34'])
  })

  it('re-vets EVERY redirect hop and pins each one to its own vetted address', async () => {
    const seen: Array<[string, string]> = []
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(async (url: string, init: { address: string }) => { seen.push([url, init.address]); return new Response(null, { status: 302, headers: { location: 'https://cdn2.example.test/x.mp4' } }) })
      .mockImplementationOnce(async (url: string, init: { address: string }) => { seen.push([url, init.address]); return response('ok') })
    const resolveHost = async (host: string) => (host === 'cdn.example.test' ? ['93.184.216.34'] : ['93.184.216.99'])

    await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost, upload: uploaded() })

    expect(seen).toEqual([['https://cdn.example.test/v.mp4', '93.184.216.34'], ['https://cdn2.example.test/x.mp4', '93.184.216.99']])
  })

  describe('pinnedFetch (real sockets against a local server)', () => {
    async function withServer(handler: http.RequestListener, run: (port: number) => Promise<void>) {
      const server = http.createServer(handler)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        await run((server.address() as AddressInfo).port)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }

    it('reaches the pinned address even though the URL hostname cannot be resolved (the lookup is overridden)', async () => {
      await withServer((req, res) => { res.setHeader('content-type', 'video/mp4'); res.end(`host=${req.headers.host}`) }, async (port) => {
        // "pinned.invalid" never resolves: only the pinned lookup can make this connect.
        const res = await pinnedFetch(`http://pinned.invalid:${port}/v.mp4`, { address: '127.0.0.1', request: http.request })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('video/mp4')
        // The Host header still carries the real hostname (virtual hosts, SNI, cert verification).
        expect(await res.text()).toBe(`host=pinned.invalid:${port}`)
      })
    })

    it('does NOT follow redirects: a 3xx is handed back for re-validation', async () => {
      let hits = 0
      await withServer((req, res) => {
        hits += 1
        if (req.url === '/start') { res.statusCode = 302; res.setHeader('location', 'http://169.254.169.254/latest/meta-data'); res.end(); return }
        res.end('should never be requested')
      }, async (port) => {
        const res = await pinnedFetch(`http://pinned.invalid:${port}/start`, { address: '127.0.0.1', request: http.request })
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data')
        expect(res.body).toBeNull()
        expect(hits).toBe(1)
      })
    })

    it('honours the abort signal (the download is time-bounded)', async () => {
      await withServer(() => { /* never answers */ }, async (port) => {
        const controller = new AbortController()
        const pending = pinnedFetch(`http://pinned.invalid:${port}/slow`, { address: '127.0.0.1', request: http.request, signal: controller.signal })
        setTimeout(() => controller.abort(), 20)
        await expect(pending).rejects.toThrow()
      })
    })

    it('streams a body larger than one chunk intact', async () => {
      const payload = Buffer.alloc(200_000, 7)
      await withServer((_req, res) => { res.setHeader('content-length', String(payload.length)); res.end(payload) }, async (port) => {
        const res = await pinnedFetch(`http://pinned.invalid:${port}/big`, { address: '127.0.0.1', request: http.request })
        expect(Buffer.from(await res.arrayBuffer()).equals(payload)).toBe(true)
      })
    })
  })

  it('the default download path is the pinned one (no plain fetch of provider URLs)', async () => {
    const source = (await import('node:fs')).readFileSync('lib/storage/video-downloader.ts', 'utf8')
    expect(source).toContain('pinnedFetch')
    expect(source).not.toMatch(/\bfetch\(current/)
  })
})

describe('single-buffer download (memory)', () => {
  it('with a declared length the body is written into ONE buffer and the exact bytes are stored', async () => {
    const upload = uploaded()
    const body = new Uint8Array(1000).fill(3)
    const fetchFn = vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1000' } }))
    const result = await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: fetchFn as any, resolveHost: PUBLIC, upload })
    expect(result.size).toBe(1000)
    const stored = upload.mock.calls[0][0] as Buffer
    expect(stored.length).toBe(1000)
    expect(stored.every((byte) => byte === 3)).toBe(true)
  })

  it('a body that ends SHORT of its declared length stores only what arrived; one that exceeds it is refused', async () => {
    const shortUpload = uploaded()
    const short = vi.fn(async () => new Response(new Uint8Array(400), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1000' } }))
    expect((await downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: short as any, resolveHost: PUBLIC, upload: shortUpload })).size).toBe(400)

    const longUpload = uploaded()
    const long = vi.fn(async () => new Response(new Uint8Array(1500), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1000' } }))
    await expect(downloadAndStoreVideo('https://cdn.example.test/v.mp4', 'p', {}, { fetchFn: long as any, resolveHost: PUBLIC, upload: longUpload })).rejects.toThrow(/too large/)
    expect(longUpload).not.toHaveBeenCalled()
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
