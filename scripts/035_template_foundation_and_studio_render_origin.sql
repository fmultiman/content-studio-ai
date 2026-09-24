-- 035_template_foundation_and_studio_render_origin.sql
-- Creative Editor Template Foundation V1, per
-- docs/productization/creative-rendering/CREATIVE_EDITOR_TEMPLATE_FOUNDATION_V1.md.
--
-- Additive only. Two independent pieces:
--
-- 1. channel_piece_static_authoring_states.template_id
--    The carousel's Template lives at the ROOT of its authored state. That
--    row's JSONB (`slides`) is an ARRAY, so a root-level key cannot be added
--    to it without changing its shape — hence one plain column. Existing rows
--    default to the first registered Template, which is what they were
--    authored with. Validation of the id stays in the app (code registry).
--
-- 2. library_files.origin + library_files.source_render_execution_id
--    UI DISCOVERY classification, not a new entity: an explicitly saved
--    Creative Editor PNG ("Salvar nesta peca") is still a LibraryFile and
--    still attaches through ChannelPieceMedia exactly as before. `origin`
--    only lets the UI list it under Galeria / "Imagens geradas" instead of
--    Arquivos / "Arquivos do projeto". Scratch renders never get here (they
--    are not LibraryFiles until that explicit save).
--
-- Re-executable (IF NOT EXISTS / guarded DO blocks), same convention as 031/034.

ALTER TABLE channel_piece_static_authoring_states
  ADD COLUMN IF NOT EXISTS template_id TEXT NOT NULL DEFAULT 'editorial-documentary-collage-v1';

ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'upload';

ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS source_render_execution_id UUID REFERENCES render_executions(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'library_files_origin_check') THEN
    ALTER TABLE library_files
      ADD CONSTRAINT library_files_origin_check CHECK (origin IN ('upload', 'studio_render'));
  END IF;
  -- A render provenance link only makes sense on a studio render. One-way on
  -- purpose: ON DELETE SET NULL may later clear the link on a studio render.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'library_files_render_source_origin_check') THEN
    ALTER TABLE library_files
      ADD CONSTRAINT library_files_render_source_origin_check CHECK (source_render_execution_id IS NULL OR origin = 'studio_render');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_library_files_project_origin
  ON library_files(project_id, origin) WHERE deleted_at IS NULL;

-- Backfill: PNGs already saved through "Salvar nesta peca" before `origin`
-- existed. Matched strictly: same owner, a completed static_still execution,
-- and the exact filename the Editor gives a saved render
-- (slide-<i>-de-<n>-<first 8 chars of the execution id>.png).
UPDATE library_files lf
SET origin = 'studio_render', source_render_execution_id = re.id
FROM render_executions re
WHERE re.kind = 'static_still'
  AND re.status = 'completed'
  AND re.user_id = lf.user_id
  AND lf.origin = 'upload'
  AND lf.mime_type = 'image/png'
  AND lf.name ~ ('^slide-[0-9]+-de-[0-9]+-' || left(re.id::text, 8) || '\.png$');

-- ============================================================
-- ROLLBACK
-- ============================================================
--   DROP INDEX IF EXISTS idx_library_files_project_origin;
--   ALTER TABLE library_files DROP CONSTRAINT IF EXISTS library_files_render_source_origin_check;
--   ALTER TABLE library_files DROP CONSTRAINT IF EXISTS library_files_origin_check;
--   ALTER TABLE library_files DROP COLUMN IF EXISTS source_render_execution_id;
--   ALTER TABLE library_files DROP COLUMN IF EXISTS origin;
--   ALTER TABLE channel_piece_static_authoring_states DROP COLUMN IF EXISTS template_id;
