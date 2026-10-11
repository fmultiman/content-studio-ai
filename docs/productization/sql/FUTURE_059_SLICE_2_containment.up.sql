-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_2 — FORWARD (PROPOSED, NOT APPLIED).
--
-- Column-privilege containment of public.user_settings. Privileges only: no data is read, moved, encrypted or
-- changed; no policy, trigger, view or function is created; no column is added or dropped.
--
-- Run as the table owner (`postgres`) in ONE transaction. Table-level privileges are replaced with column-level
-- privileges for `authenticated`; `anon` loses everything; `service_role` and the owner are untouched.
--
-- Why REVOKE the TABLE privilege first: a table-wide SELECT/INSERT/UPDATE grant covers every column, and
-- REVOKE ... (secret_column) cannot subtract from it. The table grant must go, then only allowed columns come back.
--
-- Safe to re-run? NO, on purpose: the precondition requires the exact pre-migration ACL, so a second run (or a run
-- against a table that drifted) aborts before changing anything.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  expected_columns text[] := ARRAY[
    'id','user_id','theme','studio_intensity','auto_mode_default','save_prompt_history','notifications_email',
    'notifications_browser','automation_enabled','default_image_model','image_evaluator_enabled',
    'max_refinement_iterations','nanobanana_base_url','nanobanana_model','created_at','updated_at',
    'openai_api_key','gemini_api_key','nanobanana_api_key','kling_api_key','replicate_api_key'
  ];
  actual_columns text[];
  actual_acl text;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2: public.user_settings not found';
  END IF;

  SELECT array_agg(attname::text ORDER BY attname) INTO actual_columns
    FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attnum > 0 AND NOT attisdropped;
  IF actual_columns IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(expected_columns) c) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2: user_settings columns changed since this migration was reviewed (%). Re-review the allowlist.', actual_columns;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_settings'::regclass) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2: RLS is not enabled on user_settings';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2: unexpected column-level ACLs already exist';
  END IF;

  -- Compared as a sorted list: aclitem order depends on grant history, the privileges are what matter.
  SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) INTO actual_acl FROM pg_class WHERE oid = 'public.user_settings'::regclass;
  IF actual_acl IS DISTINCT FROM 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres' THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2: table ACL is not the reviewed pre-migration state (%). Rollback would not be exact; aborting.', actual_acl;
  END IF;
END
$guard$;

-- 1. anon: nothing. (No anon path ever has a settings row: every policy is auth.uid() = user_id.)
REVOKE ALL ON TABLE public.user_settings FROM anon;

-- 2. authenticated: drop every table-level privilege (this also removes TRUNCATE, REFERENCES, TRIGGER, MAINTAIN)...
REVOKE ALL ON TABLE public.user_settings FROM authenticated;

-- 3. ...then grant back only non-secret columns.
--    READ: every non-secret column (16). Reading these is harmless and keeps existing and future non-secret reads working.
GRANT SELECT (
  id, user_id, theme, studio_intensity, auto_mode_default, save_prompt_history, notifications_email,
  notifications_browser, automation_enabled, default_image_model, image_evaluator_enabled,
  max_refinement_iterations, nanobanana_base_url, nanobanana_model, created_at, updated_at
) ON TABLE public.user_settings TO authenticated;

--    WRITE: only the columns the Settings page upserts today (user_id + 10 preferences). PostgREST's
--    INSERT ... ON CONFLICT (user_id) DO UPDATE SET every supplied column (incl. user_id) needs both INSERT and UPDATE
--    on exactly those columns. The NanoBanana base URL, created_at/updated_at and id are server-managed and are
--    deliberately NOT writable from the browser; the five provider-key columns are never writable from the browser.
GRANT INSERT (
  user_id, theme, studio_intensity, auto_mode_default, save_prompt_history, notifications_email,
  notifications_browser, automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations
) ON TABLE public.user_settings TO authenticated;

GRANT UPDATE (
  user_id, theme, studio_intensity, auto_mode_default, save_prompt_history, notifications_email,
  notifications_browser, automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations
) ON TABLE public.user_settings TO authenticated;

--    Own-row deletion is unchanged (RLS still restricts it to the owner).
GRANT DELETE ON TABLE public.user_settings TO authenticated;

-- 4. Verify the result inside the same transaction; any surprise aborts and rolls back everything above.
DO $verify$
DECLARE
  secret_columns text[] := ARRAY['openai_api_key','gemini_api_key','nanobanana_api_key','kling_api_key','replicate_api_key'];
  role_name text;
  col text;
  priv text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH col IN ARRAY secret_columns LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege(role_name, 'public.user_settings', col, priv) THEN
          RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: % still holds % on %', role_name, priv, col;
        END IF;
      END LOOP;
    END LOOP;
    IF has_table_privilege(role_name, 'public.user_settings', 'SELECT')
       OR has_table_privilege(role_name, 'public.user_settings', 'INSERT')
       OR has_table_privilege(role_name, 'public.user_settings', 'UPDATE')
       OR has_table_privilege(role_name, 'public.user_settings', 'TRUNCATE')
       OR has_table_privilege(role_name, 'public.user_settings', 'REFERENCES')
       OR has_table_privilege(role_name, 'public.user_settings', 'TRIGGER') THEN
      RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: % still holds a table-wide privilege', role_name;
    END IF;
  END LOOP;

  IF has_any_column_privilege('anon', 'public.user_settings', 'SELECT')
     OR has_any_column_privilege('anon', 'public.user_settings', 'INSERT')
     OR has_any_column_privilege('anon', 'public.user_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: anon still holds a column privilege';
  END IF;

  FOREACH col IN ARRAY secret_columns LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF NOT has_column_privilege('service_role', 'public.user_settings', col, priv) THEN
        RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: service_role lost % on %', priv, col;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT (has_column_privilege('authenticated', 'public.user_settings', 'theme', 'SELECT')
          AND has_column_privilege('authenticated', 'public.user_settings', 'theme', 'INSERT')
          AND has_column_privilege('authenticated', 'public.user_settings', 'theme', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.user_settings', 'user_id', 'SELECT')
          AND has_column_privilege('authenticated', 'public.user_settings', 'nanobanana_base_url', 'SELECT')
          AND has_table_privilege('authenticated', 'public.user_settings', 'DELETE')) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: authenticated lost a required non-secret privilege';
  END IF;

  IF has_column_privilege('authenticated', 'public.user_settings', 'nanobanana_base_url', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.user_settings', 'updated_at', 'UPDATE') THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2 verify: authenticated can write a server-managed column';
  END IF;
END
$verify$;

-- 5. Make PostgREST pick the change up immediately (Supabase also reloads on DDL; this is belt and braces).
NOTIFY pgrst, 'reload schema';

COMMIT;
