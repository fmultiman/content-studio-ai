-- 045_library_files_source_image.sql
-- GENERATED_IMAGE_LIBRARY_PROMOTION_V1
--
-- Durable, race-safe provenance for an explicitly saved generated image.
--
-- A generated image lives in `images` (written from the browser, no Library link).
-- "Salvar em Arquivos" copies its bytes into the canonical Library namespace and
-- registers ONE LibraryFile. The saved object owns its source reference:
--
--   library_files.source_image_id -> images.id   (ON DELETE SET NULL)
--
--   - Deleting the generated-image history row NEVER deletes the LibraryFile or its
--     copied bytes: the reference just becomes NULL.
--   - At most ONE ACTIVE (not soft-deleted) LibraryFile per (user, source image).
--     The unique partial index is the final authority for concurrent promotions;
--     a file moved to Trash (deleted_at set) no longer counts, so the image can be
--     saved again. Restoring a trashed file while an active one exists for the same
--     image is refused by this index (by design).
--
-- Additive only. Existing rows keep source_image_id = NULL (no backfill: historical
-- sources are not inferred). No grants/RLS change: library_files keeps its existing
-- per-user policies, which cover the new column.
--
-- `origin` is intentionally NOT changed. Per migration 035 it is a UI DISCOVERY
-- classification (Arquivos vs Galeria/"Imagens geradas" renders), not provenance;
-- `upload` keeps a promoted image in Arquivos, and source_image_id carries the truth.
--
-- Re-executable (IF NOT EXISTS).

ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS source_image_id UUID REFERENCES images(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_library_files_active_source_image
  ON library_files (user_id, source_image_id)
  WHERE source_image_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- ROLLBACK (manual, only if no application code depends on it)
-- ============================================================
--   DROP INDEX IF EXISTS uq_library_files_active_source_image;
--   ALTER TABLE library_files DROP COLUMN IF EXISTS source_image_id;
