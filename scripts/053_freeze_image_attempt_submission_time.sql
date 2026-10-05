-- The submitted timestamp is part of the immutable submission snapshot. This
-- corrective migration keeps provider lifecycle updates restricted to status,
-- provider result linkage, failure details and completion time.
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
