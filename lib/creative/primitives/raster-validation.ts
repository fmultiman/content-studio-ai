import crypto from 'node:crypto'
import sharp from 'sharp'

export type PngInspection = {
  mime_type: 'image/png'
  width: number
  height: number
  has_alpha: boolean
  file_size: number
  sha256: string
}

export async function inspectPngBuffer(buffer: Buffer, requireAlpha = true): Promise<PngInspection> {
  const metadata = await sharp(buffer).metadata()
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (!isPng || metadata.format !== 'png') throw new Error('Primitive binary is not a valid PNG')
  if (!metadata.width || !metadata.height) throw new Error('Primitive PNG dimensions are unavailable')
  const hasAlpha = metadata.hasAlpha === true
  if (requireAlpha && !hasAlpha) throw new Error('Primitive PNG requires an alpha channel')

  return {
    mime_type: 'image/png',
    width: metadata.width,
    height: metadata.height,
    has_alpha: hasAlpha,
    file_size: buffer.byteLength,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  }
}

