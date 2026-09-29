import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { isConnectionEncryptionConfigured } from '@/lib/provider-connections/crypto'
import { startKlingMcpAuthorization } from '@/lib/provider-connections/kling-mcp-oauth'
import type { KlingMcpConnectIntent } from '@/lib/provider-connections/kling-mcp'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Starts the Kling MCP OAuth flow for the AUTHENTICATED user. The browser
// receives only the provider's authorization URL (which carries the public
// state and PKCE *challenge*). The PKCE verifier stays encrypted on the server.
//
// Scopes: READ-ONLY by default. The `generation` intent — the only way
// `generation.create` is ever requested — must come from an explicit user
// action ("Autorizar geração" in Settings); opening /videos or selecting the
// connection never starts it. Re-authorizing reuses the user's single Kling MCP
// connection row (unique per user/provider/method), so no duplicate appears.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // An empty body means the default read-only connect. Anything else must be a known intent.
    let intent: KlingMcpConnectIntent = 'read_only'
    const raw = await request.text()
    if (raw.trim()) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return NextResponse.json({ error: 'Pedido inválido.', code: 'INVALID_INTENT' }, { status: 400 })
      }
      const requested = (parsed as { intent?: unknown } | null)?.intent
      if (requested === 'generation' || requested === 'read_only') {
        intent = requested
      } else if (requested !== undefined) {
        return NextResponse.json({ error: 'Pedido inválido.', code: 'INVALID_INTENT' }, { status: 400 })
      }
    }

    // Fail closed before creating any server-side state.
    if (!isConnectionEncryptionConfigured()) {
      return NextResponse.json(
        { error: 'Conexões de conta ainda não estão disponíveis neste ambiente.', code: 'CONNECTION_ENCRYPTION_NOT_CONFIGURED' },
        { status: 503 },
      )
    }

    const { authorizationUrl } = await startKlingMcpAuthorization(createServiceRoleSupabase(), { userId: user.id, intent })

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
