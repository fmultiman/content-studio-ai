import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IMAGE_ORIGINAL_SQL_TAIL,
  IMAGE_THUMBNAIL_SQL_TAIL,
  checkImageStoragePath,
  isTrustedImageStoragePath,
} from '@/lib/storage/image-path'
import { isTenantImageStoragePath, validateGeneratedImageForLibrary } from '@/lib/images/library-promotion'
import { safeKeyExtension } from '@/lib/storage/s3'

// IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1 — synthetic users/keys only.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const BLOB = '33333333-3333-4333-8333-333333333333'

const original = (ext = 'png', owner = OWNER, blob = BLOB) => `users/${owner}/images/${blob}/original.${ext}`
const thumb = (owner = OWNER, blob = BLOB) => `users/${owner}/images/${blob}/thumb.webp`

describe('checkImageStoragePath — the real generated-image key family', () => {
  it.each(['png', 'jpg', 'webp'])('allows the owner’s own original.%s', (ext) => {
    expect(checkImageStoragePath(OWNER, original(ext))).toEqual({ ok: true, path: original(ext), kind: 'original', extension: ext })
  })

  it('allows the owner’s own thumbnail, and narrows by expected kind', () => {
    expect(checkImageStoragePath(OWNER, thumb())).toEqual({ ok: true, path: thumb(), kind: 'thumbnail', extension: 'webp' })
    expect(checkImageStoragePath(OWNER, thumb(), 'thumbnail').ok).toBe(true)
    expect(checkImageStoragePath(OWNER, thumb(), 'original').ok).toBe(false)
    expect(checkImageStoragePath(OWNER, original(), 'original').ok).toBe(true)
    expect(checkImageStoragePath(OWNER, original(), 'thumbnail').ok).toBe(false)
  })

  it('rejects another user’s canonical image namespace', () => {
    expect(checkImageStoragePath(OWNER, original('png', OTHER)).ok).toBe(false)
    expect(checkImageStoragePath(OWNER, thumb(OTHER)).ok).toBe(false)
  })

  it.each([
    ['a lookalike owner prefix (same start, longer id)', `users/${OWNER}x/images/${BLOB}/original.png`],
    ['a lookalike owner prefix (owner as a prefix of the next segment)', `users/${OWNER}-evil/images/${BLOB}/original.png`],
    ['traversal escaping to another tenant', `users/${OWNER}/images/../${OTHER}/images/${BLOB}/original.png`],
    ['traversal inside the blob position', `users/${OWNER}/images/../original.png`],
    ['a single-dot segment', `users/${OWNER}/images/./${BLOB}/original.png`],
    ['a dots-only file name', `users/${OWNER}/images/${BLOB}/..`],
    ['a dots-only blob segment', `users/${OWNER}/images/../original.png`],
    ['percent-encoded traversal', `users/${OWNER}/images/%2e%2e/${OTHER}/original.png`],
    ['percent-encoded separator', `users/${OWNER}/images/${BLOB}%2foriginal.png`],
    ['an https URL', `https://s3.example.test/bucket/${original()}`],
    ['an absolute path', `/${original()}`],
    ['a Windows path', original().replace(/\//g, '\\')],
    ['a filesystem path', '/etc/passwd'],
    ['a query string', `${original()}?X-Amz-Signature=abc`],
    ['a fragment', `${original()}#x`],
    ['another namespace (library)', `users/${OWNER}/library/${BLOB}/original.png`],
    ['another namespace (posts)', `users/${OWNER}/posts/${BLOB}/original.png`],
    ['another namespace (videos)', `users/${OWNER}/videos/ai/${BLOB}/v.mp4`],
    ['an extra folder segment', `users/${OWNER}/images/extra/${BLOB}/original.png`],
    ['a missing blob', `users/${OWNER}/images/original.png`],
    ['a non-uuid blob', `users/${OWNER}/images/not-a-uuid/original.png`],
    ['an uppercase uuid (the writer never emits one)', `users/${OWNER}/images/ABCDEFAB-1234-4ABC-8DEF-ABCDEFABCDEF/original.png`],
    ['a file name that is not original/thumb', `users/${OWNER}/images/${BLOB}/secret.png`],
    ['an extra suffix', `users/${OWNER}/images/${BLOB}/original.png.exe`],
    ['an unsupported extension', `users/${OWNER}/images/${BLOB}/original.gif`],
    ['a trailing slash', `users/${OWNER}/images/${BLOB}/original.png/`],
    ['an empty segment', `users/${OWNER}/images//${BLOB}/original.png`],
    ['a control character', `users/${OWNER}/images/${BLOB}/original\u0000.png`],
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
    ['overlong', `users/${OWNER}/images/${BLOB}/${'a'.repeat(600)}`],
  ])('rejects %s', (_name, value) => {
    expect(checkImageStoragePath(OWNER, value)).toEqual({ ok: false, reason: 'INVALID_STORAGE_PATH' })
  })

  it('rejects an owner id that is not a safe single segment', () => {
    expect(checkImageStoragePath('', `users//images/${BLOB}/original.png`).ok).toBe(false)
    expect(checkImageStoragePath(`${OWNER}/images`, `users/${OWNER}/images/images/${BLOB}/original.png`).ok).toBe(false)
    expect(checkImageStoragePath('..', `users/../images/${BLOB}/original.png`).ok).toBe(false)
  })

  it('does not decide by prefix: a startsWith-style key with a traversal tail does not pass', () => {
    const forged = `users/${OWNER}/images/../${OTHER}/images/${BLOB}/original.png`
    expect(forged.startsWith(`users/${OWNER}/images/`)).toBe(true) // what the old check looked at
    expect(isTrustedImageStoragePath(OWNER, forged)).toBe(false)
  })
})

describe('the Image → Library promotion policy uses the same parser', () => {
  it('keeps accepting the owner’s original and keeps refusing everything the parser refuses', () => {
    expect(isTenantImageStoragePath(original(), OWNER)).toBe(true)
    expect(isTenantImageStoragePath(thumb(), OWNER)).toBe(false) // promotion copies the original only
    expect(isTenantImageStoragePath(original('png', OTHER), OWNER)).toBe(false)
    expect(isTenantImageStoragePath(`users/${OWNER}/images/../${OTHER}/images/${BLOB}/original.png`, OWNER)).toBe(false)
    const row = { id: 'i', user_id: OWNER, project_id: 'p', storage_path: `users/${OTHER}/images/${BLOB}/original.png` }
    expect(validateGeneratedImageForLibrary(row, OWNER)).toEqual({ ok: false, code: 'INVALID_STORAGE_PATH' })
  })
})

describe('migration 047 stays in lockstep with the TypeScript rule', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', '047_images_storage_trust_boundary.sql'), 'utf8')

  it('uses the same namespace tails as the parser', () => {
    expect(sql).toContain(`'^users/' || user_id::text || '${IMAGE_ORIGINAL_SQL_TAIL}'`)
    expect(sql).toContain(`'^users/' || user_id::text || '${IMAGE_THUMBNAIL_SQL_TAIL}'`)
  })

  it('NULL keys (legacy provider/data URL rows) stay valid, and existing rows are validated', () => {
    expect(sql).toMatch(/storage_path IS NULL\s+OR storage_path ~/)
    expect(sql).toMatch(/thumbnail_path IS NULL\s+OR thumbnail_path ~/)
    expect(sql).toMatch(/VALIDATE CONSTRAINT images_storage_path_owner_check/)
    expect(sql).toMatch(/VALIDATE CONSTRAINT images_thumbnail_path_owner_check/)
  })

  it('the SQL tails accept/reject the same corpus as the parser (JS RegExp parity)', () => {
    const original = new RegExp(`^users/${OWNER}${IMAGE_ORIGINAL_SQL_TAIL}`)
    const thumbnail = new RegExp(`^users/${OWNER}${IMAGE_THUMBNAIL_SQL_TAIL}`)
    const corpus = [
      [`users/${OWNER}/images/${BLOB}/original.png`, 'original'],
      [`users/${OWNER}/images/${BLOB}/original.jpg`, 'original'],
      [`users/${OWNER}/images/${BLOB}/original.webp`, 'original'],
      [`users/${OWNER}/images/${BLOB}/thumb.webp`, 'thumbnail'],
      [`users/${OTHER}/images/${BLOB}/original.png`, 'original'],
      [`users/${OWNER}/images/../${OTHER}/images/${BLOB}/original.png`, 'original'],
      [`users/${OWNER}/images/${BLOB}/original.gif`, 'original'],
      [`users/${OWNER}/library/${BLOB}/original.png`, 'original'],
      [`users/${OWNER}/images/extra/${BLOB}/original.png`, 'original'],
      [`users/${OWNER}/images/${BLOB}/thumb.png`, 'thumbnail'],
    ] as const
    for (const [path, kind] of corpus) {
      const sqlOk = (kind === 'original' ? original : thumbnail).test(path)
      expect(sqlOk, path).toBe(checkImageStoragePath(OWNER, path, kind).ok)
    }
  })

  it('checks Project ownership in the database and does not revoke the generation writer’s columns', () => {
    expect(sql).toMatch(/p\.id = NEW\.project_id AND p\.user_id = NEW\.user_id/)
    expect(sql).not.toMatch(/REVOKE (UPDATE|INSERT) ON images/i)
    expect(sql).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE|INSERT INTO|UPDATE images SET)\b/i)
    expect(sql.match(/ALTER TABLE (\w+)/g)?.every((statement) => statement === 'ALTER TABLE images')).toBe(true)
  })
})

describe('upload key extension cannot shape the key', () => {
  it('keeps every valid current extension (lowercased)', () => {
    expect(safeKeyExtension('foto.png', 'image/png')).toBe('png')
    expect(safeKeyExtension('foto.JPG', 'image/jpeg')).toBe('jpg')
    expect(safeKeyExtension('clip.mp4', 'video/mp4')).toBe('mp4')
    expect(safeKeyExtension('a.b.webp', 'image/webp')).toBe('webp')
  })

  it.each([
    ['a path separator', 'foto.png/../../x', 'image/png'],
    ['a backslash', 'foto.p\\ng', 'image/png'],
    ['query text', 'foto.png?x=1', 'image/png'],
    ['hash text', 'foto.png#frag', 'image/png'],
    ['a space', 'foto.p ng', 'image/png'],
    ['an overlong extension', `foto.${'a'.repeat(40)}`, 'image/png'],
    ['an empty extension', 'foto.', 'image/png'],
    ['non-ascii text', 'foto.pñg', 'image/png'],
    ['a dots-only extension', 'foto...', 'image/png'],
  ])('falls back to the MIME-derived extension for %s', (_name, filename, mime) => {
    const extension = safeKeyExtension(filename, mime)
    expect(extension).toBe('png')
    expect(extension).toMatch(/^[a-z0-9]{1,8}$/)
  })

  it('never lets extension text carry a separator', () => {
    for (const filename of ['x./', 'x.a/b', 'x..', 'x.%2e%2e', 'x.a\\b', 'x.\u0000png']) {
      expect(safeKeyExtension(filename, 'image/webp')).toMatch(/^[a-z0-9]{1,8}$/)
    }
  })
})
