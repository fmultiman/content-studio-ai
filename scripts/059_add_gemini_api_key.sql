-- GEMINI_BYOK_CREDENTIAL_STORAGE_V1
-- Add the official Google Gemini API key to the existing per-user BYOK store.
-- This is storage only; no Gemini client or execution path is enabled here.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS gemini_api_key TEXT DEFAULT NULL;

COMMENT ON COLUMN public.user_settings.gemini_api_key IS
  'User-owned official Google Gemini API key. Server-side BYOK credential; never returned to clients.';
