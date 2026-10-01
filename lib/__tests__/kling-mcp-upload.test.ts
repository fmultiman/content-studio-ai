import { describe, expect, it, vi } from 'vitest'
import { ProtocolError, ProtocolErrorCode, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client'
import {
  parseUploadTicket,
  parseUploadedFileUrl,
  shapeOf,
  uploadKlingMcpSourceImage,
  type KlingMcpUploadDependencies,
  type KlingMcpUploadImage,
} from '@/lib/provider-connections/kling-mcp-upload'
import { KlingMcpSubmitError } from '@/lib/provider-connections/kling-mcp-generation'
import { ProviderAuthorizationRequiredError } from '@/lib/provider-connections/types'
import type { PinnedPostRequest, PostResponse } from '@/lib/security/pinned-provider-upload'
import { pngBytes } from './helpers/image-fixtures'

// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — the `file_upload` ticket flow, against the contract the CURRENT Kling MCP server
// declares (mcpVersion 1.3.3): tool `file_upload` {contentType, filename, size} -> one-time ticket {ticket, upload_url,
// expire_at}; POST multipart (`ticket` + `file`) to upload_url -> response carries the file URL. No real provider call.

const TOKEN = 'ACCESS-TOKEN-SHOULD-NEVER-APPEAR'
const TICKET = 'ONE-TIME-TICKET-SECRET'
const UPLOAD_URL = 'https://upload.example.test/put/abc?sig=SECRET-SIG'
const FILE_URL = 'https://provider-files.example.test/u/abc123.png'
const NOW = 1_800_000_000_000
const PUBLIC = [{ address: '93.184.216.34', family: 4 as const }]

const IMAGE: KlingMcpUploadImage = { bytes: pngBytes(1024, 768, 4096), mimeType: 'image/png', filename: 'capa.png' }

const ticketResult = (overrides: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: JSON.stringify({ ticket: TICKET, upload_url: UPLOAD_URL, expire_at: (NOW + 600_000) / 1000, ...overrides }) }],
})

function post(status: number, body: unknown): PostResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status, body: (async function* () { yield new TextEncoder().encode(text) })(), destroy: vi.fn() }
}

function harness(options: {
  ticket?: () => unknown
  connect?: () => Promise<void>
  callTool?: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>
  upload?: (request: PinnedPostRequest) => Promise<PostResponse>
  resolveHost?: () => Promise<typeof PUBLIC>
} = {}) {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = []
  const posts: PinnedPostRequest[] = []
  const client = {
    connect: options.connect ?? (async () => undefined),
    listTools: async () => ({ tools: [] }),
    callTool: async (params: { name: string; arguments?: Record<string, unknown> }) => {
      calls.push(params)
      return options.callTool ? options.callTool(params) : (options.ticket ?? ticketResult)()
    },
    close: vi.fn(async () => undefined),
  }
  const tokens: string[] = []
  const deps: KlingMcpUploadDependencies = {
    createClient: ((token: string) => {
      tokens.push(token)
      return { client, transport: {} }
    }) as never,
    nowMs: () => NOW,
    providerUpload: {
      resolveHost: options.resolveHost ?? (async () => PUBLIC),
      transport: async (request) => {
        posts.push(request)
        return options.upload ? options.upload(request) : post(200, { url: FILE_URL })
      },
    },
  }
  return { client, calls, posts, tokens, deps }
}

const failure = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error)

describe('16-19. exact mapping of the documented contract', () => {
  it('step 1: calls ONLY file_upload with exactly {contentType, filename, size}', async () => {
    const { calls, deps } = harness()
    await uploadKlingMcpSourceImage(TOKEN, IMAGE, deps)
    expect(calls).toEqual([{ name: 'file_upload', arguments: { contentType: 'image/png', filename: 'capa.png', size: 4096 } }])
  })

  it('JPEG maps to image/jpeg with its own filename and size', async () => {
    const jpeg: KlingMcpUploadImage = { bytes: new Uint8Array(777), mimeType: 'image/jpeg', filename: 'retrato.jpg' }
    const { calls, deps } = harness()
    await uploadKlingMcpSourceImage(TOKEN, jpeg, deps)
    expect(calls[0].arguments).toEqual({ contentType: 'image/jpeg', filename: 'retrato.jpg', size: 777 })
  })

  it('step 2: POSTs multipart to the ticket’s upload_url with the `ticket` field, the `file` part (filename + content type) and the bytes verbatim', async () => {
    const { posts, deps } = harness()
    await uploadKlingMcpSourceImage(TOKEN, IMAGE, deps)
    expect(posts).toHaveLength(1)
    expect(posts[0].url.href).toBe(UPLOAD_URL)
    const text = posts[0].body.toString('latin1')
    expect(text).toContain(`name="ticket"\r\n\r\n${TICKET}\r\n`)
    expect(text).toContain('name="file"; filename="capa.png"\r\nContent-Type: image/png\r\n\r\n')
    const start = posts[0].body.indexOf(Buffer.from('Content-Type: image/png\r\n\r\n')) + 'Content-Type: image/png\r\n\r\n'.length
    expect(Array.from(posts[0].body.subarray(start, start + IMAGE.bytes.length))).toEqual(Array.from(IMAGE.bytes))
  })

  it('20. step 3: the returned reference is exactly the provider file URL', async () => {
    const { deps } = harness()
    expect(await uploadKlingMcpSourceImage(TOKEN, IMAGE, deps)).toEqual({ url: FILE_URL })
  })

  it('uses the SAME per-call connection boundary as the other tools (token in, closed afterwards)', async () => {
    const { client, tokens, deps } = harness()
    await uploadKlingMcpSourceImage(TOKEN, IMAGE, deps)
    expect(tokens).toEqual([TOKEN])
    expect(client.close).toHaveBeenCalledTimes(1)
  })
})

describe('parsers: documented names first, fail closed on anything else', () => {
  it('ticket: ticket + upload_url + expire_at (seconds, milliseconds or ISO), also under data/result', () => {
    expect(parseUploadTicket({ ticket: 't', upload_url: 'https://u.example.test/x', expire_at: 1_800_000_600 })).toEqual({ ticket: 't', uploadUrl: 'https://u.example.test/x', expiresAtMs: 1_800_000_600_000 })
    expect(parseUploadTicket({ data: { ticket: 't', uploadUrl: 'https://u.example.test/x', expireAt: 1_800_000_600_000 } })?.expiresAtMs).toBe(1_800_000_600_000)
    expect(parseUploadTicket({ result: { ticket: 't', upload_url: 'https://u.example.test/x', expire_at: '2027-01-15T08:00:00Z' } })?.expiresAtMs).toBe(Date.parse('2027-01-15T08:00:00Z'))
    expect(parseUploadTicket({ ticket: 't', upload_url: 'https://u.example.test/x' })?.expiresAtMs).toBeNull()
  })

  it.each([
    ['no ticket', { upload_url: 'https://u.example.test/x' }],
    ['no upload url', { ticket: 't' }],
    ['blank values', { ticket: ' ', upload_url: '' }],
    ['wrong types', { ticket: 5, upload_url: {} }],
    ['an array', [1, 2]],
    ['null', null],
    ['a string', 'ticket'],
  ])('ticket: %s is unusable', (_name, payload) => {
    expect(parseUploadTicket(payload)).toBeNull()
  })

  it('file URL: url / file_url / fileUrl (top level or under data/result/file), https only, no credentials', () => {
    expect(parseUploadedFileUrl({ url: FILE_URL })).toBe(FILE_URL)
    expect(parseUploadedFileUrl({ file_url: FILE_URL })).toBe(FILE_URL)
    expect(parseUploadedFileUrl({ data: { fileUrl: FILE_URL } })).toBe(FILE_URL)
    expect(parseUploadedFileUrl({ result: { file: { url: FILE_URL } } })).toBe(FILE_URL)
  })

  it.each([
    ['http', { url: 'http://provider-files.example.test/a.png' }],
    ['credentials', { url: 'https://user:pw@provider-files.example.test/a.png' }],
    ['a data URL', { url: 'data:image/png;base64,AAAA' }],
    ['a relative path', { url: '/files/a.png' }],
    ['an unknown key', { link: FILE_URL }],
    ['an over-long URL', { url: `https://provider-files.example.test/${'a'.repeat(3000)}` }],
    ['nothing', {}],
    ['null', null],
  ])('file URL: %s is refused', (_name, payload) => {
    expect(parseUploadedFileUrl(payload)).toBeNull()
  })

  it('no Content Studio storage rule is imposed on a provider-hosted URL, and no host list is invented', () => {
    expect(parseUploadedFileUrl({ url: 'https://some-cdn.example.org/any/path/x.jpg?x=1' })).not.toBeNull()
  })

  it('shapeOf reports key NAMES only, never values', () => {
    expect(shapeOf({ b: 'SECRET', a: 1 })).toBe('a,b')
    expect(shapeOf([1])).toBe('array')
    expect(shapeOf('x')).toBe('string')
  })
})

describe('21-22. unusable results', () => {
  it('a ticket without the documented fields fails as MCP_FILE_UPLOAD_FAILED, reports key names only, and posts nothing', async () => {
    const { posts, deps } = harness({ ticket: () => ({ content: [{ type: 'text', text: JSON.stringify({ surprise: 'SECRET-VALUE' }) }] }) })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
    expect(error).toBeInstanceOf(KlingMcpSubmitError)
    expect(error.failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(error.outcomeUnknown).toBe(false)
    expect(error.providerText).toContain('surprise')
    expect(`${error.message} ${error.providerText}`).not.toContain('SECRET-VALUE')
    expect(posts).toEqual([])
  })

  it('an unreadable (non-JSON) ticket result fails the same way', async () => {
    const { posts, deps } = harness({ ticket: () => ({ content: [{ type: 'text', text: 'not json' }] }) })
    expect(((await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError).failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(posts).toEqual([])
  })

  it('an upload that succeeds but returns no usable file URL is MCP_SOURCE_REFERENCE_INVALID (diagnosed by key names only)', async () => {
    for (const body of [{ ok: true, secret: 'SECRET-VALUE' }, 'OK', { url: 'http://insecure.example.test/a.png' }, {}]) {
      const { deps } = harness({ upload: async () => post(200, body) })
      const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
      expect(error.failureClass).toBe('MCP_SOURCE_REFERENCE_INVALID')
      expect(error.outcomeUnknown).toBe(false)
      expect(`${error.message} ${error.providerText}`).not.toMatch(/SECRET-VALUE|insecure\.example/)
    }
  })
})

describe('23-25. provider errors, timeouts and retries', () => {
  it('the ticket tool reporting an error is MCP_FILE_UPLOAD_FAILED and nothing is posted', async () => {
    const { posts, deps } = harness({ ticket: () => ({ isError: true, content: [{ type: 'text', text: 'quota' }] }) })
    expect(((await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError).failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(posts).toEqual([])
  })

  it.each([
    ['a JSON-RPC error', () => new ProtocolError(ProtocolErrorCode.InvalidParams, 'bad params')],
    ['a dropped connection', () => new Error('ECONNRESET')],
    ['a 5xx', () => new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'upstream', { status: 502 })],
  ])('the ticket call failing with %s is MCP_FILE_UPLOAD_FAILED, never "outcome unknown" (nothing paid was sent)', async (_name, make) => {
    const { deps } = harness({ callTool: async () => { throw make() } })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
    expect(error.failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(error.outcomeUnknown).toBe(false)
  })

  it('an HTTP 403 (missing permission) uses the existing authorization wording, not a media error', async () => {
    const { deps } = harness({ callTool: async () => { throw new SdkHttpError(SdkErrorCode.ClientHttpForbidden, 'forbidden', { status: 403 }) } })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
    expect(error.failureClass).toBe('PROVIDER_REJECTED')
    expect(error.message).toMatch(/autorização da conta não permite gerar/)
  })

  it('a rejected token is rethrown for the ONE refresh-and-retry the transport allows (it never reached the tool)', async () => {
    const connectFails = harness({ connect: async () => { throw new UnauthorizedError('expired') } })
    expect(await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, connectFails.deps))).toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(connectFails.calls).toEqual([])
    const callFails = harness({ callTool: async () => { throw new UnauthorizedError('expired') } })
    expect(await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, callFails.deps))).toBeInstanceOf(ProviderAuthorizationRequiredError)
    expect(callFails.posts).toEqual([])
  })

  it('a failed connection is MCP_FILE_UPLOAD_FAILED and nothing else happens', async () => {
    const { calls, deps } = harness({ connect: async () => { throw new Error('down') } })
    expect(((await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError).failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(calls).toEqual([])
  })

  it.each([
    ['HTTP 500', async () => post(500, 'boom')],
    ['HTTP 403', async () => post(403, { error: 'ticket' })],
    ['a redirect', async () => post(302, '')],
    ['a network error', async () => { throw new Error('ECONNRESET') }],
  ])('the upload POST failing with %s is MCP_FILE_UPLOAD_FAILED — after exactly ONE attempt (no automatic duplicate upload)', async (_name, upload) => {
    const { calls, posts, deps } = harness({ upload })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
    expect(error.failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(error.outcomeUnknown).toBe(false)
    expect(calls).toHaveLength(1)
    expect(posts).toHaveLength(1)
  })

  it('24. a ticket call that never answers is bounded: MCP_FILE_UPLOAD_FAILED after the timeout, one call, no POST, no retry', async () => {
    const { calls, posts, client, deps } = harness({ callTool: () => new Promise(() => undefined) })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, { ...deps, ticketTimeoutMs: 25 }))) as KlingMcpSubmitError
    expect(error).toBeInstanceOf(KlingMcpSubmitError)
    expect(error.failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(error.outcomeUnknown).toBe(false)
    expect(error.providerText).toBe('ticket timeout')
    expect(calls).toHaveLength(1)
    expect(posts).toEqual([])
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it('an already-expired ticket is refused without posting the image', async () => {
    const { posts, deps } = harness({ ticket: () => ticketResult({ expire_at: (NOW - 1000) / 1000 }) })
    expect(((await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError).failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(posts).toEqual([])
  })

  it('an upload_url that resolves to a private address is refused and no byte of the image leaves', async () => {
    const { posts, deps } = harness({ resolveHost: async () => [{ address: '10.0.0.7', family: 4 as const }] as never })
    const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError
    expect(error.failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
    expect(posts).toEqual([])
  })

  it.each(['http://upload.example.test/put', 'https://upload.example.test:9000/put', 'https://u:p@upload.example.test/put', 'javascript:alert(1)'])(
    'a provider-returned upload_url of %s is refused',
    async (uploadUrl) => {
      const { posts, deps } = harness({ ticket: () => ticketResult({ upload_url: uploadUrl }) })
      expect(((await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, deps))) as KlingMcpSubmitError).failureClass).toBe('MCP_FILE_UPLOAD_FAILED')
      expect(posts).toEqual([])
    },
  )
})

describe('secrets and persistence', () => {
  it('no error, message or diagnostic ever contains the token, the ticket, the signed upload URL or the image', async () => {
    const scenarios = [
      harness({ upload: async () => post(500, 'x') }),
      harness({ upload: async () => post(200, { nope: true }) }),
      harness({ ticket: () => ({ content: [{ type: 'text', text: JSON.stringify({ ticket: TICKET }) }] }) }),
    ]
    for (const scenario of scenarios) {
      const error = (await failure(uploadKlingMcpSourceImage(TOKEN, IMAGE, scenario.deps))) as KlingMcpSubmitError
      const text = `${error.message} ${error.providerText ?? ''} ${error.failureClass}`
      expect(text).not.toMatch(new RegExp(`${TOKEN}|${TICKET}|SECRET-SIG|upload\\.example\\.test`))
    }
  })

  it('26. the provider reference is returned to the caller only: this module persists nothing and has no storage import', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('lib/provider-connections/kling-mcp-upload.ts', 'utf8')
    expect(source).not.toMatch(/from\s+['"]@\/lib\/(supabase|storage)/)
    expect(source).not.toMatch(/\.(insert|update|upsert)\(/)
  })
})
