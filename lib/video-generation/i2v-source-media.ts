// VIDEO_MCP_I2V_SOURCE_TRANSPORT_V1
//
// Trusted Image -> Video source resolution. The browser only ever names a stable `sourceImageId` OR
// `sourceLibraryFileId`; everything else is re-derived here on the server:
//
//   resolveI2vSource        the owner / Project / kind / deleted / storage-key trust chain (LIBRARY_FILE_REGISTRATION_TRUST_
//                           HARDENING_V1 + IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1). Moved here UNCHANGED from
//                           POST /api/video-generations so REST keeps exactly the URL it always sent.
//   loadTrustedI2vSourceImage   MCP only: reads the image BYTES server-side from the proven key, then applies the final
//                           content policy (signature MIME, size, dimensions). The provider can never fetch our private
//                           storage, so these bytes are what `file_upload` receives. A Content Studio presigned URL, a
//                           browser URL and a data URL are NEVER handed to Kling.
//
// Gallery, Arquivos and Enviar are all LibraryFiles, so they resolve identically: the server trusts the domain record,
// never the UI label that produced the id. There is no arbitrary remote fetch anywhere in here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { headS3Object, readS3Object } from '@/lib/storage/s3'
import { presignImageObject } from '@/lib/storage/image-storage'
import { presignLibraryRead } from '@/lib/storage/library-storage'
import { isTrustedImageStoragePath } from '@/lib/storage/image-path'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'
import { checkLibrarySourceFile, LIBRARY_SOURCE_REJECTION_MESSAGE } from '@/lib/video-generation/i2v-source'
import {
  decodeLegacyImageDataUrl,
  i2vUploadFilename,
  I2V_MCP_MAX_SOURCE_BYTES,
  validateI2vSourceBytes,
  type I2vMediaFailureCode,
  type I2vSourceMime,
} from '@/lib/video-generation/i2v-media-policy'

export interface I2vSourceLocator {
  kind: 'image' | 'library'
  id: string
  ownerUserId: string
  /** Owner-proven storage key: the ONLY thing bytes are ever read from. Null for legacy rows that carry none. */
  storageKey: string | null
  /** Legacy `images.image_url`. Only a bounded `data:image/(png|jpeg);base64,` value is ever decoded; a URL is never fetched. */
  legacyUrl: string | null
  displayName: string | null
}

export type I2vSourceResolution =
  | {
      ok: true
      /** The externally fetchable URL REST has always received (presigned, or the legacy stored value). */
      restSourceUrl: string
      locator: I2vSourceLocator
    }
  | { ok: false; status: number; body: Record<string, unknown> }

function failure(status: number, body: Record<string, unknown>): I2vSourceResolution {
  return { ok: false, status, body }
}

export async function resolveI2vSource(
  supabase: SupabaseClient,
  params: {
    userId: string
    projectId: string
    sourceImageId?: string | null
    sourceLibraryFileId?: string | null
    /**
     * 'url'   (REST): also presign the URL the REST adapter has always received.
     * 'bytes' (MCP):  prove the storage key only. NO Content Studio presigned URL is ever created for Kling: it cannot
     *                 fetch our storage, and the bytes are uploaded through file_upload instead.
     */
    deliver?: 'url' | 'bytes'
  },
): Promise<I2vSourceResolution> {
  const { userId, projectId, sourceImageId, sourceLibraryFileId } = params
  const signUrls = (params.deliver ?? 'url') === 'url'

  if (sourceImageId) {
    const { data: image, error: imageError } = await supabase
      .from('images')
      .select('*')
      .eq('id', sourceImageId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .single()

    if (imageError || !image) {
      return failure(403, { error: 'Source image not found or not owned by user in this project' })
    }
    // IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1: `images` rows are browser-written, so the stored
    // key is a claim. Only the owner's own image key is signed; a forged key is refused before any
    // provider call. A NULL key (legacy provider/data URL representation) keeps its existing behavior.
    let restSourceUrl: string
    if (image.storage_path) {
      const presigned = signUrls ? await presignImageObject(image.user_id, image.storage_path, 'original') : null
      if (!presigned && !isTrustedImageStoragePath(image.user_id, image.storage_path, 'original')) {
        return failure(422, { error: 'A imagem de origem não está disponível para envio. Escolha outra imagem.', code: 'SOURCE_MEDIA_UNAVAILABLE' })
      }
      restSourceUrl = presigned || image.image_url
    } else {
      restSourceUrl = image.image_url
    }
    return {
      ok: true,
      restSourceUrl: signUrls ? restSourceUrl || '' : '',
      locator: {
        kind: 'image',
        id: image.id,
        ownerUserId: image.user_id,
        storageKey: image.storage_path && isTrustedImageStoragePath(image.user_id, image.storage_path, 'original') ? image.storage_path : null,
        legacyUrl: typeof image.image_url === 'string' ? image.image_url : null,
        displayName: typeof image.user_input === 'string' ? image.user_input : null,
      },
    }
  }

  if (sourceLibraryFileId) {
    const { data: file, error: fileError } = await supabase
      .from('library_files')
      .select('*')
      .eq('id', sourceLibraryFileId)
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .single()

    if (fileError || !file) {
      return failure(403, { error: 'Source library file not found or not owned by user in this project' })
    }
    // Owner + project are proven above; the row itself must also be a live image.
    const rejection = checkLibrarySourceFile(file)
    if (rejection) {
      return failure(422, { error: LIBRARY_SOURCE_REJECTION_MESSAGE[rejection], code: rejection })
    }
    // LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1: the row's storage_path is a claim. Only the
    // owner's own Library key is signed, and the recorded public_url (also user-writable) is
    // never a fallback for a key that failed that proof.
    let restSourceUrl: string
    if (file.storage_path) {
      if (!isTrustedLibraryStoragePath(file.user_id, file.storage_path)) {
        return failure(422, { error: 'A imagem de origem não está disponível para envio. Escolha outra imagem.', code: 'SOURCE_MEDIA_UNAVAILABLE' })
      }
      const presigned = signUrls ? await presignLibraryRead(file) : null
      restSourceUrl = presigned || file.public_url || ''
    } else {
      restSourceUrl = file.public_url || ''
    }
    return {
      ok: true,
      restSourceUrl: signUrls ? restSourceUrl : '',
      locator: {
        kind: 'library',
        id: file.id,
        ownerUserId: file.user_id,
        storageKey: file.storage_path && isTrustedLibraryStoragePath(file.user_id, file.storage_path) ? file.storage_path : null,
        legacyUrl: null,
        displayName: typeof file.name === 'string' ? file.name : null,
      },
    }
  }

  return failure(400, { error: 'A source image is required for image_to_video.' })
}

// ---------------------------------------------------------------------------------------------------------------------
// Bytes (MCP only)
// ---------------------------------------------------------------------------------------------------------------------

export interface TrustedI2vSourceImage {
  bytes: Uint8Array
  mimeType: I2vSourceMime
  filename: string
  sourceKind: I2vSourceLocator['kind']
  sourceId: string
}

export type TrustedI2vSourceResult = { ok: true; image: TrustedI2vSourceImage } | { ok: false; code: I2vMediaFailureCode; reason: string }

export interface I2vSourceByteDependencies {
  headObject?: (key: string) => Promise<{ size: number } | null>
  readObject?: (key: string, options: { maxBytes: number }) => Promise<{ bytes: Uint8Array } | null>
}

export const I2V_MEDIA_FAILURE_MESSAGE: Record<I2vMediaFailureCode, string> = {
  SOURCE_IMAGE_UNAVAILABLE: 'A imagem de origem não está disponível para envio. Escolha outra imagem.',
  SOURCE_IMAGE_FORMAT_UNSUPPORTED: 'Formato de imagem não compatível com Image → Vídeo. Use uma imagem PNG ou JPEG.',
  SOURCE_IMAGE_TOO_LARGE: 'A imagem de origem é grande demais para Image → Vídeo (máximo de 30 MB).',
  SOURCE_IMAGE_DIMENSIONS_UNSUPPORTED: 'A imagem de origem precisa ter menos de 4K e proporção de no máximo 1:2 (ou 2:1).',
}

export async function loadTrustedI2vSourceImage(locator: I2vSourceLocator, deps: I2vSourceByteDependencies = {}): Promise<TrustedI2vSourceResult> {
  const head = deps.headObject ?? (async (key: string) => headS3Object(key))
  const read = deps.readObject ?? (async (key: string, options: { maxBytes: number }) => readS3Object(key, options))

  let bytes: Uint8Array | null = null

  if (locator.storageKey) {
    // Defense in depth: the key is proven to be the OWNER's own object again right here, whoever called this.
    const trusted =
      locator.kind === 'image'
        ? isTrustedImageStoragePath(locator.ownerUserId, locator.storageKey, 'original')
        : isTrustedLibraryStoragePath(locator.ownerUserId, locator.storageKey)
    if (!trusted) return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'storage key is not the owner’s' }

    try {
      // Size first: never pull an oversized object into memory just to reject it.
      const meta = await head(locator.storageKey)
      if (!meta) return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'object not found' }
      if (meta.size > I2V_MCP_MAX_SOURCE_BYTES) return { ok: false, code: 'SOURCE_IMAGE_TOO_LARGE', reason: `${meta.size} bytes` }
      const object = await read(locator.storageKey, { maxBytes: I2V_MCP_MAX_SOURCE_BYTES })
      bytes = object?.bytes ?? null
    } catch {
      return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'storage read failed' }
    }
  } else if (locator.kind === 'image' && locator.legacyUrl) {
    // Legacy rows without a storage key: a bounded data:image URL is normalized to bytes; an external URL is NOT
    // trusted media and is never fetched (no arbitrary remote fetch, SSRF boundary intact).
    bytes = decodeLegacyImageDataUrl(locator.legacyUrl)
    if (!bytes) return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'legacy image is not a bounded data URL' }
  } else {
    return { ok: false, code: 'SOURCE_IMAGE_UNAVAILABLE', reason: 'no trusted storage key' }
  }

  const verdict = validateI2vSourceBytes(bytes)
  if (!verdict.ok) return { ok: false, code: verdict.code, reason: verdict.reason }

  return {
    ok: true,
    image: {
      bytes: bytes as Uint8Array,
      mimeType: verdict.mimeType,
      filename: i2vUploadFilename(locator.displayName, verdict.mimeType),
      sourceKind: locator.kind,
      sourceId: locator.id,
    },
  }
}
