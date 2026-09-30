-- MEDIA_LIBRARY_PRODUCTION_SCOPING_V1
--
-- A LibraryFile gets an OPTIONAL, stable Production association that is independent of its folder:
--
--   LibraryFile
--     |- project_id      Project (already there)
--     |- production_id   editorial context (NEW, nullable)
--     `- folder          the user's own organization (unchanged, path based)
--
-- The association survives a folder rename/move and a Production rename (it is an id, not a name/path),
-- and becomes NULL when the Production is deleted. NULL is a valid domain state (Project-global media,
-- plain uploads, history with no truthful Production).
--
-- Order-safe rollout: the column is nullable and the old application never reads or writes it, so this
-- migration can be applied BEFORE the new code is deployed (the new code requires the column).

-- 1. Column + FK ---------------------------------------------------------------
ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS production_id UUID NULL REFERENCES productions(id) ON DELETE SET NULL;

-- 2. Ownership / Project consistency (extends the migration 046 trigger; nothing is weakened) -------------
-- If production_id is set it must exist, belong to the file's owner AND to the file's own Project.
-- A file that MOVES to another Project without the caller touching production_id cannot keep the old
-- Production, so it is cleared in the same statement; an explicit cross-Project assignment is refused.
CREATE OR REPLACE FUNCTION public.library_files_enforce_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'library_files.project_id must reference a Project of the file owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.source_image_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.source_image_id IS DISTINCT FROM OLD.source_image_id) THEN
    IF NOT EXISTS (SELECT 1 FROM images i WHERE i.id = NEW.source_image_id AND i.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'library_files.source_image_id must reference an image of the file owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.source_render_execution_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.source_render_execution_id IS DISTINCT FROM OLD.source_render_execution_id) THEN
    IF NOT EXISTS (SELECT 1 FROM render_executions r WHERE r.id = NEW.source_render_execution_id AND r.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'library_files.source_render_execution_id must reference a render of the file owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.production_id IS NOT NULL THEN
    IF NEW.project_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM productions pr
       WHERE pr.id = NEW.production_id AND pr.user_id = NEW.user_id AND pr.project_id = NEW.project_id
    ) THEN
      IF TG_OP = 'UPDATE'
         AND NEW.production_id IS NOT DISTINCT FROM OLD.production_id
         AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        -- Moved to another Project (or lost its Project) without touching the Production: it cannot follow.
        NEW.production_id := NULL;
      ELSIF TG_OP = 'INSERT'
         OR NEW.production_id IS DISTINCT FROM OLD.production_id
         OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'library_files.production_id must reference a Production of the file owner in the file''s own Project' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.library_files_enforce_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS library_files_enforce_ownership ON library_files;
CREATE TRIGGER library_files_enforce_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id, production_id, source_image_id, source_render_execution_id ON library_files
  FOR EACH ROW
  EXECUTE FUNCTION public.library_files_enforce_ownership();

-- 3. Grants: production_id joins the bounded set a user session may UPDATE (move clears it; the trigger
-- above is the authority on what value is acceptable). Everything else stays immutable (migration 046).
GRANT UPDATE (production_id) ON library_files TO authenticated;

-- 4. Indexes for the scalable browse/filter queries (scoped to ACTIVE files; newest first, id as tiebreak) ---
--   all Productions / unscoped:  WHERE user_id AND project_id AND deleted_at IS NULL [AND production_id IS NULL]
--   one Production:              WHERE user_id AND project_id AND production_id = $1 AND deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_library_files_browse
  ON library_files (user_id, project_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_library_files_production_browse
  ON library_files (user_id, project_id, production_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND production_id IS NOT NULL;

-- 5. Deterministic, provenance-only backfill ------------------------------------------------------------
-- A Production is written ONLY when durable provenance yields EXACTLY ONE distinct Production that
-- belongs to the file's own Project and owner. No candidate, or conflicting candidates => stays NULL.
-- Never inferred from a folder, a Project having one Production, or timestamps. Re-running is a no-op
-- (WHERE production_id IS NULL). updated_at is not bumped (the files did not change).
ALTER TABLE library_files DISABLE TRIGGER update_library_files_updated_at;

WITH candidates AS (
  -- render execution -> video draft (video renders)
  SELECT lf.id AS file_id, vd.production_id
    FROM library_files lf
    JOIN render_executions re ON re.id = lf.source_render_execution_id
    JOIN video_drafts vd ON vd.id = re.video_draft_id
   WHERE vd.production_id IS NOT NULL
  UNION
  -- render execution -> ChannelPiece -> EditorialContent (static renders)
  SELECT lf.id, ec.production_id
    FROM library_files lf
    JOIN render_executions re ON re.id = lf.source_render_execution_id
    JOIN channel_pieces cp ON cp.id = re.channel_piece_id
    JOIN editorial_contents ec ON ec.id = cp.editorial_content_id
   WHERE ec.production_id IS NOT NULL
  UNION
  -- generated image -> the draft that holds it as its current image
  SELECT lf.id, d.production_id
    FROM library_files lf
    JOIN image_drafts d ON d.current_image_id = lf.source_image_id
   WHERE d.production_id IS NOT NULL
  UNION
  -- generated image -> a draft that recorded it as an attempt
  SELECT lf.id, d.production_id
    FROM library_files lf
    JOIN image_drafts d ON d.production_id IS NOT NULL
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(d.generation_attempts) = 'array' THEN d.generation_attempts ELSE '[]'::jsonb END
    ) AS attempt
   WHERE lf.source_image_id IS NOT NULL AND (attempt ->> 'imageId') = lf.source_image_id::text
  UNION
  -- generated video promoted to Arquivos (the durable promotion pointer)
  SELECT vg.library_file_id, vg.production_id
    FROM video_generations vg
   WHERE vg.library_file_id IS NOT NULL
  UNION
  -- file attached to a ChannelPiece (static save, piece upload)
  SELECT cpm.library_file_id, ec.production_id
    FROM channel_piece_media cpm
    JOIN channel_pieces cp ON cp.id = cpm.channel_piece_id
    JOIN editorial_contents ec ON ec.id = cp.editorial_content_id
   WHERE cpm.library_file_id IS NOT NULL AND ec.production_id IS NOT NULL
),
valid AS (
  SELECT c.file_id, c.production_id
    FROM candidates c
    JOIN library_files lf ON lf.id = c.file_id
    JOIN productions p ON p.id = c.production_id
   WHERE p.project_id = lf.project_id AND p.user_id = lf.user_id
),
unique_choice AS (
  SELECT file_id, (array_agg(DISTINCT production_id))[1] AS production_id
    FROM valid
   GROUP BY file_id
  HAVING count(DISTINCT production_id) = 1
)
UPDATE library_files lf
   SET production_id = uc.production_id
  FROM unique_choice uc
 WHERE lf.id = uc.file_id AND lf.production_id IS NULL;

ALTER TABLE library_files ENABLE TRIGGER update_library_files_updated_at;
