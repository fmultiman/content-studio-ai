// LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1
//
// The only doors through which Library code reaches the generic S3 helpers.
// Every operation proves the key belongs to the OWNER of the row first
// (lib/storage/library-path.ts); the generic helpers stay untouched so no other
// domain is affected.

import { createPresignedReadUrl, deleteS3Object } from '@/lib/storage/s3'
import { isTrustedLibraryStoragePath } from '@/lib/storage/library-path'

type OwnedLibraryObject = { user_id: string; storage_path: string | null | undefined }

/** A short-lived read URL, or null when the key is not provably the owner's Library object. */
export async function presignLibraryRead(
  file: OwnedLibraryObject,
  options?: Parameters<typeof createPresignedReadUrl>[1],
): Promise<string | null> {
  if (!isTrustedLibraryStoragePath(file.user_id, file.storage_path)) return null
  return createPresignedReadUrl(file.storage_path, options)
}

/** Deletes the object only when the key is provably the owner's Library object. Returns whether it deleted. */
export async function deleteLibraryObject(file: OwnedLibraryObject): Promise<boolean> {
  if (!isTrustedLibraryStoragePath(file.user_id, file.storage_path)) return false
  return deleteS3Object(file.storage_path)
}
