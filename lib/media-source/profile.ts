import { I2V_SOURCE_MIME_TYPES, i2vMimeFromFile } from '@/lib/video-generation/i2v-source'

/** The shared chooser defaults to Video's verified PNG/JPEG policy. */
export type ImageSourceProfile = 'video-i2v' | 'image-reference'
export const IMAGE_REFERENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_REFERENCE_MAX_BYTES = 10 * 1024 * 1024

export function parseImageSourceProfile(raw: unknown): ImageSourceProfile | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'video-i2v') return 'video-i2v'
  return raw === 'image-reference' ? raw : null
}

export function sourceMimeTypes(profile: ImageSourceProfile): readonly string[] {
  return profile === 'image-reference' ? IMAGE_REFERENCE_MIME_TYPES : I2V_SOURCE_MIME_TYPES
}

export function sourceMimeFromFile(file: { name: string; type: string }, profile: ImageSourceProfile): string | null {
  const videoMime = i2vMimeFromFile(file)
  if (videoMime || profile !== 'image-reference') return videoMime
  const type = file.type.toLowerCase()
  return type === 'image/webp' || (!type && file.name.toLowerCase().endsWith('.webp')) ? 'image/webp' : null
}
