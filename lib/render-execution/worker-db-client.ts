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

import { createClient as createServiceRoleClient } from '@supabase/supabase-js'

/** Returns null when env vars are absent (caller responds 503). */
export function createWorkerApiDbClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) return null
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
