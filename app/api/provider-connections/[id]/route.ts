import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { deleteOwnedConnection, getOwnedConnection } from '@/lib/provider-connections/connections'
import { revokeKlingMcpGrant } from '@/lib/provider-connections/kling-mcp-oauth'
import { deleteConnectionTokens } from '@/lib/provider-connections/token-store'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Disconnect: revoke the grant at Kling (RFC 7009, best effort), then delete
// the token material and then the connection row (the FK also cascades).
// Touches ONLY this OAuth connection: the Kling REST API key in
// user_settings.kling_api_key and all historical VideoGenerations are untouched.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const db = createServiceRoleSupabase()

    // A foreign or unknown id is indistinguishable from "not found".
    const owned = await getOwnedConnection(db, id, user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Conexão não encontrada' }, { status: 404 })
    }

    const revocation = await revokeKlingMcpGrant(db, owned.id)
    // Explicit token removal (the FK also cascades) so secrets never outlive the connection.
    await deleteConnectionTokens(db, owned.id)
    await deleteOwnedConnection(db, owned.id, user.id)

    return NextResponse.json({ disconnected: true, revocation }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[Kling MCP] disconnect failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
