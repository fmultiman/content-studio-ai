-- FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_D — FORWARD (PROPOSED, NOT APPLIED).
--
-- Image-output pricing support for the existing provider pricing registry (scripts/061) and the Standard paid-tier list
-- prices of the two V1 official Google image models. DDL: ONE check constraint widened. DML: six price rows INSERTED.
-- Nothing is updated or deleted, no table/column/index/trigger/function/policy/grant is created or changed, and
-- provider_usage_events is not touched (cost is DERIVED ON READ from usage x pricing).
--
-- 1. provider_pricing_versions.usage_category CHECK  {input, cached_input, output, unit}
--                                              ->    {input, cached_input, output, image_output, unit}
--    Every existing category stays valid, so every existing row stays valid; nothing else depends on the list
--    (the unique key and the overlap trigger treat usage_category as opaque text).
-- 2. Six versions, USD per 1,000,000 tokens, tier 'standard', source https://ai.google.dev/gemini-api/docs/pricing
--    (page "Last updated 2026-10-09 UTC", read 2026-10-12 04:05 UTC; the page publishes no price history):
--
--      model                          input   text+thinking output   image output
--      gemini-nano-banana-2.1         1.50    7.50                   30.00
--      gemini-3.1-flash-lite-image    0.25    1.50                   30.00
--
--    Both models: 1K image = 1,120 image-output tokens = $0.0336 (30 x 1120 / 1e6). That is INFORMATION: billing stays
--    per reported token; no token count is derived from an image size anywhere.
--    Standard paid tier only. NOT seeded on purpose: Batch (a different API surface that never reports a tier), Flex /
--    Priority (the page shows no such price for these models), context caching (the page says it is not available),
--    the 2K / 4K per-image figures (V1 generates 1K only), the free tier (none exists for these models), and every
--    model that was not approved for V1 (e.g. gemini-3-pro-image, gemini-3.1-flash-image).
--    effective_from is the day the price was OBSERVED at the source (basis observed_at_source), like the 061/062 seeds:
--    nothing is back-dated and executions before that day stay unpriced.
--
-- Run as the table owner (`postgres`) in ONE transaction. Safe to re-run: if the exact post-state already exists it
-- changes nothing; ANY other state (drifted constraint, different ACL/policy, unexpected rows for these models, an
-- image_output row for another model, a seeded value that differs) aborts BEFORE changing anything.
--
-- Deployment order: apply this SQL BEFORE the cost-derivation code change and BEFORE enabling image generation. Old
-- code is safe with the new rows: toPricingVersion() drops an unknown category, so image_output rows are simply
-- ignored (image rows stay "unavailable"), while input / text-output / thinking rows are already priced correctly.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Fingerprint of everything this migration must NOT change: every price row that is not one of the V1 model rows.
CREATE TEMP TABLE _f064d_pre ON COMMIT DROP AS
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest
    FROM public.provider_pricing_versions t
   WHERE NOT (t.provider = 'gemini' AND t.model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'));

DO $guard$
DECLARE
  def text;
BEGIN
  IF to_regclass('public.provider_pricing_versions') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: public.provider_pricing_versions not found (apply 061 first)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.provider_pricing_versions'::regclass) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: RLS is not enabled on provider_pricing_versions';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_pricing_versions') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_pricing_versions'
                      AND policyname = 'provider_pricing_versions_select_authenticated' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: the policy set of provider_pricing_versions is not the reviewed one';
  END IF;
  -- Privileges (checked semantically, not as an ACL string): read-only for the app, no runtime writer, nothing for anon.
  IF NOT has_table_privilege('authenticated', 'public.provider_pricing_versions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.provider_pricing_versions', 'SELECT')
     OR has_table_privilege('anon', 'public.provider_pricing_versions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('anon', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: the privileges of provider_pricing_versions are not the reviewed read-only set';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.provider_pricing_versions'::regclass AND tgname = 'provider_pricing_versions_no_overlap' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_version_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: the overlap trigger or the version key is missing';
  END IF;

  SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') INTO def
    FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: provider_pricing_versions_usage_category_check not found';
  END IF;
  IF def NOT IN (
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''unit''::text])))',
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))'
     ) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: usage_category constraint is neither the pre- nor the post-migration definition (%). Re-review.', def;
  END IF;

  -- The V1 models may carry ONLY the reviewed seed (this migration or a previous run of it).
  IF EXISTS (
    SELECT 1 FROM public.provider_pricing_versions
     WHERE provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image')
       AND NOT (service_tier = 'standard' AND usage_category IN ('input', 'output', 'image_output')
                AND effective_from = '2026-10-12T00:00:00Z' AND effective_to IS NULL)
  ) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: unexpected price history already exists for the V1 image models; sequence it by hand';
  END IF;
  -- Image-output prices are approved for the two V1 models only.
  IF EXISTS (
    SELECT 1 FROM public.provider_pricing_versions
     WHERE usage_category = 'image_output' AND NOT (provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'))
  ) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D: an image_output row exists for a model that was not approved';
  END IF;
END
$guard$;

-- 1. Widen the category list (one atomic statement). Skipped when the post-migration definition is already in place.
DO $widen$
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     = 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''unit''::text])))' THEN
    ALTER TABLE public.provider_pricing_versions
      DROP CONSTRAINT provider_pricing_versions_usage_category_check,
      ADD CONSTRAINT provider_pricing_versions_usage_category_check
        CHECK (usage_category IN ('input', 'cached_input', 'output', 'image_output', 'unit'));
  END IF;
END
$widen$;

-- 2. The six reviewed versions. A version that already exists (same key) is left untouched; the verification below proves
--    the stored values are the reviewed ones, so a drifted row aborts instead of being silently kept.
INSERT INTO public.provider_pricing_versions
  (provider, model, usage_category, service_tier, currency, unit_name, unit_quantity, price_amount,
   effective_from, effective_from_basis, source_url, source_label, retrieved_at, notes)
VALUES
  ('gemini', 'gemini-nano-banana-2.1', 'input',        'standard', 'USD', 'tokens', 1000000,  1.500000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2.1 (gemini-nano-banana-2.1) - Standard - Paid Tier - Input (text / image / video)', '2026-10-12T04:05:00Z', 'List price per 1M tokens. Page "Last updated 2026-10-09 UTC"; no price history is published. No free tier exists for this model. Context caching is not available.'),
  ('gemini', 'gemini-nano-banana-2.1', 'output',       'standard', 'USD', 'tokens', 1000000,  7.500000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2.1 (gemini-nano-banana-2.1) - Standard - Paid Tier - Output (text and thinking)', '2026-10-12T04:05:00Z', 'List price per 1M TEXT and thinking output tokens. Image output tokens are priced by the image_output version, never by this one.'),
  ('gemini', 'gemini-nano-banana-2.1', 'image_output', 'standard', 'USD', 'tokens', 1000000, 30.000000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2.1 (gemini-nano-banana-2.1) - Standard - Paid Tier - Output (images)', '2026-10-12T04:05:00Z', 'List price per 1M IMAGE-modality output tokens. Informational per-image figure on the page: 1K image = 1,120 tokens = $0.0336 (2K = 1,680 tokens = $0.0504; 4K = 3,780 tokens = $0.113). Billing is per reported token.'),
  ('gemini', 'gemini-3.1-flash-lite-image', 'input',        'standard', 'USD', 'tokens', 1000000,  0.250000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2 Lite (gemini-3.1-flash-lite-image) - Standard - Paid Tier - Input (text / image / video)', '2026-10-12T04:05:00Z', 'List price per 1M tokens. Page "Last updated 2026-10-09 UTC"; no price history is published. No free tier exists for this model. Context caching is not available.'),
  ('gemini', 'gemini-3.1-flash-lite-image', 'output',       'standard', 'USD', 'tokens', 1000000,  1.500000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2 Lite (gemini-3.1-flash-lite-image) - Standard - Paid Tier - Output (text and thinking)', '2026-10-12T04:05:00Z', 'List price per 1M TEXT and thinking output tokens. Image output tokens are priced by the image_output version, never by this one.'),
  ('gemini', 'gemini-3.1-flash-lite-image', 'image_output', 'standard', 'USD', 'tokens', 1000000, 30.000000000000, '2026-10-12T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Nano Banana 2 Lite (gemini-3.1-flash-lite-image) - Standard - Paid Tier - Output (images)', '2026-10-12T04:05:00Z', 'List price per 1M IMAGE-modality output tokens. Informational per-image figure on the page: 1K image = 1,120 tokens = $0.0336 (1K only). Billing is per reported token.')
ON CONFLICT ON CONSTRAINT provider_pricing_versions_version_key DO NOTHING;

-- 3. Verification: any failure aborts the whole transaction (nothing is applied).
DO $verify$
DECLARE
  pre record;
  post record;
  matched int;
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     IS DISTINCT FROM 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))' THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D verify: usage_category constraint is not the post-migration definition';
  END IF;

  SELECT * INTO pre FROM _f064d_pre;
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest INTO post
    FROM public.provider_pricing_versions t
   WHERE NOT (t.provider = 'gemini' AND t.model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'));
  IF post.n <> pre.n OR post.digest <> pre.digest THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D verify: an existing price row changed (before % / %, after % / %)', pre.n, pre.digest, post.n, post.digest;
  END IF;

  SELECT count(*)::int INTO matched
    FROM public.provider_pricing_versions p
    JOIN (VALUES
      ('gemini-nano-banana-2.1',      'input',        1.5::numeric),
      ('gemini-nano-banana-2.1',      'output',       7.5::numeric),
      ('gemini-nano-banana-2.1',      'image_output', 30::numeric),
      ('gemini-3.1-flash-lite-image', 'input',        0.25::numeric),
      ('gemini-3.1-flash-lite-image', 'output',       1.5::numeric),
      ('gemini-3.1-flash-lite-image', 'image_output', 30::numeric)
    ) AS e(model, usage_category, price) USING (model, usage_category)
   WHERE p.provider = 'gemini' AND p.service_tier = 'standard' AND p.currency = 'USD' AND p.unit_name = 'tokens'
     AND p.unit_quantity = 1000000 AND p.price_amount = e.price AND p.effective_from = '2026-10-12T00:00:00Z' AND p.effective_to IS NULL
     AND p.effective_from_basis = 'observed_at_source' AND p.source_url = 'https://ai.google.dev/gemini-api/docs/pricing';
  IF matched <> 6 OR (SELECT count(*) FROM public.provider_pricing_versions WHERE provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image')) <> 6 THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D verify: the V1 image price rows are not exactly the six reviewed versions (matched %)', matched;
  END IF;

  IF has_table_privilege('authenticated', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('service_role', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.provider_pricing_versions', 'SELECT') THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D verify: privileges changed';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
