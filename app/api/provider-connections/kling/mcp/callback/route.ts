import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { ConnectionEncryptionNotConfiguredError } from '@/lib/provider-connections/crypto'
import { completeKlingMcpAuthorization } from '@/lib/provider-connections/kling-mcp-oauth'
import { getAppBaseUrl, settingsRedirectUrl } from '@/lib/provider-connections/kling-mcp'
import { discardAuthorizationAttempt } from '@/lib/provider-connections/oauth-state'
import type { OAuthCallbackFailure } from '@/lib/provider-connections/types'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// OAuth redirect target. Validates the single-use, user-bound `state`,
// exchanges the code SERVER-SIDE (PKCE), stores the tokens encrypted, then
// 303-redirects to Settings with a short result code only. The authorization
// code, state and tokens never appear in the redirect target or any response.
function redirectTo(result: 'connected' | OAuthCallbackFailure) {
  const response = NextResponse.redirect(settingsRedirectUrl(result), 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
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
      const login = NextResponse.redirect(new URL('/login', getAppBaseUrl()), 303)
      login.headers.set('Cache-Control', 'no-store')
      return login
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
