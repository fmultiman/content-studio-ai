-- UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1
-- Typed, scope-checked provenance. No unchecked subject_type + subject_id pair.

CREATE TABLE IF NOT EXISTS public.media_artifact_provenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES public.media_artifacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  production_id UUID REFERENCES public.productions(id) ON DELETE SET NULL,
  provenance_kind TEXT NOT NULL CHECK (provenance_kind IN ('image_generation', 'video_generation', 'render_execution', 'library', 'upload')),
  image_generation_attempt_id UUID REFERENCES public.image_generation_attempts(id) ON DELETE RESTRICT,
  image_output_id UUID REFERENCES public.images(id) ON DELETE RESTRICT,
  video_generation_id UUID REFERENCES public.video_generations(id) ON DELETE RESTRICT,
  render_execution_id UUID REFERENCES public.render_executions(id) ON DELETE RESTRICT,
  library_file_id UUID REFERENCES public.library_files(id) ON DELETE RESTRICT,
  provenance_key TEXT NOT NULL CHECK (length(btrim(provenance_key)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_artifact_provenance_shape CHECK (
    (provenance_kind = 'image_generation'
      AND image_generation_attempt_id IS NOT NULL AND image_output_id IS NOT NULL
      AND video_generation_id IS NULL AND render_execution_id IS NULL AND library_file_id IS NULL)
    OR (provenance_kind = 'video_generation'
      AND video_generation_id IS NOT NULL
      AND image_generation_attempt_id IS NULL AND image_output_id IS NULL AND render_execution_id IS NULL AND library_file_id IS NULL)
    OR (provenance_kind = 'render_execution'
      AND render_execution_id IS NOT NULL
      AND image_generation_attempt_id IS NULL AND image_output_id IS NULL AND video_generation_id IS NULL AND library_file_id IS NULL)
    OR (provenance_kind IN ('library', 'upload')
      AND library_file_id IS NOT NULL
      AND image_generation_attempt_id IS NULL AND image_output_id IS NULL AND video_generation_id IS NULL AND render_execution_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS media_artifact_provenance_identity_key
  ON public.media_artifact_provenance(artifact_id, provenance_key);
CREATE INDEX IF NOT EXISTS media_artifact_provenance_artifact_idx
  ON public.media_artifact_provenance(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS media_artifact_provenance_image_output_idx
  ON public.media_artifact_provenance(image_output_id)
  WHERE image_output_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_artifact_provenance_render_idx
  ON public.media_artifact_provenance(render_execution_id)
  WHERE render_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_artifact_provenance_library_idx
  ON public.media_artifact_provenance(library_file_id)
  WHERE library_file_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_media_artifact_provenance_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  artifact_row RECORD;
  source_user UUID;
  source_project UUID;
  source_production UUID;
  source_attempt RECORD;
  source_image RECORD;
BEGIN
  SELECT user_id, project_id, production_id
    INTO artifact_row
    FROM public.media_artifacts WHERE id = NEW.artifact_id;
  IF NOT FOUND OR artifact_row.user_id IS DISTINCT FROM NEW.user_id
     OR artifact_row.project_id IS DISTINCT FROM NEW.project_id
     OR artifact_row.production_id IS DISTINCT FROM NEW.production_id THEN
    RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_ARTIFACT_SCOPE_MISMATCH';
  END IF;

  IF NEW.provenance_kind = 'image_generation' THEN
    SELECT user_id, project_id, production_id, result_image_id
      INTO source_attempt FROM public.image_generation_attempts
     WHERE id = NEW.image_generation_attempt_id;
    SELECT user_id, project_id INTO source_image FROM public.images WHERE id = NEW.image_output_id;
    IF NOT FOUND OR source_attempt.user_id IS DISTINCT FROM NEW.user_id
       OR source_attempt.project_id IS DISTINCT FROM NEW.project_id
       OR source_attempt.production_id IS DISTINCT FROM NEW.production_id
       OR source_attempt.result_image_id IS DISTINCT FROM NEW.image_output_id
       OR source_image.user_id IS DISTINCT FROM NEW.user_id
       OR source_image.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_IMAGE_SCOPE_MISMATCH';
    END IF;
  ELSIF NEW.provenance_kind = 'video_generation' THEN
    SELECT user_id, project_id, production_id
      INTO source_user, source_project, source_production
      FROM public.video_generations WHERE id = NEW.video_generation_id;
    IF NOT FOUND OR source_user IS DISTINCT FROM NEW.user_id
       OR source_project IS DISTINCT FROM NEW.project_id
       OR source_production IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_VIDEO_SCOPE_MISMATCH';
    END IF;
  ELSIF NEW.provenance_kind = 'render_execution' THEN
    SELECT user_id, project_id INTO source_user, source_project
      FROM public.render_executions WHERE id = NEW.render_execution_id;
    IF NOT FOUND OR source_user IS DISTINCT FROM NEW.user_id
       OR source_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_RENDER_SCOPE_MISMATCH';
    END IF;
  ELSE
    SELECT user_id, project_id, production_id INTO source_user, source_project, source_production
      FROM public.library_files WHERE id = NEW.library_file_id;
    IF NOT FOUND OR source_user IS DISTINCT FROM NEW.user_id
       OR source_project IS DISTINCT FROM NEW.project_id
       OR source_production IS DISTINCT FROM NEW.production_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_LIBRARY_SCOPE_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_media_artifact_provenance_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.production_id IS DISTINCT FROM OLD.production_id
     OR NEW.provenance_kind IS DISTINCT FROM OLD.provenance_kind
     OR NEW.image_generation_attempt_id IS DISTINCT FROM OLD.image_generation_attempt_id
     OR NEW.image_output_id IS DISTINCT FROM OLD.image_output_id
     OR NEW.video_generation_id IS DISTINCT FROM OLD.video_generation_id
     OR NEW.render_execution_id IS DISTINCT FROM OLD.render_execution_id
     OR NEW.library_file_id IS DISTINCT FROM OLD.library_file_id
     OR NEW.provenance_key IS DISTINCT FROM OLD.provenance_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'MEDIA_ARTIFACT_PROVENANCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_artifact_provenance_scope ON public.media_artifact_provenance;
CREATE TRIGGER media_artifact_provenance_scope
  BEFORE INSERT OR UPDATE ON public.media_artifact_provenance
  FOR EACH ROW EXECUTE FUNCTION public.validate_media_artifact_provenance_scope();

DROP TRIGGER IF EXISTS media_artifact_provenance_immutability ON public.media_artifact_provenance;
CREATE TRIGGER media_artifact_provenance_immutability
  BEFORE UPDATE ON public.media_artifact_provenance
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_artifact_provenance_immutability();

ALTER TABLE public.media_artifact_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_artifact_provenance FROM anon, authenticated;
GRANT SELECT ON TABLE public.media_artifact_provenance TO authenticated;
GRANT ALL ON TABLE public.media_artifact_provenance TO service_role;

DROP POLICY IF EXISTS media_artifact_provenance_select_own ON public.media_artifact_provenance;
CREATE POLICY media_artifact_provenance_select_own
  ON public.media_artifact_provenance FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

