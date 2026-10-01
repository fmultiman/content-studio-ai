// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1
//
// The ONLY way server code may POST user-owned image bytes to a URL that a PROVIDER returned.
//
// Kling MCP `file_upload` does not take the file: it returns a one-time upload ticket and an `upload_url`, and the
// client POSTs `multipart/form-data` (fields `ticket` + `file`) to that URL. That URL comes from the provider's tool
// result, so it is a claim: a compromised or mistaken response must never be able to steer the server (and the user's
// image) at an internal address. Enforced at the network boundary, with the same primitives as
// lib/security/safe-remote-image.ts (STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1):
//
//   1. URL: https only, default port, no credentials, no fragment, bounded length.
//      NO host allowlist: the provider's upload host is not documented and inventing one from a single observation
//      would be a false boundary. The address check below is the boundary.
//   2. DNS: resolved HERE, EVERY address must be public (lib/security/public-address.ts), and the socket is PINNED to the
//      validated address (custom `lookup`; hostname kept for SNI/Host/certificate). No second resolution, no rebinding.
//   3. Redirects are never followed (a 3xx is a failure).
//   4. Bounded: overall timeout and a streaming cap on the response body.
//   5. Minimal headers: no cookie, Authorization or app header is ever sent — the ticket inside the body is the credential.

import { lookup as dnsLookup } from 'node:dns/promises'
import https from 'node:https'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { isPublicAddress } from '@/lib/security/public-address'

export type ProviderUploadErrorCode = 'UPLOAD_URL_INVALID' | 'UPLOAD_HOST_NOT_ALLOWED' | 'UPLOAD_FAILED' | 'UPLOAD_RESPONSE_TOO_LARGE'

/** `reason` is for server logs only and never contains a URL, ticket or byte of the image. */
export class ProviderUploadError extends Error {
  constructor(
    readonly code: ProviderUploadErrorCode,
    readonly reason: string,
  ) {
    super(code)
    this.name = 'ProviderUploadError'
  }
}

export interface ProviderUploadPolicy {
  timeoutMs: number
  maxResponseBytes: number
}

export const KLING_SOURCE_UPLOAD_POLICY: ProviderUploadPolicy = {
  // The route allows 60s in total (source load + ticket + this POST + submit): this leaves room for the rest.
  timeoutMs: 30_000,
  maxResponseBytes: 64 * 1024,
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export interface PinnedPostRequest {
  url: URL
  address: ResolvedAddress
  headers: Record<string, string>
  body: Buffer
  signal: AbortSignal
}

export interface PostResponse {
  status: number
  body: AsyncIterable<Uint8Array>
  destroy: () => void
}

export interface ProviderUploadDependencies {
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>
  transport?: (request: PinnedPostRequest) => Promise<PostResponse>
}

export function parseProviderUploadUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) throw new ProviderUploadError('UPLOAD_URL_INVALID', 'not a bounded string')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ProviderUploadError('UPLOAD_URL_INVALID', 'unparseable')
  }
  if (url.protocol !== 'https:') throw new ProviderUploadError('UPLOAD_URL_INVALID', `scheme ${url.protocol}`)
  if (url.username || url.password) throw new ProviderUploadError('UPLOAD_URL_INVALID', 'credentials in URL')
  if (url.hash) throw new ProviderUploadError('UPLOAD_URL_INVALID', 'fragment')
  if (url.port !== '' && url.port !== '443') throw new ProviderUploadError('UPLOAD_URL_INVALID', 'non-default port')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname) throw new ProviderUploadError('UPLOAD_URL_INVALID', 'empty host')
  if (url.hostname !== hostname) url.hostname = hostname
  return url
}

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }))
}

async function resolveAndPin(hostname: string, resolveHost: (hostname: string) => Promise<ResolvedAddress[]>): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[]
  try {
    addresses = await resolveHost(hostname)
  } catch {
    throw new ProviderUploadError('UPLOAD_FAILED', 'dns failure')
  }
  if (addresses.length === 0) throw new ProviderUploadError('UPLOAD_FAILED', 'no addresses')
  // ANY unsafe candidate fails the whole request: there is no fallback to an unvalidated address.
  if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new ProviderUploadError('UPLOAD_HOST_NOT_ALLOWED', 'host resolves to a non-public address')
  return addresses[0]
}

export function defaultPostTransport(request: PinnedPostRequest): Promise<PostResponse> {
  return new Promise((resolve, reject) => {
    const { url, address, headers, body, signal } = request
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers,
        agent: false,
        servername: url.hostname,
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address: address.address, family: address.family }])
          else callback(null, address.address, address.family)
        }) as never,
        signal,
      },
      (response) => resolve({ status: response.statusCode ?? 0, body: response, destroy: () => response.destroy() }),
    )
    req.on('error', reject)
    req.end(body)
  })
}

export interface MultipartFilePart {
  fieldName: string
  filename: string
  contentType: string
  bytes: Uint8Array
}

/** RFC 7578 body: text fields first, then the file part. Field names/filenames are quoted-string safe by construction. */
export function buildMultipartBody(fields: Record<string, string>, file: MultipartFilePart, boundary: string): Buffer {
  const quote = (value: string) => value.replace(/["\r\n]/g, '_')
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`, 'utf8'))
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${quote(file.fieldName)}"; filename="${quote(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8',
    ),
  )
  chunks.push(Buffer.from(file.bytes))
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  return Buffer.concat(chunks)
}

async function readCapped(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > maxBytes) throw new ProviderUploadError('UPLOAD_RESPONSE_TOO_LARGE', 'response exceeds the cap')
    parts.push(Buffer.from(chunk))
  }
  return Buffer.concat(parts)
}

/** Result of the provider's upload endpoint: HTTP status and the body parsed as JSON (null when it is not JSON). */
export interface ProviderUploadResponse {
  status: number
  json: unknown | null
}

/**
 * POSTs one multipart file to a provider-returned URL. Exactly ONE request: never retried here (a retry could
 * create a second provider-side upload). Throws ProviderUploadError; never returns an unvalidated destination.
 */
export async function postMultipartToProvider(
  rawUrl: unknown,
  payload: { fields: Record<string, string>; file: MultipartFilePart },
  policy: ProviderUploadPolicy = KLING_SOURCE_UPLOAD_POLICY,
  deps: ProviderUploadDependencies = {},
): Promise<ProviderUploadResponse> {
  const url = parseProviderUploadUrl(rawUrl)
  const address = await resolveAndPin(url.hostname, deps.resolveHost ?? defaultResolveHost)

  const boundary = `----ContentStudio${randomBytes(12).toString('hex')}`
  const body = buildMultipartBody(payload.fields, payload.file, boundary)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), policy.timeoutMs)

  try {
    let response: PostResponse
    try {
      response = await (deps.transport ?? defaultPostTransport)({
        url,
        address,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(body.byteLength), Accept: 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch {
      throw new ProviderUploadError('UPLOAD_FAILED', controller.signal.aborted ? 'timeout' : 'network error')
    }

    try {
      if (response.status < 200 || response.status >= 300) {
        response.destroy()
        // 3xx is refused too: redirects are never followed.
        throw new ProviderUploadError('UPLOAD_FAILED', `http ${response.status}`)
      }
      let raw: Buffer
      try {
        raw = await readCapped(response.body, policy.maxResponseBytes)
      } catch (error) {
        if (error instanceof ProviderUploadError) throw error
        throw new ProviderUploadError('UPLOAD_FAILED', controller.signal.aborted ? 'timeout' : 'response read error')
      }
      let json: unknown | null = null
      try {
        json = JSON.parse(raw.toString('utf8'))
      } catch {
        json = null
      }
      return { status: response.status, json }
    } finally {
      response.destroy()
    }
  } finally {
    clearTimeout(timer)
  }
}
