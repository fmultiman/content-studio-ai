-- AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1
--
-- A provider-agnostic, APPEND-ONLY ledger of what an AI provider execution used.
-- This is usage OBSERVABILITY, not billing: provider-native quantities are stored
-- exactly as measured, with the unit they were measured in and HOW they were
-- measured. Nothing here is a price, a currency amount, a wallet or a balance.
--
--   quantity + unit   provider-native, never converted into a common unit
--                     (18 credits and 3 units are not the same thing).
--                     BOTH NULL when the execution is known but its usage is not:
--                     UNKNOWN IS NOT ZERO.
--   measurement_source
--                     provider_reported  the provider stated it for this execution
--                     balance_delta      inferred from an account balance difference
--                                        (weaker: not attributable per task when jobs overlap)
--                     estimated / derived / manual_import
--                                        reserved vocabulary for later producers
--                     unknown            no quantity (must pair with NULL quantity/unit)
--   idempotency_key   one provider charge = one event; completion callbacks and polls
--                     are at-least-once, so the writer upserts with DO NOTHING on it.
--
-- Access model (least privilege, learned from migration 043):
--   * authenticated users may only READ their own rows (RLS SELECT policy);
--   * every write is server-side (service role), which is granted INSERT and SELECT
--     ONLY — no UPDATE, DELETE or TRUNCATE — so history cannot be silently rewritten.
--     A correction is a NEW event. (FK actions on parent deletion run as the table
--     owner and are unaffected.)
--
-- Historical generations are NOT backfilled: their provider usage was never stored.
-- History begins when the writer ships.
--
-- Rollback (drops the ledger and its history):
--   DROP TABLE IF EXISTS provider_usage_events;

CREATE TABLE IF NOT EXISTS provider_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Context. SET NULL: deleting a project/production/connection must not delete
  -- usage history; provider/transport/operation/model remain as provenance.
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES provider_connections(id) ON DELETE SET NULL,

  provider TEXT NOT NULL CHECK (length(provider) > 0),
  -- How Content Studio reached the provider ('rest' | 'mcp' today; open for future providers).
  transport TEXT NOT NULL CHECK (length(transport) > 0),
  operation TEXT NOT NULL CHECK (length(operation) > 0),
  model TEXT,

  -- The Content Studio entity that used the provider, and the provider's own task id.
  resource_type TEXT NOT NULL CHECK (length(resource_type) > 0),
  resource_id UUID,
  provider_task_id TEXT,

  quantity NUMERIC CHECK (quantity IS NULL OR quantity >= 0),
  unit TEXT CHECK (unit IS NULL OR unit IN (
    'credits', 'units', 'tokens', 'input_tokens', 'output_tokens', 'images', 'seconds', 'requests', 'characters'
  )),
  measurement_source TEXT NOT NULL CHECK (measurement_source IN (
    'provider_reported', 'balance_delta', 'estimated', 'derived', 'manual_import', 'unknown'
  )),
  -- Unknown usage carries no number and no unit; a known quantity always has both and a real source.
  CONSTRAINT provider_usage_events_quantity_shape CHECK (
    (quantity IS NULL AND unit IS NULL AND measurement_source = 'unknown')
    OR (quantity IS NOT NULL AND unit IS NOT NULL AND measurement_source <> 'unknown')
  ),

  -- Small, safe, provider-reported context only (never tokens, secrets or result URLs).
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_usage_events_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_events_user_time
  ON provider_usage_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_usage_events_resource
  ON provider_usage_events (resource_type, resource_id);

ALTER TABLE provider_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_usage_events_select_own" ON provider_usage_events;
CREATE POLICY "provider_usage_events_select_own" ON provider_usage_events
  FOR SELECT USING (auth.uid() = user_id);

-- Owners read their own usage; nobody but the server writes, and the server only appends.
REVOKE ALL ON TABLE provider_usage_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE provider_usage_events TO authenticated;
GRANT SELECT, INSERT ON TABLE provider_usage_events TO service_role;
