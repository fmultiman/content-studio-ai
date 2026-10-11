-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — backfill function ROLLBACK (PROPOSED, NOT APPLIED).
--
-- Drops the backfill function only. It touches no table and no data; encrypted rows already written stay. After running it the
-- lazy migrate-on-read in `dual` mode and the operator sweep simply fail closed (the application reports `store_failure` for the
-- migration step and keeps serving the legacy value), so this is safe at any time.
--
-- Run as `postgres` in ONE transaction.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.backfill_provider_api_credential(uuid,text,text,text,text,smallint)') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B rollback: function does not exist';
  END IF;
END
$guard$;

DROP FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint);

NOTIFY pgrst, 'reload schema';

COMMIT;
