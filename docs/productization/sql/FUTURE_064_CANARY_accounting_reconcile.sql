-- PREPARED ONLY. DO NOT RUN IN PRODUCTION without separate owner authorization.
-- Exact Attempt; append at most one event. Never a migration or broad backfill.
-- Uses only stored usage; retains execution timestamp so later prices cannot re-date the event.
DO $$
DECLARE
  source public.provider_usage_events%ROWTYPE;
  candidate_tokens numeric;
  attributed_tokens numeric;
  remainder numeric;
  item jsonb;
  remainder_key text := 'gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:output_unattributed_tokens';
BEGIN
  SELECT e.* INTO STRICT source
  FROM public.provider_usage_events e
  JOIN public.image_generation_attempts a ON a.id = e.resource_id AND a.user_id = e.user_id
  WHERE a.id = '56ba444f-0280-4675-aa2a-ec90267e8eb8'
    AND a.provider = 'gemini' AND a.model = 'gemini-nb-2.1' AND a.status = 'succeeded'
    AND e.provider = 'gemini' AND e.transport = 'rest' AND e.operation = 'image_generation'
    AND e.model = 'gemini-nano-banana-2.1' AND e.resource_type = 'image_generation_attempt'
    AND e.unit = 'input_tokens' AND e.measurement_source = 'provider_reported'
    AND e.idempotency_key = 'gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:input_tokens'
  FOR SHARE OF a, e;

  IF jsonb_typeof(source.provider_metadata->'usage'->'candidatesTokenCount') IS DISTINCT FROM 'number'
    OR NOT (source.provider_metadata->'usage'->>'candidatesTokenCount' ~ '^[0-9]+$')
    OR jsonb_typeof(source.provider_metadata->'usage'->'candidatesTokensDetails') IS DISTINCT FROM 'array'
    OR jsonb_array_length(source.provider_metadata->'usage'->'candidatesTokensDetails') = 0
  THEN RAISE EXCEPTION 'Stored candidate usage is insufficient'; END IF;
  candidate_tokens := (source.provider_metadata->'usage'->>'candidatesTokenCount')::numeric;
  attributed_tokens := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(source.provider_metadata->'usage'->'candidatesTokensDetails') LOOP
    IF jsonb_typeof(item->'tokenCount') IS DISTINCT FROM 'number'
      OR NOT (item->>'tokenCount' ~ '^[0-9]+$')
      OR jsonb_typeof(item->'modality') IS DISTINCT FROM 'string' OR length(item->>'modality') = 0
    THEN RAISE EXCEPTION 'Stored candidate breakdown is insufficient'; END IF;
    attributed_tokens := attributed_tokens + (item->>'tokenCount')::numeric;
  END LOOP;
  remainder := candidate_tokens - attributed_tokens;
  IF remainder <= 0 OR candidate_tokens > 9007199254740991 THEN
    RAISE EXCEPTION 'Stored candidate usage cannot prove a positive safe remainder';
  END IF;
  IF EXISTS (SELECT 1 FROM public.provider_usage_events e
    WHERE e.resource_id = source.resource_id AND e.provider = source.provider AND e.operation = source.operation
      AND e.provider_metadata->'usage' IS DISTINCT FROM source.provider_metadata->'usage')
  THEN RAISE EXCEPTION 'Stored usage snapshots disagree'; END IF;

  INSERT INTO public.provider_usage_events (
    user_id, project_id, production_id, connection_id, provider, transport, operation, model,
    resource_type, resource_id, provider_task_id, quantity, unit, measurement_source,
    provider_metadata, idempotency_key, occurred_at
  ) VALUES (
    source.user_id, source.project_id, source.production_id, source.connection_id, source.provider, source.transport,
    source.operation, source.model, source.resource_type, source.resource_id, source.provider_task_id,
    remainder, 'tokens', 'provider_reported',
    source.provider_metadata || jsonb_build_object('usage_category', 'output_unattributed'),
    remainder_key, source.occurred_at
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.provider_usage_events e WHERE e.idempotency_key = remainder_key
    AND e.resource_id = source.resource_id AND e.user_id = source.user_id
    AND e.provider = source.provider AND e.transport = source.transport AND e.operation = source.operation
    AND e.model = source.model AND e.resource_type = source.resource_type
    AND e.provider_task_id IS NOT DISTINCT FROM source.provider_task_id
    AND e.quantity = remainder AND e.unit = 'tokens' AND e.measurement_source = 'provider_reported'
    AND e.occurred_at = source.occurred_at
    AND e.provider_metadata = source.provider_metadata || jsonb_build_object('usage_category', 'output_unattributed'))
  THEN RAISE EXCEPTION 'Existing remainder event conflicts with stored evidence'; END IF;
END $$;
