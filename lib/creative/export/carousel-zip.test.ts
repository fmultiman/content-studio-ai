import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildCarouselZip, CarouselExportError, orderedCarouselZipEntries } from './carousel-zip'

const item = (position: number, mimeType = 'image/png') => ({ position, mimeType, bytes: new Uint8Array([position + 1, 2, 3]) })

describe('carousel ZIP export', () => {
  it('uses ChannelPieceMedia positions for deterministic filenames', () => {
    const zip = buildCarouselZip(3, [item(2), item(0), item(1)])
    expect(Object.keys(unzipSync(zip))).toEqual(['01-slide-1.png', '02-slide-2.png', '03-slide-3.png'])
  })

  it('supports a future authored count without a hardcoded ten-slide rule', () => {
    expect(orderedCarouselZipEntries(4, [item(0), item(1), item(2), item(3)]).map((entry) => entry.name)).toEqual([
      '01-slide-1.png', '02-slide-2.png', '03-slide-3.png', '04-slide-4.png',
    ])
  })

  it('rejects incomplete, empty, and unsupported collections', () => {
    expect(() => buildCarouselZip(3, [item(0), item(1)])).toThrow(CarouselExportError)
    expect(() => buildCarouselZip(1, [{ ...item(0), bytes: new Uint8Array() }])).toThrow(/vazio/)
    expect(() => buildCarouselZip(1, [item(0, 'application/pdf')])).toThrow(/imagem estática suportada/)
  })
})
