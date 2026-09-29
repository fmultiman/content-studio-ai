import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ConnectionsUnavailableError, listVideoGenerationConnections } from '@/lib/video-generation/connections'
import type { VideoConnectionsResponse } from '@/lib/video-generation/capabilities'

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// The server authority for the /videos generation form: which connections the
// authenticated user has, what each one can do (operations, models, controls),
// and why one cannot generate right now. Everything is derived server-side from
// the user's own rows / code-backed REST capabilities; the browser never reads
// provider_connections, never talks to MCP and never sees a token.
//
// It performs NO provider request: MCP capabilities come from the persisted
// snapshot taken by the deliberate "check connection" action, so rendering the
// form can never fan out into provider calls.
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const connections = await listVideoGenerationConnections(supabase, user.id)
    const body: VideoConnectionsResponse = { connections }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ConnectionsUnavailableError) {
      return NextResponse.json(
        { error: 'Não foi possível carregar suas conexões agora.', code: 'CONNECTIONS_UNAVAILABLE' },
        { status: 503 },
      )
    }
    console.error('[Video connections] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
