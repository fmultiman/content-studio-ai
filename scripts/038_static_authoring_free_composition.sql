-- 038_static_authoring_free_composition.sql
-- CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1, per
-- docs/productization/creative-rendering/CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1.md.
--
-- The Creative Editor has two composition modes: FREE and TEMPLATE. New
-- authoring starts FREE (no Template). A free Static composition therefore has
-- NO Template, so its ChannelPiece-owned authoring row must be able to say so:
-- template_id NULL = free (written only together with explicit free slides,
-- `{ id, order, composition: { kind: 'free', elements } }`, validated in the app).
--
-- Additive and backward compatible:
--   * existing rows are NOT rewritten (every one keeps its Template id);
--   * the column DEFAULT stays, so an insert that omits the column (an older
--     client) still means the Template it always meant;
--   * no data migration, no new table, no new authority.
--
-- Re-executable (ALTER ... DROP NOT NULL is idempotent).

ALTER TABLE channel_piece_static_authoring_states
  ALTER COLUMN template_id DROP NOT NULL;

COMMENT ON COLUMN channel_piece_static_authoring_states.template_id IS
  'Template the composition is authored with (collection-level). NULL = free composition (no Template), written only with free slides. See CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1.';

-- ============================================================
-- ROLLBACK (only valid while no free row exists)
-- ============================================================
--   -- SELECT count(*) FROM channel_piece_static_authoring_states WHERE template_id IS NULL;  -- must be 0
--   ALTER TABLE channel_piece_static_authoring_states ALTER COLUMN template_id SET NOT NULL;
