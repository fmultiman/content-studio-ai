import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIBRARY_STORAGE_PATH_SQL_TAIL,
  checkLibraryStoragePath,
  isTrustedLibraryStoragePath,
  withTrustedStoragePaths,
} from '@/lib/storage/library-path'

// LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1 — synthetic users/keys only.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const BLOB = '33333333-3333-4333-8333-333333333333'

describe('checkLibraryStoragePath — the real Library key families', () => {
  it.each([
    [`users/${OWNER}/library/${BLOB}/imagem-ia-3a49939e.png`],
    [`users/${OWNER}/library/Content-Agent/${BLOB}/foto.jpg`],
    [`users/${OWNER}/library/Portal-Comunidades-Alternativas/assets/pack-b-staging/papers/${BLOB}/folha.png`],
    [`users/${OWNER}/library/${BLOB}/render-0ee1ef93.mp4`],
    // the extension is the one un-sanitized part of a server-generated key (filename.split('.').pop())
    [`users/${OWNER}/library/${BLOB}/foto.JPG`],
  ])('allows the owner’s own key %s', (path) => {
    expect(checkLibraryStoragePath(OWNER, path)).toEqual({ ok: true, path })
    expect(isTrustedLibraryStoragePath(OWNER, path)).toBe(true)
  })

  it('rejects another user’s canonical namespace (even with an otherwise perfect key)', () => {
    expect(checkLibraryStoragePath(OWNER, `users/${OTHER}/library/${BLOB}/secret.png`).ok).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['not a string', 123],
    ['null', null],
    ['an https URL', `https://s3.example.test/content-studio/users/${OWNER}/library/${BLOB}/x.png`],
    ['an absolute path', `/users/${OWNER}/library/${BLOB}/x.png`],
    ['a Windows path', `users\\${OWNER}\\library\\${BLOB}\\x.png`],
    ['wrong root', `files/${OWNER}/library/${BLOB}/x.png`],
    ['wrong namespace (images)', `users/${OWNER}/images/${BLOB}/original.png`],
    ['wrong namespace (videos)', `users/${OWNER}/videos/ai/${BLOB}/v.mp4`],
    ['too short', `users/${OWNER}/library/x.png`],
    ['no uuid segment', `users/${OWNER}/library/folder/x.png`],
    ['empty segment', `users/${OWNER}/library//${BLOB}/x.png`],
    ['trailing slash', `users/${OWNER}/library/${BLOB}/`],
    ['traversal in a folder', `users/${OWNER}/library/../${OTHER}/library/${BLOB}/x.png`],
    ['traversal escaping the namespace', `users/${OWNER}/library/a/../../../${OTHER}/library/${BLOB}/x.png`],
    ['dot segment', `users/${OWNER}/library/./${BLOB}/x.png`],
    ['dot-dot file name', `users/${OWNER}/library/${BLOB}/..`],
    ['control character', `users/${OWNER}/library/${BLOB}/x\u0000.png`],
    ['a folder with a space', `users/${OWNER}/library/My Folder/${BLOB}/x.png`],
    ['overlong key', `users/${OWNER}/library/${BLOB}/${'a'.repeat(2000)}.png`],
  ])('rejects %s', (_name, value) => {
    expect(checkLibraryStoragePath(OWNER, value)).toEqual({ ok: false, reason: 'INVALID_STORAGE_PATH' })
  })

  it('never decides by substring: the owner id embedded elsewhere in another tenant’s key does not pass', () => {
    expect(isTrustedLibraryStoragePath(OWNER, `users/${OTHER}/library/${OWNER}/${BLOB}/x.png`)).toBe(false)
    expect(isTrustedLibraryStoragePath(OWNER, `users/${OTHER}/library/${BLOB}/${OWNER}.png`)).toBe(false)
  })

  it('rejects an owner id that is itself not a safe single segment', () => {
    expect(checkLibraryStoragePath('', `users//library/${BLOB}/x.png`).ok).toBe(false)
    expect(checkLibraryStoragePath(`${OWNER}/library`, `users/${OWNER}/library/library/${BLOB}/x.png`).ok).toBe(false)
  })
})

describe('withTrustedStoragePaths — server consumers fail closed', () => {
  it('keeps a provable row and strips the path of a forged one', () => {
    const good = { id: 'a', user_id: OWNER, storage_path: `users/${OWNER}/library/${BLOB}/ok.png` }
    const forged = { id: 'b', user_id: OWNER, storage_path: `users/${OTHER}/library/${BLOB}/secret.png` }
    const empty = { id: 'c', user_id: OWNER, storage_path: null as string | null }
    const result = withTrustedStoragePaths([good, forged, empty])
    expect(result[0]).toBe(good)
    expect(result[1]).toEqual({ id: 'b', user_id: OWNER, storage_path: null })
    expect(result[2].storage_path).toBeNull()
  })
})

describe('migration 046 stays in lockstep with the TypeScript rule', () => {
  const sql = readFileSync(join(process.cwd(), 'scripts', '046_library_files_trust_boundary.sql'), 'utf8')

  it('uses the same namespace tail as the validator', () => {
    expect(sql).toContain(`'^users/' || user_id::text || '${LIBRARY_STORAGE_PATH_SQL_TAIL.replace(/\$$/, '')}$'`)
  })

  it('rejects dot segments and control characters, and validates existing rows', () => {
    expect(sql).toContain(String.raw`storage_path !~ '(^|/)\.{1,2}(/|$)'`)
    expect(sql).toContain(String.raw`storage_path !~ '[[:cntrl:]\\]'`)
    expect(sql).toMatch(/VALIDATE CONSTRAINT library_files_storage_path_owner_check/)
  })

  it('the SQL tail accepts/rejects the same corpus as the validator (JS RegExp parity)', () => {
    const tail = new RegExp(`^users/${OWNER}${LIBRARY_STORAGE_PATH_SQL_TAIL}`)
    const dot = /(^|\/)\.{1,2}(\/|$)/
    const accepts = (path: string) => tail.test(path) && !dot.test(path)
    const corpus = [
      `users/${OWNER}/library/${BLOB}/a.png`,
      `users/${OWNER}/library/F/G/${BLOB}/a.png`,
      `users/${OTHER}/library/${BLOB}/a.png`,
      `users/${OWNER}/library/../x/${BLOB}/a.png`,
      `users/${OWNER}/library/${BLOB}/..`,
      `users/${OWNER}/images/${BLOB}/a.png`,
      `users/${OWNER}/library/folder/a.png`,
      `users/${OWNER}/library/My Folder/${BLOB}/a.png`,
    ]
    for (const path of corpus) expect(accepts(path), path).toBe(isTrustedLibraryStoragePath(OWNER, path))
  })

  it('checks Project and provenance ownership in the database and locks immutable columns', () => {
    expect(sql).toMatch(/p\.id = NEW\.project_id AND p\.user_id = NEW\.user_id/)
    expect(sql).toMatch(/i\.id = NEW\.source_image_id AND i\.user_id = NEW\.user_id/)
    expect(sql).toMatch(/r\.id = NEW\.source_render_execution_id AND r\.user_id = NEW\.user_id/)
    expect(sql).toMatch(/REVOKE UPDATE ON library_files FROM anon, authenticated/)
    const grant = /GRANT UPDATE \(([^)]+)\)\s+ON library_files TO authenticated/.exec(sql)
    const columns = (grant?.[1] ?? '').split(',').map((column) => column.trim())
    expect(columns.sort()).toEqual(['deleted_at', 'folder', 'name', 'project_id', 'public_url', 'storage_path', 'thumbnail_url'])
    for (const immutable of ['user_id', 'origin', 'kind', 'mime_type', 'file_size', 'source_image_id', 'source_render_execution_id', 'id', 'created_at']) {
      expect(columns).not.toContain(immutable)
    }
  })

  it('does not touch data, other tables or historical migrations', () => {
    expect(sql).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE|INSERT INTO|UPDATE library_files SET)\b/i)
    expect(sql.match(/ALTER TABLE (\w+)/g)?.every((statement) => statement === 'ALTER TABLE library_files')).toBe(true)
  })
})
