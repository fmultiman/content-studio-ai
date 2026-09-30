// LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1
//
// The ONE definition of "a storage key that may belong to a LibraryFile row".
//
// A LibraryFile row is user-writable (RLS lets the owner write every column), so
// the row's `storage_path` is a CLAIM, never an authority. Before any server
// code signs, deletes or registers a Library object it must prove the key lives
// in the authenticated owner's own Library namespace.
//
// Factual key families (every Production row, active and trashed, 68/68):
//
//   users/{ownerUserId}/library/{uuid}/{file}                    promotions, renders, uploads
//   users/{ownerUserId}/library/{folder}/.../{uuid}/{file}       uploads into a folder
//
// where each {folder} segment comes from the server-side safe-segment rule
// (`[A-Za-z0-9._-]`, ≤ 96 chars) and `{uuid}/{file}` is always the tail. The same
// rule is enforced in the database by `library_files_storage_path_owner_check`
// (scripts/046_library_files_trust_boundary.sql); a test keeps both in lockstep.
//
// Parsing is segment-based and exact. There is no substring or `includes` test.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const OWNER_SEGMENT_RE = /^[A-Za-z0-9-]{1,64}$/
const FOLDER_SEGMENT_RE = /^[A-Za-z0-9._-]{1,96}$/
const MAX_KEY_LENGTH = 1024
const MAX_FILE_SEGMENT_LENGTH = 255

function isDotSegment(segment: string): boolean {
  return segment === '.' || segment === '..'
}

function isSafeFileSegment(segment: string): boolean {
  if (segment.length === 0 || segment.length > MAX_FILE_SEGMENT_LENGTH) return false
  if (isDotSegment(segment)) return false
  // Control characters and backslashes never appear in a server-generated name.
  return !/[\u0000-\u001f\u007f\\]/.test(segment)
}

export type LibraryPathCheck = { ok: true; path: string } | { ok: false; reason: 'INVALID_STORAGE_PATH' }

const REJECT: LibraryPathCheck = { ok: false, reason: 'INVALID_STORAGE_PATH' }

/**
 * `ownerUserId` is the AUTHENTICATED user (or the owning user of the row being
 * resolved server-side) — never a value taken from the row's own path.
 */
export function checkLibraryStoragePath(ownerUserId: string, value: unknown): LibraryPathCheck {
  // The owner is a server-side identity (auth.users id = a uuid). It must itself be a safe single
  // segment so it can never smuggle a separator into the prefix comparison below.
  if (typeof ownerUserId !== 'string' || !OWNER_SEGMENT_RE.test(ownerUserId)) return REJECT
  if (typeof value !== 'string') return REJECT
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return REJECT
  // A URL, an absolute path or a Windows path is not an object key.
  if (value.startsWith('/') || value.includes('://') || value.includes('\\') || value.includes('?') || value.includes('#')) return REJECT

  const segments = value.split('/')
  // users / {owner} / library / {uuid} / {file}  => at least 5 segments.
  if (segments.length < 5) return REJECT
  if (segments.some((segment) => segment.length === 0)) return REJECT
  if (segments[0] !== 'users') return REJECT
  if (segments[1] !== ownerUserId) return REJECT
  if (segments[2] !== 'library') return REJECT

  const fileSegment = segments[segments.length - 1]
  const uuidSegment = segments[segments.length - 2]
  if (!UUID_RE.test(uuidSegment)) return REJECT
  if (!isSafeFileSegment(fileSegment)) return REJECT

  const folderSegments = segments.slice(3, segments.length - 2)
  for (const segment of folderSegments) {
    if (isDotSegment(segment)) return REJECT
    if (!FOLDER_SEGMENT_RE.test(segment)) return REJECT
  }

  return { ok: true, path: value }
}

export function isTrustedLibraryStoragePath(ownerUserId: string, value: unknown): value is string {
  return checkLibraryStoragePath(ownerUserId, value).ok
}

/**
 * Rows for a server-side consumer (render worker claim, downloads): a row whose
 * path is not provably the owner's is returned WITHOUT its path, so every
 * downstream resolver treats it exactly like a missing file and fails closed.
 */
export function withTrustedStoragePaths<T extends { user_id: string; storage_path: string | null }>(rows: readonly T[]): T[] {
  return rows.map((row) => (isTrustedLibraryStoragePath(row.user_id, row.storage_path) ? row : { ...row, storage_path: null }))
}

/**
 * The database twin of the rule above, as the PostgreSQL regex the CHECK
 * constraint uses (`$1` = the owner uuid text). Kept here so a test can prove
 * the TypeScript validator and the migration agree on the namespace.
 */
export const LIBRARY_STORAGE_PATH_SQL_TAIL = '/library/([A-Za-z0-9._-]{1,96}/)*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
