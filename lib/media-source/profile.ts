import { I2V_SOURCE_MIME_TYPES, i2vMimeFromFile } from '@/lib/video-generation/i2v-source'

/** The shared chooser defaults to Video's verified PNG/JPEG policy. */
export type ImageSourceProfile = 'video-i2v' | 'image-reference' | 'openai-image-reference'
export const IMAGE_REFERENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024
export const OPENAI_IMAGE_REFERENCE_MAX_BYTES = 20 * 1024 * 1024

export function parseImageSourceProfile(raw: unknown): ImageSourceProfile | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'video-i2v') return 'video-i2v'
  return raw === 'image-reference' || raw === 'openai-image-reference' ? raw : null
}

export function sourceMimeTypes(profile: ImageSourceProfile): readonly string[] {
  return profile === 'video-i2v' ? I2V_SOURCE_MIME_TYPES : IMAGE_REFERENCE_MIME_TYPES
}

/** Video keeps its existing chooser behavior; provider transport validation owns its byte cap. */
export function sourceMaxBytes(profile: ImageSourceProfile): number | null {
  if (profile === 'video-i2v') return null
  return profile === 'openai-image-reference' ? OPENAI_IMAGE_REFERENCE_MAX_BYTES : IMAGE_REFERENCE_MAX_BYTES
}

export function sourceFormatErrorCopy(profile: ImageSourceProfile): string {
  return profile === 'video-i2v'
    ? 'Formato não compatível com Image → Vídeo. Use uma imagem PNG ou JPEG.'
    : 'Use uma imagem PNG, JPEG ou WebP.'
}

export function sourceSizeErrorCopy(profile: ImageSourceProfile): string {
  const maxBytes = sourceMaxBytes(profile)
  return maxBytes === null ? 'A imagem não pode estar vazia.' : `A imagem de referência deve ter até ${maxBytes / (1024 * 1024)} MiB.`
}

export function sourceAcceptedFormatsCopy(profile: ImageSourceProfile): string {
  const maxBytes = sourceMaxBytes(profile)
  return maxBytes === null
    ? 'Formatos aceitos para Image → Vídeo: PNG e JPEG.'
    : `Formatos aceitos: PNG, JPEG e WebP, até ${maxBytes / (1024 * 1024)} MiB.`
}

export function sourceMimeFromFile(file: { name: string; type: string }, profile: ImageSourceProfile): string | null {
  const videoMime = i2vMimeFromFile(file)
  if (videoMime || profile === 'video-i2v') return videoMime
  const type = file.type.toLowerCase()
  return type === 'image/webp' || (!type && file.name.toLowerCase().endsWith('.webp')) ? 'image/webp' : null
}
