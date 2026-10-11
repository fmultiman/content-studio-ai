-- FUTURE_059 Slice 2 — LOCAL STACK FIXTURE (test-only, never for a hosted database).
--
-- Recreates, in an EMPTY throwaway PostgreSQL 17 cluster, only what the containment proof needs, from the production
-- catalog metadata inspected for docs/productization/FUTURE_059_BYOK_CREDENTIAL_SLICE_2_DESIGN_V1.md:
--   * the Supabase role set (anon, authenticated, service_role BYPASSRLS, authenticator NOINHERIT) with the same
--     inherit flags and statement timeouts as production;
--   * the `auth` helpers the RLS policies call (`auth.uid()` reads the PostgREST `request.jwt.claims` GUC exactly as
--     Supabase's does);
--   * Supabase's default privileges for `public` (new tables get arwdDxtm for the three API roles) so the table's ACL
--     is produced by the SAME mechanism as production, not hand-written;
--   * public.user_settings with production's columns, defaults, constraints and 4 RLS policies.
-- It contains no production row, no user and no key. Dummy users/keys are created by the test, not here.
--
-- NOT reproduced (documented in the report): GoTrue, Kong/apikey gateway, Supabase event triggers
-- (pgrst_ddl_watch), `safeupdate`, extensions, the rest of the schema.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER;
GRANT anon, authenticated, service_role TO authenticator;
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE authenticator SET statement_timeout = '8s';
ALTER ROLE authenticator SET lock_timeout = '8s';

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.user_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  theme text DEFAULT 'dark',
  auto_mode_default boolean DEFAULT true,
  save_prompt_history boolean DEFAULT true,
  notifications_email boolean DEFAULT true,
  notifications_browser boolean DEFAULT false,
  openai_api_key text,
  replicate_api_key text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  nanobanana_api_key text,
  nanobanana_base_url text DEFAULT 'https://api.nanobanana.ai',
  automation_enabled boolean DEFAULT false,
  nanobanana_model text DEFAULT 'v1',
  default_image_model varchar(20) DEFAULT 'openai',
  image_evaluator_enabled boolean DEFAULT false,
  max_refinement_iterations integer DEFAULT 2,
  studio_intensity text NOT NULL DEFAULT 'balanced',
  kling_api_key text,
  gemini_api_key text,
  CONSTRAINT user_settings_pkey PRIMARY KEY (id),
  CONSTRAINT user_settings_user_id_key UNIQUE (user_id),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT user_settings_theme_check CHECK (theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text, 'studio'::text])),
  CONSTRAINT user_settings_studio_intensity_check CHECK (studio_intensity = ANY (ARRAY['soft'::text, 'balanced'::text, 'expressive'::text]))
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_settings_select_own ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_settings_insert_own ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_settings_update_own ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY user_settings_delete_own ON public.user_settings FOR DELETE USING (auth.uid() = user_id);
