// VIDEO_GENERATION_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
//
// The ONE definition of where a generated video lives in app-owned storage,
// and of whether a stored `storage_path` may be trusted for presigning.
//
// `video_generations.storage_path` is a database string. It is written only by
// the server-side completion boundary (see completion.ts), but the read side
// must not depend on that alone: before any presigned URL is issued, the path
// is checked against the namespace derived from the row's OWN owner and
// project. A path outside that namespace is never signed.
//
// Canonical key shape (all rows, historical and current):
//
//   {user_id}/videos/ai/{project_id}/{file}.mp4
//
//   - current rows:    {file} = {generation_id}
//   - historical rows: {file} = {13-digit ms timestamp}-{random}
//     (written before completion used a deterministic name)
//
// Both are a single path segment, so the check does not pin the file name to
// the generation id: it pins the tenant + project namespace and requires
// exactly one safe file segment below it.

const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/

/** Namespace prefix (no trailing slash) under which one project's generated videos are stored. */
export function videoStoragePrefix(userId: string, projectId: string): string {
  return `${userId}/videos/ai/${projectId}`
}

/**
 * True only when `storagePath` is a single `.mp4` object directly inside the
 * owner's own `{user_id}/videos/ai/{project_id}/` namespace. Fails closed on
 * anything else: missing ids, foreign tenants, traversal, nested folders,
 * encoded separators, control characters or a non-string value.
 */
export function isTenantVideoStoragePath(
  storagePath: unknown,
  owner: { user_id?: unknown; project_id?: unknown },
): storagePath is string {
  if (typeof storagePath !== 'string' || typeof owner.user_id !== 'string' || typeof owner.project_id !== 'string') return false
  if (!owner.user_id || !owner.project_id) return false
  // An id containing a separator could widen the namespace: refuse it outright.
  if (/[\\/]/.test(owner.user_id) || /[\\/]/.test(owner.project_id)) return false

  const prefix = `${videoStoragePrefix(owner.user_id, owner.project_id)}/`
  if (!storagePath.startsWith(prefix)) return false

  const file = storagePath.slice(prefix.length)
  return FILE_SEGMENT.test(file) && !file.includes('..')
}
