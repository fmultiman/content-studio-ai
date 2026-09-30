// STORAGE_UPLOAD_IMAGE_SSRF_HARDENING_V1
//
// "Is this resolved network address one the server may connect to on behalf of a
// browser-supplied URL?" — the public-network policy, IPv4 and IPv6.
//
// Built on Node's own `net.BlockList` (a proven CIDR primitive) rather than string
// checks. Everything that is not globally-routable unicast is refused: loopback,
// private, link-local (incl. the cloud metadata addresses), CGNAT, multicast,
// documentation/benchmark/reserved ranges, NAT64/6to4/Teredo transition ranges, and
// IPv4-mapped / IPv4-compatible IPv6 whose embedded IPv4 is itself refused.

import { BlockList, isIP } from 'node:net'

const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network" (incl. 0.0.0.0)
  ['10.0.0.0', 8], // RFC 1918
  ['100.64.0.0', 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (AWS/GCP/Azure metadata 169.254.169.254)
  ['172.16.0.0', 12], // RFC 1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. 255.255.255.255 broadcast
]

const IPV6_BLOCKED: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated)
  ['64:ff9b::', 96], // NAT64 (can reach private IPv4)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF assignments incl. Teredo 2001::/32
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
]

const blocked = new BlockList()
for (const [network, prefix] of IPV4_BLOCKED) blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of IPV6_BLOCKED) blocked.addSubnet(network, prefix, 'ipv6')

/**
 * The IPv4 embedded in an IPv4-mapped IPv6 (any spelling: `::ffff:a.b.c.d`, `::ffff:aabb:ccdd`,
 * `0:0:0:0:0:ffff:aabb:ccdd`), else null. The WHATWG URL parser canonicalizes every spelling to
 * `::ffff:hhhh:hhhh`, so one pattern covers them all.
 */
function mappedIpv4(address: string): string | null {
  let canonical: string
  try {
    canonical = new URL(`http://[${address}]/`).hostname
  } catch {
    return null
  }
  const match = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(canonical)
  if (!match) return null
  const high = parseInt(match[1], 16)
  const low = parseInt(match[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * True only for a globally-routable unicast address. Anything that does not parse as an
 * IP literal is NOT public (fail closed).
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 0) return false

  if (family === 4) return !blocked.check(address, 'ipv4')

  // A zone id ("fe80::1%eth0") or anything the URL parser cannot canonicalize is refused.
  try {
    new URL(`http://[${address}]/`)
  } catch {
    return false
  }
  const mapped = mappedIpv4(address)
  if (mapped) return !blocked.check(mapped, 'ipv4')
  return !blocked.check(address, 'ipv6')
}
