// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// A GET that connects ONLY to an address the caller already vetted.
//
// Validating a hostname's DNS answer and then calling fetch() lets fetch
// resolve the name AGAIN, so a rebinding DNS server can answer "public" to the
// check and "169.254.169.254" to the connection. Here the connection uses a
// `lookup` that always returns the vetted address, while the URL (and therefore
// TLS SNI / certificate verification / the Host header) still carries the real
// hostname. Redirects are never followed: a 3xx is returned as-is so the caller
// can re-validate the next hop.

import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'

export interface PinnedFetchInit {
  /** The vetted IP address to connect to. */
  address: string
  signal?: AbortSignal
  /** Extra request headers (only ever set by the caller for the original, vetted host). */
  headers?: Record<string, string>
  /** Transport seam (tests use plain http against a local server; production is https). */
  request?: typeof https.request | typeof http.request
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

export function pinnedFetch(url: string, init: PinnedFetchInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const family = init.address.includes(':') ? 6 : 4
    const request = init.request ?? https.request

    const req = request(
      target,
      {
        method: 'GET',
        signal: init.signal,
        headers: { 'user-agent': 'content-studio', accept: 'video/*,application/octet-stream;q=0.8', ...(init.headers ?? {}) },
        // Node may ask for one address or for all of them (happy eyeballs).
        lookup: (_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
          if (options?.all) callback(null, [{ address: init.address, family }])
          else callback(null, init.address, family)
        },
      } as https.RequestOptions,
      (res) => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const entry of value) headers.append(key, entry)
          else if (value !== undefined) headers.set(key, value)
        }
        const status = res.statusCode ?? 0
        const redirect = status >= 300 && status < 400
        if (redirect || NULL_BODY_STATUS.has(status)) {
          res.resume()
          resolve(new Response(null, { status, headers }))
          return
        }
        resolve(new Response(Readable.toWeb(res) as unknown as ReadableStream, { status, headers }))
      },
    )

    req.on('error', reject)
    req.end()
  })
}
