-- FUTURE_059_BYOK_CREDENTIAL_HARDENING_SLICE_3 — provider_api_credentials (PROPOSED, NOT APPLIED).
--
-- Creates the server-only table that will hold ENCRYPTED provider API keys. Nothing reads or writes it until an operator
-- sets PROVIDER_API_CREDENTIAL_MODE=dual|encrypted; no deploy runs this file; it lives in docs/ on purpose.
--
-- Run as `postgres` in ONE transaction. This project's default privileges grant arwdDxtm on every NEW public table to
-- anon/authenticated/service_role at CREATE time, so the lock-down below is part of the SAME transaction: there is no
-- committed state in which a browser role can see this table. RLS is also enabled with NO policy (defence in depth: even
-- an accidental future GRANT to a browser role would expose no row).
--
-- Contents are ciphertext only (AES-256-GCM envelope, see lib/credentials/byok-crypto.ts). There is no plaintext column.
-- `key_id` is a non-secret copy of the key id inside the token so a rotation job can find rows without decrypting.
--
-- Not re-runnable by design: the guard aborts if the table already exists.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regclass('public.provider_api_credentials') IS NOT NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3: public.provider_api_credentials already exists; aborting';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3: auth.users not found; aborting';
  END IF;
END
$guard$;

CREATE TABLE public.provider_api_credentials (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL,
  -- Replicate is deliberately absent: no consumer, no configured user (it stays on the legacy store until retired).
  provider       text        NOT NULL,
  -- v1.<keyId>.<iv>.<tag>.<ciphertext>; AAD = byok-credential:v1:<user_id>:<provider>; payload = {"v":1,"secret":"..."}
  ciphertext     text        NOT NULL,
  key_id         text        NOT NULL,
  format_version smallint    NOT NULL DEFAULT 1,
  secret_version integer     NOT NULL DEFAULT 1,
  source         text        NOT NULL DEFAULT 'user_entry',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_api_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT provider_api_credentials_user_provider_key UNIQUE (user_id, provider),
  CONSTRAINT provider_api_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT provider_api_credentials_provider_check CHECK (provider IN ('openai', 'gemini', 'nano_banana', 'kling')),
  CONSTRAINT provider_api_credentials_ciphertext_check CHECK (length(ciphertext) > 0),
  CONSTRAINT provider_api_credentials_key_id_check CHECK (length(key_id) BETWEEN 1 AND 64),
  CONSTRAINT provider_api_credentials_format_version_check CHECK (format_version >= 1),
  CONSTRAINT provider_api_credentials_secret_version_check CHECK (secret_version >= 1),
  CONSTRAINT provider_api_credentials_source_check CHECK (source IN ('user_entry', 'legacy_backfill'))
);

CREATE INDEX provider_api_credentials_key_id_idx ON public.provider_api_credentials (key_id);

COMMENT ON TABLE public.provider_api_credentials IS
  'Encrypted BYOK provider API keys (AES-256-GCM envelope). Server-only: service_role access only; no browser role may hold any privilege.';

-- Lock-down, in the SAME transaction as the CREATE (the default privileges just granted arwdDxtm to the API roles).
ALTER TABLE public.provider_api_credentials ENABLE ROW LEVEL SECURITY;  -- deliberately NO policies
REVOKE ALL ON TABLE public.provider_api_credentials FROM PUBLIC;
REVOKE ALL ON TABLE public.provider_api_credentials FROM anon;
REVOKE ALL ON TABLE public.provider_api_credentials FROM authenticated;
REVOKE ALL ON TABLE public.provider_api_credentials FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.provider_api_credentials TO service_role;

DO $verify$
DECLARE
  acl text;
  role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.provider_api_credentials'::regclass) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: RLS is not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.provider_api_credentials'::regclass) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: unexpected RLS policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.provider_api_credentials'::regclass AND attnum > 0 AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: unexpected column-level ACL';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(role_name, 'public.provider_api_credentials', 'SELECT')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'INSERT')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'UPDATE')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'DELETE')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'TRUNCATE')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'REFERENCES')
       OR has_table_privilege(role_name, 'public.provider_api_credentials', 'TRIGGER')
       OR has_any_column_privilege(role_name, 'public.provider_api_credentials', 'SELECT')
       OR has_any_column_privilege(role_name, 'public.provider_api_credentials', 'INSERT')
       OR has_any_column_privilege(role_name, 'public.provider_api_credentials', 'UPDATE') THEN
      RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: % still holds a privilege on provider_api_credentials', role_name;
    END IF;
  END LOOP;

  IF NOT (has_table_privilege('service_role', 'public.provider_api_credentials', 'SELECT')
          AND has_table_privilege('service_role', 'public.provider_api_credentials', 'INSERT')
          AND has_table_privilege('service_role', 'public.provider_api_credentials', 'UPDATE')
          AND has_table_privilege('service_role', 'public.provider_api_credentials', 'DELETE')) THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: service_role lacks a required privilege';
  END IF;

  SELECT (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a) INTO acl
    FROM pg_class WHERE oid = 'public.provider_api_credentials'::regclass;
  IF acl IS DISTINCT FROM 'postgres=arwdDxtm/postgres,service_role=arwd/postgres' THEN
    RAISE EXCEPTION 'FUTURE_059_SLICE_3 verify: unexpected ACL (%)', acl;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
