-- PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1
--
-- The pricing AUTHORITY used to turn factual provider usage (provider_usage_events) into an ESTIMATED
-- list-price-equivalent cost. It is a versioned, effective-dated reference table:
--
--   * a row is one price for one (provider, model, billable category, service tier) over one half-open
--     window [effective_from, effective_to). A price change is a NEW row (and the old row is closed with
--     effective_to), so a past execution is always priced with the rate that applied when it ran;
--   * rows for the same (provider, model, usage_category, service_tier) may never overlap (trigger below):
--     an ambiguous window is rejected at write time instead of being guessed at read time;
--   * every row carries its provenance: the OFFICIAL source url/label, when it was retrieved, and the basis
--     of effective_from: a date the provider EXPLICITLY published, or - when the source publishes no price
--     history, which is the usual case - the day the price was observed at the source. A price is never
--     back-dated: absence of a documented change is NOT evidence that a price stayed the same.
--
-- This table is NOT billing. It does not store what a provider charged anybody. Nothing here touches
-- provider_usage_events (no column added, no row changed): cost is DERIVED ON READ from usage x pricing.
--
-- Access model: public reference data (no tenant column). Signed-in users may read; nobody may write at
-- runtime - not even the service role. The only write path is a reviewed migration.
--
-- Prices are list prices. Free tiers and negotiated terms are not represented (see notes).
--
-- Rollback (derived costs disappear from Settings; usage history is unaffected):
--   DROP TABLE IF EXISTS provider_pricing_versions;
--   DROP FUNCTION IF EXISTS provider_pricing_versions_reject_overlap();

CREATE TABLE IF NOT EXISTS provider_pricing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider TEXT NOT NULL CHECK (length(provider) > 0),
  -- The exact model id as stored in provider_usage_events.model. No wildcards, no families.
  model TEXT NOT NULL CHECK (length(model) > 0),
  -- The BILLABLE category (what the provider prices), not the ledger unit: a ledger row is mapped onto it in code.
  --   input / cached_input / output  token pricing (thinking tokens are priced as output when the provider says so)
  --   unit                           provider "units" (a fixed currency amount per provider unit)
  usage_category TEXT NOT NULL CHECK (usage_category IN ('input', 'cached_input', 'output', 'unit')),
  -- 'standard' is the provider's default tier; 'flex' / 'priority' etc. only when the provider prices them apart.
  service_tier TEXT NOT NULL DEFAULT 'standard' CHECK (length(service_tier) > 0),

  -- price_amount is the price of unit_quantity of unit_name (e.g. 1.50 USD per 1,000,000 tokens).
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit_name TEXT NOT NULL CHECK (unit_name IN ('tokens', 'units', 'credits', 'images', 'seconds', 'requests', 'characters')),
  unit_quantity NUMERIC(24, 6) NOT NULL CHECK (unit_quantity > 0),
  price_amount NUMERIC(24, 12) NOT NULL CHECK (price_amount >= 0),

  -- Half-open window: effective_from <= t < effective_to. NULL effective_to = still current.
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  effective_from_basis TEXT NOT NULL CHECK (effective_from_basis IN (
    'official_effective_date',
    'observed_at_source'
  )),
  CONSTRAINT provider_pricing_versions_window CHECK (effective_to IS NULL OR effective_to > effective_from),

  source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
  source_label TEXT NOT NULL CHECK (length(source_label) > 0),
  retrieved_at TIMESTAMPTZ NOT NULL,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT provider_pricing_versions_version_key
    UNIQUE (provider, model, usage_category, service_tier, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_provider_pricing_versions_lookup
  ON provider_pricing_versions (provider, model, usage_category, service_tier, effective_from DESC);

-- No two windows of the same (provider, model, usage_category, service_tier) may overlap, whatever the
-- currency. Serialised per key so concurrent migrations cannot both pass the check. An identical
-- effective_from is left to the UNIQUE constraint (that is what makes this migration re-runnable).
CREATE OR REPLACE FUNCTION provider_pricing_versions_reject_overlap() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.provider || '|' || NEW.model || '|' || NEW.usage_category || '|' || NEW.service_tier, 0));
  IF EXISTS (
    SELECT 1 FROM provider_pricing_versions o
    WHERE o.provider = NEW.provider
      AND o.model = NEW.model
      AND o.usage_category = NEW.usage_category
      AND o.service_tier = NEW.service_tier
      AND o.id <> NEW.id
      AND o.effective_from <> NEW.effective_from
      AND tstzrange(o.effective_from, o.effective_to, '[)') && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'provider_pricing_versions: overlapping effective window for %/%/%/%', NEW.provider, NEW.model, NEW.usage_category, NEW.service_tier
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_pricing_versions_no_overlap ON provider_pricing_versions;
CREATE TRIGGER provider_pricing_versions_no_overlap
  BEFORE INSERT OR UPDATE ON provider_pricing_versions
  FOR EACH ROW EXECUTE FUNCTION provider_pricing_versions_reject_overlap();

ALTER TABLE provider_pricing_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_pricing_versions_select_authenticated" ON provider_pricing_versions;
CREATE POLICY "provider_pricing_versions_select_authenticated" ON provider_pricing_versions
  FOR SELECT TO authenticated USING (true);

-- Read-only for the app; the only writer is a reviewed migration (the table owner).
REVOKE ALL ON TABLE provider_pricing_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE provider_pricing_versions TO authenticated;
GRANT SELECT ON TABLE provider_pricing_versions TO service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Seed: official list prices retrieved 2026-10-09 (UTC). See docs/architecture/PROVIDER_PRICING_REGISTRY_AND_ESTIMATED_COST_V1.md
-- ---------------------------------------------------------------------------------------------------------
--
-- Gemini API, Paid Tier, USD per 1,000,000 tokens, https://ai.google.dev/gemini-api/docs/pricing
--   * the page prices "Output (including thinking tokens)" as ONE rate, so thinking tokens are priced as output;
--   * input is one rate for text / image / video / audio (3.5 Flash and 3.5 Flash-Lite); no prompt-size threshold;
--   * the page publishes no price history and no effective date, so every Gemini version starts on the day
--     it was OBSERVED at the source (2026-10-09, basis observed_at_source). The model GA dates in the official
--     changelog (gemini-3.5-flash 2026-05-19, gemini-3.5-flash-lite 2026-07-21) prove when a model shipped,
--     NOT what it cost then, so they are deliberately NOT used. Earlier executions stay unpriced until an
--     authoritative historical rate is added as a new version.
--   * Batch pricing is not seeded: it is a separate API surface that never reports a serviceTier.
--   * Context-cache STORAGE (per token-hour) is not seeded: the ledger records no cache duration.
--
-- Kling API, https://kling.ai/document-api/pricing/base/video (rendered page, read 2026-10-09):
--   every price is quoted in provider units with its USD equivalent at 1 unit = $0.14 (e.g. Kling 3.0, 720P,
--   no native audio: "0.6 Units ($0.084) /s"). The page publishes no date, so effective_from is the day it
--   was observed (basis observed_at_source). Kling MCP "credits" have NO published USD mapping and are
--   deliberately not priced.

INSERT INTO provider_pricing_versions
  (provider, model, usage_category, service_tier, currency, unit_name, unit_quantity, price_amount,
   effective_from, effective_from_basis, source_url, source_label, retrieved_at, notes)
VALUES
  -- gemini-3.5-flash
  ('gemini', 'gemini-3.5-flash', 'input',        'standard', 'USD', 'tokens', 1000000,  1.500000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Standard - Paid Tier - Input', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens. Free tier is $0 and is not distinguishable from usage metadata.'),
  ('gemini', 'gemini-3.5-flash', 'cached_input', 'standard', 'USD', 'tokens', 1000000,  0.150000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Standard - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price (per 1M tokens per hour) is not modelled.'),
  ('gemini', 'gemini-3.5-flash', 'output',       'standard', 'USD', 'tokens', 1000000,  9.000000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Standard - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens: thinking tokens are priced at this rate.'),
  ('gemini', 'gemini-3.5-flash', 'input',        'flex',     'USD', 'tokens', 1000000,  0.750000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Flex - Paid Tier - Input', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens.'),
  ('gemini', 'gemini-3.5-flash', 'cached_input', 'flex',     'USD', 'tokens', 1000000,  0.080000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Flex - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price is not modelled.'),
  ('gemini', 'gemini-3.5-flash', 'output',       'flex',     'USD', 'tokens', 1000000,  4.500000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Flex - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens.'),
  ('gemini', 'gemini-3.5-flash', 'input',        'priority', 'USD', 'tokens', 1000000,  2.700000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Priority - Paid Tier - Input', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens.'),
  ('gemini', 'gemini-3.5-flash', 'cached_input', 'priority', 'USD', 'tokens', 1000000,  0.270000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Priority - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price is not modelled.'),
  ('gemini', 'gemini-3.5-flash', 'output',       'priority', 'USD', 'tokens', 1000000, 16.200000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash - Priority - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens.'),
  -- gemini-3.5-flash-lite
  ('gemini', 'gemini-3.5-flash-lite', 'input',        'standard', 'USD', 'tokens', 1000000, 0.300000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Standard - Paid Tier - Input (text / image / video / audio)', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens. Free tier is $0 and is not distinguishable from usage metadata.'),
  ('gemini', 'gemini-3.5-flash-lite', 'cached_input', 'standard', 'USD', 'tokens', 1000000, 0.030000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Standard - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price is not modelled.'),
  ('gemini', 'gemini-3.5-flash-lite', 'output',       'standard', 'USD', 'tokens', 1000000, 2.500000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Standard - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens: thinking tokens are priced at this rate.'),
  ('gemini', 'gemini-3.5-flash-lite', 'input',        'flex',     'USD', 'tokens', 1000000, 0.150000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Flex - Paid Tier - Input (text / image / video / audio)', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens.'),
  ('gemini', 'gemini-3.5-flash-lite', 'cached_input', 'flex',     'USD', 'tokens', 1000000, 0.020000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Flex - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price is not modelled.'),
  ('gemini', 'gemini-3.5-flash-lite', 'output',       'flex',     'USD', 'tokens', 1000000, 1.250000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Flex - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens.'),
  ('gemini', 'gemini-3.5-flash-lite', 'input',        'priority', 'USD', 'tokens', 1000000, 0.540000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Priority - Paid Tier - Input (text / image / video / audio)', '2026-10-09T00:00:00Z', 'Paid-tier list price per 1M tokens.'),
  ('gemini', 'gemini-3.5-flash-lite', 'cached_input', 'priority', 'USD', 'tokens', 1000000, 0.050000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Priority - Paid Tier - Context caching', '2026-10-09T00:00:00Z', 'Cached-content token rate. Storage price is not modelled.'),
  ('gemini', 'gemini-3.5-flash-lite', 'output',       'priority', 'USD', 'tokens', 1000000, 4.500000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Gemini 3.5 Flash-Lite - Priority - Paid Tier - Output (including thinking tokens)', '2026-10-09T00:00:00Z', 'Official output price includes thinking tokens.'),
  -- kling-v3 (Kling 3.0), REST: provider units
  ('kling', 'kling-v3', 'unit', 'standard', 'USD', 'units', 1, 0.140000000000, '2026-10-09T00:00:00Z', 'observed_at_source', 'https://kling.ai/document-api/pricing/base/video', 'Kling AI API pricing - Video - Kling 3.0 (price per unit = $0.14)', '2026-10-09T00:00:00Z', 'List price: 1 unit = $0.14 as quoted by the official pricing page. The page is undated, so the window starts on the day it was observed. Applies to API units (provider_reported), never to MCP credits.')
ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING;
