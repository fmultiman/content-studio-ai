// IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
//
// The only door through which image code reaches the generic S3 presigner with a key
// that came from an `images` row. The key is proven to be the OWNER's own image object
// first (lib/storage/image-path.ts); the generic helper stays domain-agnostic.

import { createPresignedReadUrl } from '@/lib/storage/s3'
import { isTrustedImageStoragePath, type ImagePathKind } from '@/lib/storage/image-path'

/** A short-lived read URL, or null when the key is not provably the owner's image object. */
export async function presignImageObject(
  ownerUserId: string,
  storagePath: string | null | undefined,
  kind: ImagePathKind,
  options?: Parameters<typeof createPresignedReadUrl>[1],
): Promise<string | null> {
  if (!isTrustedImageStoragePath(ownerUserId, storagePath, kind)) return null
  return createPresignedReadUrl(storagePath, options)
}
