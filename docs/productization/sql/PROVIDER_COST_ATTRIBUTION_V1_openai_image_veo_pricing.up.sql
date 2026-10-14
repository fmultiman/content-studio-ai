-- PROVIDER_COST_ATTRIBUTION_V1 — FORWARD (PROPOSED, NOT APPLIED).
--
-- Official list prices for OpenAI GPT Image 2 and Google Veo 3.1, added to the existing provider pricing registry (scripts/061).
-- DDL: ONE check constraint widened (usage_category). DML: 11 price rows INSERTED. Nothing is updated or deleted, no table / column /
-- index / trigger / function / policy / grant is created or changed, and provider_usage_events is NOT touched (cost is DERIVED ON READ
-- from usage x pricing, so no historical usage row changes and nothing is backfilled).
--
-- 1. provider_pricing_versions.usage_category CHECK
--      {input, cached_input, output, image_output, unit}                        (Production today, after FUTURE-064 Slice D)
--    ->{input, cached_input, output, image_output, image_input, unit, video_second_720p, video_second_1080p, video_second_4k}
--    Every existing category stays valid, so every existing row stays valid.
-- 2. OpenAI gpt-image-2, Standard, USD per 1,000,000 tokens — https://developers.openai.com/api/docs/pricing (read 2026-10-14 ~12:15 UTC):
--      text input 5.00 | image input 8.00 | image output 30.00
--    NOT seeded on purpose: Batch (2.50 / 4.00 / 15.00: a different API surface), cached input (1.25 / 2.00: the page says it only applies
--    to images generated with the Responses API; Content Studio uses images/edits), text output (GPT Image 2 publishes none).
--    Real canary (2026-10-13): 30 text-in + 1024 image-in + 1756 image-out = 0.00015 + 0.008192 + 0.05268 = USD 0.061022.
-- 3. Google Veo 3.1, paid tier, USD per generated SECOND of video with audio — https://ai.google.dev/gemini-api/docs/pricing (read 2026-10-14 ~12:20 UTC):
--      model                          720p    1080p   4k
--      veo-3.1-generate-preview       0.40    0.40    0.60     (Standard)
--      veo-3.1-fast-generate-preview  0.10    0.12    0.30     (Fast)
--      veo-3.1-lite-generate-preview  0.05    0.08    -        (Lite; 4k output is not supported, so no 4k row exists)
--    The free tier is "unavailable" for Veo. The page notes a video is only charged when it is generated.
--
-- Both pages publish no price history and no effective date, so every version starts on the day the price was OBSERVED (2026-10-14,
-- basis observed_at_source), exactly like the 061 / 062 / Slice D seeds: nothing is back-dated and an execution before that day is
-- never given a period estimate (the application shows it only as a clearly separate simulation at this price).
--
-- Run as the table owner (`postgres`) in ONE transaction. Safe to re-run: if the exact post-state already exists it changes nothing;
-- ANY other state (drifted constraint, different ACL/policy, unexpected rows for these models, a seeded value that differs, a new
-- category used by another model) aborts BEFORE changing anything.
--
-- Deployment order: either. The new application code works against the old registry (these models then show "Preço indisponível"),
-- and the OLD code ignores rows with a category it does not know (toPricingVersion drops them), so it is safe with these rows.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Fingerprint of everything this migration must NOT change: every price row outside the reviewed models.
CREATE TEMP TABLE _pca_pre ON COMMIT DROP AS
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest
    FROM public.provider_pricing_versions t
   WHERE NOT ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')));

DO $guard$
DECLARE
  def text;
BEGIN
  IF to_regclass('public.provider_pricing_versions') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: public.provider_pricing_versions not found (apply 061 first)';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.provider_pricing_versions'::regclass) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: RLS is not enabled on provider_pricing_versions';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_pricing_versions') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'provider_pricing_versions'
                      AND policyname = 'provider_pricing_versions_select_authenticated' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: the policy set of provider_pricing_versions is not the reviewed one';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.provider_pricing_versions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.provider_pricing_versions', 'SELECT')
     OR has_table_privilege('anon', 'public.provider_pricing_versions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('anon', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: the privileges of provider_pricing_versions are not the reviewed read-only set';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.provider_pricing_versions'::regclass AND tgname = 'provider_pricing_versions_no_overlap' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_version_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: the overlap trigger or the version key is missing';
  END IF;

  SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') INTO def
    FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: provider_pricing_versions_usage_category_check not found';
  END IF;
  -- Only the Slice D state (what Production has) or this migration's own post-state are accepted; the pre-Slice-D list is NOT (apply Slice D first).
  IF def NOT IN (
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))',
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''image_input''::text,''unit''::text,''video_second_720p''::text,''video_second_1080p''::text,''video_second_4k''::text])))'
     ) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: usage_category constraint is neither the Slice D nor the post-migration definition (%). Re-review.', def;
  END IF;

  -- The reviewed models may carry ONLY the reviewed seed (this migration or a previous run of it).
  IF EXISTS (
    SELECT 1 FROM public.provider_pricing_versions t
     WHERE ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))
       AND NOT (t.service_tier = 'standard' AND t.effective_from = '2026-10-14T00:00:00Z' AND t.effective_to IS NULL
                AND t.usage_category IN ('input', 'image_input', 'image_output', 'video_second_720p', 'video_second_1080p', 'video_second_4k'))
  ) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: unexpected price history already exists for the reviewed models; sequence it by hand';
  END IF;
  -- The new categories are approved for these models only.
  IF EXISTS (
    SELECT 1 FROM public.provider_pricing_versions t
     WHERE t.usage_category IN ('image_input', 'video_second_720p', 'video_second_1080p', 'video_second_4k') AND NOT ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))
  ) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1: a new-category row exists for a model that was not approved';
  END IF;
END
$guard$;

-- 1. Widen the category list (one atomic statement). Skipped when the post-migration definition is already in place.
DO $widen$
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     = 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))' THEN
    ALTER TABLE public.provider_pricing_versions
      DROP CONSTRAINT provider_pricing_versions_usage_category_check,
      ADD CONSTRAINT provider_pricing_versions_usage_category_check
        CHECK (usage_category IN ('input', 'cached_input', 'output', 'image_output', 'image_input', 'unit', 'video_second_720p', 'video_second_1080p', 'video_second_4k'));
  END IF;
END
$widen$;

-- 2. The 11 reviewed versions. A version that already exists (same key) is left untouched; the verification below proves the stored
--    values are the reviewed ones, so a drifted row aborts instead of being silently kept.
INSERT INTO public.provider_pricing_versions
  (provider, model, usage_category, service_tier, currency, unit_name, unit_quantity, price_amount,
   effective_from, effective_from_basis, source_url, source_label, retrieved_at, notes)
VALUES
  ('openai', 'gpt-image-2', 'input', 'standard', 'USD', 'tokens', 1000000, 5.000000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - Image generation models - Standard - gpt-image-2 - Text - Input', '2026-10-14T12:20:00Z', 'List price per 1M TEXT input tokens (Standard). Batch ($2.50) and cached input ($1.25, Responses API only) are not used.'),
  ('openai', 'gpt-image-2', 'image_input', 'standard', 'USD', 'tokens', 1000000, 8.000000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - Image generation models - Standard - gpt-image-2 - Image - Input', '2026-10-14T12:20:00Z', 'List price per 1M IMAGE input tokens (Standard). Image input tokens are INCLUDED in the aggregate input_tokens and priced by this version, never by the text input one. Batch ($4.00) and cached input ($2.00, Responses API only) are not used.'),
  ('openai', 'gpt-image-2', 'image_output', 'standard', 'USD', 'tokens', 1000000, 30.000000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://developers.openai.com/api/docs/pricing', 'OpenAI API pricing - Image generation models - Standard - gpt-image-2 - Image - Output', '2026-10-14T12:20:00Z', 'List price per 1M IMAGE output tokens (Standard). Batch ($15.00) is not used. GPT Image 2 publishes NO text-output price, so none is seeded.'),
  ('gemini', 'veo-3.1-generate-preview', 'video_second_720p', 'standard', 'USD', 'seconds', 1, 0.400000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Standard (veo-3.1-generate-preview) - Paid Tier - Video with audio - 720p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 720p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-generate-preview', 'video_second_1080p', 'standard', 'USD', 'seconds', 1, 0.400000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Standard (veo-3.1-generate-preview) - Paid Tier - Video with audio - 1080p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 1080p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-generate-preview', 'video_second_4k', 'standard', 'USD', 'seconds', 1, 0.600000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Standard (veo-3.1-generate-preview) - Paid Tier - Video with audio - 4k (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 4k, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-fast-generate-preview', 'video_second_720p', 'standard', 'USD', 'seconds', 1, 0.100000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Fast (veo-3.1-fast-generate-preview) - Paid Tier - Video with audio - 720p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 720p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-fast-generate-preview', 'video_second_1080p', 'standard', 'USD', 'seconds', 1, 0.120000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Fast (veo-3.1-fast-generate-preview) - Paid Tier - Video with audio - 1080p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 1080p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-fast-generate-preview', 'video_second_4k', 'standard', 'USD', 'seconds', 1, 0.300000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Fast (veo-3.1-fast-generate-preview) - Paid Tier - Video with audio - 4k (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 4k, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-lite-generate-preview', 'video_second_720p', 'standard', 'USD', 'seconds', 1, 0.050000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Lite (veo-3.1-lite-generate-preview) - Paid Tier - Video with audio - 720p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 720p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.'),
  ('gemini', 'veo-3.1-lite-generate-preview', 'video_second_1080p', 'standard', 'USD', 'seconds', 1, 0.080000000000, '2026-10-14T00:00:00Z', 'observed_at_source', 'https://ai.google.dev/gemini-api/docs/pricing', 'Gemini API pricing - Veo 3.1 Lite (veo-3.1-lite-generate-preview) - Paid Tier - Video with audio - 1080p (per second)', '2026-10-14T12:20:00Z', 'List price per generated SECOND of video with audio at 1080p, paid tier, real-time (standard) API. The free tier is unavailable for Veo. A video is only charged when it is generated. The billed seconds are DERIVED by Content Studio from the delivered request, not reported by the provider.')
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
     IS DISTINCT FROM 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''image_input''::text,''unit''::text,''video_second_720p''::text,''video_second_1080p''::text,''video_second_4k''::text])))' THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 verify: usage_category constraint is not the post-migration definition';
  END IF;

  SELECT * INTO pre FROM _pca_pre;
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest INTO post
    FROM public.provider_pricing_versions t
   WHERE NOT ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')));
  IF post.n <> pre.n OR post.digest <> pre.digest THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 verify: an existing price row changed (before % / %, after % / %)', pre.n, pre.digest, post.n, post.digest;
  END IF;

  SELECT count(*)::int INTO matched
    FROM public.provider_pricing_versions p
    JOIN (VALUES
      ('gpt-image-2', 'input', 5.000000000000::numeric, 'tokens', 1000000),
      ('gpt-image-2', 'image_input', 8.000000000000::numeric, 'tokens', 1000000),
      ('gpt-image-2', 'image_output', 30.000000000000::numeric, 'tokens', 1000000),
      ('veo-3.1-generate-preview', 'video_second_720p', 0.400000000000::numeric, 'seconds', 1),
      ('veo-3.1-generate-preview', 'video_second_1080p', 0.400000000000::numeric, 'seconds', 1),
      ('veo-3.1-generate-preview', 'video_second_4k', 0.600000000000::numeric, 'seconds', 1),
      ('veo-3.1-fast-generate-preview', 'video_second_720p', 0.100000000000::numeric, 'seconds', 1),
      ('veo-3.1-fast-generate-preview', 'video_second_1080p', 0.120000000000::numeric, 'seconds', 1),
      ('veo-3.1-fast-generate-preview', 'video_second_4k', 0.300000000000::numeric, 'seconds', 1),
      ('veo-3.1-lite-generate-preview', 'video_second_720p', 0.050000000000::numeric, 'seconds', 1),
      ('veo-3.1-lite-generate-preview', 'video_second_1080p', 0.080000000000::numeric, 'seconds', 1)
    ) AS e(model, usage_category, price, unit_name, unit_quantity) USING (model, usage_category)
   WHERE p.provider IN ('openai', 'gemini') AND p.service_tier = 'standard' AND p.currency = 'USD' AND p.unit_name = e.unit_name
     AND p.unit_quantity = e.unit_quantity AND p.price_amount = e.price AND p.effective_from = '2026-10-14T00:00:00Z' AND p.effective_to IS NULL
     AND p.effective_from_basis = 'observed_at_source' AND p.source_url IN ('https://developers.openai.com/api/docs/pricing', 'https://ai.google.dev/gemini-api/docs/pricing');
  IF matched <> 11 OR (SELECT count(*) FROM public.provider_pricing_versions t WHERE ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))) <> 11 THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 verify: the reviewed price rows are not exactly the 11 reviewed versions (matched %)', matched;
  END IF;

  IF has_table_privilege('authenticated', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE')
     OR has_table_privilege('service_role', 'public.provider_pricing_versions', 'INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('authenticated', 'public.provider_pricing_versions', 'SELECT') THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 verify: privileges changed';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
