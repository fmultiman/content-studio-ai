import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { ConnectionEncryptionNotConfiguredError } from '@/lib/provider-connections/crypto'
import { completeKlingMcpAuthorization } from '@/lib/provider-connections/kling-mcp-oauth'
import { settingsRedirectPath } from '@/lib/provider-connections/kling-mcp'
import { discardAuthorizationAttempt } from '@/lib/provider-connections/oauth-state'
import type { OAuthCallbackFailure } from '@/lib/provider-connections/types'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// OAuth redirect target. Validates the single-use, user-bound `state`,
// exchanges the code SERVER-SIDE (PKCE), stores the tokens encrypted, then
// 303-redirects to Settings with a short result code only. The authorization
// code, state and tokens never appear in the redirect target or any response.
// Relative `Location` on purpose: the redirect (including the failure paths)
// cannot itself fail because of a missing or invalid base-URL configuration.
function see(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function redirectTo(result: 'connected' | OAuthCallbackFailure) {
  return see(settingsRedirectPath(result))
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const state = params.get('state')
  const providerError = params.get('error')
  const iss = params.get('iss') ?? undefined

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return see('/login')
    }

    const db = createServiceRoleSupabase()

    if (providerError) {
      if (state) await discardAuthorizationAttempt(db, state)
      return redirectTo(providerError === 'access_denied' ? 'provider_denied' : 'provider_error')
    }

    if (!code || !state) return redirectTo('missing_parameters')

    const result = await completeKlingMcpAuthorization(db, { userId: user.id, state, code, iss })
    return redirectTo(result.ok ? 'connected' : result.failure)
  } catch (error) {
    console.error('[Kling MCP] callback failed:', error instanceof Error ? error.name : 'unknown')
    return redirectTo(error instanceof ConnectionEncryptionNotConfiguredError ? 'encryption_unavailable' : 'exchange_failed')
  }
}
