-- PROVIDER_COST_ATTRIBUTION_V1 — ROLLBACK (PROPOSED, NOT APPLIED).
--
-- Restores the Slice D state of provider_pricing_versions:
--   * deletes EXACTLY the 11 reviewed versions (only if they are still byte-for-byte what the forward migration inserted: a closed
--     window, a newer version, a changed price or an extra row for these models means a human has been editing the registry, and the
--     rollback aborts instead of deleting history);
--   * narrows the usage_category CHECK back to {input, cached_input, output, image_output, unit}.
-- Every other price row is verified unchanged by digest. Usage history is unaffected: the derived cost of GPT Image 2 and Veo
-- executions simply becomes "unavailable" again.
--
-- Run as the table owner (`postgres`) in ONE transaction. Safe to re-run: when the Slice D state already holds it changes nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _pca_pre ON COMMIT DROP AS
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest
    FROM public.provider_pricing_versions t
   WHERE NOT ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')));

DO $guard$
DECLARE
  def text;
  scoped int;
  matched int;
BEGIN
  IF to_regclass('public.provider_pricing_versions') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback: public.provider_pricing_versions not found';
  END IF;
  SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') INTO def
    FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check';
  IF def IS NULL OR def NOT IN ('CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))', 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''image_input''::text,''unit''::text,''video_second_720p''::text,''video_second_1080p''::text,''video_second_4k''::text])))') THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback: usage_category constraint is not a reviewed definition (%)', def;
  END IF;

  -- A new-category row outside the reviewed models would block narrowing the constraint: stop and decide by hand.
  IF EXISTS (SELECT 1 FROM public.provider_pricing_versions t
              WHERE t.usage_category IN ('image_input', 'video_second_720p', 'video_second_1080p', 'video_second_4k') AND NOT ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback: a new-category row exists for another model; resolve it first';
  END IF;

  SELECT count(*)::int INTO scoped FROM public.provider_pricing_versions t WHERE ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')));
  IF scoped > 0 THEN
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
    IF matched <> 11 OR scoped <> 11 THEN
      RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback: the reviewed price rows are not exactly the 11 seeded versions (rows %, matching %). Refusing to delete price history.', scoped, matched;
    END IF;
  END IF;
END
$guard$;

DELETE FROM public.provider_pricing_versions t
 WHERE ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))
   AND t.service_tier = 'standard' AND t.effective_from = '2026-10-14T00:00:00Z';

DO $narrow$
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     = 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''image_input''::text,''unit''::text,''video_second_720p''::text,''video_second_1080p''::text,''video_second_4k''::text])))' THEN
    ALTER TABLE public.provider_pricing_versions
      DROP CONSTRAINT provider_pricing_versions_usage_category_check,
      ADD CONSTRAINT provider_pricing_versions_usage_category_check
        CHECK (usage_category IN ('input', 'cached_input', 'output', 'image_output', 'unit'));
  END IF;
END
$narrow$;

DO $verify$
DECLARE
  pre record;
  post record;
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     IS DISTINCT FROM 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))' THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback verify: usage_category constraint is not the Slice D definition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.provider_pricing_versions t WHERE ((t.provider = 'openai' AND t.model = 'gpt-image-2') OR (t.provider = 'gemini' AND t.model IN ('veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview')))) THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback verify: reviewed price rows remain';
  END IF;
  SELECT * INTO pre FROM _pca_pre;
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest INTO post FROM public.provider_pricing_versions t;
  IF post.n <> pre.n OR post.digest <> pre.digest THEN
    RAISE EXCEPTION 'PROVIDER_COST_ATTRIBUTION_V1 rollback verify: an unrelated price row changed';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
