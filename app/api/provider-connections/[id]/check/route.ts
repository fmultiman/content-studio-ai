import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { checkKlingMcpConnection } from '@/lib/provider-connections/connection-check'
import type { ProviderConnectionErrorCode } from '@/lib/provider-connections/types'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Read-only validation of the authenticated user's own connection: MCP
// initialize, tools/list, who_am_i, query_membership_and_credits. No
// generation tool can be reached. The response carries safe metadata and a
// LIVE credit read for display; the balance is never stored.
const HTTP_STATUS: Record<ProviderConnectionErrorCode, number> = {
  PROVIDER_AUTHORIZATION_REQUIRED: 409,
  PROVIDER_SCOPE_INSUFFICIENT: 403,
  PROVIDER_CONNECTION_INVALID: 409,
  PROVIDER_CLIENT_REJECTED: 409,
  CONNECTION_STORE_UNAVAILABLE: 503,
  PROVIDER_TOOL_ERROR: 502,
  PROVIDER_UNAVAILABLE: 502,
  CONNECTION_ENCRYPTION_NOT_CONFIGURED: 503,
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const outcome = await checkKlingMcpConnection(createServiceRoleSupabase(), { connectionId: id, userId: user.id })

    if (outcome.ok) {
      return NextResponse.json(
        { connection: outcome.connection, credits: outcome.credits },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (outcome.notFound) {
      return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 })
    }

    // `connectionStatus` is included only when it was actually persisted.
    return NextResponse.json(
      {
        error: 'Não foi possível verificar a conexão.',
        code: outcome.code,
        ...(outcome.connectionStatus ? { connectionStatus: outcome.connectionStatus } : {}),
      },
      { status: HTTP_STATUS[outcome.code] ?? 502 },
    )
  } catch (error) {
    console.error('[Kling MCP] check failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
