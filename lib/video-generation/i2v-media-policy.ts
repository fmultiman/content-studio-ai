// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1
//
// Pure policy for the image Content Studio hands to Kling MCP `file_upload` as an Image -> Video source.
// No I/O and no logging: it only looks at bytes the SERVER already loaded from a proven-owner storage key.
//
// Limits are the ones the CURRENT Kling MCP server declares (mcpVersion 1.3.3, `file_upload` / `image_to_video`
// tool descriptions, read through the MCP tool listing — not copied from the REST docs):
//   "Supported image specs: PNG/JPG only, below 4K resolution, <=30MB, aspect ratio no wider than 1:2."
// The provider stays the final authority: anything these checks let through that Kling still refuses fails at
// the upload step, BEFORE any paid generation is submitted.

import { sniffImageMime } from '@/lib/security/safe-remote-image'

/** "<=30MB". Read as decimal megabytes: the strictest reading, so a file we accept is within either reading. */
export const I2V_MCP_MAX_SOURCE_BYTES = 30 * 1000 * 1000

/**
 * "below 4K resolution" is not defined numerically by the provider. 4096 px on an edge is >= 4K under every
 * reading (UHD 3840 or DCI 4096), so it is the lenient bound: edges between 3840 and 4095 are left to the provider.
 */
export const I2V_MCP_MAX_EDGE_PX = 4096

/** "aspect ratio no wider than 1:2": the long edge is at most twice the short edge, in either orientation. */
export const I2V_MCP_MAX_ASPECT_RATIO = 2

export type I2vSourceMime = 'image/png' | 'image/jpeg'

export type I2vMediaFailureCode =
  | 'SOURCE_IMAGE_UNAVAILABLE'
  | 'SOURCE_IMAGE_FORMAT_UNSUPPORTED'
  | 'SOURCE_IMAGE_TOO_LARGE'
  | 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED'

export type I2vMediaValidation =
  | { ok: true; mimeType: I2vSourceMime; width: number; height: number }
  | { ok: false; code: I2vMediaFailureCode; reason: string }

const u16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1]
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

/** PNG: the IHDR chunk is always first (signature 8, length 4, "IHDR" 4, width 4, height 4). */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  const isIhdr = bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  if (!isIhdr) return null
  return { width: u32(bytes, 16), height: u32(bytes, 20) }
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** JPEG: walk the marker segments to the first Start-Of-Frame. Bounded by the buffer; never reads past it. */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let index = 2 // after SOI
  while (index + 4 <= bytes.length) {
    if (bytes[index] !== 0xff) return null
    let marker = bytes[index + 1]
    while (marker === 0xff && index + 2 < bytes.length) {
      index += 1 // fill bytes
      marker = bytes[index + 1]
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      index += 2 // standalone markers carry no length
      continue
    }
    const length = u16(bytes, index + 2)
    if (length < 2) return null
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (index + 9 > bytes.length) return null
      return { height: u16(bytes, index + 5), width: u16(bytes, index + 7) }
    }
    index += 2 + length
  }
  return null
}

/**
 * The server's final source-image check. The MIME comes from the FILE SIGNATURE, never from a stored column or a
 * file name: a row that says image/png over JPEG (or WebP) bytes is judged by its bytes.
 */
export function validateI2vSourceBytes(bytes: Uint8Array | null | undefined): I2vMediaValidation {
  if (!bytes || bytes.byteLength === 0) return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'no bytes' }
  if (bytes.byteLength > I2V_MCP_MAX_SOURCE_BYTES) return { ok: false, code: 'SOURCE_IMAGE_TOO_LARGE', reason: `${bytes.byteLength} bytes` }

  const sniffed = sniffImageMime(bytes)
  if (sniffed !== 'image/png' && sniffed !== 'image/jpeg') {
    return { ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED', reason: `signature ${sniffed ?? 'unknown'}` }
  }

  const dimensions = sniffed === 'image/png' ? readPngDimensions(bytes) : readJpegDimensions(bytes)
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    return { ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED', reason: 'unreadable dimensions' }
  }
  const { width, height } = dimensions
  if (width >= I2V_MCP_MAX_EDGE_PX || height >= I2V_MCP_MAX_EDGE_PX) {
    return { ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED', reason: `${width}x${height} is 4K or larger` }
  }
  if (Math.max(width, height) / Math.min(width, height) > I2V_MCP_MAX_ASPECT_RATIO) {
    return { ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED', reason: `${width}x${height} is wider than 1:2` }
  }
  return { ok: true, mimeType: sniffed, width, height }
}

/** A safe, short upload file name whose extension always matches the VERIFIED MIME. */
export function i2vUploadFilename(name: string | null | undefined, mimeType: I2vSourceMime): string {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'
  const base = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'source'}.${extension}`
}

/** Legacy `images.image_url` data URL -> bytes, only for a bounded `data:image/(png|jpeg);base64,` value. */
export function decodeLegacyImageDataUrl(value: string | null | undefined): Uint8Array | null {
  if (typeof value !== 'string') return null
  const match = /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) return null
  // Bound the DECODED size before decoding (base64 = 4 chars per 3 bytes).
  if (Math.floor((match[1].length * 3) / 4) > I2V_MCP_MAX_SOURCE_BYTES) return null
  try {
    return new Uint8Array(Buffer.from(match[1], 'base64'))
  } catch {
    return null
  }
}
