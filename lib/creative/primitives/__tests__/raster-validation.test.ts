import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { inspectPngBuffer } from '../raster-validation'

describe('primitive raster validation', () => {
  it('detects dimensions, alpha, size, and checksum for a valid PNG', async () => {
    const buffer = await sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const result = await inspectPngBuffer(buffer)
    expect(result).toMatchObject({ mime_type: 'image/png', width: 12, height: 8, has_alpha: true, file_size: buffer.byteLength })
    expect(result.sha256).toHaveLength(64)
  })

  it('rejects non-PNG and non-alpha input when alpha is required', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    await expect(inspectPngBuffer(jpeg)).rejects.toThrow(/PNG/)
    const opaque = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(inspectPngBuffer(opaque)).rejects.toThrow(/alpha/)
  })
})

