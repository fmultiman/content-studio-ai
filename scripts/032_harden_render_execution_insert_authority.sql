-- 032_harden_render_execution_insert_authority.sql
-- Phase 2I-B1.1 -- closes the short-lived authenticated direct-INSERT
-- authority introduced by the original 031 migration.  Kept as a separate
-- corrective migration for any environment that already ran 031; 031 itself
-- is also corrected so a fresh migration run never opens that window.

ALTER TABLE render_executions ENABLE ROW LEVEL SECURITY;

-- An authenticated owner must be able to observe an execution, but must not
-- be able to create one: a row's JSON snapshot is an authoritative future
-- worker command, not browser-authored user data.
DROP POLICY IF EXISTS "render_executions_insert_own" ON render_executions;
REVOKE INSERT ON TABLE render_executions FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE render_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE render_executions TO service_role;

-- ROLLBACK
-- Reinstating browser INSERT is intentionally not an automatic rollback:
-- doing so would reopen the authoritative-snapshot bypass this migration
-- closes.  Restore only through an explicitly reviewed authority design.
