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
import { classifyExecutionEnvironment, type PolicyEnv } from '@/lib/providers/execution-policy'
import { resolveAdminCredential } from '@/lib/supabase/admin-credential'

export class ServiceRoleNotConfiguredError extends Error {
  readonly code = 'SERVICE_ROLE_NOT_CONFIGURED'
  constructor() {
    super('Service role client is not configured.')
    this.name = 'ServiceRoleNotConfiguredError'
  }
}

// FUTURE-050: an ordinary local `next dev` must not silently inherit admin authority over a (possibly Production)
// database just because `vercel env pull` put the service-role key in `.env.local`. A local runtime must name the
// Supabase project it is allowed to administer; the value must equal the project ref in NEXT_PUBLIC_SUPABASE_URL.
export const LOCAL_SERVICE_ROLE_PROJECT_REF_ENV = 'CONTENT_STUDIO_LOCAL_SERVICE_ROLE_PROJECT_REF'

export class ServiceRoleNotPermittedError extends Error {
  readonly code = 'SERVICE_ROLE_NOT_PERMITTED_LOCALLY'
  constructor() {
    super(`Service-role access from a local runtime requires ${LOCAL_SERVICE_ROLE_PROJECT_REF_ENV}=<project ref>.`)
    this.name = 'ServiceRoleNotPermittedError'
  }
}

export function supabaseProjectRef(url: string | undefined): string | null {
  try {
    const host = new URL(url ?? '').hostname
    return host.endsWith('.supabase.co') ? host.split('.')[0] : null
  } catch {
    return null
  }
}

export function assertServiceRolePermitted(env: PolicyEnv = process.env): void {
  if (classifyExecutionEnvironment(env) !== 'local') return
  const ref = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL)
  if (!ref || env[LOCAL_SERVICE_ROLE_PROJECT_REF_ENV] !== ref) throw new ServiceRoleNotPermittedError()
}

// The key is passed to supabase-js untouched: it accepts the secret API key (sb_secret_...)
// (see admin-credential.ts). Throws AdminCredentialMalformedError for any other shape.
function buildServiceRoleClient(supabaseUrl: string, key: string): SupabaseClient {
  assertServiceRolePermitted()
  return createServiceRoleClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function createServiceRoleSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const credential = resolveAdminCredential()
  if (!supabaseUrl || !credential) throw new ServiceRoleNotConfiguredError()
  return buildServiceRoleClient(supabaseUrl, credential.key)
}

/** Same client and the same local-runtime guard, for routes that answer 503 when the service is not configured. */
export function createServiceRoleSupabaseOrNull(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const credential = resolveAdminCredential()
  if (!supabaseUrl || !credential) return null
  return buildServiceRoleClient(supabaseUrl, credential.key)
}
