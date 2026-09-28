-- AI_PROVIDER_CREDENTIALS_BYOK_V1
-- Adds the user-owned Kling provider credential column to the existing
-- user_settings table. This is additive and backward-compatible:
-- - No existing column is altered or dropped.
-- - No existing row is mutated (new column defaults to NULL for every row).
-- - RLS policies already scope user_settings by auth.uid() = user_id, so the
--   new column inherits the same per-user isolation as openai_api_key and
--   nanobanana_api_key without any policy change.
--
-- Rollback: `ALTER TABLE user_settings DROP COLUMN IF EXISTS kling_api_key;`
-- is safe at any time — the column is nullable and no other table or
-- generated column depends on it.

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS kling_api_key TEXT DEFAULT NULL;
