-- VIDEO_GENERATION_STORAGE_PATH_TENANT_ISOLATION_SECURITY_V1
--
-- video_generations is a SERVER-OWNED table. Its lifecycle/provenance columns
-- (status, task_id, storage_path, public_url, result_metadata, error_details,
-- provider, transport, connection_id, next_poll_at, poll_attempts, ...) are
-- written only by trusted server code running with the service role: the
-- create route, the REST webhook, the manual sync route and the MCP poller.
--
-- Migration 039 gave the table Supabase's default privileges (anon and
-- authenticated: ALL) and RLS policies that only check `auth.uid() = user_id`.
-- RLS has no column awareness, so any signed-in user could INSERT or UPDATE
-- their own row with arbitrary server-owned values — notably `storage_path`,
-- which the playback routes turn into a presigned S3 URL (cross-tenant object
-- disclosure if the attacker knows another tenant's key), but equally a forged
-- `succeeded` state, a swapped `task_id`/`connection_id`, or poll-lease state.
--
-- Fix: the user session may only READ its own rows (and delete its own
-- history). Nothing else is granted back, so no forged value can be written
-- through INSERT or UPDATE. The INSERT/UPDATE policies are dropped as well, so
-- that even an accidental future GRANT would still be denied by RLS.
--
-- Not affected: service_role (bypasses RLS; its grants are re-stated below),
-- FK cascades from projects/productions/auth.users/library_files (executed by
-- the table owner), historical rows (no data is touched).
--
-- Rollback (restores the previous, vulnerable behavior — do not use lightly):
--   GRANT INSERT, UPDATE ON TABLE video_generations TO authenticated;
--   CREATE POLICY "Users can create their own video generations"
--     ON video_generations FOR INSERT WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY "Users can update their own video generations"
--     ON video_generations FOR UPDATE
--     USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE video_generations FROM PUBLIC, anon, authenticated;

GRANT SELECT, DELETE ON TABLE video_generations TO authenticated;
GRANT ALL ON TABLE video_generations TO service_role;

DROP POLICY IF EXISTS "Users can create their own video generations" ON video_generations;
DROP POLICY IF EXISTS "Users can update their own video generations" ON video_generations;
