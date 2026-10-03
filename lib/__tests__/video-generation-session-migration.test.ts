import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 — static contract of scripts/049.
//
// The behavioral proof (composite FK, delete cascades, SET NULL (session_id), RLS/grants, immutability, unique
// index) was executed against a real Postgres with this exact file applied; it is recorded in the PR. These tests
// pin the file so that proof cannot silently drift: they fail if a guarantee is removed from the SQL.

const ROOT = process.cwd()
const MIGRATION = '049_video_generation_sessions.sql'
const sql = readFileSync(join(ROOT, 'scripts', MIGRATION), 'utf8')
const code = sql.replace(/--.*$/gm, '')
const squash = (text: string) => text.replace(/\s+/g, ' ')

describe('scripts/049_video_generation_sessions.sql', () => {
  it('follows 048 in the sequence and is the only 049', () => {
    const numbered = readdirSync(join(ROOT, 'scripts')).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    expect(numbered.filter((f) => f.startsWith('049_'))).toEqual([MIGRATION])
    expect(numbered.includes('048_library_files_production_scope.sql')).toBe(true)
  })

  it('creates the Session table with exactly the approved columns — and none of the rejected ones', () => {
    const table = squash(code.match(/CREATE TABLE IF NOT EXISTS video_generation_sessions \(([\s\S]*?)\n\);/)![1])
    for (const column of ['id UUID PRIMARY KEY', 'user_id UUID NOT NULL', 'project_id UUID NOT NULL', 'production_id UUID NOT NULL', 'working_prompt TEXT NOT NULL', 'working_config JSONB NOT NULL', 'created_at TIMESTAMPTZ NOT NULL', 'updated_at TIMESTAMPTZ NOT NULL']) {
      expect(table).toContain(column)
    }
    for (const rejected of ['status', 'selected_generation_id', 'selected_result_id', 'archived_at', 'deleted_at', 'attempt_number', 'last_activity_at', 'current_image_id', 'source_image_id', 'source_library_file_id', ' name ', 'provenance', 'refined']) {
      expect(table, rejected).not.toContain(rejected)
    }
  })

  it('project and production are REQUIRED and cascade (a Session never exists outside a Production)', () => {
    const sql1 = squash(code)
    expect(sql1).toContain('project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE')
    expect(sql1).toContain('production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE')
    expect(sql1).toContain('user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE')
  })

  it('declares the composite ownership key and the composite FK with column-list SET NULL', () => {
    const flat = squash(code)
    expect(flat).toContain('UNIQUE (id, user_id, project_id, production_id)')
    expect(flat).toContain('FOREIGN KEY (session_id, user_id, project_id, production_id) REFERENCES video_generation_sessions (id, user_id, project_id, production_id) ON DELETE SET NULL (session_id)')
  })

  it('adds only nullable columns to video_generations (no backfill, no rewrite, no NOT NULL)', () => {
    const flat = squash(code)
    for (const column of ['session_id UUID', 'client_request_id UUID', 'request_fingerprint TEXT']) {
      expect(flat).toContain(`ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS ${column};`)
    }
    expect(code).not.toMatch(/INSERT INTO\s+video_generation_sessions/i)
    expect(code).not.toMatch(/UPDATE\s+video_generations\s+SET/i)
    expect(code).not.toMatch(/INSERT INTO\s+video_generations/i)
    expect(code).not.toMatch(/ALTER COLUMN/i)
    expect(code).not.toMatch(/DROP COLUMN/i)
  })

  it('Session writes are server-owned: authenticated gets SELECT only, with an own-rows RLS policy', () => {
    const flat = squash(code)
    expect(flat).toContain('ALTER TABLE video_generation_sessions ENABLE ROW LEVEL SECURITY;')
    expect(flat).toContain('REVOKE ALL ON TABLE video_generation_sessions FROM PUBLIC, anon, authenticated;')
    expect(flat).toContain('GRANT SELECT ON TABLE video_generation_sessions TO authenticated;')
    expect(flat).toContain('GRANT ALL ON TABLE video_generation_sessions TO service_role;')
    expect(flat).toMatch(/CREATE POLICY "[^"]+" ON video_generation_sessions FOR SELECT USING \(auth\.uid\(\) = user_id\);/)
    expect(code).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i)
    expect(code).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]*TO[^;]*authenticated/i)
  })

  it('updated_at is trigger-maintained (it is the optimistic-concurrency token)', () => {
    const flat = squash(code)
    expect(flat).toContain('BEFORE UPDATE ON video_generation_sessions')
    expect(flat).toContain('EXECUTE FUNCTION update_updated_at_column()')
  })

  it('idempotency is a per-user partial unique index on client_request_id', () => {
    expect(squash(code)).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_video_generations_user_client_request ON video_generations (user_id, client_request_id) WHERE client_request_id IS NOT NULL;')
  })

  it('has the lookup indexes the API and the delete cascades rely on', () => {
    const flat = squash(code)
    expect(flat).toContain('ON video_generation_sessions (production_id, user_id, updated_at DESC)')
    expect(flat).toContain('ON video_generation_sessions (project_id)')
    expect(flat).toContain('ON video_generations (session_id, created_at, id) WHERE session_id IS NOT NULL')
  })

  it('session_id is immutable after creation, except the FK’s own SET NULL', () => {
    const flat = squash(code)
    expect(flat).toContain('BEFORE UPDATE OF session_id ON video_generations')
    expect(flat).toContain('IF NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN')
  })

  it('documents a rollback and is safe to re-apply', () => {
    expect(sql).toMatch(/Rollback/)
    expect(sql).toContain('DROP TABLE IF EXISTS video_generation_sessions;')
    expect(code).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/)
    expect(code).not.toMatch(/CREATE POLICY(?![^;]*\n)/) // sanity: policies are created after a DROP POLICY IF EXISTS
    expect(code).toContain('DROP POLICY IF EXISTS "Users can view their own video generation sessions"')
  })

  it('leaves the Session table out of every legacy surface: it does not touch image_drafts or video_drafts', () => {
    expect(code).not.toMatch(/image_drafts|video_drafts|video_scenes|channel_piece/i)
  })
})
