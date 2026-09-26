-- 037_add_video_draft_canvas.sql
-- VIDEO_CANVAS_OUTPUT_FORMAT_V1, per
-- docs/productization/creative-rendering/VIDEO_CANVAS_OUTPUT_FORMAT_V1.md.
--
-- Additive only. One nullable JSONB column for the VideoDraft's AUTHORED output
-- stage {width, height} in px, shared by every Scene and root timeline item.
--
-- Why a column: `scenes` is a JSONB ARRAY (no room for a document-level field
-- without reshaping it), and `timeline` is the root TEMPORAL authority — the
-- output stage is spatial/output authority and must not live inside it.
-- NULL = the legacy 1080×1920 stage every draft rendered at before; existing
-- rows are never backfilled. Shape/bounds validation stays in the app
-- (app/api/video-drafts, lib/creative/video-editor/video-canvas.ts).
--
-- Re-executable (IF NOT EXISTS), same convention as 031/034/035/036.

ALTER TABLE video_drafts
  ADD COLUMN IF NOT EXISTS canvas JSONB;

COMMENT ON COLUMN video_drafts.canvas IS
  'Authored output stage {width, height} in px (VIDEO_CANVAS_OUTPUT_FORMAT_V1). NULL = legacy 1080x1920. Not per Scene; source media never defines it.';
