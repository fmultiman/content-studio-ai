-- 036_add_video_draft_timeline.sql
-- VIDEO_TIMELINE_GATE_B_INDEPENDENT_TEMPORAL_COMPOSITION_V1, per
-- docs/productization/creative-rendering/VIDEO_TIMELINE_GATE_B_INDEPENDENT_TEMPORAL_COMPOSITION_V1.md.
--
-- Additive only. One nullable JSONB column for the VideoDraft's AUTHORED
-- independent temporal layer (B-roll, lower thirds, audio): items with their
-- own absolute start/duration, next to the primary Scene sequence in `scenes`.
--
-- `scenes` is a JSONB ARRAY, so a root-level field cannot be added to it
-- without reshaping it (same factual constraint as migration 035 for Static).
-- NULL = no independent items (every draft before this). This column is
-- authoring state, never a TimelineManifest (that stays derived, on demand).
-- Shape validation stays in the app (app/api/video-drafts).
--
-- Re-executable (IF NOT EXISTS), same convention as 031/034/035.

ALTER TABLE video_drafts
  ADD COLUMN IF NOT EXISTS timeline JSONB;

COMMENT ON COLUMN video_drafts.timeline IS
  'Authored independent temporal items (Gate B): {version, items[{id, kind visual|text|audio, start_frame, duration_frames, ...payload}]}. NULL = none. Not a TimelineManifest.';
