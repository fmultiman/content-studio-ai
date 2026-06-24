-- 026_add_posts_migrated_at.sql
-- Adds migrated_at TIMESTAMPTZ NULL to posts for M8.5B Legacy Marking.
--
-- Purpose: mark migrated posts as read-only without deleting them.
--   migrated_at IS NOT NULL  → post was migrated; PATCH and DELETE are blocked.
--   migrated_at IS NULL      → post is active (not migrated or not yet marked).
--
-- The corresponding EditorialContent is located via:
--   SELECT * FROM editorial_contents WHERE legacy_post_id = posts.id
-- (unique index uq_ec_legacy_post_id already exists from migration 025).
-- No circular FK is added to posts — the bridge is one-directional.
--
-- Design decisions:
--   - NULL semantics: IS NULL = not migrated; IS NOT NULL = migrated (no extra boolean).
--   - No migrated_editorial_content_id in schema: the EC lookup via legacy_post_id
--     is sufficient and avoids circular domain coupling. The API layer enriches the
--     response with ec_id/ec_project_id when needed.
--   - Partial index on migrated_at WHERE NOT NULL: efficient guard for API checks.
--   - Trigger update_posts_updated_at fires on this UPDATE — expected; migrated_at
--     is a marking event, not a content edit.
--   - Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- ─── Rollback ─────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS idx_posts_migrated_at;
--   ALTER TABLE posts DROP COLUMN IF EXISTS migrated_at;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_posts_migrated_at
  ON posts (migrated_at)
  WHERE migrated_at IS NOT NULL;
