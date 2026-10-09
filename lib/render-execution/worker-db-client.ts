/**
 * Phase 2I-B2 — server-only service-role Supabase client factory for
 * render-execution worker API routes.
 *
 * Pattern mirrors the existing inline factories in:
 *   app/api/video-drafts/[id]/render/route.ts (write client)
 *   app/api/render-executions/[id]/route.ts   (read client)
 *
 * Centralised here so the three worker-facing routes (claim / fail / complete)
 * don't each duplicate the same factory and env-check logic.
 *
 * Never imported from a browser bundle — this file must not be re-exported
 * through any path that ends up in a client component or page.
 */

import { createServiceRoleSupabaseOrNull } from '@/lib/supabase/service-role'

/**
 * Returns null when the Supabase URL or the admin credential is absent (caller responds 503). The credential is
 * resolved by lib/supabase/admin-credential.ts (SUPABASE_SECRET_KEY, legacy SUPABASE_SERVICE_ROLE_KEY fallback).
 */
export function createWorkerApiDbClient() {
  return createServiceRoleSupabaseOrNull()
}
