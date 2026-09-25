import { zipSync } from 'fflate'

export const SUPPORTED_CAROUSEL_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type SupportedCarouselImageMimeType = (typeof SUPPORTED_CAROUSEL_IMAGE_MIME_TYPES)[number]

export type CarouselExportItem = {
  position: number
  mimeType: string | null | undefined
  bytes: Uint8Array
}

export class CarouselExportError extends Error {
  constructor(public readonly code: 'INCOMPLETE' | 'UNSUPPORTED' | 'EMPTY', message: string) {
    super(message)
    this.name = 'CarouselExportError'
  }
}

export function isSupportedCarouselImageMimeType(value: string | null | undefined): value is SupportedCarouselImageMimeType {
  return (SUPPORTED_CAROUSEL_IMAGE_MIME_TYPES as readonly string[]).includes(value ?? '')
}

function extensionForMimeType(mimeType: SupportedCarouselImageMimeType) {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
}

export function orderedCarouselZipEntries(expectedCount: number, items: readonly CarouselExportItem[]) {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) throw new CarouselExportError('EMPTY', 'O carrossel não possui slides para exportar.')
  if (items.length !== expectedCount) throw new CarouselExportError('INCOMPLETE', `Exportação incompleta: esperados ${expectedCount} arquivos, encontrados ${items.length}.`)

  const positions = new Set<number>()
  return Array.from({ length: expectedCount }, (_, index) => {
    const item = items.find((candidate) => candidate.position === index)
    if (!item || positions.has(index)) throw new CarouselExportError('INCOMPLETE', `Exportação incompleta: falta o slide ${index + 1}.`)
    positions.add(index)
    if (!isSupportedCarouselImageMimeType(item.mimeType)) throw new CarouselExportError('UNSUPPORTED', `O slide ${index + 1} não é uma imagem estática suportada.`)
    if (item.bytes.byteLength === 0) throw new CarouselExportError('INCOMPLETE', `O arquivo do slide ${index + 1} está vazio.`)
    const extension = extensionForMimeType(item.mimeType)
    return { name: `${String(index + 1).padStart(2, '0')}-slide-${index + 1}.${extension}`, bytes: item.bytes }
  })
}

export function buildCarouselZip(expectedCount: number, items: readonly CarouselExportItem[]) {
  const entries = orderedCarouselZipEntries(expectedCount, items)
  return zipSync(Object.fromEntries(entries.map((entry) => [entry.name, entry.bytes])), { level: 0 })
}

