-- IMAGES_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
--
-- `images` rows are written straight from the browser (the generation flow in
-- /imagens INSERTs and UPDATEs them with the object keys the server-side
-- generators returned), and RLS only compares user_id. A session could
-- therefore store ANOTHER tenant's object key in storage_path/thumbnail_path, or
-- point project_id at a Project of someone else, and have server routes sign or
-- forward it. The routes now validate all of this; this migration makes the
-- database itself refuse it, so the direct-table path cannot bypass them.
--
-- Constraint/trigger migration only: no column privilege is revoked (the
-- generation flow legitimately UPDATEs storage_path, thumbnail_path, image_url,
-- file_size, mime_type, status ... on the owner's own row), no row is rewritten.
-- Every existing row already conforms (verified against Production before this
-- was written: 26/26 rows).
--
-- Additive and order-safe: the application enforces the same rules, so this can
-- be applied before or after the deploy.

-- 1. Canonical key namespace --------------------------------------------------
-- NULL stays valid: legacy rows hold only a provider URL or a data: URL (8 of 26
-- in Production) and were never stored in S3. A non-NULL key must be exactly
--   users/{owner}/images/{uuid}/original.(png|jpg|webp)   storage_path
--   users/{owner}/images/{uuid}/thumb.webp                thumbnail_path
-- (keep in lockstep with lib/storage/image-path.ts; a test compares them)
ALTER TABLE images
  DROP CONSTRAINT IF EXISTS images_storage_path_owner_check;

ALTER TABLE images
  ADD CONSTRAINT images_storage_path_owner_check CHECK (
    storage_path IS NULL
    OR storage_path ~ ('^users/' || user_id::text || '/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/original\.(png|jpg|webp)$')
  ) NOT VALID;

ALTER TABLE images VALIDATE CONSTRAINT images_storage_path_owner_check;

ALTER TABLE images
  DROP CONSTRAINT IF EXISTS images_thumbnail_path_owner_check;

ALTER TABLE images
  ADD CONSTRAINT images_thumbnail_path_owner_check CHECK (
    thumbnail_path IS NULL
    OR thumbnail_path ~ ('^users/' || user_id::text || '/images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/thumb\.webp$')
  ) NOT VALID;

ALTER TABLE images VALIDATE CONSTRAINT images_thumbnail_path_owner_check;

-- 2. Project ownership ---------------------------------------------------------
-- A foreign key only proves the Project EXISTS. It must also belong to the image's
-- owner. Checked on INSERT and whenever project_id changes; ON DELETE SET NULL
-- (NULL) is unaffected.
CREATE OR REPLACE FUNCTION public.images_enforce_project_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'images.project_id must reference a Project of the image owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.images_enforce_project_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS images_enforce_project_owner ON images;
CREATE TRIGGER images_enforce_project_owner
  BEFORE INSERT OR UPDATE OF user_id, project_id ON images
  FOR EACH ROW
  EXECUTE FUNCTION public.images_enforce_project_owner();
