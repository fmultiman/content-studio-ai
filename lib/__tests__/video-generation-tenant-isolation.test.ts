import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from './helpers/fake-db'

// VIDEO_GENERATION_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
//
// The attack: a signed-in user rewrites (or inserts) their OWN video_generations
// row so `storage_path` names ANOTHER tenant's object, then asks the playback
// route for their own generation; the server presigns the forged key.
//
// Layer 1 (database): the user session can no longer INSERT/UPDATE the table.
//   Proven statically here against the migration text, and structurally against
//   the database once the migration is applied (see the PR / closure record).
// Layer 2 (application): a stored path is only ever signed when it lies inside
//   the row owner's own namespace.
//
// No provider, no network, no real storage: everything below is in memory.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/storage/s3', () => ({ createPresignedReadUrl: vi.fn(async (path: string) => `https://s3.example.test/signed/${path}?sig=1`) }))

import * as server from '@/lib/supabase/server'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import { isTenantVideoStoragePath, videoStoragePrefix } from '@/lib/video-generation/storage-path'
import { completeVideoGeneration } from '@/lib/video-generation/completion'

const ROOT = process.cwd()
const OWNER = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const GENERATION = 'b6c59c5d-222a-4f51-b016-5bc77b94dbba'

const owner = { user_id: OWNER, project_id: PROJECT }

describe('isTenantVideoStoragePath', () => {
  it('accepts the canonical current key ({user}/videos/ai/{project}/{generation}.mp4)', () => {
    expect(isTenantVideoStoragePath(`${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4`, owner)).toBe(true)
  })

  it('accepts the historical key shape ({user}/videos/ai/{project}/{timestamp}-{random}.mp4)', () => {
    expect(isTenantVideoStoragePath(`${OWNER}/videos/ai/${PROJECT}/1759000000000-abc123.mp4`, owner)).toBe(true)
  })

  it('is built from the same prefix helper completion uses', () => {
    expect(videoStoragePrefix(OWNER, PROJECT)).toBe(`${OWNER}/videos/ai/${PROJECT}`)
  })

  it.each([
    ['another tenant', `${VICTIM}/videos/ai/${PROJECT}/${GENERATION}.mp4`],
    ['another project of the same tenant', `${OWNER}/videos/ai/${OTHER_PROJECT}/${GENERATION}.mp4`],
    ["another tenant's library object", `users/${VICTIM}/library/${GENERATION}/secret.mp4`],
    ['a traversal into another tenant', `${OWNER}/videos/ai/${PROJECT}/../../../${VICTIM}/videos/ai/${PROJECT}/${GENERATION}.mp4`],
    ['a parent traversal segment', `${OWNER}/videos/ai/${PROJECT}/..`],
    ['a nested folder below the project', `${OWNER}/videos/ai/${PROJECT}/nested/${GENERATION}.mp4`],
    ['a prefix that is only a string-prefix of the owner id', `${OWNER}x/videos/ai/${PROJECT}/${GENERATION}.mp4`],
    ['a leading slash', `/${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4`],
    ['a backslash separator', `${OWNER}/videos/ai/${PROJECT}\\${GENERATION}.mp4`],
    ['a percent-encoded separator', `${OWNER}/videos/ai/${PROJECT}/%2e%2e%2f${GENERATION}.mp4`],
    ['a non-mp4 object', `${OWNER}/videos/ai/${PROJECT}/${GENERATION}.png`],
    ['an empty file name', `${OWNER}/videos/ai/${PROJECT}/.mp4`],
    ['a null byte', `${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4\u0000.png`],
    ['a newline', `${OWNER}/videos/ai/${PROJECT}/${GENERATION}\n.mp4`],
    ['an empty string', ''],
    ['a bare relative path', 's3/path.mp4'],
  ])('rejects %s', (_name, path) => {
    expect(isTenantVideoStoragePath(path, owner)).toBe(false)
  })

  it.each([null, undefined, 42, {}, []])('rejects a non-string path (%j)', (value) => {
    expect(isTenantVideoStoragePath(value, owner)).toBe(false)
  })

  it.each([
    [{ user_id: OWNER }],
    [{ project_id: PROJECT }],
    [{ user_id: '', project_id: PROJECT }],
    [{ user_id: OWNER, project_id: '' }],
    [{ user_id: `${OWNER}/../${VICTIM}`, project_id: PROJECT }],
    [{ user_id: OWNER, project_id: `${PROJECT}/..` }],
  ])('fails closed when the row owner is missing or malformed (%j)', (badOwner) => {
    expect(isTenantVideoStoragePath(`${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4`, badOwner)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Playback route (Layer 2)
// ---------------------------------------------------------------------------
describe('GET /api/video-generations/[id]/playback-url — stored path is not trusted', () => {
  const play = async (row: Record<string, unknown> | null, userId = OWNER) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
    }
    vi.mocked(server.createClient).mockResolvedValue({
      from: () => chain,
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    } as any)
    const { GET } = await import('@/app/api/video-generations/[id]/playback-url/route')
    return GET(new Request(`http://localhost/api/video-generations/${GENERATION}/playback-url`), { params: Promise.resolve({ id: GENERATION }) })
  }
  const row = (storage_path: unknown) => ({ id: GENERATION, user_id: OWNER, project_id: PROJECT, status: 'succeeded', storage_path })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('owner: a legitimate completed generation (canonical key) still plays', async () => {
    const path = `${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4`
    const response = await play(row(path))
    expect(response.status).toBe(200)
    expect(createPresignedReadUrl).toHaveBeenCalledWith(path, expect.anything())
    expect((await response.json()).url).toContain(path)
  })

  it('owner: a historical row (timestamp-random name) still plays', async () => {
    const path = `${OWNER}/videos/ai/${PROJECT}/1759000000000-abc123.mp4`
    const response = await play(row(path))
    expect(response.status).toBe(200)
    expect(createPresignedReadUrl).toHaveBeenCalledWith(path, expect.anything())
  })

  it('FORGED cross-tenant storage_path is rejected: nothing is signed and the foreign key is not echoed', async () => {
    const forged = `${VICTIM}/videos/ai/${PROJECT}/${GENERATION}.mp4`
    const response = await play(row(forged))
    const text = JSON.stringify(await response.json())

    expect(response.status).toBe(409)
    expect(JSON.parse(text).code).toBe('INVALID_STORAGE_PATH')
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
    expect(text).not.toContain(VICTIM)
    expect(text).not.toMatch(/videos\/ai|s3|bucket/i)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(VICTIM)
  })

  it.each([
    ["another tenant's library object", `users/${VICTIM}/library/x/secret.mp4`],
    ['a traversal', `${OWNER}/videos/ai/${PROJECT}/../../${VICTIM}/videos/ai/${PROJECT}/x.mp4`],
    ['a foreign project', `${OWNER}/videos/ai/${OTHER_PROJECT}/x.mp4`],
    ['garbage', 's3/path.mp4'],
  ])('malformed / non-canonical path fails closed: %s', async (_name, path) => {
    const response = await play(row(path))
    expect(response.status).toBe(409)
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })

  it('a row without a project id cannot be validated and fails closed', async () => {
    const response = await play({ id: GENERATION, user_id: OWNER, status: 'succeeded', storage_path: `${OWNER}/videos/ai/${PROJECT}/${GENERATION}.mp4` })
    expect(response.status).toBe(409)
    expect(createPresignedReadUrl).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// History list (second presign site)
// ---------------------------------------------------------------------------
describe('GET /api/video-generations — the history list does not sign forged paths either', () => {
  it('signs canonical/historical rows and strips a forged one (no storage_path, no stored URL)', async () => {
    vi.clearAllMocks()
    const good = { id: 'g1', user_id: OWNER, project_id: PROJECT, status: 'succeeded', storage_path: `${OWNER}/videos/ai/${PROJECT}/g1.mp4`, public_url: 'raw-1', created_at: '2026-09-29T00:00:00Z' }
    const old = { id: 'g2', user_id: OWNER, project_id: PROJECT, status: 'succeeded', storage_path: `${OWNER}/videos/ai/${PROJECT}/1759000000000-abc123.mp4`, public_url: 'raw-2', created_at: '2026-09-28T00:00:00Z' }
    const forged = { id: 'g3', user_id: OWNER, project_id: PROJECT, status: 'succeeded', storage_path: `${VICTIM}/videos/ai/${PROJECT}/x.mp4`, public_url: `https://s3.example.test/${VICTIM}/x.mp4`, created_at: '2026-09-27T00:00:00Z' }
    const db = createFakeDb({ seed: { video_generations: [good, old, forged] } })
    vi.mocked(server.createClient).mockResolvedValue({ from: db.from, auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) } } as any)

    const { GET } = await import('@/app/api/video-generations/route')
    const body = await (await GET(new NextRequest('http://localhost/api/video-generations'))).json()
    const byId = Object.fromEntries(body.generations.map((g: any) => [g.id, g]))

    expect(byId.g1.public_url).toContain('/signed/')
    expect(byId.g2.public_url).toContain('/signed/')
    expect(byId.g3.storage_path).toBeNull()
    expect(byId.g3.public_url).toBeNull()
    expect(JSON.stringify(byId.g3)).not.toContain(VICTIM)
    expect(createPresignedReadUrl).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Server completion still produces a path the read side accepts
// ---------------------------------------------------------------------------
describe('server-side completion writes a path inside the owner namespace', () => {
  it('completeVideoGeneration (server-authority db) sets storage_path/status/result metadata and the result passes the tenant check', async () => {
    const db = createFakeDb({
      seed: { video_generations: [{ id: GENERATION, user_id: OWNER, project_id: PROJECT, status: 'processing', task_id: 'task-1', transport: 'mcp', storage_path: null }] },
    }) as any
    // Mirrors downloadAndStoreVideo: `${prefix}/${objectName}`.
    const download = vi.fn(async (_url: string, prefix: string, options?: { objectName?: string }) => ({
      storagePath: `${prefix}/${options?.objectName}`,
      publicUrl: 'https://s3.example.test/x',
      mime: 'video/mp4',
      size: 5,
    }))

    const result = await completeVideoGeneration(db, { generationId: GENERATION, taskId: 'task-1', transport: 'mcp', resultUrl: 'https://cdn.example.test/v.mp4' }, { download: download as any })

    expect(result.outcome).toBe('completed')
    const stored = db.tables.video_generations[0]
    expect(stored).toMatchObject({ status: 'succeeded' })
    expect(stored.result_metadata).toMatchObject({ provider_task_id: 'task-1', transport: 'mcp' })
    expect(isTenantVideoStoragePath(stored.storage_path, stored)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Layer 1: privilege boundary (static — the live check runs against the applied database)
// ---------------------------------------------------------------------------
describe('migration 043 — video_generations is server-owned', () => {
  const FILE = '043_video_generations_server_owned_writes.sql'
  const SQL = readFileSync(join(ROOT, 'scripts', FILE), 'utf8').replace(/--.*$/gm, '')
  const statements = SQL.split(';').map((statement) => statement.replace(/\s+/g, ' ').trim()).filter(Boolean)

  it('is a single, uniquely numbered migration that leaves 039/041/042 in place', () => {
    const numbered = readdirSync(join(ROOT, 'scripts')).filter((name) => /^\d{3}_.*\.sql$/.test(name))
    expect(numbered.filter((name) => name.startsWith('043_'))).toEqual([FILE])
    for (const untouched of ['039_create_video_generations.sql', '041_create_provider_connections.sql', '042_video_generation_transport_provenance.sql']) {
      expect(numbered).toContain(untouched)
    }
  })

  it('revokes every privilege from PUBLIC, anon and authenticated first', () => {
    expect(statements[0]).toMatch(/^REVOKE ALL ON TABLE video_generations FROM PUBLIC, anon, authenticated$/i)
  })

  it('grants the user session SELECT and DELETE only — never INSERT, UPDATE, TRUNCATE, TRIGGER or REFERENCES', () => {
    const grants = statements.filter((statement) => /^GRANT\b/i.test(statement) && /TO authenticated\b/i.test(statement))
    expect(grants).toEqual(['GRANT SELECT, DELETE ON TABLE video_generations TO authenticated'])
    expect(SQL).not.toMatch(/GRANT[^;]*TO\s+(anon|PUBLIC)\b/i)
  })

  it('column-level grants are not used to re-open storage_path or any server-owned column', () => {
    expect(SQL).not.toMatch(/GRANT\s+(INSERT|UPDATE)\s*\(/i)
  })

  it('keeps the server authority (service_role) fully privileged', () => {
    expect(SQL).toMatch(/GRANT ALL ON TABLE video_generations TO service_role/i)
  })

  it('drops the INSERT and UPDATE policies (RLS would still deny if a privilege were ever re-granted) and creates no new one', () => {
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Users can create their own video generations" ON video_generations/i)
    expect(SQL).toMatch(/DROP POLICY IF EXISTS "Users can update their own video generations" ON video_generations/i)
    expect(SQL).not.toMatch(/CREATE POLICY/i)
  })

  it('does not drop the SELECT or DELETE policies, alter columns, or touch any row', () => {
    expect(SQL).not.toMatch(/DROP POLICY[^;]*view their own/i)
    expect(SQL).not.toMatch(/DROP POLICY[^;]*delete their own/i)
    // Case-sensitive on purpose: the dropped policy NAMES contain the lowercase words "create"/"update".
    expect(SQL).not.toMatch(/\b(ALTER TABLE|UPDATE|DELETE FROM|INSERT INTO|TRUNCATE TABLE|DROP TABLE|DROP COLUMN)\b/)
  })

  it('the original policies it drops exist in 039 (guards against renaming drift)', () => {
    const original = readFileSync(join(ROOT, 'scripts/039_create_video_generations.sql'), 'utf8')
    expect(original).toContain('"Users can create their own video generations"')
    expect(original).toContain('"Users can update their own video generations"')
  })
})

// ---------------------------------------------------------------------------
// The application never writes video_generations with the user session
// ---------------------------------------------------------------------------
describe('no route writes video_generations through the user-session client', () => {
  const sources = () => {
    const out: Array<{ file: string; source: string }> = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push({ file: full, source: readFileSync(full, 'utf8') })
      }
    }
    walk(join(ROOT, 'app'))
    return out
  }

  it('the user-session client (`supabase`) never chains a write onto video_generations', () => {
    const offenders: string[] = []
    for (const { file, source } of sources()) {
      for (const match of source.matchAll(/\bsupabase\s*\.?\s*from\('video_generations'\)\s*\.(insert|update|upsert|delete)\b/g)) offenders.push(`${file}: ${match[0]}`)
      for (const match of source.matchAll(/\bsupabase\s*\n\s*\.from\('video_generations'\)\s*\n?\s*\.(insert|update|upsert|delete)\b/g)) offenders.push(`${file}: ${match[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('the create and sync routes obtain a server-authority client for their writes', () => {
    const create = readFileSync(join(ROOT, 'app/api/video-generations/route.ts'), 'utf8')
    const sync = readFileSync(join(ROOT, 'app/api/video-generations/[id]/sync/route.ts'), 'utf8')
    expect(create).toMatch(/serverDb\s*=\s*createServiceRoleSupabase\(\)/)
    expect(sync).toMatch(/writeDb\s*=\s*createServiceRoleSupabase\(\)/)
  })
})
