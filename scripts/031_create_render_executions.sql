-- 031_create_render_executions.sql
-- Phase 2I-B1 — persistent render execution record for Timeline video
-- rendering, per docs/productization/creative-rendering/
-- PHASE_2I_B0_RENDER_EXECUTION_CONTRACT.md.
--
-- Timeline-render-specific, NOT a generic jobs/tasks framework. Deliberately
-- separate from `generation_tasks` (external-provider/webhook-shaped) --
-- render_executions tracks compute this application's own VPS worker runs,
-- discovered by polling + atomic claim, never by an inbound webhook.
--
-- Re-executable: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION /
-- DROP POLICY IF EXISTS follow the same convention already used throughout
-- this schema (e.g. 015, 020, 024). Does not reconcile a partially-diverged
-- existing table.

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS render_executions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership / subject (B0 §5) -----------------------------------------
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Denormalized from video_draft.project_id at creation time, same
  -- pattern video_drafts.POST already uses for project_id from production_id
  -- (app/api/video-drafts/route.ts). Frozen so this row survives the draft
  -- being reparented/deleted later without losing "which project this was".
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  video_draft_id        UUID NOT NULL REFERENCES video_drafts(id) ON DELETE CASCADE,

  -- State machine (B0 §4): queued -> claimed -> completed | failed.
  -- No persisted "idle"; "preparing"/"rendering" deliberately collapsed
  -- into "claimed" (B0 §4 -- nothing in this design branches on the
  -- difference once a worker owns the row).
  status                TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'claimed', 'completed', 'failed')),

  -- Claim-attempt counter for infra retries on the SAME row (worker crash /
  -- stale lease reclaim, B0 §4.1) -- distinct from a user-initiated retry,
  -- which creates a NEW row (retry_of_execution_id below).
  attempt               INT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  max_attempts          INT NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  retry_of_execution_id UUID REFERENCES render_executions(id),

  -- Claim / lease fields (B0 §7/§8/§9) -- written ONLY by
  -- claim_next_render_execution below; never by a user session.
  claimed_by            TEXT,
  lease_expires_at      TIMESTAMPTZ,

  -- Authoritative, signed-URL-free render input (B0 §6/§7). Frozen once at
  -- INSERT and never mutated afterward -- the worker/claim endpoint
  -- reconstructs real (fresh) presigned asset URLs from this at claim time,
  -- never from a persisted URL. See lib/render-execution/build-snapshot.ts
  -- for the exact shape written here ({ schema_version, manifest,
  -- identitySnapshot }) -- a small, deliberate refinement of B0's literal
  -- "frozen TimelineManifest" wording, documented in
  -- PHASE_2I_B1_RENDER_EXECUTION_PERSISTENCE.md.
  input_schema_version  TEXT NOT NULL,
  input_snapshot        JSONB NOT NULL,

  -- Idempotency (B0 §14/§15): dedupes one accidental double-submit of the
  -- SAME user gesture. Two deliberate renders use two different keys (or
  -- omit the key) and are NOT deduplicated.
  idempotency_key       TEXT,

  -- Timestamps (B0 §5) ----------------------------------------------------
  queued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Output locator metadata (B0 §11/§12) -- populated only by a future
  -- worker-facing "complete" route (2I-B2+), NOT this phase. Never implies
  -- a LibraryFile/ChannelPieceMedia was created.
  output_bucket         TEXT,
  output_storage_path   TEXT,
  output_mime_type      TEXT DEFAULT 'video/mp4',
  output_size_bytes     BIGINT,
  output_duration_ms    INT,

  -- Structured errors (B0 §13/§14) -- error_detail is internal-only and
  -- must never be returned by the user-facing GET route.
  error_code            TEXT,
  error_message         TEXT,
  error_detail          TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_render_executions_user_id
  ON render_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_render_executions_project_id
  ON render_executions(project_id);
CREATE INDEX IF NOT EXISTS idx_render_executions_video_draft_id
  ON render_executions(video_draft_id);

-- Claim query lookup (B0 §8): covers both the "queued" branch and, via the
-- partial index below, the "stale claimed" branch.
CREATE INDEX IF NOT EXISTS idx_render_executions_queued
  ON render_executions(queued_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_render_executions_stale_claim
  ON render_executions(lease_expires_at) WHERE status = 'claimed';

-- Idempotency lookup (B0 §14/§15): one active key per user; NULL keys are
-- unconstrained (a render without a supplied key is never deduplicated).
CREATE UNIQUE INDEX IF NOT EXISTS uq_render_executions_user_idempotency_key
  ON render_executions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE render_executions ENABLE ROW LEVEL SECURITY;

-- SELECT: a user sees only their own execution rows (no team/membership
-- model exists anywhere in this schema -- confirmed by audit in B0 §2, so
-- plain user_id = auth.uid() is the correct, established shape here too).
DROP POLICY IF EXISTS "render_executions_select_own" ON render_executions;
CREATE POLICY "render_executions_select_own" ON render_executions
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT: only via the authenticated creation route (POST
-- /api/video-drafts/:id/render), which uses the normal per-request
-- Supabase client (anon key + session) -- same as video_drafts.POST. RLS
-- still guarantees a forged user_id can never be inserted regardless of
-- what the route computes.
DROP POLICY IF EXISTS "render_executions_insert_own" ON render_executions;
CREATE POLICY "render_executions_insert_own" ON render_executions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Deliberately NO UPDATE or DELETE policy for `authenticated`/`anon`.
-- Postgres RLS default-denies any command with no matching policy, so the
-- browser has no path -- authorized or otherwise -- to set status,
-- claimed_by, lease fields, attempt, output paths, error fields, or
-- completion timestamps (B0 §16, explicit product requirement). All
-- post-creation mutation happens exclusively through
-- claim_next_render_execution (SECURITY DEFINER, service_role-only) and,
-- in a later phase, service_role-backed complete/fail routes.

-- ============================================================
-- updated_at TRIGGER (reuses the function already defined in 001)
-- ============================================================
DROP TRIGGER IF EXISTS update_render_executions_updated_at ON render_executions;
CREATE TRIGGER update_render_executions_updated_at
  BEFORE UPDATE ON render_executions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FUNCTION: claim_next_render_execution
-- ============================================================
-- Atomically claims at most one eligible execution for a worker. Modeled
-- directly on the existing atomic-locking precedent in
-- 024_channel_piece_media_organization.sql (structured RAISE EXCEPTION
-- codes, fixed search_path) -- with two deliberate differences required by
-- this function's different caller shape:
--   * SECURITY DEFINER, not INVOKER -- the caller is a service-role-backed
--     Vercel route acting on behalf of the whole render queue, not an
--     end-user acting on their own rows, so it must see across all users'
--     queued/claimed rows. RLS therefore cannot apply here by construction.
--   * FOR UPDATE SKIP LOCKED, not NOWAIT -- a claim caller doesn't care
--     WHICH queued row it gets, so a lock conflict should mean "try the
--     next available row", not "reject and ask the caller to retry" (NOWAIT
--     is correct for CPM's single, human-identified target row; SKIP LOCKED
--     is Postgres's standard idiom for a work-queue claim).
--
-- Eligibility (B0 §4/§8): a row is claimable when it is `queued`, OR when
-- it is `claimed` but its lease has expired and it has not yet exhausted
-- max_attempts (stale-lease self-recovery -- no cron/broker needed for the
-- common case). Rows with attempt >= max_attempts are left for a later,
-- separate sweep (B0 §21, not implemented this phase) to mark `failed`.
--
-- Returns the claimed row, or a row with `id IS NULL` when nothing was
-- eligible -- callers must check `(claim_next_render_execution(...)).id`.
CREATE OR REPLACE FUNCTION claim_next_render_execution(
  p_worker_id     TEXT,
  p_lease_seconds INT DEFAULT 300
) RETURNS render_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row render_executions;
BEGIN
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' THEN
    RAISE EXCEPTION 'RENDER_EXEC_INVALID_INPUT: worker_id is required';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'RENDER_EXEC_INVALID_INPUT: lease_seconds must be a positive integer';
  END IF;

  UPDATE render_executions
  SET
    status           = 'claimed',
    claimed_by       = p_worker_id,
    -- Only set on the FIRST claim; a reclaim after lease expiry preserves
    -- the original claimed_at so "time since first attempt" stays visible.
    claimed_at        = COALESCE(claimed_at, NOW()),
    lease_expires_at  = NOW() + make_interval(secs => p_lease_seconds),
    -- attempt increments only on a RECLAIM (row was already 'claimed' and
    -- stale); a brand-new 'queued' row keeps its starting attempt (1).
    attempt           = CASE WHEN status = 'claimed' THEN attempt + 1 ELSE attempt END,
    updated_at        = NOW()
  WHERE id = (
    SELECT id
    FROM render_executions
    WHERE (status = 'queued')
       OR (status = 'claimed' AND lease_expires_at < NOW() AND attempt < max_attempts)
    ORDER BY queued_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO v_row;

  RETURN v_row; -- v_row.id IS NULL when nothing was eligible
END;
$$;

-- Least privilege (B0 §9/§10): never callable by an ordinary authenticated
-- user session or anonymously -- only the service-role-backed Vercel route
-- that brokers worker claims may execute it. The worker itself never holds
-- a Supabase credential of any kind.
REVOKE ALL ON FUNCTION claim_next_render_execution(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_render_execution(TEXT, INT) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
--   DROP FUNCTION IF EXISTS claim_next_render_execution(TEXT, INT);
--   DROP TABLE IF EXISTS render_executions;
--
-- Requires audit and explicit authorization before applying to production,
-- same as every other migration in this schema. Not applied by this phase.
