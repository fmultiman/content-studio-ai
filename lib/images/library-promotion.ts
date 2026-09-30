// GENERATED_IMAGE_LIBRARY_PROMOTION_V1
//
// Pure policy for the explicit generated-image -> LibraryFile boundary.
//
// `images` rows are written from the browser, so `storage_path`, `mime_type` and
// `project_id` are CLAIMS, not authority. Before any server-side copy the object key
// is checked against the exact shape the real writers produce (uploadImageToS3):
//
//   users/{user_id}/images/{uuid}/original.(png|jpg|webp)
//
// and the MIME type is derived from the extension, never from the row.

import { checkImageStoragePath } from '@/lib/storage/image-path'

const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const

export type LibraryImageMime = (typeof MIME_BY_EXTENSION)[keyof typeof MIME_BY_EXTENSION]

/** library_files.file_size is a 32-bit INTEGER. */
export const MAX_LIBRARY_IMAGE_BYTES = 2_147_483_647

export type PromotableImage = {
  id: string
  user_id: string
  project_id: string | null
  storage_path: string | null
}

export type ImageLibraryEligibility =
  | { ok: true; storagePath: string; extension: 'png' | 'jpg' | 'webp'; mimeType: LibraryImageMime }
  | { ok: false; code: 'MISSING_PROJECT' | 'MISSING_STORAGE_PATH' | 'INVALID_STORAGE_PATH' }

/** True only for a single original image object directly inside the caller's own images namespace. */
export function isTenantImageStoragePath(storagePath: unknown, userId: unknown): storagePath is string {
  return parseTenantImagePath(storagePath, userId) !== null
}

function parseTenantImagePath(storagePath: unknown, userId: unknown): { extension: 'png' | 'jpg' | 'webp' } | null {
  if (typeof userId !== 'string') return null
  // IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1: one shared, segment-based parser (lib/storage/image-path.ts).
  const check = checkImageStoragePath(userId, storagePath, 'original')
  return check.ok ? { extension: check.extension } : null
}

/** Ownership is established by the caller's session; this only judges what the row claims. */
export function validateGeneratedImageForLibrary(image: PromotableImage, callerUserId: string): ImageLibraryEligibility {
  if (image.user_id !== callerUserId) return { ok: false, code: 'INVALID_STORAGE_PATH' }
  if (!image.project_id) return { ok: false, code: 'MISSING_PROJECT' }
  if (!image.storage_path) return { ok: false, code: 'MISSING_STORAGE_PATH' }
  const parsed = parseTenantImagePath(image.storage_path, callerUserId)
  if (!parsed) return { ok: false, code: 'INVALID_STORAGE_PATH' }
  return { ok: true, storagePath: image.storage_path, extension: parsed.extension, mimeType: MIME_BY_EXTENSION[parsed.extension] }
}

/** Default display name: readable, deterministic. The user can rename it in Arquivos as usual. */
export function generatedImageLibraryFilename(imageId: string, extension: string): string {
  return `imagem-ia-${imageId.slice(0, 8)}.${extension}`
}

/** PostgREST/Postgres signals for "the promotion column does not exist yet" (migration 045 not applied). */
export function isSchemaNotReadyError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /source_image_id/.test(error.message ?? '')
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}
