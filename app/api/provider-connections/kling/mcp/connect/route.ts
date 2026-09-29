import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { isConnectionEncryptionConfigured } from '@/lib/provider-connections/crypto'
import { startKlingMcpAuthorization } from '@/lib/provider-connections/kling-mcp-oauth'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Starts the Kling MCP OAuth flow for the AUTHENTICATED user. The browser
// receives only the provider's authorization URL (which carries the public
// state and PKCE *challenge*). The PKCE verifier stays encrypted on the server.
// Requests read-only scopes; never `generation.create`.
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // Fail closed before creating any server-side state.
    if (!isConnectionEncryptionConfigured()) {
      return NextResponse.json(
        { error: 'Conexões de conta ainda não estão disponíveis neste ambiente.', code: 'CONNECTION_ENCRYPTION_NOT_CONFIGURED' },
        { status: 503 },
      )
    }

    const { authorizationUrl } = await startKlingMcpAuthorization(createServiceRoleSupabase(), { userId: user.id })

    return NextResponse.json({ authorizationUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Log the error class only: messages/URLs from the OAuth layer are not logged.
    console.error('[Kling MCP] connect failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      { error: 'Não foi possível iniciar a conexão com a Kling agora.', code: 'PROVIDER_UNAVAILABLE' },
      { status: 502 },
    )
  }
}
