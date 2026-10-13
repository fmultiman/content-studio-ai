// Shared Video source authorization; each provider supplies its reference media policy.
// Only durable owner/project-proven objects are read. Provider/public URLs are never fetched.
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveI2vSource } from '@/lib/video-generation/i2v-source-media'
import { headS3Object, openS3ObjectStream } from '@/lib/storage/s3'
import { sniffImageMime } from '@/lib/security/safe-remote-image'
import type { GeminiImageModel } from '@/lib/providers/gemini/image-models'
import type { ImageReference } from './session'

export class ImageReferenceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export type LoadedImageReference = {
  bytes: Buffer
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  provenance: { type: ImageReference['type']; id: string; sha256: string; mimeType: string; byteLength: number; width: number; height: number }
}

export type ReferenceMediaCapabilities = {
  maxReferences: number; maxBytes: number; mimeTypes: readonly string[];
  maxDimension: number; maxPixels?: number;
}

const sizeLimitMessage = (caps: ReferenceMediaCapabilities, legacyGemini = false) => legacyGemini
  ? 'A referência deve ter até 10 MB.' : `A referência deve ter até ${caps.maxBytes / (1024 * 1024)} MiB.`

export async function validateImageReferenceBytes(bytes: Buffer, caps: ReferenceMediaCapabilities, legacyGemini = false) {
  if (!bytes.length || bytes.length > caps.maxBytes) throw new ImageReferenceError(422, 'SOURCE_IMAGE_TOO_LARGE', sizeLimitMessage(caps, legacyGemini))
  const mimeType = sniffImageMime(bytes)
  if (!mimeType || !caps.mimeTypes.includes(mimeType)) throw new ImageReferenceError(422, 'SOURCE_IMAGE_FORMAT_UNSUPPORTED', 'Use uma referência PNG, JPEG ou WebP.')
  try {
    const image = sharp(bytes, { limitInputPixels: caps.maxPixels ?? caps.maxDimension ** 2, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }
    if (metadata.format !== formats[mimeType] || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error('Invalid image')
    if (metadata.width > caps.maxDimension || metadata.height > caps.maxDimension) throw new ImageReferenceError(422, 'SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED', `A referência deve ter até ${caps.maxDimension} pixels por lado.`)
    // Metadata alone accepts complete headers with truncated pixel data. Decode before spending,
    // using stats so validation does not allocate a second full raw output buffer.
    await image.stats()
    return { mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp', width: metadata.width, height: metadata.height }
  } catch (error) {
    if (error instanceof ImageReferenceError) throw error
    throw new ImageReferenceError(422, 'SOURCE_IMAGE_FORMAT_UNSUPPORTED', 'A referência não é uma imagem válida.')
  }
}

export async function loadImageReferences(input: {
  db: SupabaseClient; userId: string; projectId: string | null; references: readonly ImageReference[]; capabilities: ReferenceMediaCapabilities
}, legacyGemini = false): Promise<LoadedImageReference[]> {
  const caps = input.capabilities
  if (input.references.length > caps.maxReferences) throw new ImageReferenceError(400, 'SOURCE_REFERENCE_LIMIT', 'Use uma referência por geração.')
  if (input.references.length && !input.projectId) throw new ImageReferenceError(400, 'SOURCE_PROJECT_REQUIRED', 'Selecione um projeto para usar uma referência.')
  const images: LoadedImageReference[] = []
  for (const reference of input.references) {
    const resolved = await resolveI2vSource(input.db, {
      userId: input.userId, projectId: input.projectId!, deliver: 'bytes',
      ...(reference.type === 'image' ? { sourceImageId: reference.id } : { sourceLibraryFileId: reference.id }),
    })
    if (!resolved.ok) throw new ImageReferenceError(resolved.status, String(resolved.body.code ?? 'SOURCE_NOT_AUTHORIZED'), 'Referência indisponível neste projeto.')
    const key = resolved.locator.storageKey
    // Legacy provider/data URLs have no durable object and cannot become Gemini inputs.
    if (!key) throw new ImageReferenceError(422, 'SOURCE_MEDIA_UNAVAILABLE', 'Salve a imagem na Biblioteca antes de usá-la como referência.')
    const maxBytes = caps.maxBytes
    let bytes: Buffer
    try {
      const head = await headS3Object(key)
      if (!head) throw new Error('Object missing')
      if (head.size > maxBytes) throw new ImageReferenceError(422, 'SOURCE_IMAGE_TOO_LARGE', sizeLimitMessage(caps, legacyGemini))
      const object = await openS3ObjectStream(key)
      if (!object) throw new Error('Object missing')
      const chunks: Buffer[] = []
      let size = 0
      try {
        for await (const chunk of object.stream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > maxBytes) throw new ImageReferenceError(422, 'SOURCE_IMAGE_TOO_LARGE', sizeLimitMessage(caps, legacyGemini))
          chunks.push(buffer)
        }
      } finally { object.stream.destroy() }
      bytes = Buffer.concat(chunks)
    } catch (error) {
      if (error instanceof ImageReferenceError) throw error
      throw new ImageReferenceError(422, 'SOURCE_MEDIA_UNAVAILABLE', 'Não foi possível ler a referência. Escolha outra imagem.')
    }
    const media = await validateImageReferenceBytes(bytes, caps, legacyGemini)
    images.push({ bytes, mimeType: media.mimeType, provenance: {
      type: reference.type, id: reference.id, ...media, byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    } })
  }
  return images
}

// Compatibility wrappers retain Gemini's limits, messages and call sites.
export function validateGeminiReferenceBytes(bytes: Buffer, model: GeminiImageModel) {
  return validateImageReferenceBytes(bytes, model.referenceCapabilities, true)
}

export function loadGeminiImageReferences(input: {
  db: SupabaseClient; userId: string; projectId: string | null; references: readonly ImageReference[]; model: GeminiImageModel
}) {
  return loadImageReferences({ ...input, capabilities: input.model.referenceCapabilities }, true)
}
