import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { isPublicAddress } from '@/lib/security/public-address'
import {
  NANOBANANA_RESULT_IMAGE_POLICY,
  RemoteImageError,
  fetchRemoteImage,
  hostMatchesAllowlist,
  parseRemoteImageUrl,
  sniffImageMime,
  type PinnedRequest,
  type RemoteImagePolicy,
  type TransportResponse,
} from '@/lib/security/safe-remote-image'

// STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1 — mocks and synthetic fixtures only.
// No socket is opened and no real address is contacted anywhere in this file.

const HOST = 'tempfile.aiquickdraw.com'
const PUBLIC_IP = { address: '93.184.216.34', family: 4 as const }
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const policy: RemoteImagePolicy = { ...NANOBANANA_RESULT_IMAGE_POLICY, timeoutMs: 200 }

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof RemoteImageError) return error.code
    throw error
  }
  return 'NO_ERROR'
}

function response(status: number, body: Buffer | AsyncIterable<Uint8Array>, headers: Record<string, string> = {}): TransportResponse {
  return {
    status,
    headers: { 'content-type': 'image/png', ...headers },
    body: Buffer.isBuffer(body) ? Readable.from([body]) : body,
    destroy: vi.fn(),
  }
}

const okTransport = () => vi.fn(async (_request: PinnedRequest) => response(200, PNG))
const publicResolver = () => vi.fn(async () => [PUBLIC_IP])

describe('isPublicAddress — the public-network policy', () => {
  it.each([
    ['0.0.0.0'], ['0.1.2.3'], ['10.0.0.1'], ['10.255.255.255'], ['100.64.0.1'], ['100.100.100.200'], ['127.0.0.1'], ['127.1.2.3'],
    ['169.254.0.1'], ['169.254.169.254'], ['172.16.0.1'], ['172.31.255.255'], ['192.0.0.8'], ['192.0.2.1'], ['192.168.0.1'],
    ['198.18.0.1'], ['198.19.255.255'], ['198.51.100.7'], ['203.0.113.9'], ['224.0.0.1'], ['239.255.255.255'], ['240.0.0.1'], ['255.255.255.255'],
    ['::'], ['::1'], ['fc00::1'], ['fd00:ec2::254'], ['fe80::1'], ['fec0::1'], ['ff02::1'], ['2001:db8::1'], ['2002:7f00:1::1'],
    ['64:ff9b::7f00:1'], ['2001::1'], ['100::1'],
    ['::ffff:127.0.0.1'], ['::ffff:7f00:1'], ['0:0:0:0:0:ffff:7f00:1'], ['::ffff:10.0.0.5'], ['::ffff:a9fe:a9fe'], ['::ffff:192.168.1.1'],
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each([['8.8.8.8'], ['93.184.216.34'], ['1.1.1.1'], ['172.15.255.255'], ['172.32.0.1'], ['100.63.255.255'], ['2606:4700:4700::1111'], ['2a00:1450:4001:81b::200e'], ['::ffff:8.8.8.8']])(
    'allows the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )

  it.each([[''], ['localhost'], ['example.com'], ['999.1.1.1'], ['1.2.3'], ['fe80::1%eth0'], ['2130706433'], ['0x7f.0.0.1']])('fails closed on the non-literal/unparseable %s', (value) => {
    expect(isPublicAddress(value)).toBe(false)
  })
})

describe('parseRemoteImageUrl — URL policy', () => {
  const ok = `https://${HOST}/img/result.png?X-Amz-Signature=abc`

  it('accepts the allowed provider host over https on the default port', () => {
    expect(parseRemoteImageUrl(ok, policy).hostname).toBe(HOST)
    expect(parseRemoteImageUrl(`https://${HOST}:443/x.png`, policy).hostname).toBe(HOST)
    expect(parseRemoteImageUrl(`https://${HOST.toUpperCase()}./x.png`, policy).hostname).toBe(HOST)
  })

  it.each([
    ['not a string', 42, 'REMOTE_IMAGE_URL_INVALID'],
    ['empty', '', 'REMOTE_IMAGE_URL_INVALID'],
    ['malformed', 'https://', 'REMOTE_IMAGE_URL_INVALID'],
    ['relative', '/x.png', 'REMOTE_IMAGE_URL_INVALID'],
    ['overlong', `https://${HOST}/${'a'.repeat(3000)}`, 'REMOTE_IMAGE_URL_INVALID'],
    ['file://', 'file:///etc/passwd', 'REMOTE_IMAGE_URL_INVALID'],
    ['data:', 'data:image/png;base64,AAAA', 'REMOTE_IMAGE_URL_INVALID'],
    ['ftp://', `ftp://${HOST}/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['gopher://', `gopher://${HOST}/x`, 'REMOTE_IMAGE_URL_INVALID'],
    ['blob:', `blob:https://${HOST}/uuid`, 'REMOTE_IMAGE_URL_INVALID'],
    ['javascript:', 'javascript:alert(1)', 'REMOTE_IMAGE_URL_INVALID'],
    ['ws://', `ws://${HOST}/x`, 'REMOTE_IMAGE_URL_INVALID'],
    ['wss://', `wss://${HOST}/x`, 'REMOTE_IMAGE_URL_INVALID'],
    ['plain http', `http://${HOST}/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['credentials', `https://user:pass@${HOST}/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['username only', `https://user@${HOST}/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['userinfo that hides the real host', `https://${HOST}@evil.example/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['a fragment', `https://${HOST}/x.png#frag`, 'REMOTE_IMAGE_URL_INVALID'],
    ['an unusual port', `https://${HOST}:8443/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['an internal-style port', `https://${HOST}:6379/x.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['localhost', 'https://localhost/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['127.0.0.1', 'https://127.0.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['alternate loopback 127.1.2.3', 'https://127.1.2.3/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['0.0.0.0', 'https://0.0.0.0/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['10.x', 'https://10.0.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['172.16/12', 'https://172.16.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['192.168.x', 'https://192.168.1.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['169.254.x', 'https://169.254.1.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data/', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['CGNAT', 'https://100.64.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['a decimal-encoded loopback', 'https://2130706433/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['a hex-encoded loopback', 'https://0x7f.0.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['an octal-encoded loopback', 'https://0177.0.0.1/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 loopback', 'https://[::1]/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 unique-local', 'https://[fd00::1]/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 link-local', 'https://[fe80::1]/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['an internal service name', 'https://metadata.google.internal/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['a lookalike suffix', `https://evil${HOST}/x.png`, 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['the allowed host as a sub-label of another domain', `https://${HOST}.evil.example/x.png`, 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['a sibling subdomain (no wildcard was granted)', 'https://other.aiquickdraw.com/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['the bare parent domain', 'https://aiquickdraw.com/x.png', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
  ])('rejects %s', (_name, value, code) => {
    let thrown: unknown
    try {
      parseRemoteImageUrl(value, policy)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RemoteImageError)
    expect((thrown as RemoteImageError).code).toBe(code)
  })

  it('applies wildcard entries only on a label boundary', () => {
    const wildcard = ['*.example.com']
    expect(hostMatchesAllowlist('cdn.example.com', wildcard)).toBe(true)
    expect(hostMatchesAllowlist('a.b.example.com', wildcard)).toBe(true)
    expect(hostMatchesAllowlist('example.com', wildcard)).toBe(false)
    expect(hostMatchesAllowlist('evilexample.com', wildcard)).toBe(false)
    expect(hostMatchesAllowlist('cdn.example.com.evil.io', wildcard)).toBe(false)
  })
})

describe('fetchRemoteImage — the actual network boundary', () => {
  it('downloads a valid provider image (signed query string included), sniffing the real type', async () => {
    const transport = okTransport()
    const result = await fetchRemoteImage(`https://${HOST}/r.png?X-Amz-Signature=abc&Expires=1`, policy, { resolveHost: publicResolver(), transport })
    expect(result.mimeType).toBe('image/png')
    expect(result.buffer.equals(PNG)).toBe(true)
    expect(result.host).toBe(HOST)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('sends a fresh, minimal request: no cookie, Authorization or application header is ever forwarded', async () => {
    const transport = okTransport()
    await fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport })
    const sent = transport.mock.calls[0][0]
    expect(Object.keys(sent.headers).sort()).toEqual(['Accept', 'User-Agent'])
    const lowered = Object.keys(sent.headers).map((key) => key.toLowerCase())
    for (const forbidden of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) expect(lowered).not.toContain(forbidden)
  })

  describe('DNS: every address is validated and the connection is pinned to the validated one', () => {
    it('a hostname that resolves to a private address is refused before any connection', async () => {
      const transport = okTransport()
      const code = await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: async () => [{ address: '10.0.0.7', family: 4 }], transport }))
      expect(code).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
      expect(transport).not.toHaveBeenCalled()
    })

    it('mixed public + private results fail closed (no fallback to the public one)', async () => {
      const transport = okTransport()
      const mixed = async () => [PUBLIC_IP, { address: '169.254.169.254', family: 4 as const }]
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: mixed, transport }))).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
      const mappedV6 = async () => [PUBLIC_IP, { address: '::ffff:127.0.0.1', family: 6 as const }]
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: mappedV6, transport }))).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
      expect(transport).not.toHaveBeenCalled()
    })

    it('no addresses / a DNS failure is a bounded fetch failure', async () => {
      const transport = okTransport()
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: async () => [], transport }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: async () => { throw new Error('ENOTFOUND 10.0.0.1 internal') }, transport }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
      expect(transport).not.toHaveBeenCalled()
    })

    it('REBINDING: the transport receives the address that was validated; the fetcher never lets the connection resolve on its own', async () => {
      // A rebinding host answers "public" for the validation lookup and "private" for any later lookup.
      const answers = [[PUBLIC_IP], [{ address: '127.0.0.1', family: 4 as const }]]
      const resolveHost = vi.fn(async () => answers.shift() ?? [])
      const transport = vi.fn(async (request: PinnedRequest) => {
        expect(request.address).toEqual(PUBLIC_IP) // pinned: the socket goes to the validated address
        return response(200, PNG)
      })
      await fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost, transport })
      expect(resolveHost).toHaveBeenCalledTimes(1) // resolved exactly once per hop; the second (private) answer is never consulted
      expect(transport.mock.calls[0][0].address.address).toBe('93.184.216.34')
    })
  })

  describe('redirects are revalidated hop by hop', () => {
    const redirect = (location: string | undefined, status = 302) =>
      vi.fn(async (): Promise<TransportResponse> => response(status, Buffer.alloc(0), location ? { location } : {}))

    it('a public start that redirects to a private/internal target is blocked', async () => {
      for (const target of ['https://127.0.0.1/x.png', 'https://localhost/x.png', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/x.png', 'http://10.0.0.1/x.png', 'file:///etc/passwd', `https://evil.example/x.png`]) {
        const transport = redirect(target)
        const code = await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport }))
        expect(['REMOTE_IMAGE_HOST_NOT_ALLOWED', 'REMOTE_IMAGE_URL_INVALID']).toContain(code)
        expect(transport).toHaveBeenCalledTimes(1) // the unsafe hop is never requested
      }
    })

    it('an allowed host that re-resolves to a private address on the next hop is blocked', async () => {
      const answers = [[PUBLIC_IP], [{ address: '192.168.0.9', family: 4 as const }]]
      const transport = redirect(`https://${HOST}/second.png`)
      const code = await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: async () => answers.shift() ?? [], transport }))
      expect(code).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
      expect(transport).toHaveBeenCalledTimes(1)
    })

    it('follows a valid chain on the provider host (absolute and relative Location)', async () => {
      const hops = [response(301, Buffer.alloc(0), { location: `https://${HOST}/second.png` }), response(307, Buffer.alloc(0), { location: '/third.png' }), response(200, PNG)]
      const transport = vi.fn(async (_request: PinnedRequest) => hops.shift()!)
      const result = await fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport })
      expect(result.buffer.equals(PNG)).toBe(true)
      expect(transport.mock.calls.map(([request]) => request.url.pathname)).toEqual(['/r.png', '/second.png', '/third.png'])
    })

    it('refuses too many redirects, a redirect loop and a redirect without Location', async () => {
      let n = 0
      const chain = vi.fn(async () => response(302, Buffer.alloc(0), { location: `https://${HOST}/hop-${(n += 1)}.png` }))
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport: chain }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
      expect(chain).toHaveBeenCalledTimes(policy.maxRedirects + 1)

      const loop = redirect(`https://${HOST}/r.png`)
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport: loop }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
      expect(loop).toHaveBeenCalledTimes(1)

      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport: redirect(undefined) }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
    })
  })

  describe('size, time and content', () => {
    it('rejects an oversized Content-Length before reading a single body byte', async () => {
      let consumed = false
      const body = (async function* () {
        consumed = true
        yield PNG
      })()
      const transport = vi.fn(async () => response(200, body, { 'content-length': String(policy.maxBytes + 1) }))
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_TOO_LARGE')
      expect(consumed).toBe(false)
    })

    it('aborts a stream that crosses the cap even with no (or a lying) Content-Length', async () => {
      const small: RemoteImagePolicy = { ...policy, maxBytes: 1024 }
      let yielded = 0
      const endless = () =>
        (async function* () {
          yield PNG
          for (;;) {
            yielded += 1
            yield Buffer.alloc(512)
            if (yielded > 50) return
          }
        })()
      for (const headers of [{} as Record<string, string>, { 'content-length': '10' }]) {
        yielded = 0
        const transport = vi.fn(async () => response(200, endless(), headers))
        expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, small, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_TOO_LARGE')
        expect(yielded).toBeLessThan(5) // stopped as soon as the cap was crossed, not after draining
      }
    })

    it('times out a host that never answers', async () => {
      const transport = vi.fn((request: PinnedRequest) => new Promise<TransportResponse>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')))))
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, { ...policy, timeoutMs: 40 }, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
    })

    it('times out even a transport that ignores the abort signal', async () => {
      const transport = vi.fn(() => new Promise<TransportResponse>(() => undefined))
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, { ...policy, timeoutMs: 40 }, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
    })

    it('refuses non-image content: an HTML/JSON error page returned with 200, and an image Content-Type over HTML bytes', async () => {
      const html = Buffer.from('<html><body>internal admin</body></html>')
      for (const [type, bytes] of [['text/html', html], ['application/json', Buffer.from('{"a":1}')], ['image/png', html], ['image/png', Buffer.from('plain text')]] as const) {
        const transport = vi.fn(async () => response(200, bytes, { 'content-type': type }))
        expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_INVALID_CONTENT')
      }
    })

    it('accepts PNG/JPEG/WebP/GIF by signature, and a missing or octet-stream Content-Type when the signature is real', async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
      const gif = Buffer.from('GIF89a......')
      for (const [bytes, mime, headers] of [
        [jpeg, 'image/jpeg', { 'content-type': 'image/jpeg' }],
        [webp, 'image/webp', { 'content-type': 'image/webp' }],
        [gif, 'image/gif', { 'content-type': 'image/gif' }],
        [PNG, 'image/png', { 'content-type': 'application/octet-stream' }],
      ] as const) {
        const transport = vi.fn(async () => response(200, bytes, headers))
        expect((await fetchRemoteImage(`https://${HOST}/r.bin`, policy, { resolveHost: publicResolver(), transport })).mimeType).toBe(mime)
      }
      const noType = vi.fn(async () => ({ ...response(200, PNG), headers: {} }))
      expect((await fetchRemoteImage(`https://${HOST}/r`, policy, { resolveHost: publicResolver(), transport: noType })).mimeType).toBe('image/png')
    })

    it('a non-200 answer is a bounded failure', async () => {
      const transport = vi.fn(async () => response(404, Buffer.from('nope')))
      expect(await errorCode(fetchRemoteImage(`https://${HOST}/r.png`, policy, { resolveHost: publicResolver(), transport }))).toBe('REMOTE_IMAGE_FETCH_FAILED')
    })
  })

  it('never puts the URL, its query string or an address into an error reason', async () => {
    const secret = 'SIGNATURE-SECRET-123'
    const attempts = [
      fetchRemoteImage(`http://${HOST}/r.png?X-Amz-Signature=${secret}`, policy),
      fetchRemoteImage(`https://evil.example/r.png?X-Amz-Signature=${secret}`, policy),
      fetchRemoteImage(`https://${HOST}/r.png?X-Amz-Signature=${secret}`, policy, { resolveHost: async () => [{ address: '10.1.2.3', family: 4 }], transport: okTransport() }),
    ]
    for (const attempt of attempts) {
      const error = await attempt.then(() => null, (caught) => caught as RemoteImageError)
      expect(error).toBeInstanceOf(RemoteImageError)
      expect(`${error!.message} ${error!.reason}`).not.toContain(secret)
      expect(`${error!.message} ${error!.reason}`).not.toMatch(/10\.1\.2\.3/)
    }
  })
})

describe('sniffImageMime', () => {
  it('does not trust anything but the leading bytes', () => {
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageMime(Buffer.from('RIFF....WAVEfmt '))).toBeNull()
    expect(sniffImageMime(new Uint8Array(0))).toBeNull()
  })
})
