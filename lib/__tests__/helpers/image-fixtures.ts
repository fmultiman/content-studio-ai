// Synthetic image bytes for source-transport tests. Only the headers the server actually reads are real
// (signature + dimensions); there is no decodable pixel data and nothing here is a real user image.

const u32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
const u16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff]

/** A PNG signature + IHDR (width x height) + padding up to `size` bytes. */
export function pngBytes(width = 1024, height = 1024, size = 2048): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 6, 0, 0, 0]
  const out = new Uint8Array(Math.max(size, header.length))
  out.set(header)
  return out
}

/** A JPEG: SOI, one APP0 segment, then SOF0 (height x width), padded up to `size` bytes. */
export function jpegBytes(width = 1024, height = 1024, size = 2048): Uint8Array {
  const app0 = [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const sof0 = [0xff, 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  const header = [0xff, 0xd8, ...app0, ...sof0]
  const out = new Uint8Array(Math.max(size, header.length))
  out.set(header)
  return out
}

/** RIFF....WEBPVP8 — a real WebP signature, which the I2V source policy must refuse. */
export function webpBytes(size = 2048): Uint8Array {
  const out = new Uint8Array(size)
  out.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
  return out
}

export function gifBytes(size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  return out
}

export const toDataUrl = (bytes: Uint8Array, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
