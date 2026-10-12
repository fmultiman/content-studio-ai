-- FUTURE_064_GOOGLE_GEMINI_IMAGE_SLICE_D — ROLLBACK (PROPOSED, NOT APPLIED).
--
-- Restores the pre-migration state of provider_pricing_versions:
--   * deletes EXACTLY the six reviewed V1 image-model versions (only if they are still byte-for-byte what the forward
--     migration inserted: a closed window, a newer version, a changed price or an extra row for these models means a
--     human has been editing the registry, and the rollback aborts instead of deleting history);
--   * narrows the usage_category CHECK back to {input, cached_input, output, unit}.
-- Every other price row (Gemini text, OpenAI, Kling) is verified unchanged by digest. Usage history is unaffected:
-- the derived cost of Gemini image executions simply becomes "unavailable" again.
--
-- Run as the table owner (`postgres`) in ONE transaction. Safe to re-run: when the pre-migration state already
-- holds (constraint narrow, no V1 rows) it changes nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _f064d_pre ON COMMIT DROP AS
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest
    FROM public.provider_pricing_versions t
   WHERE NOT (t.provider = 'gemini' AND t.model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'));

DO $guard$
DECLARE
  def text;
  v1_rows int;
  matched int;
BEGIN
  IF to_regclass('public.provider_pricing_versions') IS NULL THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback: public.provider_pricing_versions not found';
  END IF;
  SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') INTO def
    FROM pg_constraint WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check';
  IF def IS NULL OR def NOT IN (
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''unit''::text])))',
       'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))'
     ) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback: usage_category constraint is not a reviewed definition (%)', def;
  END IF;

  SELECT count(*)::int INTO v1_rows FROM public.provider_pricing_versions
   WHERE provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image');

  -- Any image_output row outside the two V1 models would block narrowing the constraint: stop and decide by hand.
  IF EXISTS (SELECT 1 FROM public.provider_pricing_versions WHERE usage_category = 'image_output'
              AND NOT (provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image'))) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback: an image_output row exists for another model; resolve it first';
  END IF;

  IF v1_rows > 0 THEN
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
    IF matched <> 6 OR v1_rows <> 6 THEN
      RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback: the V1 image price rows are not exactly the six seeded versions (rows %, matching %). Refusing to delete price history.', v1_rows, matched;
    END IF;
  END IF;
END
$guard$;

DELETE FROM public.provider_pricing_versions
 WHERE provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image')
   AND service_tier = 'standard' AND effective_from = '2026-10-12T00:00:00Z' AND usage_category IN ('input', 'output', 'image_output');

DO $narrow$
BEGIN
  IF (SELECT regexp_replace(pg_get_constraintdef(oid), '\s+', '', 'g') FROM pg_constraint
       WHERE conrelid = 'public.provider_pricing_versions'::regclass AND conname = 'provider_pricing_versions_usage_category_check')
     = 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''image_output''::text,''unit''::text])))' THEN
    ALTER TABLE public.provider_pricing_versions
      DROP CONSTRAINT provider_pricing_versions_usage_category_check,
      ADD CONSTRAINT provider_pricing_versions_usage_category_check
        CHECK (usage_category IN ('input', 'cached_input', 'output', 'unit'));
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
     IS DISTINCT FROM 'CHECK((usage_category=ANY(ARRAY[''input''::text,''cached_input''::text,''output''::text,''unit''::text])))' THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback verify: usage_category constraint is not the original definition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.provider_pricing_versions WHERE provider = 'gemini' AND model IN ('gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image')) THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback verify: V1 image price rows remain';
  END IF;
  SELECT * INTO pre FROM _f064d_pre;
  SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t.id)), '') AS digest INTO post FROM public.provider_pricing_versions t;
  IF post.n <> pre.n OR post.digest <> pre.digest THEN
    RAISE EXCEPTION 'FUTURE_064_SLICE_D rollback verify: an unrelated price row changed';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
