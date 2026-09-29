import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { deleteOwnedConnection, getOwnedConnection } from '@/lib/provider-connections/connections'
import { revokeKlingMcpGrant } from '@/lib/provider-connections/kling-mcp-oauth'
import { deleteConnectionTokens } from '@/lib/provider-connections/token-store'
import { QUEUED_ORPHAN_AGE_MS } from '@/lib/video-generation/poll-constants'

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

    // A paid generation that is still running needs this grant to be retrieved
    // (MCP has no callback). Disconnecting now would strand it, so it is refused
    // until every generation using this connection has finished. Fail closed:
    // if the check itself fails, nothing is deleted.
    // Only jobs that can actually need the grant count: those the provider has
    // accepted (submitted/processing) and a `queued` one that is still plausibly
    // mid-submit. An interrupted `queued` row (no provider task, past the
    // orphan cutoff) can never be retrieved and must not block a disconnect.
    //
    // A connection that is NOT `connected` (revoked/expired/errored) cannot be
    // polled anyway, so keeping its dead tokens protects nothing: the user may
    // always remove them (the dependent jobs then fail with an explicit
    // CONNECTION_UNAVAILABLE message; reconnecting instead would have recovered them).
    const checkActive = owned.status === 'connected'
    const queuedCutoff = new Date(Date.now() - QUEUED_ORPHAN_AGE_MS).toISOString()
    const [inFlight, midSubmit] = checkActive
      ? await Promise.all([
          db.from('video_generations').select('id').eq('connection_id', owned.id).in('status', ['submitted', 'processing']).limit(1),
          db.from('video_generations').select('id').eq('connection_id', owned.id).eq('status', 'queued').gt('created_at', queuedCutoff).limit(1),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    const activeError = inFlight.error ?? midSubmit.error
    const active = [...(inFlight.data ?? []), ...(midSubmit.data ?? [])]
    if (activeError) {
      return NextResponse.json(
        { error: 'Não foi possível verificar gerações em andamento.', code: 'CONNECTION_STORE_UNAVAILABLE' },
        { status: 503 },
      )
    }
    if (active.length > 0) {
      return NextResponse.json(
        {
          error: 'Há vídeos ainda em geração com esta conta. Aguarde a conclusão para desconectar.',
          code: 'CONNECTION_HAS_ACTIVE_GENERATIONS',
        },
        { status: 409 },
      )
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
