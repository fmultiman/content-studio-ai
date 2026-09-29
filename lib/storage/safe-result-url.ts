// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// URL/host safety for provider-supplied result URLs that the SERVER fetches
// (MCP `query_tasks` results and REST webhook payloads). These are external
// input, so the fetch must not be steerable at internal infrastructure (SSRF).

import { lookup } from 'node:dns/promises'

/** Result URLs must be plain https to a public-looking host (no credentials, no IP literals, no internal suffixes). */
export function isSafeResultUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || /^\d+$/.test(host)) return false
  return true
}

/** True for loopback, private, link-local, CGNAT, unspecified and unique-local addresses. */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase()
  if (value.includes(':')) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is judged by its IPv4 part.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    // IPv4-mapped / embedded forms that hide an IPv4 address in hex (::ffff:7f00:1, 64:ff9b::/96 NAT64) and 6to4 (2002::/16).
    if (value.startsWith('::ffff:') || value.startsWith('64:ff9b:') || value.startsWith('2002:')) return true
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export type HostResolver = (hostname: string) => Promise<string[]>

const defaultResolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address)

/**
 * Rejects a hostname that resolves to a non-public address (e.g. a public DNS
 * name pointing at an internal IP). Resolution failure is a failure.
 */
export async function assertPublicHost(hostname: string, resolve: HostResolver = defaultResolver): Promise<void> {
  const addresses = await resolve(hostname)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('Result host is not public.')
  }
}
