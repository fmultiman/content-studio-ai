-- IMAGE_GENERATION_SESSION_AND_ATTEMPT_FOUNDATION_V1
--
-- This migration creates the durable Image generation foundation only.  The
-- existing image_drafts authority remains intact until route convergence.
-- Data backfill is intentionally separate: run 051 only after the inventory
-- has been captured and reviewed.

create table if not exists public.image_generation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  production_id uuid references public.productions(id) on delete set null,
  name text,
  working_prompt text not null default '',
  working_state jsonb not null default '{"schemaVersion":1}'::jsonb,
  current_image_id uuid references public.images(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  revision bigint not null default 0 check (revision >= 0),
  legacy_image_draft_id uuid unique references public.image_drafts(id) on delete set null,
  legacy_current_evaluation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_generation_sessions_working_state_object
    check (jsonb_typeof(working_state) = 'object')
);

create table if not exists public.image_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.image_generation_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  production_id uuid references public.productions(id) on delete set null,
  sequence integer not null check (sequence > 0),
  submitted_prompt text,
  provider text,
  model text,
  submitted_config jsonb not null default '{}'::jsonb,
  source_snapshot jsonb,
  client_request_id uuid,
  request_fingerprint text,
  status text not null default 'queued'
    check (status in ('queued', 'submitted', 'processing', 'succeeded', 'failed', 'legacy')),
  provider_task_id text,
  result_image_id uuid references public.images(id) on delete set null,
  result_metadata jsonb,
  failure_details jsonb,
  legacy_image_draft_id uuid references public.image_drafts(id) on delete set null,
  legacy_attempt_key text,
  legacy_evaluation jsonb,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_generation_attempts_config_object
    check (jsonb_typeof(submitted_config) = 'object'),
  constraint image_generation_attempts_source_object
    check (source_snapshot is null or jsonb_typeof(source_snapshot) = 'object')
);

create unique index if not exists image_generation_attempts_session_sequence_key
  on public.image_generation_attempts(session_id, sequence)
  where session_id is not null;

create unique index if not exists image_generation_attempts_client_request_key
  on public.image_generation_attempts(user_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists image_generation_attempts_legacy_key
  on public.image_generation_attempts(legacy_image_draft_id, legacy_attempt_key)
  where legacy_image_draft_id is not null and legacy_attempt_key is not null;

create index if not exists image_generation_sessions_user_updated_idx
  on public.image_generation_sessions(user_id, updated_at desc);
create index if not exists image_generation_sessions_project_idx
  on public.image_generation_sessions(user_id, project_id, updated_at desc);
create index if not exists image_generation_sessions_production_idx
  on public.image_generation_sessions(user_id, production_id, updated_at desc);
create index if not exists image_generation_attempts_session_created_idx
  on public.image_generation_attempts(session_id, sequence);
create index if not exists image_generation_attempts_user_created_idx
  on public.image_generation_attempts(user_id, created_at desc);
create index if not exists image_generation_attempts_result_image_idx
  on public.image_generation_attempts(result_image_id)
  where result_image_id is not null;

create or replace function public.validate_image_generation_session_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_owner uuid;
  production_owner uuid;
  production_project uuid;
  image_owner uuid;
  image_project uuid;
begin
  if new.project_id is not null then
    select p.user_id into project_owner from public.projects p where p.id = new.project_id;
    if project_owner is null then
      raise exception 'IMAGE_SESSION_PROJECT_NOT_FOUND';
    end if;
    if project_owner is distinct from new.user_id then
      raise exception 'IMAGE_SESSION_PROJECT_OWNERSHIP_MISMATCH';
    end if;
  end if;

  if new.production_id is not null then
    if new.project_id is null then
      raise exception 'IMAGE_SESSION_PRODUCTION_REQUIRES_PROJECT';
    end if;
    select p.user_id, p.project_id
      into production_owner, production_project
      from public.productions p
      where p.id = new.production_id;
    if production_owner is null then
      raise exception 'IMAGE_SESSION_PRODUCTION_NOT_FOUND';
    end if;
    if production_owner is distinct from new.user_id then
      raise exception 'IMAGE_SESSION_PRODUCTION_OWNERSHIP_MISMATCH';
    end if;
    if production_project is distinct from new.project_id then
      raise exception 'IMAGE_SESSION_PRODUCTION_PROJECT_MISMATCH';
    end if;
  end if;

  if new.current_image_id is not null then
    select i.user_id, i.project_id
      into image_owner, image_project
      from public.images i
      where i.id = new.current_image_id;
    if image_owner is null then
      raise exception 'IMAGE_SESSION_CURRENT_IMAGE_NOT_FOUND';
    end if;
    if image_owner is distinct from new.user_id then
      raise exception 'IMAGE_SESSION_CURRENT_IMAGE_OWNERSHIP_MISMATCH';
    end if;
    if new.project_id is not null and image_project is distinct from new.project_id then
      raise exception 'IMAGE_SESSION_CURRENT_IMAGE_PROJECT_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_image_generation_session_revision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or new.production_id is distinct from old.production_id
     or new.legacy_image_draft_id is distinct from old.legacy_image_draft_id
  then
    raise exception 'IMAGE_SESSION_SCOPE_IMMUTABLE';
  end if;

  if new.revision <> old.revision + 1 then
    raise exception 'IMAGE_SESSION_REVISION_MUST_INCREMENT_BY_ONE';
  end if;
  return new;
end;
$$;

create or replace function public.validate_image_generation_attempt_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  linked_session_user uuid;
  linked_session_project uuid;
  linked_session_production uuid;
  image_owner uuid;
  image_project uuid;
begin
  if new.session_id is not null then
    select s.user_id, s.project_id, s.production_id
      into linked_session_user, linked_session_project, linked_session_production
      from public.image_generation_sessions s
      where s.id = new.session_id;
    if linked_session_user is null then
      raise exception 'IMAGE_ATTEMPT_SESSION_NOT_FOUND';
    end if;
    if new.user_id is distinct from linked_session_user
       or new.project_id is distinct from linked_session_project
       or new.production_id is distinct from linked_session_production
    then
      raise exception 'IMAGE_ATTEMPT_SESSION_SCOPE_MISMATCH';
    end if;
  end if;

  if new.result_image_id is not null then
    select i.user_id, i.project_id
      into image_owner, image_project
      from public.images i
      where i.id = new.result_image_id;
    if image_owner is null then
      raise exception 'IMAGE_ATTEMPT_RESULT_IMAGE_NOT_FOUND';
    end if;
    if image_owner is distinct from new.user_id then
      raise exception 'IMAGE_ATTEMPT_RESULT_IMAGE_OWNERSHIP_MISMATCH';
    end if;
    if new.project_id is not null and image_project is distinct from new.project_id then
      raise exception 'IMAGE_ATTEMPT_RESULT_IMAGE_PROJECT_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_image_generation_attempt_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.session_id is distinct from old.session_id
     or new.user_id is distinct from old.user_id
     or new.project_id is distinct from old.project_id
     or new.production_id is distinct from old.production_id
     or new.sequence is distinct from old.sequence
     or new.submitted_prompt is distinct from old.submitted_prompt
     or new.provider is distinct from old.provider
     or new.model is distinct from old.model
     or new.submitted_config is distinct from old.submitted_config
     or new.source_snapshot is distinct from old.source_snapshot
     or new.client_request_id is distinct from old.client_request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.legacy_image_draft_id is distinct from old.legacy_image_draft_id
     or new.legacy_attempt_key is distinct from old.legacy_attempt_key
     or new.legacy_evaluation is distinct from old.legacy_evaluation
     or new.submitted_at is distinct from old.submitted_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'IMAGE_ATTEMPT_SUBMISSION_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists image_generation_sessions_scope on public.image_generation_sessions;
create trigger image_generation_sessions_scope
  before insert or update on public.image_generation_sessions
  for each row execute function public.validate_image_generation_session_scope();

drop trigger if exists image_generation_sessions_revision on public.image_generation_sessions;
create trigger image_generation_sessions_revision
  before update on public.image_generation_sessions
  for each row execute function public.guard_image_generation_session_revision();

drop trigger if exists image_generation_sessions_updated_at on public.image_generation_sessions;
create trigger image_generation_sessions_updated_at
  before update on public.image_generation_sessions
  for each row execute function public.update_updated_at_column();

drop trigger if exists image_generation_attempts_scope on public.image_generation_attempts;
create trigger image_generation_attempts_scope
  before insert or update on public.image_generation_attempts
  for each row execute function public.validate_image_generation_attempt_scope();

drop trigger if exists image_generation_attempts_immutability on public.image_generation_attempts;
create trigger image_generation_attempts_immutability
  before update on public.image_generation_attempts
  for each row execute function public.guard_image_generation_attempt_immutability();

drop trigger if exists image_generation_attempts_updated_at on public.image_generation_attempts;
create trigger image_generation_attempts_updated_at
  before update on public.image_generation_attempts
  for each row execute function public.update_updated_at_column();

alter table public.image_generation_sessions enable row level security;
alter table public.image_generation_attempts enable row level security;

revoke all on table public.image_generation_sessions from anon, authenticated;
revoke all on table public.image_generation_attempts from anon, authenticated;
grant select on table public.image_generation_sessions to authenticated;
grant select on table public.image_generation_attempts to authenticated;
grant all on table public.image_generation_sessions to service_role;
grant all on table public.image_generation_attempts to service_role;

drop policy if exists image_generation_sessions_select_own on public.image_generation_sessions;
create policy image_generation_sessions_select_own
  on public.image_generation_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists image_generation_attempts_select_own on public.image_generation_attempts;
create policy image_generation_attempts_select_own
  on public.image_generation_attempts for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.image_generation_sessions is
  'Mutable Image generation working state. Legacy image_drafts remain compatible until route convergence.';
comment on table public.image_generation_attempts is
  'Immutable Image generation submission snapshots with provider lifecycle and output linkage.';
comment on column public.image_generation_sessions.legacy_current_evaluation is
  'Compatibility preservation only; not the shared Review authority.';
comment on column public.image_generation_attempts.legacy_evaluation is
  'Compatibility preservation only; not the shared Review authority.';
