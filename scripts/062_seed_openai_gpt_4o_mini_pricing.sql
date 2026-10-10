-- FUTURE-054 — PROMPT_ASSISTANCE_USAGE_ACCOUNTING_AND_PRICING_HARDENING_V1
--
-- DATA-ONLY. Adds the OFFICIAL OpenAI list price of ONE model to the pricing authority created by 061. It creates no
-- table, column, policy or function, and it never touches provider_usage_events: cost stays DERIVED ON READ from
-- usage x pricing, so no historical usage row is changed and nothing is backfilled.
--
-- Source (read 2026-10-10, ~13:57 UTC): https://developers.openai.com/api/docs/pricing  ("Standard pricing data";
-- the same figures appear on the model page https://developers.openai.com/api/docs/models/gpt-4o-mini).
--   gpt-4o-mini, Standard, USD per 1,000,000 text tokens:  input 0.15 | cached input 0.075 | output 0.60
-- Not seeded on purpose:
--   * Batch ($0.075 / $0.30), Flex and Priority tiers: Prompt Assistance never requests them, and the derivation only
--     prices a tier the RESPONSE reported (service_tier "default" = Standard). Any other reported tier has no price
--     here, so it resolves to "unavailable", never to the Standard price;
--   * every other OpenAI model (including gpt-3.5-turbo, which Prompt Assistance still offers): no price is
--     added until it is verified, so those executions stay unpriced.
-- The page publishes no price history and no effective date, so effective_from is the day the price was OBSERVED
-- (basis observed_at_source), exactly like the 061 Gemini/Kling seed. Executions before that day stay unpriced;
-- absence of a documented change is not evidence that the price was the same earlier.
--
-- Re-runnable: ON CONFLICT DO NOTHING on the 061 version key.
-- Rollback (derived OpenAI costs disappear; usage history is unaffected):
--   DELETE FROM provider_pricing_versions WHERE provider = 'openai' AND model = 'gpt-4o-mini' AND effective_from = '2026-10-10T00:00:00Z';

INSERT INTO provider_pricing_versions
  (provider, model, usage_category, service_tier, currency, unit_name, unit_quantity, price_amount,
   effective_from, effective_from_basis, source_url, source_label, retrieved_at, notes)
VALUES
  ('openai', 'gpt-4o-mini', 'input',        'standard', 'USD', 'tokens', 1000000, 0.150000000000, '2026-10-10T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - gpt-4o-mini - Standard - Text tokens - Input',        '2026-10-10T13:57:00Z', 'List price per 1M tokens. prompt_tokens includes the cached subset, which is priced separately as cached input.'),
  ('openai', 'gpt-4o-mini', 'cached_input', 'standard', 'USD', 'tokens', 1000000, 0.075000000000, '2026-10-10T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - gpt-4o-mini - Standard - Text tokens - Cached input', '2026-10-10T13:57:00Z', 'List price per 1M cached input tokens (a subset of the prompt tokens).'),
  ('openai', 'gpt-4o-mini', 'output',       'standard', 'USD', 'tokens', 1000000, 0.600000000000, '2026-10-10T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - gpt-4o-mini - Standard - Text tokens - Output',       '2026-10-10T13:57:00Z', 'List price per 1M tokens. completion_tokens already includes any reasoning tokens.')
ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING;
