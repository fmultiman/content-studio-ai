// STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1
//
// The ONLY way server code may download an image from a URL that originated in browser state.
//
// `POST /api/storage/upload-image` used to `fetch(imageUrl)` with whatever the browser sent. The
// real caller only ever sends the Nano Banana result URL (Production: 11/11 completed tasks are
// `https://tempfile.aiquickdraw.com/...`, default port, no signed query), but that URL round-trips
// through browser-writable state (`generation_tasks.image_url` is owner-updatable and the provider
// callback is unauthenticated), so it is a claim, not authority. Authority here is therefore the
// provider host itself, enforced at the network boundary:
//
//   1. URL: platform parser, https only, default port, no credentials/fragment, host on an exact
//      provider allowlist (label-boundary suffix rules only) — IP literals can never match.
//   2. DNS: the hostname is resolved HERE, every returned address must be public
//      (lib/security/public-address.ts), and the connection is PINNED to the validated address
//      (custom `lookup`, hostname kept for SNI/Host/certificate) — there is no second, uncontrolled
//      resolution between validation and connect, so DNS rebinding cannot swap in a private address.
//   3. Redirects are never followed automatically: every hop re-runs 1 and 2; small limit; loops refused.
//   4. Bounded: overall timeout, Content-Length pre-check and a streaming byte cap.
//   5. Content: an image Content-Type AND a matching file signature (never the URL extension).
//   6. A fresh outbound request with minimal headers: no cookie, Authorization or app header is ever forwarded.

import { lookup as dnsLookup } from 'node:dns/promises'
import https from 'node:https'
import { Buffer } from 'node:buffer'
import { isPublicAddress } from '@/lib/security/public-address'

export type RemoteImageErrorCode =
  | 'REMOTE_IMAGE_URL_INVALID'
  | 'REMOTE_IMAGE_HOST_NOT_ALLOWED'
  | 'REMOTE_IMAGE_FETCH_FAILED'
  | 'REMOTE_IMAGE_TOO_LARGE'
  | 'REMOTE_IMAGE_INVALID_CONTENT'

/** `reason` is for server logs only; the client only ever sees the bounded `code`. */
export class RemoteImageError extends Error {
  constructor(
    readonly code: RemoteImageErrorCode,
    readonly reason: string,
  ) {
    super(code)
    this.name = 'RemoteImageError'
  }
}

export interface RemoteImagePolicy {
  /** Exact hostnames, or `*.example.com` (label-boundary suffix; never a bare substring/endsWith). */
  allowedHosts: readonly string[]
  maxBytes: number
  timeoutMs: number
  maxRedirects: number
}

/** Nano Banana result files (the only caller). Proven from Production data, not from memory. */
export const NANOBANANA_RESULT_IMAGE_POLICY: RemoteImagePolicy = {
  allowedHosts: ['tempfile.aiquickdraw.com'],
  maxBytes: 15 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 3,
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export interface PinnedRequest {
  url: URL
  /** The validated address the socket MUST connect to. */
  address: ResolvedAddress
  headers: Record<string, string>
  signal: AbortSignal
}

export interface TransportResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: AsyncIterable<Uint8Array>
  destroy: () => void
}

export interface RemoteImageDependencies {
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>
  transport?: (request: PinnedRequest) => Promise<TransportResponse>
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

// ---------------------------------------------------------------------------
// 1. URL policy
// ---------------------------------------------------------------------------

export function hostMatchesAllowlist(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((entry) => {
    const pattern = entry.toLowerCase()
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // ".example.com": the dot is the label boundary
      return hostname.length > suffix.length && hostname.endsWith(suffix)
    }
    return hostname === pattern
  })
}

/** Parses and applies the URL policy. Throws RemoteImageError; never returns an unsafe URL. */
export function parseRemoteImageUrl(raw: unknown, policy: RemoteImagePolicy): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'not a bounded string')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'unparseable')
  }

  if (url.protocol !== 'https:') throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', `scheme ${url.protocol}`)
  if (url.username || url.password) throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'credentials in URL')
  if (url.hash) throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'fragment')
  if (url.port !== '' && url.port !== '443') throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'non-default port')

  // The URL parser lowercases, punycodes and canonicalizes IPv4 spellings; a trailing root dot is stripped here.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname) throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'empty host')
  if (url.hostname !== hostname) url.hostname = hostname // the canonical host is what gets resolved, pinned and sent as SNI
  if (!hostMatchesAllowlist(hostname, policy.allowedHosts)) throw new RemoteImageError('REMOTE_IMAGE_HOST_NOT_ALLOWED', `host ${hostname}`)
  return url
}

// ---------------------------------------------------------------------------
// 2. DNS: resolve, validate EVERY address, pin
// ---------------------------------------------------------------------------

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }))
}

async function resolveAndPin(hostname: string, resolveHost: (hostname: string) => Promise<ResolvedAddress[]>): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[]
  try {
    addresses = await resolveHost(hostname)
  } catch {
    throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'dns failure')
  }
  if (addresses.length === 0) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'no addresses')
  // ANY unsafe candidate fails the whole request: there is no fallback to an unvalidated address.
  if (addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new RemoteImageError('REMOTE_IMAGE_HOST_NOT_ALLOWED', `host ${hostname} resolves to a non-public address`)
  }
  return addresses[0]
}

// ---------------------------------------------------------------------------
// Transport (default): node:https with the connection pinned to the validated address
// ---------------------------------------------------------------------------

export function defaultTransport(request: PinnedRequest): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const { url, address, headers, signal } = request
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname, // kept for SNI, certificate verification and the Host header
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        agent: false, // never share a pooled socket that was connected elsewhere
        servername: url.hostname,
        // The ONLY place a socket address is chosen: the address validated above, never a fresh lookup.
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address: address.address, family: address.family }])
          else callback(null, address.address, address.family)
        }) as never,
        signal,
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          destroy: () => response.destroy(),
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// 5. Content: signature sniffing (Content-Type is necessary, never sufficient)
// ---------------------------------------------------------------------------

export function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  const at = (index: number) => bytes[index]
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'image/png'
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp'
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 && (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) return 'image/gif'
  return null
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function assertAcceptableContentType(contentType: string | undefined): void {
  if (!contentType) return // a missing header is judged by the signature alone
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (type.startsWith('image/') || type === 'application/octet-stream' || type === 'binary/octet-stream') return
  throw new RemoteImageError('REMOTE_IMAGE_INVALID_CONTENT', `content-type ${type}`)
}

// ---------------------------------------------------------------------------
// The fetcher
// ---------------------------------------------------------------------------

export interface RemoteImageResult {
  buffer: Buffer
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Normalized host only — never the URL, whose query string may carry a signature. */
  host: string
}

export async function fetchRemoteImage(rawUrl: unknown, policy: RemoteImagePolicy, deps: RemoteImageDependencies = {}): Promise<RemoteImageResult> {
  const resolveHost = deps.resolveHost ?? defaultResolveHost
  const transport = deps.transport ?? defaultTransport

  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'timeout'))
    }, policy.timeoutMs)
  })
  deadline.catch(() => undefined)

  const run = async (): Promise<RemoteImageResult> => {
    let current = parseRemoteImageUrl(rawUrl, policy)
    const visited = new Set<string>()

    for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
      if (visited.has(current.href)) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'redirect loop')
      visited.add(current.href)

      const hostname = current.hostname.toLowerCase().replace(/\.$/, '')
      const pinned = await resolveAndPin(hostname, resolveHost)

      let response: TransportResponse
      try {
        response = await transport({
          url: current,
          address: pinned,
          // Fresh, minimal headers: nothing from the incoming request is ever forwarded.
          headers: { Accept: 'image/*', 'User-Agent': 'ContentStudio-ImageIngest/1' },
          signal: controller.signal,
        })
      } catch {
        if (timedOut) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'timeout')
        throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'connection failure')
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        response.destroy()
        if (hop === policy.maxRedirects) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'too many redirects')
        const location = firstHeader(response.headers.location)
        if (!location) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'redirect without location')
        let next: string
        try {
          next = new URL(location, current).href // relative Location resolved against the current URL
        } catch {
          throw new RemoteImageError('REMOTE_IMAGE_URL_INVALID', 'bad redirect location')
        }
        current = parseRemoteImageUrl(next, policy) // the ENTIRE policy runs again for every hop
        continue
      }

      if (response.status !== 200) {
        response.destroy()
        throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', `status ${response.status}`)
      }

      try {
        assertAcceptableContentType(firstHeader(response.headers['content-type']))

        const declared = Number(firstHeader(response.headers['content-length']))
        if (Number.isFinite(declared) && declared > policy.maxBytes) throw new RemoteImageError('REMOTE_IMAGE_TOO_LARGE', 'content-length over cap')

        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of response.body) {
          total += chunk.byteLength
          // Enforced while streaming too: a missing or lying Content-Length does not bypass the cap.
          if (total > policy.maxBytes) throw new RemoteImageError('REMOTE_IMAGE_TOO_LARGE', 'stream over cap')
          chunks.push(Buffer.from(chunk))
        }
        const buffer = Buffer.concat(chunks, total)
        const mimeType = sniffImageMime(buffer)
        if (!mimeType) throw new RemoteImageError('REMOTE_IMAGE_INVALID_CONTENT', 'not an image signature')
        return { buffer, mimeType, host: hostname }
      } catch (error) {
        response.destroy()
        if (error instanceof RemoteImageError) throw error
        if (timedOut) throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'timeout')
        throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'read failure')
      }
    }
    throw new RemoteImageError('REMOTE_IMAGE_FETCH_FAILED', 'too many redirects')
  }

  const running = run()
  running.catch(() => undefined) // when the deadline wins, a late failure of the abandoned run is not an unhandled rejection
  try {
    return await Promise.race([running, deadline])
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}
