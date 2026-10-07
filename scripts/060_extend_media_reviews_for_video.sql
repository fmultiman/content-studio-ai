-- MEDIA_REVIEWS_VIDEO_SCHEMA_EXTENSION_V1
--
-- Let the existing universal `media_reviews` table persist a VIDEO Review next
-- to the existing IMAGE Review, with the media artifact as the canonical subject.
--
--   IMAGE  (unchanged):  image_attempt_id NOT NULL, image_output_id NOT NULL, artifact image
--   VIDEO  (new):        image_attempt_id NULL,     image_output_id NULL,     artifact video
--
-- Purely additive and metadata-only for existing data:
--   * no row is inserted, updated, deleted or backfilled (ALTER ... DROP NOT NULL,
--     DROP/ADD CHECK and CREATE INDEX never rewrite or touch existing tuples);
--   * every existing row is an image row with both image FKs set, so each new
--     constraint is satisfied by construction;
--   * the existing Image active-attempt index and every other index are untouched.
--
-- No application code depends on this yet. Video Review rows are created only by
-- a later adapter. There is deliberately no second Review table.
--
-- Transaction: the whole script runs as ONE transaction. Either every statement
-- applies or none does. See MEDIA_REVIEWS_VIDEO_SCHEMA_EXTENSION_V1.md for the
-- application procedure, post-apply checks and the rollback caveat.

BEGIN;

-- 1. subject_media_type: image-only -> image | video.
ALTER TABLE public.media_reviews
  DROP CONSTRAINT IF EXISTS media_reviews_subject_media_type_check;
ALTER TABLE public.media_reviews
  ADD CONSTRAINT media_reviews_subject_media_type_check
  CHECK (subject_media_type IN ('image', 'video'));

-- 2. The Image-specific foreign keys stop being PHYSICALLY required. Their
--    semantic requirement for Image Reviews is restored by the shape CHECK below.
ALTER TABLE public.media_reviews ALTER COLUMN image_attempt_id DROP NOT NULL;
ALTER TABLE public.media_reviews ALTER COLUMN image_output_id DROP NOT NULL;

-- 3. Discriminated shape. An Image Review keeps both Image links; a Video Review
--    carries neither (it must never borrow or fabricate an Image Attempt) and is
--    always bound to an artifact. media_artifact_id is already NOT NULL (058); it
--    is repeated here so the discriminated shape is self-describing.
ALTER TABLE public.media_reviews
  DROP CONSTRAINT IF EXISTS media_reviews_subject_shape;
ALTER TABLE public.media_reviews
  ADD CONSTRAINT media_reviews_subject_shape CHECK (
    (subject_media_type = 'image'
      AND image_attempt_id IS NOT NULL
      AND image_output_id IS NOT NULL
      AND media_artifact_id IS NOT NULL)
    OR
    (subject_media_type = 'video'
      AND image_attempt_id IS NULL
      AND image_output_id IS NULL
      AND media_artifact_id IS NOT NULL)
  );

-- 4. Scope validation, branched by subject_media_type.
--
--    IMAGE branch: byte-for-byte the logic installed by migration 058 (verified
--    identical to the live Production function before this migration was
--    authored), now behind an explicit `subject_media_type = 'image'` guard.
--
--    VIDEO branch: validates only invariants that exist in the current schema.
--      * the artifact exists, belongs to the Review owner, and is a video;
--      * the Review's Project/Production equal the artifact's, NULL-safe. A
--        Library video can legitimately have a NULL Project and/or Production;
--        then the Review has NULL as well and nothing is required. A Review can
--        never claim a scope the canonical artifact does not have, and never
--        omits one it does have;
--      * the Project belongs to the owner, and the Production belongs to the
--        owner AND to the Review's Project (a Production without a Project is
--        rejected, exactly as media_artifacts and the Image branch do).
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
  IF NEW.subject_media_type = 'image' THEN
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
  ELSIF NEW.subject_media_type = 'video' THEN
    IF NEW.media_artifact_id IS NULL THEN
      RAISE EXCEPTION 'MEDIA_REVIEW_ARTIFACT_REQUIRED';
    END IF;
    SELECT user_id, project_id, production_id, media_type
      INTO artifact_row FROM public.media_artifacts WHERE id = NEW.media_artifact_id;
    IF NOT FOUND OR artifact_row.user_id IS DISTINCT FROM NEW.user_id
       OR artifact_row.media_type <> 'video'
       OR artifact_row.project_id IS DISTINCT FROM NEW.project_id
       OR artifact_row.production_id IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'MEDIA_REVIEW_ARTIFACT_SCOPE_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION 'MEDIA_REVIEW_UNSUPPORTED_SUBJECT';
  END IF;

  -- Shared ownership checks (identical to migration 058; each applies only when the scope is present).
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

-- The trigger itself (media_reviews_scope) already points at this function and
-- keeps firing BEFORE INSERT OR UPDATE; CREATE OR REPLACE swaps the body in place.
-- guard_media_review_lifecycle is unchanged: it compares columns only and already
-- covers every subject column (including media_artifact_id), so a Video Review is
-- immutable once created and terminal states stay terminal.

-- 5. At most ONE in-flight Video Review per artifact (the Files API upload and the
--    model call are paid and slow, so concurrent duplicates are refused). The
--    predicate lists exactly the in-flight lifecycle states the Image index uses
--    ('pending','running'); 'completed' and 'failed' are terminal and never block,
--    so an artifact keeps an unlimited immutable Review history over time.
CREATE UNIQUE INDEX IF NOT EXISTS media_reviews_active_video_artifact_key
  ON public.media_reviews (media_artifact_id)
  WHERE subject_media_type = 'video' AND status IN ('pending', 'running');

-- media_reviews_active_attempt_key (UNIQUE (image_attempt_id) WHERE status IN
-- ('pending','running')) is intentionally NOT touched: a unique index treats NULLs
-- as distinct, so Video rows (image_attempt_id NULL) can never collide on it and
-- Image behavior is identical to before.

COMMENT ON TABLE public.media_reviews IS
  'Advisory immutable Review executions. Image Reviews carry typed Attempt/output FKs; Video Reviews are bound only to a video media artifact. Discriminated by subject_media_type (media_reviews_subject_shape).';

COMMIT;
