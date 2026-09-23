-- 034_add_static_still_render_executions.sql
-- Static Render Worker V1 -- lets the existing render execution plane
-- (render_executions + claim_next_render_execution + the VPS worker) also
-- carry STATIC still renders (Creative Editor "Gerar PNG"), per
-- docs/productization/creative-rendering/STATIC_RENDER_WORKER_V1.md.
--
-- Design: one execution table, discriminated by an explicit `kind`.
--   kind = 'video'        -> subject is video_draft_id   (unchanged semantics)
--   kind = 'static_still' -> subject is channel_piece_id (new)
-- The CHECK below makes the subject a strict function of `kind`, so a video
-- row can never lose its VideoDraft and a static row can never pretend to be
-- one. Existing rows default to kind='video' and already satisfy it.
--
-- Additive only: no data rewrite, no RLS/grant change (render_executions
-- stays server-only -- see 031/032), no change to claim_next_render_execution
-- (it returns the full row, which now simply includes `kind`).
--
-- Re-executable, same convention as 031 (IF NOT EXISTS / guarded DO blocks).

ALTER TABLE render_executions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'video';

ALTER TABLE render_executions
  ADD COLUMN IF NOT EXISTS channel_piece_id UUID REFERENCES channel_pieces(id) ON DELETE CASCADE;

-- Static output dimensions (and, opportunistically, video's) -- metadata only.
ALTER TABLE render_executions
  ADD COLUMN IF NOT EXISTS output_width INT CHECK (output_width IS NULL OR output_width > 0);
ALTER TABLE render_executions
  ADD COLUMN IF NOT EXISTS output_height INT CHECK (output_height IS NULL OR output_height > 0);

-- A static row has no VideoDraft. Video rows keep requiring one via the
-- kind/subject CHECK below (the NOT NULL moves from the column to the check).
ALTER TABLE render_executions
  ALTER COLUMN video_draft_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'render_executions_kind_check'
  ) THEN
    ALTER TABLE render_executions
      ADD CONSTRAINT render_executions_kind_check
      CHECK (kind IN ('video', 'static_still'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'render_executions_kind_subject_check'
  ) THEN
    ALTER TABLE render_executions
      ADD CONSTRAINT render_executions_kind_subject_check
      CHECK (
        (kind = 'video' AND video_draft_id IS NOT NULL AND channel_piece_id IS NULL)
        OR
        (kind = 'static_still' AND channel_piece_id IS NOT NULL AND video_draft_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_render_executions_channel_piece_id
  ON render_executions(channel_piece_id) WHERE channel_piece_id IS NOT NULL;

-- ============================================================
-- ROLLBACK (only valid while no static_still rows exist)
-- ============================================================
--   DELETE FROM render_executions WHERE kind = 'static_still';
--   ALTER TABLE render_executions DROP CONSTRAINT IF EXISTS render_executions_kind_subject_check;
--   ALTER TABLE render_executions DROP CONSTRAINT IF EXISTS render_executions_kind_check;
--   DROP INDEX IF EXISTS idx_render_executions_channel_piece_id;
--   ALTER TABLE render_executions ALTER COLUMN video_draft_id SET NOT NULL;
--   ALTER TABLE render_executions DROP COLUMN IF EXISTS output_height;
--   ALTER TABLE render_executions DROP COLUMN IF EXISTS output_width;
--   ALTER TABLE render_executions DROP COLUMN IF EXISTS channel_piece_id;
--   ALTER TABLE render_executions DROP COLUMN IF EXISTS kind;

-- Keep the claim RPC worker-only even if an older baseline omitted its grant hardening.
REVOKE ALL ON FUNCTION public.claim_next_render_execution(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_render_execution(TEXT, INT) TO service_role;
