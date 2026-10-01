import { describe, expect, it } from 'vitest'
import {
  I2V_MCP_MAX_ASPECT_RATIO,
  I2V_MCP_MAX_EDGE_PX,
  I2V_MCP_MAX_SOURCE_BYTES,
  decodeLegacyImageDataUrl,
  i2vUploadFilename,
  readJpegDimensions,
  readPngDimensions,
  validateI2vSourceBytes,
} from '@/lib/video-generation/i2v-media-policy'
import { gifBytes, jpegBytes, pngBytes, toDataUrl, webpBytes } from './helpers/image-fixtures'

// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1 — the final, server-side source-image policy. Synthetic bytes only.

describe('limits are the ones the CURRENT Kling MCP server declares (mcpVersion 1.3.3), not the REST ones', () => {
  it('"PNG/JPG only, below 4K, <=30MB, aspect ratio no wider than 1:2"', () => {
    expect(I2V_MCP_MAX_SOURCE_BYTES).toBe(30_000_000)
    expect(I2V_MCP_MAX_EDGE_PX).toBe(4096)
    expect(I2V_MCP_MAX_ASPECT_RATIO).toBe(2)
  })
})

describe('format: the FILE SIGNATURE decides, never a stored mime or a name', () => {
  it('accepts PNG and JPEG', () => {
    expect(validateI2vSourceBytes(pngBytes(1024, 768))).toEqual({ ok: true, mimeType: 'image/png', width: 1024, height: 768 })
    expect(validateI2vSourceBytes(jpegBytes(1920, 1080))).toEqual({ ok: true, mimeType: 'image/jpeg', width: 1920, height: 1080 })
  })

  it.each([
    ['WebP', webpBytes()],
    ['GIF', gifBytes()],
    ['plain text', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['random bytes', Uint8Array.from({ length: 64 }, (_, index) => (index * 37) % 251)],
  ])('refuses %s with SOURCE_IMAGE_FORMAT_UNSUPPORTED', (_name, bytes) => {
    expect(validateI2vSourceBytes(bytes)).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })

  it('a row that CLAIMS image/png over WebP bytes is judged by its bytes (the stored mime is never consulted)', () => {
    expect(validateI2vSourceBytes(webpBytes())).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })

  it('truncated headers are refused, not guessed', () => {
    expect(validateI2vSourceBytes(pngBytes().slice(0, 12))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
    expect(validateI2vSourceBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_FORMAT_UNSUPPORTED' })
  })

  it('no bytes at all is "unavailable"', () => {
    expect(validateI2vSourceBytes(new Uint8Array(0))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
    expect(validateI2vSourceBytes(null)).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE' })
  })
})

describe('size', () => {
  it('30 MB is the last accepted size; one byte more is refused before anything is uploaded', () => {
    expect(validateI2vSourceBytes(pngBytes(512, 512, I2V_MCP_MAX_SOURCE_BYTES)).ok).toBe(true)
    expect(validateI2vSourceBytes(pngBytes(512, 512, I2V_MCP_MAX_SOURCE_BYTES + 1))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_TOO_LARGE' })
  })
})

describe('dimensions', () => {
  it('reads PNG IHDR and JPEG SOF dimensions (and skips other JPEG segments first)', () => {
    expect(readPngDimensions(pngBytes(640, 480))).toEqual({ width: 640, height: 480 })
    expect(readJpegDimensions(jpegBytes(640, 480))).toEqual({ width: 640, height: 480 })
    expect(readPngDimensions(jpegBytes())).toBeNull()
  })

  it('"below 4K": an edge at 4096 or more is refused; 4095 is left to the provider', () => {
    expect(validateI2vSourceBytes(pngBytes(4096, 3000))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
    expect(validateI2vSourceBytes(jpegBytes(3000, 4096))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
    expect(validateI2vSourceBytes(pngBytes(4095, 3000)).ok).toBe(true)
  })

  it('"aspect ratio no wider than 1:2": 2:1 passes in either orientation, beyond it is refused', () => {
    expect(validateI2vSourceBytes(pngBytes(2000, 1000)).ok).toBe(true)
    expect(validateI2vSourceBytes(pngBytes(1000, 2000)).ok).toBe(true)
    expect(validateI2vSourceBytes(pngBytes(2001, 1000))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
    expect(validateI2vSourceBytes(jpegBytes(1000, 2100))).toMatchObject({ ok: false, code: 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED' })
  })

  it('a zero dimension is not an image', () => {
    expect(validateI2vSourceBytes(pngBytes(0, 100))).toMatchObject({ ok: false })
  })
})

describe('upload file name', () => {
  it('is short, safe and its extension always matches the VERIFIED mime', () => {
    expect(i2vUploadFilename('Capa do lançamento.webp', 'image/png')).toBe('Capa-do-lancamento.png')
    expect(i2vUploadFilename('retrato.PNG', 'image/jpeg')).toBe('retrato.jpg')
    expect(i2vUploadFilename('../../etc/passwd', 'image/png')).toBe('etc-passwd.png')
    expect(i2vUploadFilename('  ', 'image/png')).toBe('source.png')
    expect(i2vUploadFilename(null, 'image/jpeg')).toBe('source.jpg')
    expect(i2vUploadFilename('x'.repeat(300), 'image/png').length).toBeLessThanOrEqual(64)
    expect(i2vUploadFilename('a"b\r\nc.png', 'image/png')).not.toMatch(/["\r\n]/)
  })
})

describe('legacy data URLs', () => {
  it('a bounded PNG/JPEG data URL is decoded to the same bytes', () => {
    const png = pngBytes(800, 600)
    expect(Array.from(decodeLegacyImageDataUrl(toDataUrl(png))!)).toEqual(Array.from(png))
    expect(decodeLegacyImageDataUrl(toDataUrl(jpegBytes(), 'image/jpeg'))).not.toBeNull()
    expect(decodeLegacyImageDataUrl(toDataUrl(jpegBytes(), 'image/jpg'))).not.toBeNull()
  })

  it.each([
    ['an external URL', 'https://picsum.photos/seed/x/800/600'],
    ['a WebP data URL', 'data:image/webp;base64,AAAA'],
    ['an SVG data URL', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a non-base64 data URL', 'data:image/png,rawtext'],
    ['a script', 'javascript:alert(1)'],
    ['nothing', null],
  ])('%s is not decoded', (_name, value) => {
    expect(decodeLegacyImageDataUrl(value as string | null)).toBeNull()
  })

  it('an over-size data URL is refused BEFORE decoding', () => {
    const tooLong = `data:image/png;base64,${'A'.repeat(Math.ceil((I2V_MCP_MAX_SOURCE_BYTES * 4) / 3) + 8)}`
    expect(decodeLegacyImageDataUrl(tooLong)).toBeNull()
  })
})
