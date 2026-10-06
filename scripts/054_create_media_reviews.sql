-- SHARED_REVIEW_CORE_AND_IMAGE_ADAPTER_V1
-- Shared Review metadata with typed Image Attempt/output subjects.
-- Video columns are intentionally deferred to an additive future migration.

create table if not exists public.media_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_media_type text not null default 'image' check (subject_media_type = 'image'),
  image_attempt_id uuid not null references public.image_generation_attempts(id) on delete restrict,
  image_output_id uuid not null references public.images(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  production_id uuid references public.productions(id) on delete restrict,
  adapter_key text not null,
  adapter_version text not null,
  review_schema_version integer not null default 1 check (review_schema_version = 1),
  origin text not null default 'live' check (origin in ('live', 'legacy_import')),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  client_request_id uuid not null,
  request_fingerprint text not null,
  subject_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(subject_snapshot) = 'object'),
  context_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(context_snapshot) = 'object'),
  evaluator_provider text,
  evaluator_model text,
  evaluator_prompt_version text,
  overall_score numeric check (overall_score is null or (overall_score >= 0 and overall_score <= 100)),
  overall_assessment text check (overall_assessment is null or overall_assessment in ('strong', 'mixed', 'needs_revision', 'insufficient_evidence')),
  summary text,
  result_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(result_payload) = 'object'),
  refined_prompt text,
  failure_code text,
  failure_details jsonb,
  legacy_source_key text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint media_reviews_failed_requires_code check (status <> 'failed' or failure_code is not null),
  constraint media_reviews_legacy_requires_source check (origin <> 'legacy_import' or legacy_source_key is not null),
  constraint media_reviews_legacy_score_not_normalized check (origin <> 'legacy_import' or overall_score is null),
  constraint media_reviews_refined_prompt_consistency check (
    refined_prompt is null or result_payload->>'refinedPrompt' is not distinct from refined_prompt
  )
);

create unique index if not exists media_reviews_user_client_request_key
  on public.media_reviews(user_id, client_request_id);
create unique index if not exists media_reviews_active_attempt_key
  on public.media_reviews(image_attempt_id)
  where status in ('pending', 'running');
create unique index if not exists media_reviews_legacy_source_key
  on public.media_reviews(legacy_source_key)
  where legacy_source_key is not null;
create index if not exists media_reviews_user_created_idx
  on public.media_reviews(user_id, created_at desc);
create index if not exists media_reviews_attempt_created_idx
  on public.media_reviews(user_id, image_attempt_id, created_at desc);
create index if not exists media_reviews_output_created_idx
  on public.media_reviews(image_output_id, created_at desc);
create index if not exists media_reviews_project_created_idx
  on public.media_reviews(project_id, created_at desc)
  where project_id is not null;

create or replace function public.validate_media_review_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  attempt_row record;
  output_row record;
  project_owner uuid;
  production_owner uuid;
  production_project uuid;
begin
  select a.user_id, a.project_id, a.production_id, a.result_image_id
    into attempt_row
    from public.image_generation_attempts a
   where a.id = new.image_attempt_id;
  if not found then raise exception 'MEDIA_REVIEW_ATTEMPT_NOT_FOUND'; end if;
  if attempt_row.user_id is distinct from new.user_id
     or attempt_row.result_image_id is distinct from new.image_output_id
     or attempt_row.project_id is distinct from new.project_id
     or attempt_row.production_id is distinct from new.production_id then
    raise exception 'MEDIA_REVIEW_ATTEMPT_SCOPE_MISMATCH';
  end if;

  select i.user_id, i.project_id into output_row
    from public.images i where i.id = new.image_output_id;
  if not found or output_row.user_id is distinct from new.user_id
     or (new.project_id is not null and output_row.project_id is distinct from new.project_id) then
    raise exception 'MEDIA_REVIEW_OUTPUT_SCOPE_MISMATCH';
  end if;

  if new.project_id is not null then
    select p.user_id into project_owner from public.projects p where p.id = new.project_id;
    if project_owner is distinct from new.user_id then raise exception 'MEDIA_REVIEW_PROJECT_SCOPE_MISMATCH'; end if;
  end if;
  if new.production_id is not null then
    select p.user_id, p.project_id into production_owner, production_project
      from public.productions p where p.id = new.production_id;
    if production_owner is distinct from new.user_id then raise exception 'MEDIA_REVIEW_PRODUCTION_SCOPE_MISMATCH'; end if;
    if production_project is distinct from new.project_id then raise exception 'MEDIA_REVIEW_PRODUCTION_PROJECT_MISMATCH'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_media_review_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.subject_media_type is distinct from old.subject_media_type
     or new.image_attempt_id is distinct from old.image_attempt_id
     or new.image_output_id is distinct from old.image_output_id
     or new.project_id is distinct from old.project_id
     or new.production_id is distinct from old.production_id
     or new.adapter_key is distinct from old.adapter_key
     or new.adapter_version is distinct from old.adapter_version
     or new.review_schema_version is distinct from old.review_schema_version
     or new.origin is distinct from old.origin
     or new.client_request_id is distinct from old.client_request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.subject_snapshot is distinct from old.subject_snapshot
     or new.context_snapshot is distinct from old.context_snapshot
     or new.created_at is distinct from old.created_at then
    raise exception 'MEDIA_REVIEW_IMMUTABLE_SUBJECT';
  end if;
  if old.status = 'completed' or old.status = 'failed' then
    raise exception 'MEDIA_REVIEW_TERMINAL_IMMUTABLE';
  end if;
  if old.status = 'pending' and new.status not in ('pending', 'running', 'failed') then
    raise exception 'MEDIA_REVIEW_INVALID_LIFECYCLE';
  end if;
  if old.status = 'running' and new.status not in ('running', 'completed', 'failed') then
    raise exception 'MEDIA_REVIEW_INVALID_LIFECYCLE';
  end if;
  return new;
end;
$$;

drop trigger if exists media_reviews_scope on public.media_reviews;
create trigger media_reviews_scope
  before insert or update on public.media_reviews
  for each row execute function public.validate_media_review_scope();

drop trigger if exists media_reviews_lifecycle on public.media_reviews;
create trigger media_reviews_lifecycle
  before update on public.media_reviews
  for each row execute function public.guard_media_review_lifecycle();

drop trigger if exists media_reviews_updated_at on public.media_reviews;
create trigger media_reviews_updated_at
  before update on public.media_reviews
  for each row execute function public.update_updated_at_column();

alter table public.media_reviews enable row level security;
revoke all on table public.media_reviews from anon, authenticated;
grant select on table public.media_reviews to authenticated;
grant all on table public.media_reviews to service_role;

drop policy if exists media_reviews_select_own on public.media_reviews;
create policy media_reviews_select_own
  on public.media_reviews for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.media_reviews is
  'Advisory immutable Review executions. Image V1 uses typed Attempt/output FKs; Video is additive later.';
comment on column public.media_reviews.result_payload is
  'Versioned shared Review envelope with media-specific adapter payload.';
