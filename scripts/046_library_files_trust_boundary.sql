-- LIBRARY_FILE_REGISTRATION_TRUST_HARDENING_V1
--
-- library_files is user-writable through PostgREST (RLS only compares user_id),
-- so a browser session could INSERT/UPDATE a row whose storage_path points at
-- ANOTHER tenant's object, or whose project_id / provenance points at records
-- of another user. The server-side routes now validate all of this, and this
-- migration makes the database itself refuse it, so the direct-table path
-- cannot bypass the routes.
--
-- Privilege/constraint migration only: no table is restructured and no row is
-- rewritten. Every existing row already conforms (verified against Production
-- before this was written: 69/69 paths, 0 foreign Projects, 0 foreign provenance).
--
-- Additive and order-safe: the application code enforces the same rules, so the
-- migration can be applied before or after the deploy.

-- 1. Canonical storage namespace ---------------------------------------------
-- users/{owner}/library/[folder segments/]{uuid}/{file}
-- (keep in lockstep with lib/storage/library-path.ts; a test compares them)
ALTER TABLE library_files
  DROP CONSTRAINT IF EXISTS library_files_storage_path_owner_check;

ALTER TABLE library_files
  ADD CONSTRAINT library_files_storage_path_owner_check CHECK (
    storage_path ~ ('^users/' || user_id::text || '/library/([A-Za-z0-9._-]{1,96}/)*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$')
    AND storage_path !~ '(^|/)\.{1,2}(/|$)'
    AND storage_path !~ '[[:cntrl:]\\]'
  ) NOT VALID;

ALTER TABLE library_files VALIDATE CONSTRAINT library_files_storage_path_owner_check;

-- 2. Ownership of referenced records -----------------------------------------
-- A foreign key only proves the referenced row EXISTS. These references must
-- also belong to the file's owner. Checked on INSERT and whenever the
-- reference changes; ON DELETE SET NULL updates (NULL) are unaffected.
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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.library_files_enforce_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS library_files_enforce_ownership ON library_files;
CREATE TRIGGER library_files_enforce_ownership
  BEFORE INSERT OR UPDATE OF user_id, project_id, source_image_id, source_render_execution_id ON library_files
  FOR EACH ROW
  EXECUTE FUNCTION public.library_files_enforce_ownership();

-- 3. Immutable columns -------------------------------------------------------
-- An existing row's identity, owner, type, size and provenance never change
-- through a user session. The only UPDATEs the product performs are rename,
-- move (folder/project/storage key/url), Trash/restore and thumbnail.
REVOKE UPDATE ON library_files FROM anon, authenticated;
GRANT UPDATE (name, folder, project_id, storage_path, public_url, thumbnail_url, deleted_at)
  ON library_files TO authenticated;
