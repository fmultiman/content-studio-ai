-- READ ONLY. Exact Attempt only. No credential, provider or pricing access.
WITH source AS (
  SELECT e.resource_id, e.quantity AS input_tokens, e.model, e.occurred_at,
         e.provider_metadata->'usage' AS usage
  FROM public.provider_usage_events e
  JOIN public.image_generation_attempts a ON a.id = e.resource_id AND a.user_id = e.user_id
  WHERE a.id = '56ba444f-0280-4675-aa2a-ec90267e8eb8'
    AND a.provider = 'gemini' AND a.model = 'gemini-nb-2.1' AND a.status = 'succeeded'
    AND e.provider = 'gemini' AND e.transport = 'rest' AND e.operation = 'image_generation'
    AND e.model = 'gemini-nano-banana-2.1' AND e.resource_type = 'image_generation_attempt'
    AND e.unit = 'input_tokens' AND e.measurement_source = 'provider_reported'
    AND e.idempotency_key = 'gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:input_tokens'
), counts AS (
  SELECT source.*,
    CASE WHEN jsonb_typeof(usage->'candidatesTokenCount') = 'number'
      AND usage->>'candidatesTokenCount' ~ '^[0-9]+$'
      THEN (usage->>'candidatesTokenCount')::numeric END AS candidate_tokens,
    (SELECT CASE WHEN bool_and(jsonb_typeof(d->'tokenCount') = 'number'
          AND d->>'tokenCount' ~ '^[0-9]+$' AND jsonb_typeof(d->'modality') = 'string'
          AND length(d->>'modality') > 0)
      THEN sum((d->>'tokenCount')::numeric) END
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(usage->'candidatesTokensDetails') = 'array'
        THEN usage->'candidatesTokensDetails' ELSE '[]'::jsonb END) d) AS attributed_tokens
  FROM source
)
SELECT resource_id AS attempt_id, input_tokens, usage, candidate_tokens, attributed_tokens,
       candidate_tokens - attributed_tokens AS proposed_output_unattributed_tokens,
       'tokens' AS proposed_unit, 'output_unattributed' AS proposed_usage_category,
       'gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:output_unattributed_tokens' AS proposed_idempotency_key,
       occurred_at AS preserved_execution_time,
       candidate_tokens > attributed_tokens AND attributed_tokens >= 0
         AND candidate_tokens <= 9007199254740991 AS metadata_sufficient,
       (SELECT count(*) FROM public.provider_usage_events
        WHERE idempotency_key = 'gemini_image:56ba444f-0280-4675-aa2a-ec90267e8eb8:output_unattributed_tokens') AS existing_remainder_rows,
       (SELECT count(DISTINCT provider_metadata->'usage') FROM public.provider_usage_events
        WHERE resource_id = counts.resource_id AND provider = 'gemini' AND operation = 'image_generation') AS distinct_usage_snapshots
FROM counts;
