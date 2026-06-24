-- 025_add_editorial_content_legacy_post_id.sql
-- Adds legacy_post_id UUID NULL to editorial_contents for Posts migration rastreabilidade.
--
-- Enables idempotent migration of legacy Posts to the EditorialContent domain:
-- each migrated Post is linked via legacy_post_id = posts.id (UUID).
-- The partial unique index guarantees a Post can produce at most one EC.
--
-- Design decisions:
--   - UUID (not TEXT): posts.id is UUID; no cast, efficient comparison.
--   - NULL allowed: new ECs created manually have no legacy source.
--   - No FK to posts: posts will be retired post-migration; a permanent FK
--     would make the new domain depend on the legacy table.
--   - No legacy_source column: single source (posts), no disambiguation needed.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS.
-- Does not alter any existing rows, constraints, or RLS policies.
--
-- ─── Rollback ─────────────────────────────────────────────────────────────────
--
--   DROP INDEX IF EXISTS uq_ec_legacy_post_id;
--   ALTER TABLE editorial_contents DROP COLUMN IF EXISTS legacy_post_id;

ALTER TABLE editorial_contents
ADD COLUMN IF NOT EXISTS legacy_post_id UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ec_legacy_post_id
  ON editorial_contents (legacy_post_id)
  WHERE legacy_post_id IS NOT NULL;
