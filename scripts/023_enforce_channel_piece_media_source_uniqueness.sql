-- Migration 023: enforce unique source per ChannelPiece
-- Prevents the same image_id or library_file_id from being associated
-- more than once with the same channel_piece_id.
--
-- Two partial unique indexes (one per source type):
--   uq_cpm_cp_image        — (channel_piece_id, image_id)       WHERE image_id IS NOT NULL
--   uq_cpm_cp_library_file — (channel_piece_id, library_file_id) WHERE library_file_id IS NOT NULL
--
-- The cpm_exactly_one_source CHECK constraint already guarantees that exactly
-- one of image_id / library_file_id is non-null per row, so these two partial
-- indexes together cover all rows without overlap.
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS — safe to run multiple times.
-- Does not alter any existing rows, constraints, or RLS policies.

CREATE UNIQUE INDEX IF NOT EXISTS uq_cpm_cp_image
  ON channel_piece_media (channel_piece_id, image_id)
  WHERE image_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cpm_cp_library_file
  ON channel_piece_media (channel_piece_id, library_file_id)
  WHERE library_file_id IS NOT NULL;
