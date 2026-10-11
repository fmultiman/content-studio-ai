-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_2 — ROLLBACK (PROPOSED, NOT APPLIED).
--
-- Restores EXACTLY the pre-migration privileges of public.user_settings, taken from the production catalog:
--   relacl = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   (after a rollback the aclitem ORDER may differ — anon/authenticated are re-appended — the privileges are identical)
--   no column-level ACLs (attacl IS NULL for every column)
--
-- SECURITY TRADEOFF: this RE-EXPOSES the five provider-key columns to the browser roles (the owner's own JWT can
-- read its own keys again; `anon` again holds the privilege, with no rows visible through RLS). It must only be run
-- by the operator after a written decision, and the exposure should be treated as active until Slice 2 is re-applied.
-- If the reason for rollback is a missing NON-secret column, prefer the targeted fix at the bottom instead.
--
-- Run as the table owner (`postgres`) in ONE transaction.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Clears the table-level AND column-level privileges that Slice 2 created for these roles...
REVOKE ALL ON TABLE public.user_settings FROM anon;
REVOKE ALL ON TABLE public.user_settings FROM authenticated;

-- ...then restores the original table-wide grant (PostgreSQL 17: arwdDxtm).
GRANT ALL ON TABLE public.user_settings TO anon;
GRANT ALL ON TABLE public.user_settings TO authenticated;

DO $verify$
BEGIN
  IF (SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) FROM pg_class WHERE oid = 'public.user_settings'::regclass)
       IS DISTINCT FROM 'anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres' THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2 rollback: ACL is not the original state';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.user_settings'::regclass AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_2 rollback: column-level ACLs remain';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- TARGETED ALTERNATIVE (does NOT re-expose any key column): if only a non-secret column is missing for the browser,
-- grant just that column instead of rolling back, e.g.
--   GRANT SELECT (some_non_secret_column) ON TABLE public.user_settings TO authenticated;
--   GRANT INSERT (some_non_secret_column), UPDATE (some_non_secret_column) ON TABLE public.user_settings TO authenticated;
