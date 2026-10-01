import { describe, expect, it, vi } from 'vitest'
import {
  ProviderUploadError,
  buildMultipartBody,
  parseProviderUploadUrl,
  postMultipartToProvider,
  type PinnedPostRequest,
  type PostResponse,
  type ProviderUploadPolicy,
} from '@/lib/security/pinned-provider-upload'

// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — the only door for POSTing user image bytes to a provider-returned URL.
// In-memory DNS and transport: no socket is ever opened.

const PUBLIC = [{ address: '93.184.216.34', family: 4 as const }]
const POLICY: ProviderUploadPolicy = { timeoutMs: 200, maxResponseBytes: 256 }
const FILE = { fieldName: 'file', filename: 'foto.png', contentType: 'image/png', bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }
const URL_OK = 'https://upload.example.test/put/abc?token=xyz'

function respond(status: number, body: string | Uint8Array[] = '{"url":"https://files.example.test/a.png"}'): PostResponse {
  const chunks = typeof body === 'string' ? [new TextEncoder().encode(body)] : body
  return { status, body: (async function* () { for (const chunk of chunks) yield chunk })(), destroy: vi.fn() }
}

const code = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof ProviderUploadError ? error.code : `other:${String(error)}`))

describe('URL policy (no host allowlist is invented; the address check is the boundary)', () => {
  it('accepts a plain https URL and keeps its path and query', () => {
    expect(parseProviderUploadUrl(URL_OK).href).toBe(URL_OK)
  })

  it.each([
    ['http', 'http://upload.example.test/put'],
    ['a non-default port', 'https://upload.example.test:8443/put'],
    ['embedded credentials', 'https://user:pass@upload.example.test/put'],
    ['a fragment', 'https://upload.example.test/put#x'],
    ['a file URL', 'file:///etc/passwd'],
    ['a data URL', 'data:text/plain,hi'],
    ['not a URL', 'nope'],
    ['an empty string', ''],
    ['a number', 42],
    ['an over-long URL', `https://upload.example.test/${'a'.repeat(5000)}`],
  ])('refuses %s', (_name, value) => {
    expect(() => parseProviderUploadUrl(value)).toThrowError(ProviderUploadError)
  })

  it('an IP literal is judged by the same public-address rule', async () => {
    expect(await code(postMultipartToProvider('https://127.0.0.1/put', { fields: {}, file: FILE }, POLICY, { transport: async () => respond(200) }))).toBe('UPLOAD_HOST_NOT_ALLOWED')
  })
})

describe('DNS: every address must be public, and the socket is pinned to the validated one', () => {
  it.each([
    ['loopback', [{ address: '127.0.0.1', family: 4 as const }]],
    ['private 10/8', [{ address: '10.1.2.3', family: 4 as const }]],
    ['link-local metadata', [{ address: '169.254.169.254', family: 4 as const }]],
    ['private 192.168/16', [{ address: '192.168.0.9', family: 4 as const }]],
    ['IPv6 loopback', [{ address: '::1', family: 6 as const }]],
    ['one public + one private', [{ address: '93.184.216.34', family: 4 as const }, { address: '10.0.0.5', family: 4 as const }]],
  ])('refuses a host that resolves to %s and sends NOTHING', async (_name, addresses) => {
    const transport = vi.fn(async () => respond(200))
    expect(await code(postMultipartToProvider(URL_OK, { fields: { ticket: 't' }, file: FILE }, POLICY, { resolveHost: async () => addresses, transport }))).toBe('UPLOAD_HOST_NOT_ALLOWED')
    expect(transport).not.toHaveBeenCalled()
  })

  it('a DNS failure or an empty answer is a failure, never a fallback', async () => {
    const transport = vi.fn(async () => respond(200))
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => { throw new Error('nx') }, transport }))).toBe('UPLOAD_FAILED')
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => [], transport }))).toBe('UPLOAD_FAILED')
    expect(transport).not.toHaveBeenCalled()
  })

  it('connects to the validated address (hostname kept for SNI), exactly ONE request', async () => {
    const transport = vi.fn(async (_request: PinnedPostRequest) => respond(200))
    await postMultipartToProvider(URL_OK, { fields: { ticket: 't' }, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport })
    expect(transport).toHaveBeenCalledTimes(1)
    const request = transport.mock.calls[0][0]
    expect(request.address).toEqual(PUBLIC[0])
    expect(request.url.hostname).toBe('upload.example.test')
  })
})

describe('request shape', () => {
  it('sends ONLY minimal headers: multipart content type + length, no cookie, Authorization or app header', async () => {
    const transport = vi.fn(async (_request: PinnedPostRequest) => respond(200))
    await postMultipartToProvider(URL_OK, { fields: { ticket: 'TICKET' }, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport })
    const { headers, body } = transport.mock.calls[0][0]
    expect(Object.keys(headers).map((key) => key.toLowerCase()).sort()).toEqual(['accept', 'content-length', 'content-type'])
    expect(headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=----ContentStudio[0-9a-f]{24}$/)
    expect(headers['Content-Length']).toBe(String(body.byteLength))
  })

  it('builds RFC 7578 multipart: the ticket field first, then the file part with its filename and content type, closed by the boundary', () => {
    const body = buildMultipartBody({ ticket: 'TICKET-1' }, FILE, 'BOUNDARY').toString('latin1')
    expect(body).toContain('--BOUNDARY\r\nContent-Disposition: form-data; name="ticket"\r\n\r\nTICKET-1\r\n')
    expect(body).toContain('--BOUNDARY\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\nContent-Type: image/png\r\n\r\n')
    expect(body.endsWith('\r\n--BOUNDARY--\r\n')).toBe(true)
    expect(body.indexOf('name="ticket"')).toBeLessThan(body.indexOf('name="file"'))
  })

  it('carries the image bytes verbatim inside the file part', () => {
    const raw = buildMultipartBody({}, FILE, 'B')
    const start = raw.indexOf(Buffer.from('\r\n\r\n', 'latin1'), raw.indexOf(Buffer.from('name="file"'))) + 4
    expect(Array.from(raw.subarray(start, start + FILE.bytes.length))).toEqual(Array.from(FILE.bytes))
  })

  it('a hostile filename can never break out of the quoted header', () => {
    const body = buildMultipartBody({}, { ...FILE, filename: 'a"b\r\nX-Injected: 1.png' }, 'B').toString('latin1')
    expect(body).not.toMatch(/\r\nX-Injected/)
    expect(body.match(/filename="[^"\r\n]*"/)).not.toBeNull()
  })
})

describe('response handling', () => {
  it('returns the status and the JSON body', async () => {
    const result = await postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: async () => respond(200, '{"url":"https://files.example.test/a.png"}') })
    expect(result).toEqual({ status: 200, json: { url: 'https://files.example.test/a.png' } })
  })

  it('a non-JSON success body is reported as null (the caller decides), not thrown as a crash', async () => {
    const result = await postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: async () => respond(200, 'OK') })
    expect(result.json).toBeNull()
  })

  it.each([301, 302, 307, 400, 401, 403, 500, 503])('HTTP %s is a failure and redirects are NEVER followed', async (status) => {
    const transport = vi.fn(async () => respond(status))
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport }))).toBe('UPLOAD_FAILED')
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('a response larger than the cap is refused', async () => {
    const big = [new Uint8Array(200), new Uint8Array(200)]
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: async () => respond(200, big) }))).toBe('UPLOAD_RESPONSE_TOO_LARGE')
  })

  it('a network error and a hang both fail (bounded by the timeout) without a retry', async () => {
    const failing = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: failing }))).toBe('UPLOAD_FAILED')
    expect(failing).toHaveBeenCalledTimes(1)

    const hanging = vi.fn((request: PinnedPostRequest) => new Promise<PostResponse>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted')))))
    expect(await code(postMultipartToProvider(URL_OK, { fields: {}, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: hanging }))).toBe('UPLOAD_FAILED')
    expect(hanging).toHaveBeenCalledTimes(1)
  })

  it('error reasons never contain the URL, the ticket or image bytes', async () => {
    const error = await postMultipartToProvider(URL_OK, { fields: { ticket: 'SECRET-TICKET' }, file: FILE }, POLICY, { resolveHost: async () => PUBLIC, transport: async () => respond(403) }).catch((caught) => caught)
    expect(error).toBeInstanceOf(ProviderUploadError)
    expect(`${error.message} ${error.reason}`).not.toMatch(/SECRET-TICKET|upload\.example\.test|token=xyz/)
  })
})
