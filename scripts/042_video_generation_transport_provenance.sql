-- VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
--
-- Additive provenance + polling state for video_generations. Nothing existing
-- is rewritten or backfilled: every historical row stays valid with NULLs.
--
--   transport      how Content Studio reached the provider for THIS generation
--                  ('rest' | 'mcp'). NULL on rows created before this
--                  migration; those rows were all REST (the only transport
--                  that existed), and application code reads NULL as legacy
--                  REST. It is never inferred from the task id's shape.
--   connection_id  the provider_connections row an MCP generation used.
--                  NULL for REST (the REST credential is user_settings, not a
--                  ProviderConnection). ON DELETE SET NULL: deleting a
--                  connection must never delete or invalidate generation
--                  history; provider/model/transport remain as provenance.
--                  (Disconnect is additionally BLOCKED by the application
--                  while a non-terminal generation depends on it.)
--   next_poll_at / poll_attempts
--                  the only scheduling state the MCP poller needs: when the
--                  row is next due, and how many status checks were made
--                  (drives backoff). Also acts as the lease that stops two
--                  concurrent pollers from checking the same row.
--
-- No secrets are stored in any of these columns.
--
-- Rollback (safe; only additive columns):
--   DROP INDEX IF EXISTS idx_video_generations_mcp_poll_due;
--   ALTER TABLE video_generations
--     DROP COLUMN IF EXISTS poll_attempts, DROP COLUMN IF EXISTS next_poll_at,
--     DROP COLUMN IF EXISTS connection_id, DROP COLUMN IF EXISTS transport;

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS transport TEXT
    CHECK (transport IS NULL OR transport IN ('rest', 'mcp'));

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES provider_connections(id) ON DELETE SET NULL;

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ;

ALTER TABLE video_generations
  ADD COLUMN IF NOT EXISTS poll_attempts INTEGER NOT NULL DEFAULT 0;

-- Only MCP rows that are still in flight are ever polled.
CREATE INDEX IF NOT EXISTS idx_video_generations_mcp_poll_due
  ON video_generations (next_poll_at)
  WHERE transport = 'mcp' AND status IN ('submitted', 'processing');

-- Used to refuse disconnecting a connection that in-flight generations need.
CREATE INDEX IF NOT EXISTS idx_video_generations_connection_active
  ON video_generations (connection_id)
  WHERE connection_id IS NOT NULL AND status IN ('queued', 'submitted', 'processing');
