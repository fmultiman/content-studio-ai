-- SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1
-- Preserve only the 17 evaluated legacy Attempts that have a linked output.
-- The outputless evaluated Attempt and the five null evaluations remain legacy-only.

insert into public.media_reviews (
  user_id, subject_media_type, image_attempt_id, image_output_id,
  project_id, production_id, adapter_key, adapter_version,
  review_schema_version, origin, status, client_request_id, request_fingerprint,
  subject_snapshot, context_snapshot, evaluator_provider, evaluator_model,
  evaluator_prompt_version, overall_score, overall_assessment, summary,
  result_payload, refined_prompt, legacy_source_key, created_at, completed_at, updated_at
)
select
  a.user_id,
  'image',
  a.id,
  a.result_image_id,
  a.project_id,
  a.production_id,
  'image-legacy-compat',
  'legacy-json-v1',
  1,
  'legacy_import',
  'completed',
  gen_random_uuid(),
  md5('legacy-review:' || a.legacy_image_draft_id::text || ':' || a.legacy_attempt_key),
  jsonb_build_object(
    'schemaVersion', 1,
    'attemptId', a.id,
    'outputId', a.result_image_id,
    'submittedPrompt', a.submitted_prompt,
    'provider', a.provider,
    'model', a.model,
    'submittedConfig', a.submitted_config,
    'sourceSnapshot', a.source_snapshot
  ),
  jsonb_build_object(
    'schemaVersion', 1,
    'legacy', true,
    'projectId', a.project_id,
    'productionId', a.production_id,
    'unknown', jsonb_build_array(
      'evaluator_provider', 'evaluator_model', 'evaluator_prompt_version',
      'evaluation_context_snapshot', 'evaluation_created_at', 'score_scale'
    )
  ),
  null,
  null,
  null,
  null,
  null,
  null,
  jsonb_build_object(
    'schemaVersion', 1,
    'status', 'completed',
    'adapter', jsonb_build_object('key', 'image-legacy-compat', 'version', 'legacy-json-v1'),
    'overall', jsonb_build_object('score', null, 'assessment', null),
    'summary', null,
    'criteria', '[]'::jsonb,
    'strengths', '[]'::jsonb,
    'issues', '[]'::jsonb,
    'recommendations', '[]'::jsonb,
    'refinedPrompt', a.legacy_evaluation->>'refinedPrompt',
    'adapterResult', jsonb_build_object('legacyPayload', a.legacy_evaluation, 'scoreScale', 'unknown')
  ),
  a.legacy_evaluation->>'refinedPrompt',
  a.legacy_image_draft_id::text || ':' || a.legacy_attempt_key,
  coalesce(a.created_at, now()),
  coalesce(a.completed_at, a.submitted_at, a.created_at, now()),
  coalesce(a.completed_at, a.submitted_at, a.created_at, now())
from public.image_generation_attempts a
where a.legacy_attempt_key is not null
  and a.legacy_evaluation is not null
  and a.legacy_evaluation <> 'null'::jsonb
  and a.result_image_id is not null
on conflict (legacy_source_key) where legacy_source_key is not null do nothing;

do $$
declare
  imported_count integer;
begin
  select count(*) into imported_count
    from public.media_reviews where origin = 'legacy_import';
  if imported_count <> 17 then
    raise exception 'MEDIA_REVIEW_BACKFILL_COUNT_MISMATCH: expected 17, got %', imported_count;
  end if;
end;
$$;
