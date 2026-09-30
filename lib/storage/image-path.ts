// IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
//
// The ONE definition of "a storage key that may belong to a generated `images` row".
//
// `images` rows are written straight from the browser (RLS only compares user_id), so
// `storage_path` / `thumbnail_path` are CLAIMS, never authority. Before any server code
// signs, copies or forwards an image object it must prove the key is one the real writer
// (`uploadImageToS3`) could have produced for THIS owner.
//
// Factual key family (Production: 18/18 stored images; 0 other shapes):
//
//   users/{ownerUserId}/images/{uuid}/original.(png|jpg|webp)     storage_path
//   users/{ownerUserId}/images/{uuid}/thumb.webp                  thumbnail_path
//
// A NULL storage_path is a valid legacy representation (provider URL or data: URL only,
// 8/26 rows) and is NOT judged here — callers keep their existing behavior for it.
//
// The same rule is enforced in the database by `images_storage_path_owner_check` and
// `images_thumbnail_path_owner_check` (scripts/047_images_storage_trust_boundary.sql);
// a test keeps both in lockstep. Parsing is segment-based and exact: no `startsWith`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const OWNER_SEGMENT_RE = /^[A-Za-z0-9-]{1,64}$/
const ORIGINAL_FILE_RE = /^original\.(png|jpg|webp)$/
const THUMBNAIL_FILE = 'thumb.webp'
const MAX_KEY_LENGTH = 512

export type ImagePathKind = 'original' | 'thumbnail'

export type ImagePathCheck =
  | { ok: true; path: string; kind: ImagePathKind; extension: 'png' | 'jpg' | 'webp' }
  | { ok: false; reason: 'INVALID_STORAGE_PATH' }

const REJECT: ImagePathCheck = { ok: false, reason: 'INVALID_STORAGE_PATH' }

/**
 * `ownerUserId` is the AUTHENTICATED user, or the owning user of the row resolved
 * server-side — never a value read out of the path itself.
 * `expected` narrows the key to the original object or to the thumbnail; default is either.
 */
export function checkImageStoragePath(ownerUserId: string, value: unknown, expected?: ImagePathKind): ImagePathCheck {
  if (typeof ownerUserId !== 'string' || !OWNER_SEGMENT_RE.test(ownerUserId)) return REJECT
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH) return REJECT
  // URLs, absolute paths, Windows paths, encoded separators/dots and control characters are not object keys.
  if (value.startsWith('/') || value.includes('://') || value.includes('\\') || value.includes('%')) return REJECT
  if (/[\u0000-\u001f\u007f?#]/.test(value)) return REJECT

  const segments = value.split('/')
  if (segments.length !== 5) return REJECT
  const [root, owner, namespace, blob, file] = segments
  if (root !== 'users' || owner !== ownerUserId || namespace !== 'images') return REJECT
  if (!UUID_RE.test(blob)) return REJECT

  const original = ORIGINAL_FILE_RE.exec(file)
  if (original) {
    if (expected === 'thumbnail') return REJECT
    return { ok: true, path: value, kind: 'original', extension: original[1] as 'png' | 'jpg' | 'webp' }
  }
  if (file === THUMBNAIL_FILE) {
    if (expected === 'original') return REJECT
    return { ok: true, path: value, kind: 'thumbnail', extension: 'webp' }
  }
  return REJECT
}

export function isTrustedImageStoragePath(ownerUserId: string, value: unknown, expected?: ImagePathKind): value is string {
  return checkImageStoragePath(ownerUserId, value, expected).ok
}

/**
 * The PostgreSQL regex tails the CHECK constraints use (`'^users/' || user_id::text || <tail>`).
 * Exported so a test can prove the TypeScript rule and the migration agree.
 */
export const IMAGE_ORIGINAL_SQL_TAIL = '/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/original\\.(png|jpg|webp)$'
export const IMAGE_THUMBNAIL_SQL_TAIL = '/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/thumb\\.webp$'
