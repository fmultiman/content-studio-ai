-- UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1
-- Add the canonical artifact subject and bridge all existing normalized Image
-- Reviews without changing their payloads, timestamps, or execution state.

ALTER TABLE public.media_reviews
  ADD COLUMN IF NOT EXISTS media_artifact_id UUID;

ALTER TABLE public.media_reviews
  DROP CONSTRAINT IF EXISTS media_reviews_media_artifact_id_fkey;
ALTER TABLE public.media_reviews
  ADD CONSTRAINT media_reviews_media_artifact_id_fkey
  FOREIGN KEY (media_artifact_id) REFERENCES public.media_artifacts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS media_reviews_artifact_created_idx
  ON public.media_reviews(media_artifact_id, created_at DESC);

-- The existing trigger function does not know the new column. Disable the
-- trigger during the bridge update, then install the scope/lifecycle guards
-- defined below before the migration finishes.
DROP TRIGGER IF EXISTS media_reviews_scope ON public.media_reviews;
DROP TRIGGER IF EXISTS media_reviews_lifecycle ON public.media_reviews;

CREATE OR REPLACE FUNCTION public.validate_media_review_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  attempt_row RECORD;
  output_row RECORD;
  artifact_row RECORD;
  project_owner UUID;
  production_owner UUID;
  production_project UUID;
BEGIN
  SELECT a.user_id, a.project_id, a.production_id, a.result_image_id
    INTO attempt_row
    FROM public.image_generation_attempts a
   WHERE a.id = NEW.image_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_REVIEW_ATTEMPT_NOT_FOUND'; END IF;
  IF attempt_row.user_id IS DISTINCT FROM NEW.user_id
     OR attempt_row.result_image_id IS DISTINCT FROM NEW.image_output_id
     OR attempt_row.project_id IS DISTINCT FROM NEW.project_id
     OR attempt_row.production_id IS DISTINCT FROM NEW.production_id THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_ATTEMPT_SCOPE_MISMATCH';
  END IF;

  SELECT i.user_id, i.project_id INTO output_row
    FROM public.images i WHERE i.id = NEW.image_output_id;
  IF NOT FOUND OR output_row.user_id IS DISTINCT FROM NEW.user_id
     OR (NEW.project_id IS NOT NULL AND output_row.project_id IS DISTINCT FROM NEW.project_id) THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_OUTPUT_SCOPE_MISMATCH';
  END IF;

  IF NEW.media_artifact_id IS NULL THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_ARTIFACT_REQUIRED';
  END IF;
  SELECT user_id, project_id, production_id, media_type
    INTO artifact_row FROM public.media_artifacts WHERE id = NEW.media_artifact_id;
  IF NOT FOUND OR artifact_row.user_id IS DISTINCT FROM NEW.user_id
     OR artifact_row.media_type <> 'image'
     OR artifact_row.project_id IS DISTINCT FROM NEW.project_id
     OR artifact_row.production_id IS DISTINCT FROM NEW.production_id THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_ARTIFACT_SCOPE_MISMATCH';
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT p.user_id INTO project_owner FROM public.projects p WHERE p.id = NEW.project_id;
    IF project_owner IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'MEDIA_REVIEW_PROJECT_SCOPE_MISMATCH'; END IF;
  END IF;
  IF NEW.production_id IS NOT NULL THEN
    SELECT p.user_id, p.project_id INTO production_owner, production_project
      FROM public.productions p WHERE p.id = NEW.production_id;
    IF production_owner IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'MEDIA_REVIEW_PRODUCTION_SCOPE_MISMATCH'; END IF;
    IF production_project IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'MEDIA_REVIEW_PRODUCTION_PROJECT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_media_review_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.subject_media_type IS DISTINCT FROM OLD.subject_media_type
     OR NEW.image_attempt_id IS DISTINCT FROM OLD.image_attempt_id
     OR NEW.image_output_id IS DISTINCT FROM OLD.image_output_id
     OR NEW.media_artifact_id IS DISTINCT FROM OLD.media_artifact_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.production_id IS DISTINCT FROM OLD.production_id
     OR NEW.adapter_key IS DISTINCT FROM OLD.adapter_key
     OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
     OR NEW.review_schema_version IS DISTINCT FROM OLD.review_schema_version
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.subject_snapshot IS DISTINCT FROM OLD.subject_snapshot
     OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_IMMUTABLE_SUBJECT';
  END IF;
  IF OLD.status = 'completed' OR OLD.status = 'failed' THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_TERMINAL_IMMUTABLE';
  END IF;
  IF OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'running', 'failed') THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_INVALID_LIFECYCLE';
  END IF;
  IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'completed', 'failed') THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_INVALID_LIFECYCLE';
  END IF;
  RETURN NEW;
END;
$$;

-- One artifact per existing stored Image output. The legacy snapshot mode is
-- explicit because SQL migrations cannot read the private object bytes to
-- calculate SHA-256. New runtime resolution always uses sha256 mode.
INSERT INTO public.media_artifacts (
  user_id, project_id, production_id, media_type, identity_mode,
  storage_provider, storage_path, content_hash, identity_fingerprint,
  version, mime_type, byte_size, width, height, duration_ms
)
SELECT DISTINCT
  r.user_id,
  r.project_id,
  r.production_id,
  'image',
  'legacy_storage_snapshot',
  COALESCE(i.storage_provider, 's3'),
  i.storage_path,
  NULL::text,
  md5('legacy-image-artifact:' || r.user_id::text || ':' || i.id::text || ':' || COALESCE(i.updated_at::text, '')),
  1,
  COALESCE(i.mime_type, 'image/png'),
  i.file_size,
  NULL::integer,
  NULL::integer,
  NULL::bigint
FROM public.media_reviews r
JOIN public.images i ON i.id = r.image_output_id
WHERE r.media_artifact_id IS NULL
  AND i.storage_path IS NOT NULL
ON CONFLICT (user_id, media_type, storage_provider, storage_path, version) DO NOTHING;

INSERT INTO public.media_artifact_provenance (
  artifact_id, user_id, project_id, production_id, provenance_kind,
  image_generation_attempt_id, image_output_id, provenance_key
)
SELECT DISTINCT
  a.id, r.user_id, r.project_id, r.production_id, 'image_generation',
  r.image_attempt_id, r.image_output_id,
  'image_generation:' || r.image_attempt_id::text || ':' || r.image_output_id::text
FROM public.media_reviews r
JOIN public.images i ON i.id = r.image_output_id
JOIN public.media_artifacts a
  ON a.user_id = r.user_id
 AND a.media_type = 'image'
 AND a.storage_path = i.storage_path
 AND a.version = 1
WHERE r.media_artifact_id IS NULL
ON CONFLICT (artifact_id, provenance_key) DO NOTHING;

UPDATE public.media_reviews r
SET media_artifact_id = a.id
FROM public.images i
JOIN public.media_artifacts a
  ON a.media_type = 'image'
 AND a.storage_path = i.storage_path
 AND a.version = 1
WHERE i.id = r.image_output_id
  AND a.user_id = r.user_id
  AND r.media_artifact_id IS NULL;

DO $$
DECLARE
  review_count INTEGER;
  linked_count INTEGER;
BEGIN
  SELECT count(*) INTO review_count FROM public.media_reviews;
  SELECT count(*) INTO linked_count FROM public.media_reviews WHERE media_artifact_id IS NOT NULL;
  IF review_count <> linked_count THEN
    RAISE EXCEPTION 'MEDIA_REVIEW_ARTIFACT_BACKFILL_MISMATCH: % of % linked', linked_count, review_count;
  END IF;
END;
$$;

ALTER TABLE public.media_reviews
  ALTER COLUMN media_artifact_id SET NOT NULL;

DROP TRIGGER IF EXISTS media_reviews_scope ON public.media_reviews;
CREATE TRIGGER media_reviews_scope
  BEFORE INSERT OR UPDATE ON public.media_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_media_review_scope();

DROP TRIGGER IF EXISTS media_reviews_lifecycle ON public.media_reviews;
CREATE TRIGGER media_reviews_lifecycle
  BEFORE UPDATE ON public.media_reviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_review_lifecycle();
