-- 024_channel_piece_media_organization.sql
-- Adds two RPCs for atomic ChannelPiece media organization (M6).
--
-- Functions:
--   organize_channel_piece_media(p_channel_piece_id UUID, p_items JSONB) → JSONB
--   remove_channel_piece_media(p_id UUID)                                → JSONB
--
-- Non-destructive: no schema changes, no data modifications.
-- Idempotent: CREATE OR REPLACE FUNCTION — safe to run multiple times.
--
-- ─── Security ──────────────────────────────────────────────────────────────────
--
-- SECURITY INVOKER (default) — functions run under the caller's permissions.
-- RLS policies on channel_piece_media, channel_pieces apply normally.
-- auth.uid() is available via the JWT context supplied by Supabase/PostgREST.
-- SECURITY DEFINER is NOT used — not required since RLS provides isolation.
--
-- Fixed search_path = public, auth prevents search_path injection.
--
-- ─── Concurrency ───────────────────────────────────────────────────────────────
--
-- Both functions use FOR UPDATE NOWAIT to lock CPM rows.
-- If another transaction holds the lock, the caller gets SQLSTATE 55P03
-- (lock_not_available), which the API maps to 409 Conflict.
-- This guarantees: one operation wins, another gets 409, zero partial state.
--
-- ─── organize_channel_piece_media ─────────────────────────────────────────────
--
-- Atomically reorders and/or changes roles for ALL media of a ChannelPiece.
--
-- Input:
--   p_channel_piece_id  UUID   — target ChannelPiece (must belong to auth.uid())
--   p_items             JSONB  — complete list of ALL current CPMs with desired
--                                position and role:
--                                [{id: uuid, position: int, role: text}, ...]
--
-- The payload MUST contain every existing CPM for the ChannelPiece.
-- Extra or missing IDs → CPM_CONFLICT (409) — detects stale payloads.
--
-- Invariants enforced:
--   - auth.uid() not null
--   - CP belongs to auth.uid()
--   - input ID set exactly matches DB ID set
--   - no duplicate IDs in input
--   - no duplicate positions in input
--   - positions are exactly 0..N-1 (compact, no gaps)
--   - all roles are valid
--   - exactly one primary (when N > 0)
--
-- Primary handling:
--   uq_cpm_cp_primary is IMMEDIATE (not deferrable).
--   Phase 1: demote old primary to carousel_item if a different item becomes primary.
--   Phase 2: apply all position + role updates (position constraint deferred).
--
-- Returns: JSONB array of updated CPM rows ordered by position ASC.
--
-- Error codes (start of RAISE EXCEPTION message — parsed by API layer):
--   CPM_UNAUTHORIZED   → API returns 401
--   CPM_NOT_FOUND      → API returns 404
--   CPM_CONFLICT       → API returns 409 (ID set mismatch / stale payload)
--   CPM_LOCK_CONFLICT  → API returns 409 (concurrent lock)
--   CPM_INVALID_INPUT  → API returns 400
--
-- ─── remove_channel_piece_media ───────────────────────────────────────────────
--
-- Atomically removes a CPM, promotes a new primary if needed, and compacts
-- remaining positions to 0..N-1.
--
-- Input:
--   p_id  UUID — CPM to remove (must belong to auth.uid())
--
-- Behaviour:
--   1. Lock all CPM rows for the ChannelPiece (FOR UPDATE NOWAIT)
--   2. Delete the target CPM
--   3. If deleted item was primary AND others remain → promote lowest-position item
--   4. Compact remaining positions to 0..N-1 (deferred position constraint)
--   5. Return updated list
--
-- Sources (images, library_files, S3 objects) are NEVER touched.
--
-- ─── Rollback ─────────────────────────────────────────────────────────────────
--
--   DROP FUNCTION IF EXISTS organize_channel_piece_media(UUID, JSONB);
--   DROP FUNCTION IF EXISTS remove_channel_piece_media(UUID);
--
-- ─── Production application ───────────────────────────────────────────────────
--
--   Requires audit, confirmation of M1–M5 schema, and authorization before
--   applying to production. See CHANNEL_PIECE_MEDIA_DECISIONS.md CPM-D25.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Function: organize_channel_piece_media
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION organize_channel_piece_media(
  p_channel_piece_id UUID,
  p_items            JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_uid      UUID    := auth.uid();
  v_n_input  INT;
  v_n_db     INT;
  v_dup_ids  INT;
  v_dup_pos  INT;
  v_min_pos  INT;
  v_max_pos  INT;
  v_pri_ct   INT;
  v_item     JSONB;
  v_result   JSONB;
BEGIN
  -- ── Auth ────────────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CPM_UNAUTHORIZED: authentication required';
  END IF;

  -- ── Validate input ──────────────────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' THEN
    RAISE EXCEPTION 'CPM_INVALID_INPUT: items must be a JSON array';
  END IF;

  v_n_input := jsonb_array_length(p_items);

  IF v_n_input = 0 THEN
    RAISE EXCEPTION 'CPM_INVALID_INPUT: items cannot be empty';
  END IF;

  -- Validate structure and values of each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF v_item->>'id'       IS NULL
    OR v_item->>'position' IS NULL
    OR v_item->>'role'     IS NULL
    THEN
      RAISE EXCEPTION 'CPM_INVALID_INPUT: each item must have id, position, and role';
    END IF;

    IF (v_item->>'role') NOT IN (
      'primary', 'thumbnail', 'carousel_item', 'background', 'attachment'
    ) THEN
      RAISE EXCEPTION 'CPM_INVALID_INPUT: invalid role: %', v_item->>'role';
    END IF;

    -- position must be a non-negative integer (SMALLINT range is checked by cast)
    IF (v_item->>'position') !~ '^\d+$' THEN
      RAISE EXCEPTION 'CPM_INVALID_INPUT: position must be a non-negative integer';
    END IF;
  END LOOP;

  -- No duplicate IDs in input
  SELECT COUNT(*) - COUNT(DISTINCT (item->>'id'))
  INTO v_dup_ids
  FROM jsonb_array_elements(p_items) AS item;
  IF v_dup_ids > 0 THEN
    RAISE EXCEPTION 'CPM_INVALID_INPUT: duplicate IDs in items';
  END IF;

  -- No duplicate positions in input
  SELECT COUNT(*) - COUNT(DISTINCT (item->>'position')::INT)
  INTO v_dup_pos
  FROM jsonb_array_elements(p_items) AS item;
  IF v_dup_pos > 0 THEN
    RAISE EXCEPTION 'CPM_INVALID_INPUT: duplicate positions in items';
  END IF;

  -- Positions must be exactly 0..N-1
  SELECT
    MIN((item->>'position')::INT),
    MAX((item->>'position')::INT)
  INTO v_min_pos, v_max_pos
  FROM jsonb_array_elements(p_items) AS item;

  IF v_min_pos != 0 OR v_max_pos != v_n_input - 1 THEN
    RAISE EXCEPTION
      'CPM_INVALID_INPUT: positions must be 0..N-1 (got min=%, max=%, N=%)',
      v_min_pos, v_max_pos, v_n_input;
  END IF;

  -- Exactly one primary
  SELECT COUNT(*)
  INTO v_pri_ct
  FROM jsonb_array_elements(p_items) AS item
  WHERE item->>'role' = 'primary';

  IF v_pri_ct != 1 THEN
    RAISE EXCEPTION
      'CPM_INVALID_INPUT: exactly one primary required (got %)', v_pri_ct;
  END IF;

  -- ── Verify CP ownership ─────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM channel_pieces
    WHERE id = p_channel_piece_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'CPM_NOT_FOUND: ChannelPiece not found or not authorized';
  END IF;

  -- ── Lock all CPM rows for this CP (serialize concurrent organize/remove) ────
  BEGIN
    PERFORM id
    FROM channel_piece_media
    WHERE channel_piece_id = p_channel_piece_id AND user_id = v_uid
    ORDER BY id
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'CPM_LOCK_CONFLICT: concurrent operation in progress, please retry';
  END;

  -- ── Verify ID set matches DB exactly ───────────────────────────────────────
  SELECT COUNT(*) INTO v_n_db
  FROM channel_piece_media
  WHERE channel_piece_id = p_channel_piece_id AND user_id = v_uid;

  IF v_n_input != v_n_db THEN
    RAISE EXCEPTION
      'CPM_CONFLICT: payload has % items but ChannelPiece has % '
      '(stale payload or concurrent modification)',
      v_n_input, v_n_db;
  END IF;

  -- Every input ID must exist in DB for this CP/user
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item
    WHERE NOT EXISTS (
      SELECT 1
      FROM channel_piece_media
      WHERE id               = (item->>'id')::UUID
        AND channel_piece_id = p_channel_piece_id
        AND user_id          = v_uid
    )
  ) THEN
    RAISE EXCEPTION
      'CPM_CONFLICT: one or more IDs do not belong to this ChannelPiece';
  END IF;

  -- ── Phase 1: Demote current primary if a different item becomes primary ─────
  -- uq_cpm_cp_primary is IMMEDIATE — must clear old primary before setting new.
  UPDATE channel_piece_media
  SET    role = 'carousel_item', updated_at = NOW()
  WHERE  channel_piece_id = p_channel_piece_id
    AND  user_id          = v_uid
    AND  role             = 'primary'
    AND  id NOT IN (
           SELECT (item->>'id')::UUID
           FROM   jsonb_array_elements(p_items) AS item
           WHERE  item->>'role' = 'primary'
         );

  -- ── Phase 2: Apply all position + role updates ─────────────────────────────
  -- Defer position constraint so we can update positions in any order.
  SET CONSTRAINTS cpm_unique_position DEFERRED;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    UPDATE channel_piece_media
    SET
      position   = (v_item->>'position')::SMALLINT,
      role       = v_item->>'role',
      updated_at = NOW()
    WHERE id               = (v_item->>'id')::UUID
      AND channel_piece_id = p_channel_piece_id
      AND user_id          = v_uid;
  END LOOP;

  -- ── Return updated list ordered by position ────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               c.id,
      'user_id',          c.user_id,
      'channel_piece_id', c.channel_piece_id,
      'image_id',         c.image_id,
      'library_file_id',  c.library_file_id,
      'position',         c.position,
      'role',             c.role,
      'alt_text',         c.alt_text,
      'created_at',       c.created_at,
      'updated_at',       c.updated_at
    )
    ORDER BY c.position ASC, c.created_at ASC
  )
  INTO v_result
  FROM channel_piece_media c
  WHERE c.channel_piece_id = p_channel_piece_id
    AND c.user_id          = v_uid;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Function: remove_channel_piece_media
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION remove_channel_piece_media(
  p_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_uid         UUID    := auth.uid();
  v_cp_id       UUID;
  v_was_primary BOOLEAN;
  v_result      JSONB;
BEGIN
  -- ── Auth ────────────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CPM_UNAUTHORIZED: authentication required';
  END IF;

  -- ── Lock the target CPM (NOWAIT) ───────────────────────────────────────────
  BEGIN
    SELECT channel_piece_id, (role = 'primary')
    INTO   v_cp_id, v_was_primary
    FROM   channel_piece_media
    WHERE  id = p_id AND user_id = v_uid
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'CPM_LOCK_CONFLICT: concurrent operation in progress, please retry';
  END;

  IF v_cp_id IS NULL THEN
    RAISE EXCEPTION 'CPM_NOT_FOUND: media association not found';
  END IF;

  -- ── Lock remaining rows of this CP (for position compaction) ───────────────
  BEGIN
    PERFORM id
    FROM   channel_piece_media
    WHERE  channel_piece_id = v_cp_id
      AND  user_id          = v_uid
      AND  id               != p_id
    ORDER BY id
    FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'CPM_LOCK_CONFLICT: concurrent operation in progress, please retry';
  END;

  -- ── Delete the CPM ─────────────────────────────────────────────────────────
  -- Never touches images, library_files, or S3 objects — association only.
  DELETE FROM channel_piece_media
  WHERE  id = p_id AND user_id = v_uid;

  -- ── Promote new primary if needed ──────────────────────────────────────────
  -- Only when: deleted item was primary AND at least one item remains.
  IF v_was_primary THEN
    UPDATE channel_piece_media
    SET    role = 'primary', updated_at = NOW()
    WHERE  id = (
      SELECT id
      FROM   channel_piece_media
      WHERE  channel_piece_id = v_cp_id AND user_id = v_uid
      ORDER  BY position ASC, created_at ASC
      LIMIT  1
    );
  END IF;

  -- ── Compact positions to 0..N-1 ────────────────────────────────────────────
  -- ROW_NUMBER()-1 reassigns positions sequentially by current order.
  -- Defer position constraint: multiple rows get new positions simultaneously.
  SET CONSTRAINTS cpm_unique_position DEFERRED;

  WITH ranked AS (
    SELECT
      id,
      (ROW_NUMBER() OVER (ORDER BY position ASC, created_at ASC) - 1)::SMALLINT AS new_pos
    FROM channel_piece_media
    WHERE channel_piece_id = v_cp_id AND user_id = v_uid
  )
  UPDATE channel_piece_media c
  SET    position   = r.new_pos,
         updated_at = NOW()
  FROM   ranked r
  WHERE  c.id            = r.id
    AND  c.position      != r.new_pos;  -- skip rows already at the correct position

  -- ── Return final list ───────────────────────────────────────────────────────
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               c.id,
      'user_id',          c.user_id,
      'channel_piece_id', c.channel_piece_id,
      'image_id',         c.image_id,
      'library_file_id',  c.library_file_id,
      'position',         c.position,
      'role',             c.role,
      'alt_text',         c.alt_text,
      'created_at',       c.created_at,
      'updated_at',       c.updated_at
    )
    ORDER BY c.position ASC, c.created_at ASC
  )
  INTO v_result
  FROM channel_piece_media c
  WHERE c.channel_piece_id = v_cp_id
    AND c.user_id          = v_uid;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════════

-- Revoke PUBLIC execute (default in some PG configurations).
REVOKE ALL ON FUNCTION organize_channel_piece_media(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION remove_channel_piece_media(UUID)          FROM PUBLIC;

-- Grant only to authenticated Supabase users.
GRANT EXECUTE ON FUNCTION organize_channel_piece_media(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_channel_piece_media(UUID)          TO authenticated;
