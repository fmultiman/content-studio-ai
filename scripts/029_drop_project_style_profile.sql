-- Migration 029 — M11-H: DROP COLUMN style_profile
-- Date: 2026-06-26
-- Branch: discovery/project-identity-v1-implementation
--
-- Context: style_profile was the legacy aesthetic text field on projects.
-- M11-G (commit 3116b24) removed all operational consumers from UI, Prompt
-- Generator, Image Evaluator, Feed Generator, and context formatters.
-- M11-H removes the physical column after confirming zero active usage.
--
-- Pre-conditions verified before applying:
--   - Alquimia Cibernética: identity schema_version=1, all zones present
--   - All projects: context and evaluation_mode intact
--   - No code path reads or writes style_profile after M11-G
--
-- Rollback (structural only):
--   ALTER TABLE projects ADD COLUMN style_profile TEXT;
--   -- NOTE: This recreates the column structure but does NOT restore data.
--   -- Data recovery would require a backup snapshot taken before this migration.

ALTER TABLE projects
  DROP COLUMN IF EXISTS style_profile;
