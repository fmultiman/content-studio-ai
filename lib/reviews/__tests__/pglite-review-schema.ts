import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// Shared test-only schema for running the REAL migration scripts in an isolated in-process PostgreSQL.
// Only tables the scripts reference are stubbed (with the columns the trigger functions read).

export const script = (name: string) => readFileSync(join(process.cwd(), 'scripts', name), 'utf8')

export const STUBS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
  CREATE TABLE public.projects (id uuid PRIMARY KEY, user_id uuid NOT NULL);
  CREATE TABLE public.productions (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid);
  CREATE TABLE public.images (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid,
    storage_provider text, storage_path text, mime_type text, file_size integer, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.image_generation_attempts (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid, result_image_id uuid);
  CREATE TABLE public.video_generations (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid);
  CREATE TABLE public.render_executions (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid);
  CREATE TABLE public.library_files (id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid, production_id uuid);
`

/** Applies 054, 056, 057, 058 and 060 (the full Review/artifact history through the Video extension). */
export async function createMigratedReviewDb() {
  const db = new PGlite()
  await db.exec(STUBS)
  for (const name of ['054_create_media_reviews.sql', '056_create_media_artifacts.sql', '057_create_media_artifact_provenance.sql', '058_extend_media_reviews_with_artifacts.sql', '060_extend_media_reviews_for_video.sql']) {
    await db.exec(script(name))
  }
  return db
}
