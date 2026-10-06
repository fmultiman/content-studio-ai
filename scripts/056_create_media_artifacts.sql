-- UNIVERSAL_MEDIA_REVIEW_SUBJECT_FOUNDATION_V1
-- Immutable application-owned media versions. A nullable content_hash is
-- permitted only for explicitly marked legacy storage snapshots; new server
-- resolution paths require a real SHA-256 of the stored bytes.

CREATE TABLE IF NOT EXISTS public.media_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  production_id UUID REFERENCES public.productions(id) ON DELETE SET NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  identity_mode TEXT NOT NULL CHECK (identity_mode IN ('sha256', 'legacy_storage_snapshot')),
  storage_provider TEXT NOT NULL CHECK (length(btrim(storage_provider)) > 0),
  storage_path TEXT NOT NULL CHECK (length(btrim(storage_path)) > 0),
  content_hash TEXT,
  identity_fingerprint TEXT NOT NULL CHECK (length(btrim(identity_fingerprint)) > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  mime_type TEXT NOT NULL CHECK (length(btrim(mime_type)) > 0),
  byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    (identity_mode = 'sha256' AND content_hash IS NOT NULL)
    OR identity_mode = 'legacy_storage_snapshot'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS media_artifacts_storage_version_key
  ON public.media_artifacts(user_id, media_type, storage_provider, storage_path, version);
CREATE UNIQUE INDEX IF NOT EXISTS media_artifacts_verified_hash_key
  ON public.media_artifacts(user_id, media_type, storage_provider, storage_path, content_hash)
  WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_artifacts_owner_type_idx
  ON public.media_artifacts(user_id, media_type, created_at DESC);
CREATE INDEX IF NOT EXISTS media_artifacts_hash_idx
  ON public.media_artifacts(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_media_artifact_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  project_owner UUID;
  production_owner UUID;
  production_project UUID;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT p.user_id INTO project_owner FROM public.projects p WHERE p.id = NEW.project_id;
    IF project_owner IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PROJECT_SCOPE_MISMATCH';
    END IF;
  END IF;
  IF NEW.production_id IS NOT NULL THEN
    SELECT p.user_id, p.project_id
      INTO production_owner, production_project
      FROM public.productions p
     WHERE p.id = NEW.production_id;
    IF production_owner IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PRODUCTION_SCOPE_MISMATCH';
    END IF;
    IF production_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'MEDIA_ARTIFACT_PRODUCTION_PROJECT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_media_artifact_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.production_id IS DISTINCT FROM OLD.production_id
     OR NEW.media_type IS DISTINCT FROM OLD.media_type
     OR NEW.identity_mode IS DISTINCT FROM OLD.identity_mode
     OR NEW.storage_provider IS DISTINCT FROM OLD.storage_provider
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.identity_fingerprint IS DISTINCT FROM OLD.identity_fingerprint
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.width IS DISTINCT FROM OLD.width
     OR NEW.height IS DISTINCT FROM OLD.height
     OR NEW.duration_ms IS DISTINCT FROM OLD.duration_ms
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'MEDIA_ARTIFACT_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_artifacts_scope ON public.media_artifacts;
CREATE TRIGGER media_artifacts_scope
  BEFORE INSERT OR UPDATE ON public.media_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.validate_media_artifact_scope();

DROP TRIGGER IF EXISTS media_artifacts_immutability ON public.media_artifacts;
CREATE TRIGGER media_artifacts_immutability
  BEFORE UPDATE ON public.media_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.guard_media_artifact_immutability();

DROP TRIGGER IF EXISTS media_artifacts_updated_at ON public.media_artifacts;
CREATE TRIGGER media_artifacts_updated_at
  BEFORE UPDATE ON public.media_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.media_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_artifacts FROM anon, authenticated;
GRANT SELECT ON TABLE public.media_artifacts TO authenticated;
GRANT ALL ON TABLE public.media_artifacts TO service_role;

DROP POLICY IF EXISTS media_artifacts_select_own ON public.media_artifacts;
CREATE POLICY media_artifacts_select_own
  ON public.media_artifacts FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMENT ON TABLE public.media_artifacts IS
  'Immutable media artifact versions used as universal Review subjects.';
COMMENT ON COLUMN public.media_artifacts.content_hash IS
  'SHA-256 of exact stored bytes for new artifacts; NULL is reserved for explicitly marked legacy snapshots.';
