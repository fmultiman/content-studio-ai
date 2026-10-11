-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3 — provider_api_credentials ROLLBACK (PROPOSED, NOT APPLIED).
--
-- Drops the encrypted credential table. DATA-LOSS GUARD: the script refuses to run while the table still holds rows,
-- because dropping it would destroy the only copy of any credential that was entered or migrated while an active mode
-- (dual/encrypted) was in use. Before running it:
--   1. set PROVIDER_API_CREDENTIAL_MODE back to `legacy` (or unset) and redeploy; in `dual` mode every user write also
--      refreshed the legacy column, in `encrypted` mode it did NOT — do not drop the table until each affected user has
--      re-entered their key or a reviewed export/restore into the legacy columns has been performed;
--   2. confirm with a counts-only query that the table is empty or that every row is reproducible.
-- Dropping the table does not touch `user_settings`, the Slice 2 privileges, or Kling MCP secrets.
--
-- Run as `postgres` in ONE transaction.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.provider_api_credentials') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 rollback: public.provider_api_credentials does not exist';
  END IF;
  EXECUTE 'SELECT count(*) FROM public.provider_api_credentials' INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 rollback: refusing to drop a table that still holds % encrypted credential row(s)', n;
  END IF;
END
$guard$;

DROP TABLE public.provider_api_credentials;

NOTIFY pgrst, 'reload schema';

COMMIT;
