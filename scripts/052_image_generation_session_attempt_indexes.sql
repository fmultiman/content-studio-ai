-- Cover the single-column foreign keys as well as the workspace query indexes.
-- This is separate so the data backfill remains independently auditable.
create index if not exists image_generation_sessions_project_fk_idx
  on public.image_generation_sessions(project_id);
create index if not exists image_generation_sessions_production_fk_idx
  on public.image_generation_sessions(production_id);
create index if not exists image_generation_sessions_current_image_fk_idx
  on public.image_generation_sessions(current_image_id);
create index if not exists image_generation_attempts_project_fk_idx
  on public.image_generation_attempts(project_id);
create index if not exists image_generation_attempts_production_fk_idx
  on public.image_generation_attempts(production_id);
