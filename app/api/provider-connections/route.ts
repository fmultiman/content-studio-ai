import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listConnectionsForUser } from '@/lib/provider-connections/connections'
import { isConnectionEncryptionConfigured } from '@/lib/provider-connections/crypto'
import { toPublicConnection } from '@/lib/provider-connections/types'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
// Lists the authenticated user's provider connections. Reads through the
// user's own session (RLS `provider_connections_select_own`), and returns only
// the safe public shape — no token material exists in this table.
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const rows = await listConnectionsForUser(supabase, user.id)

    return NextResponse.json(
      {
        connections: rows.map(toPublicConnection),
        // Lets the UI say truthfully whether connecting can work in this environment.
        connectionsAvailable: isConnectionEncryptionConfigured(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[Provider Connections] list failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
