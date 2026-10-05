-- IMAGE_GENERATION_SESSION_AND_ATTEMPT_FOUNDATION_V1 DATA BACKFILL
--
-- Preserving and rerun-safe: image_drafts are never updated or deleted.  The
-- legacy id is the deterministic session key; history entries use their
-- stored id or a deterministic draft/ordinal key. Unknown submission fields
-- stay NULL or {} and are never inferred.

insert into public.image_generation_sessions (
  id,
  user_id,
  project_id,
  production_id,
  name,
  working_prompt,
  working_state,
  current_image_id,
  legacy_image_draft_id,
  legacy_current_evaluation,
  created_at,
  updated_at
)
select
  d.id,
  d.user_id,
  d.project_id,
  d.production_id,
  d.name,
  coalesce(d.user_input, ''),
  jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'generatedPrompt', d.generated_prompt,
    'generatedPromptPt', d.generated_prompt_pt,
    'promptDetails', d.prompt_details,
    'autoMode', coalesce(d.auto_mode, false),
    'selectedModel', d.selected_model,
    'imageStatus', d.image_status,
    'currentAttempt', d.current_attempt,
    'currentImageId', d.current_image_id,
    'sourceReferences', '[]'::jsonb,
    'generationConfig', jsonb_build_object(
      'size', null,
      'quality', null,
      'aspectRatio', null,
      'style', null
    ),
    'legacyImageUrl', d.image_url
  )),
  d.current_image_id,
  d.id,
  d.current_evaluation,
  d.created_at,
  d.updated_at
from public.image_drafts d
where not exists (
  select 1
  from public.image_generation_sessions s
  where s.legacy_image_draft_id = d.id
);

insert into public.image_generation_attempts (
  session_id,
  user_id,
  project_id,
  production_id,
  sequence,
  submitted_prompt,
  provider,
  model,
  submitted_config,
  source_snapshot,
  status,
  result_image_id,
  legacy_image_draft_id,
  legacy_attempt_key,
  legacy_evaluation,
  submitted_at,
  completed_at,
  created_at,
  updated_at
)
select
  d.id,
  d.user_id,
  d.project_id,
  d.production_id,
  case
    when a.value->>'attempt' ~ '^[0-9]+$'
      then greatest(1, (a.value->>'attempt')::integer)
    else a.ordinality::integer
  end,
  nullif(a.value->>'prompt', ''),
  null,
  nullif(a.value->>'model', ''),
  '{}'::jsonb,
  jsonb_strip_nulls(jsonb_build_object(
    'legacyImageId', nullif(a.value->>'imageId', ''),
    'legacyImageUrl', nullif(a.value->>'imageUrl', '')
  )),
  case
    when a.value->>'imageId' ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.images i
        where i.id = (a.value->>'imageId')::uuid
          and i.user_id = d.user_id
          and (d.project_id is null or i.project_id = d.project_id)
      )
      then 'succeeded'
    else 'legacy'
  end,
  case
    when a.value->>'imageId' ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.images i
        where i.id = (a.value->>'imageId')::uuid
          and i.user_id = d.user_id
          and (d.project_id is null or i.project_id = d.project_id)
      )
      then (a.value->>'imageId')::uuid
    else null
  end,
  d.id,
  coalesce(nullif(a.value->>'id', ''), format('legacy-%s-%s', d.id, a.ordinality)),
  case when a.value ? 'evaluation' then a.value->'evaluation' else null end,
  case
    when nullif(a.value->>'timestamp', '') is not null
      then (a.value->>'timestamp')::timestamptz
    else d.created_at
  end,
  case
    when a.value->>'imageId' ~ '^[0-9a-fA-F-]{36}$'
      and exists (
        select 1
        from public.images i
        where i.id = (a.value->>'imageId')::uuid
          and i.user_id = d.user_id
          and (d.project_id is null or i.project_id = d.project_id)
      )
      then (a.value->>'timestamp')::timestamptz
    else null
  end,
  coalesce(
    case when nullif(a.value->>'timestamp', '') is not null
      then (a.value->>'timestamp')::timestamptz
      else d.created_at
    end,
    d.created_at
  ),
  coalesce(
    case when nullif(a.value->>'timestamp', '') is not null
      then (a.value->>'timestamp')::timestamptz
      else d.updated_at
    end,
    d.updated_at
  )
from public.image_drafts d
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(d.generation_attempts) = 'array' then d.generation_attempts
    else '[]'::jsonb
  end
) with ordinality as a(value, ordinality)
where not exists (
  select 1
  from public.image_generation_attempts existing
  where existing.legacy_image_draft_id = d.id
    and existing.legacy_attempt_key = coalesce(nullif(a.value->>'id', ''), format('legacy-%s-%s', d.id, a.ordinality))
);

-- Backfill is complete only when every source row has one session and every
-- stored history element has one attempt. These assertions fail loudly if a
-- future source shape cannot be classified by this preserving migration.
do $$
declare
  draft_count bigint;
  session_count bigint;
  history_count bigint;
  attempt_count bigint;
begin
  select count(*) into draft_count from public.image_drafts;
  select count(*) into session_count from public.image_generation_sessions where legacy_image_draft_id is not null;
  select count(*) into history_count
    from public.image_drafts d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.generation_attempts) = 'array' then d.generation_attempts else '[]'::jsonb end
    ) a;
  select count(*) into attempt_count from public.image_generation_attempts where legacy_image_draft_id is not null;

  if draft_count <> session_count then
    raise exception 'IMAGE_SESSION_BACKFILL_RECONCILIATION_FAILED drafts=% sessions=%', draft_count, session_count;
  end if;
  if history_count <> attempt_count then
    raise exception 'IMAGE_ATTEMPT_BACKFILL_RECONCILIATION_FAILED history=% attempts=%', history_count, attempt_count;
  end if;
end;
$$;
