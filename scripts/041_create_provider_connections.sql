-- KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
--
-- Provider connections for user-owned OAuth accounts (first case: Kling MCP).
-- Additive and backward-compatible: no existing table or column is touched.
-- The existing Kling REST API key stays in user_settings.kling_api_key.
--
-- Four separate authorities, deliberately not merged:
--   provider_connections            safe, non-secret metadata; owner may READ it
--   provider_connection_secrets     encrypted OAuth token material; server only
--   provider_oauth_clients          Content Studio's OAuth client registration; server only
--   provider_oauth_authorizations   short-lived PKCE/state attempts; server only
--
-- Every write goes through trusted server code using the service role. The
-- browser-facing `authenticated` role can only SELECT its own provider_connections
-- rows. Secret-bearing tables have RLS enabled with NO policies AND all table
-- privileges revoked from anon/authenticated (defense in depth — a policy
-- mistake alone cannot expose them).
--
-- Rollback (safe; nothing else depends on these tables):
--   DROP TABLE IF EXISTS provider_oauth_authorizations, provider_oauth_clients,
--                        provider_connection_secrets, provider_connections;

-- ---------------------------------------------------------------------------
-- 1. Safe connection metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('kling')),
  connection_method TEXT NOT NULL CHECK (connection_method IN ('mcp_oauth')),
  -- "not_configured" is the absence of a row, not a stored state.
  status TEXT NOT NULL CHECK (status IN ('connected', 'authorization_required', 'error')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  external_account_id TEXT,
  -- Safe capability snapshot only (tool names, model ids, membership label).
  -- Never tokens, never raw OAuth responses, never a credit balance.
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_connections_one_per_user_method UNIQUE (user_id, provider, connection_method)
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_user ON provider_connections(user_id);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_connections_select_own" ON provider_connections;
CREATE POLICY "provider_connections_select_own" ON provider_connections
  FOR SELECT USING (auth.uid() = user_id);

-- Owners may read their safe metadata; all writes are server-side (service role).
REVOKE ALL ON TABLE provider_connections FROM anon, authenticated;
GRANT SELECT ON TABLE provider_connections TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Encrypted token material — server only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_connection_secrets (
  connection_id UUID PRIMARY KEY REFERENCES provider_connections(id) ON DELETE CASCADE,
  -- AES-256-GCM, versioned: v1.<key id>.<iv>.<tag>.<ciphertext>. Contains the
  -- access token, refresh token and token type. Never plaintext.
  ciphertext TEXT NOT NULL,
  -- Access-token expiry is not itself a secret; kept in the clear to decide
  -- when to refresh without decrypting.
  access_token_expires_at TIMESTAMPTZ,
  -- Optimistic-concurrency version so parallel serverless refreshes cannot
  -- overwrite a newer (possibly rotated) refresh token.
  secret_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE provider_connection_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: RLS denies every non-service-role access.
REVOKE ALL ON TABLE provider_connection_secrets FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Content Studio's OAuth client registration (per provider + environment)
--    Not a user secret, and not a user connection. One registration serves all
--    users of an environment (public client; the redirect URI keys the env).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  issuer TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_id TEXT NOT NULL,
  -- Encrypted registration-management material (client_secret,
  -- registration_access_token) if the provider returns any. NULL otherwise.
  management_ciphertext TEXT,
  -- Names only (never values) of the fields the provider returned, kept as
  -- evidence about the provider's DCR behavior.
  registration_response_fields TEXT[] NOT NULL DEFAULT '{}',
  registered_scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_oauth_clients_unique UNIQUE (provider, issuer, redirect_uri)
);

ALTER TABLE provider_oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_oauth_clients FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Short-lived OAuth authorization attempts (PKCE verifier + state)
--    A table (not a cookie or memory) because serverless instances share no
--    memory, and single-use state needs an atomic delete-and-return. Rows are
--    deleted on use and swept when expired.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_oauth_authorizations (
  -- SHA-256 of the state value; the raw state is never stored.
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  connection_method TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  -- Encrypted PKCE code_verifier; server-authoritative until code exchange.
  code_verifier_ciphertext TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_oauth_authorizations_expires ON provider_oauth_authorizations(expires_at);

ALTER TABLE provider_oauth_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_oauth_authorizations FROM anon, authenticated;
