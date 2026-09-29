// Server-only service-role Supabase client factory.
//
// The service role bypasses RLS. It is used ONLY by trusted server code that
// must touch server-only tables (provider_connection_secrets, ...). Callers
// must always scope by an authenticated user id they verified themselves —
// never a value taken from the request.
//
// Never import this from a client component or any module a client bundle can
// reach. (A source-scan test enforces that only server paths import it.)

import { createClient as createServiceRoleClient, type SupabaseClient } from '@supabase/supabase-js'

export class ServiceRoleNotConfiguredError extends Error {
  readonly code = 'SERVICE_ROLE_NOT_CONFIGURED'
  constructor() {
    super('Service role client is not configured.')
    this.name = 'ServiceRoleNotConfiguredError'
  }
}

export function createServiceRoleSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new ServiceRoleNotConfiguredError()
  return createServiceRoleClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
