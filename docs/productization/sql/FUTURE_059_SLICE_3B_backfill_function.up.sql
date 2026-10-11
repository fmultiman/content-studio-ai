-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3B — atomic, race-safe backfill function (PROPOSED, NOT APPLIED).
--
-- WHY THIS EXISTS (the smallest change the data model needs). Moving a legacy plaintext credential into the encrypted table
-- must never overwrite a newer credential and never resurrect a removed one. A plain "read legacy, then INSERT encrypted" from
-- the application leaves a window in which the user can remove or replace the credential in between; undoing a wrong insert
-- afterwards is a compensating action that can itself fail. PostgREST cannot express "insert only if the legacy value is still
-- unchanged, atomically", so the check and the insert are done in ONE function, inside ONE transaction, holding a row lock on
-- the owner's `user_settings` row:
--
--   * FOR SHARE on the settings row: a concurrent removal/replacement (UPDATE of the legacy column) either committed BEFORE the
--     lock (the function then sees the new/NULL value and refuses) or waits until the function finishes (its later steps — the
--     dual-mode write order "encrypted first, legacy second", and the removal order "legacy first, encrypted second" — then act on
--     the committed result). Two concurrent backfills both take compatible FOR SHARE locks; the unique index makes exactly one insert.
--   * INSERT ... ON CONFLICT (user_id, provider) DO NOTHING: an encrypted row written meanwhile by the user (or another backfill)
--     is NEVER overwritten.
--   * The legacy value is compared by SHA-256 hash, so the plaintext key is never sent to the database as a parameter (it could
--     otherwise appear in statement/parameter logs). The ciphertext is produced by the application with the BYOK master key.
--
-- Result codes: 'inserted' | 'exists' | 'legacy_changed' | 'no_settings_row'. Nothing else is ever written.
--
-- Run AFTER FUTURE_059_SLICE_3_provider_api_credentials.up.sql, as `postgres`, in ONE transaction. This project's default
-- privileges grant EXECUTE on every new function to anon/authenticated/service_role at CREATE time, so the lock-down is in the
-- SAME transaction (no committed state in which a browser role can call it). Not re-runnable: the guard aborts if it exists.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.provider_api_credentials') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B: apply FUTURE_059_SLICE_3_provider_api_credentials.up.sql first';
  END IF;
  IF to_regprocedure('public.backfill_provider_api_credential(uuid,text,text,text,text,smallint)') IS NOT NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B: function already exists; aborting';
  END IF;
END
$guard$;

CREATE FUNCTION public.backfill_provider_api_credential(
  p_user_id               uuid,
  p_provider              text,
  p_expected_legacy_sha256 text,
  p_ciphertext            text,
  p_key_id                text,
  p_format_version        smallint
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  current_legacy text;
BEGIN
  IF p_provider NOT IN ('openai', 'gemini', 'nano_banana', 'kling') THEN
    RAISE EXCEPTION 'unsupported provider';
  END IF;
  IF p_expected_legacy_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid expected hash';
  END IF;

  -- Lock the owner's settings row for the rest of this transaction and read the CURRENT legacy value under that lock.
  SELECT CASE p_provider
           WHEN 'openai'      THEN openai_api_key
           WHEN 'gemini'      THEN gemini_api_key
           WHEN 'nano_banana' THEN nanobanana_api_key
           WHEN 'kling'       THEN kling_api_key
         END
    INTO current_legacy
    FROM public.user_settings
   WHERE user_id = p_user_id
     FOR SHARE;

  IF NOT FOUND THEN
    RETURN 'no_settings_row';
  END IF;

  IF current_legacy IS NULL
     OR encode(sha256(convert_to(current_legacy, 'UTF8')), 'hex') <> p_expected_legacy_sha256 THEN
    RETURN 'legacy_changed';
  END IF;

  INSERT INTO public.provider_api_credentials (user_id, provider, ciphertext, key_id, format_version, secret_version, source)
  VALUES (p_user_id, p_provider, p_ciphertext, p_key_id, p_format_version, 1, 'legacy_backfill')
  ON CONFLICT (user_id, provider) DO NOTHING;

  IF FOUND THEN
    RETURN 'inserted';
  END IF;
  RETURN 'exists';
END
$fn$;

REVOKE ALL ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) FROM anon;
REVOKE ALL ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) FROM authenticated;
REVOKE ALL ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) FROM service_role;
GRANT EXECUTE ON FUNCTION public.backfill_provider_api_credential(uuid, text, text, text, text, smallint) TO service_role;

DO $verify$
DECLARE
  fn oid := 'public.backfill_provider_api_credential(uuid,text,text,text,text,smallint)'::regprocedure;
  acl text;
BEGIN
  IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B verify: a browser role can execute the backfill function';
  END IF;
  IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B verify: service_role cannot execute the backfill function';
  END IF;
  SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(proacl) a) INTO acl FROM pg_proc WHERE oid = fn;
  IF acl IS DISTINCT FROM 'postgres=X/postgres,service_role=X/postgres' THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B verify: unexpected function ACL (%)', acl;
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = fn) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3B verify: function must be SECURITY INVOKER';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
