import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1 — the route driven end to end over MOCKED DNS and a MOCKED
// node:https. No socket is opened, no address is contacted, no provider/storage/paid call exists here.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ uploadImageToS3: vi.fn(), createPresignedReadUrl: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ default: { request: vi.fn() } }))

import * as server from '@/lib/supabase/server'
import https from 'node:https'
import { lookup } from 'node:dns/promises'
import { createPresignedReadUrl, uploadImageToS3 } from '@/lib/storage/s3'
import { POST } from '@/app/api/storage/upload-image/route'

const HOST = 'tempfile.aiquickdraw.com'
const USER = '11111111-1111-4111-8111-111111111111'
const SECRET = 'X-Amz-Signature=SUPER-SECRET-SIGNATURE'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)])

let authed: { id: string } | null
let requests: any[]
let answers: Array<{ status: number; headers?: Record<string, string>; body?: Buffer }>

function installHttps() {
  vi.mocked(https.request).mockImplementation(((options: any, callback: (response: any) => void) => {
    requests.push(options)
    const req = new EventEmitter() as EventEmitter & { end: () => void }
    req.end = () => {
      const answer = answers.shift() ?? { status: 200, body: PNG }
      const response = Object.assign(Readable.from([answer.body ?? Buffer.alloc(0)]), {
        statusCode: answer.status,
        headers: { 'content-type': 'image/png', ...(answer.headers ?? {}) },
      })
      setImmediate(() => callback(response))
    }
    return req
  }) as never)
}

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/storage/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))

let warn: ReturnType<typeof vi.spyOn>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  authed = { id: USER }
  requests = []
  answers = []
  vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: authed }, error: authed ? null : { message: 'no' } }) } } as any)
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
  vi.mocked(uploadImageToS3).mockResolvedValue({
    imageUrl: 'https://s3.example.test/bucket/stored.png',
    thumbnailUrl: 'https://s3.example.test/bucket/thumb.webp',
    storageProvider: 's3',
    storagePath: `users/${USER}/images/33333333-3333-4333-8333-333333333333/original.png`,
    thumbnailPath: `users/${USER}/images/33333333-3333-4333-8333-333333333333/thumb.webp`,
    fileSize: PNG.byteLength,
    mimeType: 'image/png',
  } as never)
  vi.mocked(createPresignedReadUrl).mockResolvedValue('https://signed.example.test/x?sig=1')
  installHttps()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const noNetwork = () => {
  expect(lookup).not.toHaveBeenCalled()
  expect(https.request).not.toHaveBeenCalled()
  expect(uploadImageToS3).not.toHaveBeenCalled()
}

describe('POST /api/storage/upload-image — legitimate Nano Banana flow is preserved', () => {
  it('downloads the provider image and persists the same app-owned object, thumbnail and response shape', async () => {
    const response = await post({ imageUrl: `https://${HOST}/result/abc.png?${SECRET}`, folder: 'images' })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      storagePath: `users/${USER}/images/33333333-3333-4333-8333-333333333333/original.png`,
      thumbnailPath: `users/${USER}/images/33333333-3333-4333-8333-333333333333/thumb.webp`,
      storageProvider: 's3',
      publicUrl: 'https://s3.example.test/bucket/stored.png',
      imageUrl: 'https://signed.example.test/x?sig=1',
      mimeType: 'image/png',
    })
    expect(uploadImageToS3).toHaveBeenCalledTimes(1)
    const input = vi.mocked(uploadImageToS3).mock.calls[0][0] as any
    expect(input).toMatchObject({ userId: USER, folder: 'images', mimeType: 'image/png' })
    expect(Buffer.isBuffer(input.buffer) && input.buffer.equals(PNG)).toBe(true)
  })

  it('a data:image/ upload still works and never touches the network', async () => {
    const response = await post({ image: 'data:image/png;base64,iVBORw0KGgo=', folder: 'posts' })
    expect(response.status).toBe(200)
    expect(lookup).not.toHaveBeenCalled()
    expect(https.request).not.toHaveBeenCalled()
    expect(vi.mocked(uploadImageToS3).mock.calls[0][0]).toMatchObject({ userId: USER, folder: 'posts', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  })

  it('uses the sniffed type, so a JPEG is stored as a JPEG', async () => {
    answers = [{ status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]) }]
    await post({ imageUrl: `https://${HOST}/r.jpg`, folder: 'images' })
    expect(vi.mocked(uploadImageToS3).mock.calls[0][0]).toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('requires authentication and does nothing on the network without it', async () => {
    authed = null
    expect((await post({ imageUrl: `https://${HOST}/r.png` })).status).toBe(401)
    noNetwork()
  })
})

describe('the actual connection is pinned and carries no caller credentials', () => {
  it('resolves DNS once, then connects to the VALIDATED address only (hostname kept for SNI); Authorization and cookies are not forwarded', async () => {
    await post({ imageUrl: `https://${HOST}/r.png?${SECRET}` }, { Authorization: 'Bearer APP-TOKEN', Cookie: 'sb-access-token=COOKIE-VALUE', 'X-Internal': 'yes' })

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
    const options = requests[0]
    expect(options).toMatchObject({ hostname: HOST, servername: HOST, port: 443, protocol: 'https:', method: 'GET', agent: false })
    expect(options.path).toBe(`/r.png?${SECRET}`)

    // Whatever the TLS stack asks the resolver for, the answer is the address that was validated.
    const pinned = await new Promise<unknown[]>((resolve) => options.lookup(HOST, {}, (...args: unknown[]) => resolve(args)))
    expect(pinned).toEqual([null, '93.184.216.34', 4])
    const pinnedAll = await new Promise<unknown[]>((resolve) => options.lookup('another-name.example', { all: true }, (...args: unknown[]) => resolve(args)))
    expect(pinnedAll).toEqual([null, [{ address: '93.184.216.34', family: 4 }]])

    const sent = JSON.stringify(options.headers).toLowerCase()
    for (const leaked of ['app-token', 'cookie-value', 'authorization', 'cookie', 'x-internal']) expect(sent).not.toContain(leaked)
  })

  it('REBINDING through the route: a second, private DNS answer is never used', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never)
    const response = await post({ imageUrl: `https://${HOST}/r.png` })
    expect(response.status).toBe(200)
    expect(lookup).toHaveBeenCalledTimes(1)
    const address = await new Promise<string>((resolve) => requests[0].lookup(HOST, {}, (_e: unknown, a: string) => resolve(a)))
    expect(address).toBe('93.184.216.34')
  })
})

describe('the route refuses every unsafe URL before any network activity, with bounded errors', () => {
  it.each([
    ['file://', 'file:///etc/passwd', 'REMOTE_IMAGE_URL_INVALID'],
    ['data: as a URL', 'data:text/html,<script>', 'REMOTE_IMAGE_URL_INVALID'],
    ['plain http', `http://${HOST}/r.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['malformed', 'https://', 'REMOTE_IMAGE_URL_INVALID'],
    ['credentials', `https://user:pass@${HOST}/r.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['an unusual port', `https://${HOST}:8443/r.png`, 'REMOTE_IMAGE_URL_INVALID'],
    ['localhost', 'https://localhost/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['127.0.0.1', 'https://127.0.0.1/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['10.x', 'https://10.0.0.1/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['172.16/12', 'https://172.16.5.5/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['192.168.x', 'https://192.168.1.1/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['the cloud metadata target', 'https://169.254.169.254/latest/meta-data/iam/', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['CGNAT', 'https://100.64.1.1/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 loopback', 'https://[::1]/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 unique-local', 'https://[fc00::1]/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv6 link-local', 'https://[fe80::1]/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['IPv4-mapped IPv6', 'https://[::ffff:127.0.0.1]/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['an encoded loopback', 'https://2130706433/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['an internal service name', 'https://supabase-kong.internal/x', 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
    ['a lookalike of the provider host', `https://evil${HOST}/x`, 'REMOTE_IMAGE_HOST_NOT_ALLOWED'],
  ])('%s', async (_name, imageUrl, code) => {
    const response = await post({ imageUrl })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe(code)
    noNetwork()
  })

  it('a provider hostname that resolves to a private address is refused; nothing connects, nothing is stored, nothing leaks', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.20.30.40', family: 4 }] as never)
    const response = await post({ imageUrl: `https://${HOST}/r.png?${SECRET}` })
    expect(response.status).toBe(400)
    const text = JSON.stringify(await response.json())
    expect(JSON.parse(text).code).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
    expect(https.request).not.toHaveBeenCalled()
    expect(uploadImageToS3).not.toHaveBeenCalled()
    expect(text).not.toMatch(/10\.20\.30\.40|SUPER-SECRET/)
    const logged = JSON.stringify([...warn.mock.calls, ...consoleError.mock.calls])
    expect(logged).not.toMatch(/10\.20\.30\.40|SUPER-SECRET|X-Amz-Signature/)
  })

  it('a redirect to an internal target is refused and only the first hop is requested', async () => {
    answers = [{ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' }, body: Buffer.alloc(0) }]
    const response = await post({ imageUrl: `https://${HOST}/r.png?${SECRET}` })
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('REMOTE_IMAGE_HOST_NOT_ALLOWED')
    expect(https.request).toHaveBeenCalledTimes(1)
    expect(uploadImageToS3).not.toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SUPER-SECRET')
  })

  it('non-image content and oversize responses are rejected with bounded codes', async () => {
    answers = [{ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>') }]
    const html = await post({ imageUrl: `https://${HOST}/r.png` })
    expect(html.status).toBe(400)
    expect((await html.json()).code).toBe('REMOTE_IMAGE_INVALID_CONTENT')

    answers = [{ status: 200, headers: { 'content-length': String(50 * 1024 * 1024) }, body: PNG }]
    const big = await post({ imageUrl: `https://${HOST}/r.png` })
    expect(big.status).toBe(413)
    expect((await big.json()).code).toBe('REMOTE_IMAGE_TOO_LARGE')
    expect(uploadImageToS3).not.toHaveBeenCalled()
  })

  it('an unexpected server error never echoes its message (no infrastructure detail reaches the browser)', async () => {
    vi.mocked(uploadImageToS3).mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.12:9000 (minio.internal)'))
    const response = await post({ imageUrl: `https://${HOST}/r.png` })
    expect(response.status).toBe(500)
    const text = JSON.stringify(await response.json())
    expect(text).toBe('{"error":"Erro interno"}')
  })
})
