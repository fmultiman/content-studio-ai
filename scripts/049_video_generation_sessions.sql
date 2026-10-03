-- VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 (FUTURE-036 / slice 036B)
--
-- Additive, forward-only. Nothing existing is rewritten and NO Session is ever backfilled:
-- every historical video_generations row keeps session_id NULL (a standalone attempt).
--
--   video_generation_sessions   the mutable, resumable WORKING STATE of a video generation
--                               (what the user is composing before/between Generate clicks).
--                               It is NOT an attempt: it never holds provider, status, task or
--                               result data. Those stay on video_generations, whose
--                               prompt / mode / model / request_config / transport / sources
--                               remain the immutable snapshot of each submitted attempt.
--
--     working_prompt  the user's draft prompt, verbatim (direct prompt is first-class).
--     working_config  JSON document {schemaVersion, source, selection}. Together with
--                     working_prompt it is exactly VideoGenerationWorkingStateV1
--                     (lib/video-generation/working-state.ts); the prompt lives ONLY in
--                     working_prompt, never duplicated inside working_config. Validated by the
--                     server routes (shape, schemaVersion, size); the database only guarantees
--                     it is a JSON object so future schema versions need no migration.
--     updated_at      maintained by trigger; doubles as the optimistic-concurrency token.
--
--   video_generations.session_id        nullable lineage pointer, set once at insert.
--   video_generations.client_request_id caller-supplied key of ONE logical Generate submit.
--   video_generations.request_fingerprint
--                                       hash of the canonical request that key first carried,
--                                       so a reused key with a different payload is rejected
--                                       instead of silently returning the first attempt.
--
-- Ownership: a Session belongs to exactly one (user, project, production). The composite FK makes
-- it impossible for an attempt to point at a Session of another user, project or production. The
-- check is skipped while session_id IS NULL (MATCH SIMPLE), so legacy rows are unaffected.
--
-- Deletes (verified on a throwaway Postgres, see the PR):
--   Production or Project deletion cascades to its Sessions and to its attempts.
--   Deleting a Session alone never deletes attempts: the FK nulls ONLY session_id
--   (column-list SET NULL, PG >= 15; the live database is 17), so the attempt history survives
--   as a standalone attempt. There is no user-facing Session delete in this slice.
--
-- RLS / grants: server-owned writes, mirroring 043. The user session may only READ its own
-- Sessions; every write goes through validated server routes using the service role.
--
-- Rollback (drops only what this migration added; attempts keep all their other data):
--   DROP TRIGGER IF EXISTS video_generations_session_id_immutable ON video_generations;
--   DROP FUNCTION IF EXISTS video_generations_session_id_immutable();
--   DROP INDEX IF EXISTS uq_video_generations_user_client_request;
--   DROP INDEX IF EXISTS idx_video_generations_session;
--   ALTER TABLE video_generations
--     DROP CONSTRAINT IF EXISTS video_generations_session_scope_fkey,
--     DROP COLUMN IF EXISTS request_fingerprint,
--     DROP COLUMN IF EXISTS client_request_id,
--     DROP COLUMN IF EXISTS session_id;
--   DROP TABLE IF EXISTS video_generation_sessions;

CREATE TABLE IF NOT EXISTS video_generation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,

  working_prompt TEXT NOT NULL DEFAULT '',
  working_config JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT video_generation_sessions_working_config_object
    CHECK (jsonb_typeof(working_config) = 'object'),
  -- Target of the ownership FK from video_generations.
  CONSTRAINT video_generation_sessions_scope_key
    UNIQUE (id, user_id, project_id, production_id)
);

-- Leads with production_id: serves both "recent Sessions of a Production" and the Production-delete cascade.
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_production_recent
  ON video_generation_sessions (production_id, user_id, updated_at DESC);
-- Serves the Project-delete cascade.
CREATE INDEX IF NOT EXISTS idx_video_generation_sessions_project
  ON video_generation_sessions (project_id);

DROP TRIGGER IF EXISTS update_video_generation_sessions_updated_at ON video_generation_sessions;
CREATE TRIGGER update_video_generation_sessions_updated_at
  BEFORE UPDATE ON video_generation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE video_generation_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE video_generation_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE video_generation_sessions TO authenticated;
GRANT ALL ON TABLE video_generation_sessions TO service_role;

DROP POLICY IF EXISTS "Users can view their own video generation sessions" ON video_generation_sessions;
CREATE POLICY "Users can view their own video generation sessions"
  ON video_generation_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- Attempt lineage + idempotency columns (all nullable; no rewrite of existing rows).
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS client_request_id UUID;
ALTER TABLE video_generations ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'video_generations_session_scope_fkey'
      AND conrelid = 'video_generations'::regclass
  ) THEN
    ALTER TABLE video_generations
      ADD CONSTRAINT video_generations_session_scope_fkey
      FOREIGN KEY (session_id, user_id, project_id, production_id)
      REFERENCES video_generation_sessions (id, user_id, project_id, production_id)
      ON DELETE SET NULL (session_id);
  END IF;
END $$;

-- Attempts of a Session, in their deterministic order (created_at, id).
CREATE INDEX IF NOT EXISTS idx_video_generations_session
  ON video_generations (session_id, created_at, id)
  WHERE session_id IS NOT NULL;

-- Server-owned idempotency: one logical Generate submit per (user, key). Keys never cross users.
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_generations_user_client_request
  ON video_generations (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Lineage is stable: an attempt joins a Session only when it is created and is never re-parented.
-- The only permitted change is session_id -> NULL, which is exactly what the FK's ON DELETE SET NULL does.
CREATE OR REPLACE FUNCTION video_generations_session_id_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'video_generations.session_id is set at creation and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS video_generations_session_id_immutable ON video_generations;
CREATE TRIGGER video_generations_session_id_immutable
  BEFORE UPDATE OF session_id ON video_generations
  FOR EACH ROW
  EXECUTE FUNCTION video_generations_session_id_immutable();
